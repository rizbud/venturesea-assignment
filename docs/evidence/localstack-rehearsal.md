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

## What LocalStack could not show

| Gap                                                                                                                                                               | Evidence                                        | Real AWS                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **ECS Service Connect DNS**: reporting-api → `http://ledger-api:4001` timed out (`UPSTREAM_TIMEOUT`); `ledger-api` does not resolve inside the task (`EAI_AGAIN`) | `dns.lookup` from a reporting container         | Service Connect injects that name; the same call works in the compose rehearsal ([G4](G4-deploy-rehearsal.md)) |
| Task counts: two services ran 3 tasks against a desired count of 2 after the scale-up                                                                             | `describe-services`                             | ECS enforces `desiredCount`                                                                                    |
| Availability zones, Multi-AZ failover, NAT, the Cloudflare-only security group, the ACM DNS validation                                                            | single machine; certificates issued without DNS | proved only by the real deploy (go-live checklist)                                                             |

So the rehearsal proves the CloudFormation resources are created, the deploy
order is right (migrate before any service runs, app role created by the
migration), secrets reach the tasks, and the edge-facing rules hold. It does not
prove internal service discovery or anything about availability.

## Fixed because of this run

`deploy.sh` built the registry host as `<account>.dkr.ecr.<region>.amazonaws.com`.
It now asks ECR for the repository URI, which is correct on LocalStack and on
real AWS alike.
