import { describe, expect, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { CLOUDFLARE_IPV4, GithubDeployStack, LedgerLabStack, RegistryStack } from "../lib/stacks";

const env = { account: "111111111111", region: "ap-southeast-3" };
const synth = (props: { tasksPerService?: number; multiAz?: boolean; review?: boolean } = {}) =>
  Template.fromStack(
    new LedgerLabStack(new App(), "LedgerLab", {
      env,
      domainName: "ledgerlab.example.com",
      imageTag: "abc123",
      ...props,
    }),
  );

describe("LedgerLab stack", () => {
  const template = synth();

  it("runs every service as at least 2 Fargate tasks, rolling without dropping below 2", () => {
    template.resourceCountIs("AWS::ECS::Service", 3);
    template.allResourcesProperties("AWS::ECS::Service", {
      DesiredCount: 2,
      LaunchType: "FARGATE",
      DeploymentConfiguration: Match.objectLike({
        MinimumHealthyPercent: 100,
        MaximumPercent: 200,
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
      NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "DISABLED" }) },
    });
    template.resourceCountIs("AWS::ApplicationAutoScaling::ScalableTarget", 3);
    template.allResourcesProperties("AWS::ApplicationAutoScaling::ScalableTarget", {
      MinCapacity: 2,
      MaxCapacity: 6,
    });
  });

  it("production egress is a NAT gateway; review swaps in one locked-down NAT instance", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 1);
    template.resourceCountIs("AWS::EC2::Instance", 0);

    const review = synth({ review: true });
    review.resourceCountIs("AWS::EC2::NatGateway", 0);
    review.hasResourceProperties("AWS::EC2::Instance", { InstanceType: "t4g.micro", SourceDestCheck: false });
    // The NAT setup script expects the minimal image (dnf + ip, no net-tools).
    review.hasParameter("*", {
      Default: "/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-6.1-arm64",
    });
    review.hasResourceProperties("AWS::RDS::DBInstance", { MultiAZ: false, DeletionProtection: false });
    review.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "256",
      Memory: "512",
      Family: Match.stringLikeRegexp("ledgerapi"),
    });
    const natGroup = Object.values(
      review.findResources("AWS::EC2::SecurityGroup", {
        Properties: { GroupDescription: "Security Group for NAT instances" },
      }),
    )[0]!;
    // Never open to the internet: inbound only from the VPC CIDR.
    const ingress = (natGroup.Properties.SecurityGroupIngress ?? []) as { CidrIp: unknown }[];
    expect(ingress).toHaveLength(1);
    expect(ingress[0]!.CidrIp).not.toBe("0.0.0.0/0");
  });

  it("first deploy (tasksPerService=0) starts nothing until the migration has run", () => {
    const first = synth({ tasksPerService: 0 });
    first.allResourcesProperties("AWS::ECS::Service", { DesiredCount: 0 });
    first.resourceCountIs("AWS::ApplicationAutoScaling::ScalableTarget", 0);
  });

  it("keeps Postgres private, encrypted, Multi-AZ, backed up and deletion-protected", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      EngineVersion: Match.stringLikeRegexp("^16"),
      MultiAZ: true,
      StorageEncrypted: true,
      PubliclyAccessible: false,
      DeletionProtection: true,
      BackupRetentionPeriod: 7,
    });
    template.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Snapshot" });
  });

  it("lets reporting-api reach ledger-api on 4001 (Service Connect is task to task)", () => {
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      IpProtocol: "tcp",
      FromPort: 4001,
      ToPort: 4001,
      Description: "reporting-api via Service Connect",
    });
  });

  it("lets only Cloudflare reach the load balancer, on 443 only", () => {
    const groups = template.findResources("AWS::EC2::SecurityGroup", {
      Properties: { GroupDescription: "HTTPS from Cloudflare only" },
    });
    const ingress = Object.values(groups)[0]!.Properties.SecurityGroupIngress as {
      CidrIp: string;
      FromPort: number;
    }[];
    expect(ingress.map((rule) => rule.CidrIp).sort()).toEqual([...CLOUDFLARE_IPV4].sort());
    expect(new Set(ingress.map((rule) => rule.FromPort))).toEqual(new Set([443]));
  });

  it("injects credentials as secrets, never as plain environment values", () => {
    const definitions = template.findResources("AWS::ECS::TaskDefinition");
    const containers = Object.values(definitions).flatMap(
      (d) => d.Properties.ContainerDefinitions as Record<string, unknown>[],
    );
    const env = (name: string) => containers.find((c) => c.Name === name)!;
    const names = (list: unknown) => (list as { Name: string }[] | undefined)?.map((e) => e.Name) ?? [];

    expect(names(env("ledger-api").Secrets)).toEqual(
      expect.arrayContaining(["PGPASSWORD", "INTERNAL_API_TOKEN", "ORIGIN_SECRET"]),
    );
    expect(names(env("migrate").Secrets)).toEqual(
      expect.arrayContaining(["PGUSER", "PGPASSWORD", "APP_DB_PASSWORD"]),
    );
    for (const container of containers) {
      expect(names(container.Environment)).not.toContain("PGPASSWORD");
      expect(names(container.Environment)).not.toContain("DATABASE_URL");
      expect(names(container.Environment)).not.toContain("INTERNAL_API_TOKEN");
    }
    expect(env("ledger-api").Environment).toEqual(
      expect.arrayContaining([
        { Name: "PGUSER", Value: "ledgerlab_app" },
        { Name: "PGSSLMODE", Value: "require" },
        { Name: "CLIENT_IP_HEADER", Value: "cf-connecting-ip" },
        { Name: "CORS_ORIGINS", Value: "https://ledgerlab.example.com" },
      ]),
    );
    expect(env("migrate").Command).toEqual(["node", "dist/migrate.js"]);
  });

  it("routes each hostname to its service over HTTPS with health checks", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", { Port: 443, Protocol: "HTTPS" });
    template.resourcePropertiesCountIs("AWS::ElasticLoadBalancingV2::Listener", { Port: 80 }, 0);
    for (const [host, path] of [
      ["ledgerlab-api.example.com", "/health"],
      ["ledgerlab-reports.example.com", "/health"],
      ["ledgerlab.example.com", "/healthz"],
    ] as const) {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::ListenerRule", {
        Conditions: [{ Field: "host-header", HostHeaderConfig: { Values: [host] } }],
      });
      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::TargetGroup",
        Match.objectLike({ HealthCheckPath: path }),
      );
    }
  });
});

describe("Registry stack", () => {
  it("creates the three scanned image repositories", () => {
    const template = Template.fromStack(new RegistryStack(new App(), "LedgerLabRegistry", { env }));
    for (const name of ["ledger-api", "reporting-api", "web"]) {
      template.hasResourceProperties("AWS::ECR::Repository", {
        RepositoryName: `ledgerlab/${name}`,
        ImageScanningConfiguration: { ScanOnPush: true },
      });
    }
  });
});

describe("GitHub deploy stack", () => {
  const template = Template.fromStack(
    new GithubDeployStack(new App(), "LedgerLabGithub", { env, repository: "rizbud/venturesea-assignment" }),
  );

  it("trusts only the repository's production environment, through OIDC", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "ledgerlab-github-deploy",
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub":
                  "repo:rizbud/venturesea-assignment:environment:production",
              },
            },
          }),
        ],
      },
    });
  });

  it("grants no wildcard actions and passes roles only to ECS tasks", () => {
    const policies = Object.values(template.findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap(
      (p) => p.Properties.PolicyDocument.Statement as { Action: string | string[]; Condition?: unknown }[],
    );
    const actions = statements.flatMap((s) => [s.Action].flat());
    expect(actions.some((a) => a.endsWith("*"))).toBe(false);
    expect(statements.find((s) => s.Action === "iam:PassRole")?.Condition).toEqual({
      StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" },
    });
  });
});
