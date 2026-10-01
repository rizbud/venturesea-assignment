import { App } from "aws-cdk-lib";
import { LedgerLabStack, RegistryStack } from "../lib/stacks";

// Usage (see deployment/aws/README.md; deploy.sh runs these in order):
//   cdk deploy LedgerLabRegistry
//   cdk deploy LedgerLab -c domainName=ledgerlab.example.com -c imageTag=<git sha> [-c tasksPerService=0]
const app = new App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: app.node.tryGetContext("region") ?? process.env.CDK_DEFAULT_REGION,
};

new RegistryStack(app, "LedgerLabRegistry", { env });

const domainName: string | undefined = app.node.tryGetContext("domainName");
if (domainName) {
  const imageTag: string | undefined = app.node.tryGetContext("imageTag");
  if (!imageTag) throw new Error("-c imageTag=<git sha> is required with -c domainName");
  new LedgerLabStack(app, "LedgerLab", {
    env,
    domainName,
    imageTag,
    tasksPerService: Number(app.node.tryGetContext("tasksPerService") ?? 2),
    multiAz: String(app.node.tryGetContext("multiAz") ?? "true") !== "false",
  });
}
