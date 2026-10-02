#!/usr/bin/env bash
# Deploy to AWS ECS Fargate (infra/aws). Started by hand from GitHub Actions
# (.github/workflows/deploy.yml, Run workflow), or locally from the repo root
# with AWS credentials for the target account (aws sso login):
#
#   DOMAIN=ledgerlab.example.com AWS_REGION=ap-southeast-3 deployment/aws/deploy.sh
#
# Order: build -> push -> migrate with the NEW image (migrations
# stay backward compatible for one release, so the old tasks keep working) ->
# roll the services. The very first deploy creates everything with 0 tasks,
# migrates (which creates the app role), then scales to 2 per service.
set -euo pipefail

: "${DOMAIN:?set DOMAIN, e.g. ledgerlab.example.com}"
REGION="${AWS_REGION:-ap-southeast-3}"
# Images are tagged with the commit they were built from; to roll back, deploy an
# existing tag with cdk (deployment/aws/README.md), do not rebuild.
git diff --quiet HEAD || { echo "uncommitted changes: commit first, images are tagged with the git SHA" >&2; exit 1; }
TAG=$(git rev-parse --short HEAD)
export AWS_REGION="$REGION" CDK_DISABLE_VERSION_CHECK=1
# REVIEW=true: short-lived review stack (NAT instance, single-AZ DB); see README.
cdk() { pnpm --filter @ledgerlab/infra-aws exec cdk "$@" --require-approval never -c region="$REGION" -c review="${REVIEW:-false}"; }
output() {
  aws cloudformation describe-stacks --stack-name LedgerLab \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

migrate() {
  echo "==> running migrations ($TAG)"
  local task
  task=$(aws ecs run-task --cluster "$(output ClusterName)" --launch-type FARGATE \
    --task-definition "$(output MigrateTaskDefinition)" \
    --network-configuration "awsvpcConfiguration={subnets=[$(output AppSubnets)],securityGroups=[$(output MigrateSecurityGroup)],assignPublicIp=DISABLED}" \
    --query 'tasks[0].taskArn' --output text)
  aws ecs wait tasks-stopped --cluster "$(output ClusterName)" --tasks "$task"
  local code
  code=$(aws ecs describe-tasks --cluster "$(output ClusterName)" --tasks "$task" \
    --query 'tasks[0].containers[0].exitCode' --output text)
  if [ "$code" != "0" ]; then
    echo "migration failed (exit $code); services were not changed. Logs: CloudWatch group LedgerLab-migrateLogs*" >&2
    exit 1
  fi
}

echo "==> registry"
cdk deploy LedgerLabRegistry

# Ask ECR for the registry host instead of assuming *.amazonaws.com (LocalStack differs).
REGISTRY=$(aws ecr describe-repositories --repository-names ledgerlab/web \
  --query 'repositories[0].repositoryUri' --output text)
REGISTRY="${REGISTRY%/ledgerlab/web}"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"

echo "==> images ($TAG)"
docker build -f deployment/Dockerfile.ledger-api -t "$REGISTRY/ledgerlab/ledger-api:$TAG" .
docker build -f deployment/Dockerfile.reporting-api -t "$REGISTRY/ledgerlab/reporting-api:$TAG" .
# Vite inlines the API origins at build time.
docker build -f deployment/Dockerfile.web \
  --build-arg VITE_LEDGER_API_URL="https://${DOMAIN%%.*}-api.${DOMAIN#*.}" \
  --build-arg VITE_REPORTING_API_URL="https://${DOMAIN%%.*}-reports.${DOMAIN#*.}" \
  -t "$REGISTRY/ledgerlab/web:$TAG" .
docker tag "$REGISTRY/ledgerlab/ledger-api:$TAG" "$REGISTRY/ledgerlab/ledger-api:migrate"
for image in ledger-api:$TAG ledger-api:migrate reporting-api:$TAG web:$TAG; do
  docker push "$REGISTRY/ledgerlab/$image"
done

# 0 or missing (no stack yet, or a first deploy that stopped before scaling): first-deploy path.
if [ "$(output TasksPerService 2>/dev/null)" -gt 0 ] 2>/dev/null; then
  migrate
  echo "==> rolling services to $TAG"
  cdk deploy LedgerLab -c domainName="$DOMAIN" -c imageTag="$TAG"
else
  echo "==> first deploy: creating or updating the stack with 0 tasks"
  echo "    ACM waits for DNS validation: add the CNAMEs shown in the ACM console to Cloudflare (DNS only)."
  cdk deploy LedgerLab -c domainName="$DOMAIN" -c imageTag="$TAG" -c tasksPerService=0
  migrate
  echo "==> scaling to 2 tasks per service"
  cdk deploy LedgerLab -c domainName="$DOMAIN" -c imageTag="$TAG"
fi

echo "==> done. Load balancer: $(output AlbDnsName)"
