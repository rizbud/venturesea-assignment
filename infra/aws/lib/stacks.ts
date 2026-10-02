import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export const REPOSITORIES = ["ledger-api", "reporting-api", "web"] as const;
type RepositoryName = (typeof REPOSITORIES)[number];
const repositoryName = (name: RepositoryName) => `ledgerlab/${name}`;

/** The migration task always runs the image most recently pushed with this tag (deploy.sh). */
export const MIGRATE_TAG = "migrate";

/**
 * Cloudflare's IPv4 ranges (https://www.cloudflare.com/ips-v4, read 2026-10-01).
 * Only these may reach the load balancer. Cloudflare announces changes in
 * advance; re-check the list quarterly. The ALB is IPv4-only, so Cloudflare
 * connects over IPv4 and the IPv6 ranges are not needed.
 */
export const CLOUDFLARE_IPV4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

/** Image registries. Deployed first so images exist before any service needs one. */
export class RegistryStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    for (const name of REPOSITORIES) {
      new ecr.Repository(this, name, {
        repositoryName: repositoryName(name),
        imageScanOnPush: true,
        lifecycleRules: [{ maxImageCount: 30 }],
        removalPolicy: RemovalPolicy.RETAIN,
      });
    }
  }
}

export interface LedgerLabStackProps extends StackProps {
  /** Host served by the dashboard; the APIs live on <name>-api.<parent> and <name>-reports.<parent>. */
  domainName: string;
  /** Image tag (git SHA) for the three services. */
  imageTag: string;
  /** Tasks per service. 0 only for the first deploy, before the migration has created the app role. */
  tasksPerService?: number;
  multiAz?: boolean;
  /**
   * Short-lived review deployment: a t4g.nano NAT instance instead of a NAT
   * gateway and a smaller ledger task. Production keeps the defaults.
   */
  review?: boolean;
}

/** NAT setup with tools the AL2023 minimal image has (dnf, ip); stops on any failure. */
function natUserData() {
  const userData = ec2.UserData.forLinux();
  userData.addCommands(
    "set -euxo pipefail",
    "dnf install -y iptables-services",
    "echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/90-nat.conf",
    "sysctl -p /etc/sysctl.d/90-nat.conf",
    "iptables -t nat -A POSTROUTING -o \"$(ip route show default | awk '{print $5; exit}')\" -j MASQUERADE",
    "iptables -F FORWARD",
    "iptables-save > /etc/sysconfig/iptables",
    "systemctl enable --now iptables",
  );
  return userData;
}

/**
 * Production on ECS Fargate: Cloudflare -> ALB (Cloudflare IPs only) -> web,
 * ledger-api, reporting-api (2+ tasks each, private subnets) -> RDS Postgres 16
 * (isolated subnets). Mirrors deployment/render.yaml and docker-compose.prod.yml.
 */
export class LedgerLabStack extends Stack {
  constructor(scope: Construct, id: string, props: LedgerLabStackProps) {
    super(scope, id, props);
    const { domainName, imageTag, tasksPerService = 2, review = false, multiAz = !review } = props;
    // Siblings, not sub-subdomains: Cloudflare Universal SSL covers *.<parent> only.
    const apiHost = domainName.replace(".", "-api.");
    const reportsHost = domainName.replace(".", "-reports.");

    // ponytail: one NAT instance, no failover; fine for a review stack that lives
    // for days. Production (review = false) uses a NAT gateway.
    const natInstance = review
      ? ec2.NatProvider.instanceV2({
          // nano (512 MB) runs out of memory in the setup script's dnf install.
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
          // User data runs once per instance: changing the image is what replaces a broken NAT.
          machineImage: ec2.MachineImage.fromSsmParameter(
            "/aws/service/ami-amazon-linux-latest/al2023-ami-minimal-kernel-6.1-arm64",
          ),
          userData: natUserData(),
          // The CDK default admits all inbound IPv4; only the VPC may route through it.
          defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
        })
      : undefined;
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      // ponytail: one NAT gateway (image pulls, logs, secrets) is a single AZ for
      // outbound traffic only; add one per AZ, or VPC endpoints, if an AZ outage
      // must not block new task starts.
      natGateways: 1,
      natGatewayProvider: natInstance,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });

    natInstance?.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTraffic());

    // Generated by Secrets Manager: never in the template, the images or git.
    const appDbSecret = new secretsmanager.Secret(this, "AppDbSecret", {
      description: "ledgerlab_app runtime role; the migration task creates/rotates the role from it",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "ledgerlab_app" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
    const internalToken = new secretsmanager.Secret(this, "InternalApiToken", {
      description: "Bearer token for /api/internal/* (reporting -> ledger)",
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });
    const originSecret = new secretsmanager.Secret(this, "OriginSecret", {
      description: "X-Origin-Secret value; add it as a Cloudflare request-header transform rule",
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });

    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.SMALL),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      multiAz,
      databaseName: "ledgerlab",
      // The master user owns the schema and is used only by the migration task.
      credentials: rds.Credentials.fromGeneratedSecret("ledgerlab"),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      publiclyAccessible: false,
      backupRetention: Duration.days(7),
      // Review stacks are torn down after the review; the snapshot on delete still applies.
      deletionProtection: !review,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      cloudwatchLogsExports: ["postgresql"],
    });
    // RDS for Postgres 15+ forces TLS (rds.force_ssl = 1).
    const dbEnv = {
      PGHOST: db.dbInstanceEndpointAddress,
      PGPORT: db.dbInstanceEndpointPort,
      PGDATABASE: "ledgerlab",
      PGSSLMODE: "require",
    };

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      defaultCloudMapNamespace: { name: "ledgerlab.internal", useForServiceConnect: true },
    });

    const repositories = new Map<RepositoryName, ecr.IRepository>();
    const image = (name: RepositoryName, tag = imageTag) => {
      if (!repositories.has(name)) {
        repositories.set(
          name,
          ecr.Repository.fromRepositoryName(this, `${name}Repository`, repositoryName(name)),
        );
      }
      return ecs.ContainerImage.fromEcrRepository(repositories.get(name)!, tag);
    };

    const task = (
      name: string,
      size: { cpu: number; memoryLimitMiB: number },
      container: Omit<ecs.ContainerDefinitionOptions, "logging">,
    ) => {
      const definition = new ecs.FargateTaskDefinition(this, `${name}Task`, {
        ...size,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      definition.addContainer(name, {
        ...container,
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: name, logGroup }),
      });
      return definition;
    };

    const common = {
      NODE_ENV: "production",
      CORS_ORIGINS: `https://${domainName}`,
      // Safe because the ALB accepts only Cloudflare (CLOUDFLARE_IPV4).
      CLIENT_IP_HEADER: "cf-connecting-ip",
    };
    const sharedSecrets = {
      INTERNAL_API_TOKEN: ecs.Secret.fromSecretsManager(internalToken),
      ORIGIN_SECRET: ecs.Secret.fromSecretsManager(originSecret),
    };

    const ledgerTask = task(
      "ledger-api",
      review ? { cpu: 256, memoryLimitMiB: 512 } : { cpu: 512, memoryLimitMiB: 1024 },
      {
        image: image("ledger-api"),
        environment: {
          ...common,
          ...dbEnv,
          LEDGER_API_PORT: "4001",
          PGUSER: "ledgerlab_app",
          DATABASE_POOL_MAX: "10",
        },
        secrets: { ...sharedSecrets, PGPASSWORD: ecs.Secret.fromSecretsManager(appDbSecret, "password") },
        portMappings: [{ containerPort: 4001, name: "ledger-api" }],
      },
    );
    const reportingTask = task(
      "reporting-api",
      { cpu: 256, memoryLimitMiB: 512 },
      {
        image: image("reporting-api"),
        // Service Connect resolves ledger-api inside the cluster; never via the ALB.
        environment: { ...common, REPORTING_API_PORT: "4002", LEDGER_API_URL: "http://ledger-api:4001" },
        secrets: sharedSecrets,
        portMappings: [{ containerPort: 4002, name: "reporting-api" }],
      },
    );
    const webTask = task(
      "web",
      { cpu: 256, memoryLimitMiB: 512 },
      {
        image: image("web"),
        environment: { CSP_CONNECT_SRC: `https://${apiHost} https://${reportsHost}` },
        portMappings: [{ containerPort: 8080, name: "web" }],
      },
    );
    // One-off deploy step (deploy.sh runs it before rolling the services), as the schema owner.
    const migrateTask = task(
      "migrate",
      { cpu: 256, memoryLimitMiB: 512 },
      {
        image: image("ledger-api", MIGRATE_TAG),
        command: ["node", "dist/migrate.js"],
        environment: dbEnv,
        secrets: {
          PGUSER: ecs.Secret.fromSecretsManager(db.secret!, "username"),
          PGPASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
          APP_DB_PASSWORD: ecs.Secret.fromSecretsManager(appDbSecret, "password"),
        },
      },
    );

    const service = (
      name: string,
      taskDefinition: ecs.FargateTaskDefinition,
      serviceConnectConfiguration?: ecs.ServiceConnectProps,
    ) => {
      const svc = new ecs.FargateService(this, `${name}Service`, {
        cluster,
        taskDefinition,
        desiredCount: tasksPerService,
        // Rolling deploys never drop below the running count; a release that
        // never turns healthy is rolled back automatically.
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        circuitBreaker: { enable: true, rollback: true },
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        healthCheckGracePeriod: Duration.seconds(30),
        serviceConnectConfiguration,
      });
      if (tasksPerService > 0) {
        svc
          .autoScaleTaskCount({ minCapacity: tasksPerService, maxCapacity: 6 })
          .scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 70 });
      }
      return svc;
    };

    const ledger = service("ledger-api", ledgerTask, {
      services: [{ portMappingName: "ledger-api", dnsName: "ledger-api", port: 4001 }],
    });
    const reporting = service("reporting-api", reportingTask, {});
    // Service Connect goes task to task, so the ledger must admit reporting directly.
    ledger.connections.allowFrom(reporting, ec2.Port.tcp(4001), "reporting-api via Service Connect");
    const web = service("web", webTask);

    const migrateSecurityGroup = new ec2.SecurityGroup(this, "MigrateSg", {
      vpc,
      description: "Migration task (needs Postgres and outbound for image pull)",
    });
    db.connections.allowDefaultPortFrom(ledger, "ledger-api tasks");
    db.connections.allowDefaultPortFrom(migrateSecurityGroup, "migration task");

    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "HTTPS from Cloudflare only",
      allowAllOutbound: true,
    });
    for (const cidr of CLOUDFLARE_IPV4)
      albSecurityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(443));
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      dropInvalidHeaderFields: true,
    });
    // DNS-validated: during the first deploy, add the CNAMEs ACM shows to Cloudflare (DNS only, not proxied).
    const certificate = new acm.Certificate(this, "Certificate", {
      domainName,
      subjectAlternativeNames: [apiHost, reportsHost],
      validation: acm.CertificateValidation.fromDns(),
    });
    // No port 80 listener: Cloudflare redirects to HTTPS at the edge.
    const https = alb.addListener("Https", {
      port: 443,
      // CDK opens a listener to 0.0.0.0/0 by default; ingress is the Cloudflare list above.
      open: false,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not found",
      }),
    });
    const route = (
      name: string,
      target: ecs.FargateService,
      host: string,
      port: number,
      path: string,
      priority: number,
    ) =>
      https.addTargets(name, {
        priority,
        conditions: [elbv2.ListenerCondition.hostHeaders([host])],
        protocol: elbv2.ApplicationProtocol.HTTP,
        port,
        targets: [target],
        healthCheck: { path, interval: Duration.seconds(15), healthyThresholdCount: 2 },
        // ECS takes a stopping task out of the ALB, waits this long for in-flight
        // requests, then sends SIGTERM (the apps drain and exit within 10 s).
        deregistrationDelay: Duration.seconds(15),
      });
    route("ledger", ledger, apiHost, 4001, "/health", 10);
    route("reporting", reporting, reportsHost, 4002, "/health", 20);
    route("web", web, domainName, 8080, "/healthz", 30);

    new CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "Point the three Cloudflare CNAMEs (proxied) here",
    });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    // deploy.sh resumes an unfinished first deploy while this is 0.
    new CfnOutput(this, "TasksPerService", { value: String(tasksPerService) });
    new CfnOutput(this, "MigrateTaskDefinition", { value: migrateTask.taskDefinitionArn });
    new CfnOutput(this, "MigrateSecurityGroup", { value: migrateSecurityGroup.securityGroupId });
    new CfnOutput(this, "AppSubnets", {
      value: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds.join(","),
    });
    new CfnOutput(this, "OriginSecretArn", {
      value: originSecret.secretArn,
      description: "Read once and put the value in the Cloudflare transform rule",
    });
  }
}

export interface GithubDeployStackProps extends StackProps {
  /**
   * owner/name of the GitHub repository whose `production` environment may deploy,
   * exactly as its OIDC `sub` claim spells it (repositories with immutable subjects
   * use owner@id/name@id; see GET /repos/{repo}/actions/oidc/customization/sub).
   */
  repository: string;
}

/**
 * The role GitHub Actions assumes (OIDC, no stored AWS keys) to run
 * deployment/aws/deploy.sh. Deploy once from a signed-in machine.
 */
export class GithubDeployStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubDeployStackProps) {
    super(scope, id, props);
    const provider = new iam.OpenIdConnectProvider(this, "GithubOidc", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });
    const role = new iam.Role(this, "DeployRole", {
      roleName: "ledgerlab-github-deploy",
      description: `GitHub Actions deploys from ${props.repository} (production environment only)`,
      // The first deploy waits for RDS and ACM validation.
      maxSessionDuration: Duration.hours(2),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${props.repository}:environment:production`,
        },
      }),
    });

    const { account, region } = this;
    // cdk deploy: CloudFormation runs with the bootstrap roles, not this one.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${account}:role/cdk-*`],
      }),
    );
    // deploy.sh: find the registry, push images, read stack outputs, run and watch the migration task.
    role.addToPolicy(new iam.PolicyStatement({ actions: ["ecr:GetAuthorizationToken"], resources: ["*"] }));
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:DescribeRepositories",
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ],
        resources: REPOSITORIES.map(
          (name) => `arn:aws:ecr:${region}:${account}:repository/${repositoryName(name)}`,
        ),
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [`arn:aws:cloudformation:${region}:${account}:stack/LedgerLab*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        resources: [`arn:aws:ecs:${region}:${account}:task-definition/LedgerLab*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecs:DescribeTasks"],
        resources: [`arn:aws:ecs:${region}:${account}:task/*`],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [`arn:aws:iam::${account}:role/LedgerLab-*`],
        conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
      }),
    );

    new CfnOutput(this, "DeployRoleArn", {
      value: role.roleArn,
      description: "Set as the AWS_DEPLOY_ROLE_ARN variable of the GitHub production environment",
    });
  }
}
