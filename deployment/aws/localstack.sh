#!/usr/bin/env bash
# Rehearse deploy.sh against LocalStack instead of a real AWS account.
#
#   docker compose --profile localstack up -d localstack   (LOCALSTACK_AUTH_TOKEN in .env)
#   deployment/aws/localstack.sh
#
# Same script, same CDK stacks, same images; only the endpoint and credentials
# differ. The AWS CLI is borrowed from the LocalStack container when it is not
# installed. Single-machine emulation: no real AZs, failover, TLS or IP rules.
set -euo pipefail

export AWS_ENDPOINT_URL=http://localhost.localstack.cloud:4566
export AWS_ENDPOINT_URL_S3=http://s3.localhost.localstack.cloud:4566
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
export AWS_REGION="${AWS_REGION:-ap-southeast-3}" AWS_DEFAULT_REGION="${AWS_REGION:-ap-southeast-3}"
export CDK_DEFAULT_ACCOUNT=000000000000 CDK_DEFAULT_REGION="$AWS_REGION" CDK_DISABLE_VERSION_CHECK=1
export DOMAIN="${DOMAIN:-ledgerlab.localhost}"

if ! command -v aws >/dev/null; then
  aws() { docker compose exec -T -e AWS_DEFAULT_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY localstack aws --endpoint-url http://localhost:4566 "$@"; }
  export -f aws
fi

pnpm --filter @ledgerlab/infra-aws exec cdk bootstrap "aws://000000000000/$AWS_REGION" -c region="$AWS_REGION"
exec deployment/aws/deploy.sh
