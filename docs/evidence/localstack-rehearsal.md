# AWS deploy rehearsed on LocalStack

**Date:** 2026-10-02 · **Emulator:** LocalStack 2026.8.5 (trial licence; the free
plan does not include ECS, ECR, RDS, ELBv2, Cloud Map or autoscaling) ·
**Commit deployed:** `7dac866`

The point: run the real `deployment/aws/deploy.sh` and the real CDK stacks end to
end before spending money on an AWS account. Only the endpoint and credentials
differ (`deployment/aws/localstack.sh`).

```
docker compose --profile localstack up -d localstack   # LOCALSTACK_AUTH_TOKEN in .env
deployment/aws/localstack.sh
```

## Result

`deploy.sh` exited 0 in **5 min 38 s** and followed the first-deploy path:
bootstrap → `LedgerLabRegistry` → build and push three images tagged `7dac866`
→ `LedgerLab` with 0 tasks → migration task (exit 0) → `LedgerLab` at 2 tasks
per service.

| Check (through the emulated ALB, HTTPS listener)        | Result                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Host routing: `api.`, `reports.`, apex                  | 200 on each health check; unknown host → 404 (default action)                                                          |
| Origin lock: `/api/accounts` without `X-Origin-Secret`  | **403**; with the secret from Secrets Manager: 200                                                                     |
| `/api/internal/account-totals` without the bearer token | **401**                                                                                                                |
| Secure headers on API responses                         | HSTS (1 year, preload), `default-src 'none'` CSP, `X-Frame-Options: DENY`                                              |
| Fresh production database                               | empty (`{"data":[]}`): production is never seeded                                                                      |
| Post a balanced entry / an unbalanced one               | **201** / **422**                                                                                                      |
| Trial balance as of 2026-10-31                          | Dr 125,000 = Cr 125,000, `balanced: true` (ledger task → emulated RDS Postgres with the migrated triggers and rollups) |
| Web task                                                | serves the SPA (`<title>LedgerLab</title>`)                                                                            |
| Migration task                                          | ran as a one-off ECS task from the ledger image, exit 0, before any service started                                    |

## Second run: the update path, and Service Connect stood in for

`localstack.sh` again (commit `51acb4e`): **2 min 41 s**, exit 0, this time the
existing-stack path. The migration task re-applied every migration to a database
that already held data, then the services rolled to the new image. Afterwards
the trial balance was unchanged (Dr 125,000 = Cr 125,000) and the new tasks
served it.

LocalStack accepts the Service Connect configuration (`describe-services` shows
the `ledger-api` client alias) but registers nothing in Cloud Map, and tasks
resolve names through Docker's embedded DNS (`127.0.0.11`), so `ledger-api` did
not resolve (`EAI_AGAIN`) and reporting timed out. `localstack.sh` now gives the
ledger containers the Docker network alias `ledger-api` after the deploy, which
is what Service Connect provides on AWS. The stacks are unchanged. With it,
through the ALB on `reports.`: income statement revenue 125,000; balance sheet
assets 125,000 = equity 125,000; dashboard 1 entry. That is reporting-api calling
ledger-api with the internal token from Secrets Manager, ledger-api reading RDS.

## What LocalStack still cannot show

| Gap                                                                                                                                                                       | Evidence                                        | Real AWS                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Service Connect itself (the Envoy proxy, retries, its health-based routing)                                                                                               | stood in for by a Docker alias, see above       | proved only by the real deploy                                            |
| Task counts: after the 0 → 2 scale-up two services ran 3 tasks; after the roll each service kept one old-image task. `update-service --desired-count 2` did not reconcile | `describe-services`, `docker ps`                | ECS stops surplus tasks; `desiredCount` 2 is asserted in `infra/aws/test` |
| Availability zones, Multi-AZ failover, NAT, the Cloudflare-only security group (no network enforcement), ACM DNS validation                                               | single machine; certificates issued without DNS | proved only by the real deploy (go-live checklist)                        |

So the rehearsal proves the CloudFormation resources are created, both deploy
paths run in the right order (migrate before services change; the app role
comes from the migration; re-applied migrations keep data), secrets reach the
tasks, the edge-facing rules hold, and every request path works. It does not
prove anything about availability or the network rules.

## Fixed because of this run

`deploy.sh` built the registry host as `<account>.dkr.ecr.<region>.amazonaws.com`.
It now asks ECR for the repository URI, which is correct on LocalStack and on
real AWS alike.
