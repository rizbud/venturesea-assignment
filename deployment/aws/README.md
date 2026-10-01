# Deploying LedgerLab on AWS (ECS Fargate)

The production target. Infrastructure is code in [`infra/aws`](../../infra/aws)
(AWS CDK, TypeScript). GitHub Actions ([`deploy.yml`](../../.github/workflows/deploy.yml))
deploys every push to `main` that passes CI by running [`deploy.sh`](deploy.sh),
which builds, migrates and rolls out. AWS access is OIDC: no AWS keys in GitHub.

> **Status (2026-10-01):** the stacks synthesize and are covered by assertion
> tests (`pnpm --filter @ledgerlab/infra-aws test`). They have not been deployed:
> that needs an AWS account, a domain and Cloudflare.

## Shape

```
Cloudflare (TLS, WAF, rate limit, adds X-Origin-Secret)
  │  HTTPS, Cloudflare IPv4 ranges only (ALB security group)
  ▼
ALB :443 ── host ledgerlab.example.com          → web            (2+ tasks, nginx, /healthz)
         ── host api.ledgerlab.example.com      → ledger-api     (2+ tasks, /health)
         ── host reports.ledgerlab.example.com  → reporting-api  (2+ tasks, /health)
                                                   │ Service Connect: http://ledger-api:4001
                                                   ▼  (never through the ALB)
private subnets ── ledger-api ── TLS ──► RDS Postgres 16 (isolated subnets, Multi-AZ,
                                          encrypted, 7-day PITR, deletion-protected)
```

| Resource     | Setting                                                                                                          | Why                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ECS services | `desiredCount 2`, autoscale 2–6 on CPU 70%, min healthy 100%, circuit-breaker rollback                           | ≥ 2 replicas per service across two AZs; deploys never drop below 2        |
| Tasks        | ledger 0.5 vCPU / 1 GB; reporting and web 0.25 vCPU / 0.5 GB; private subnets, no public IP                      | Same sizes as the rehearsal                                                |
| RDS          | `db.t4g.small`, Postgres 16, Multi-AZ, gp storage 20 → 100 GB autoscaling, backups 7 days, snapshot on delete    | Managed DB with tested restore; survives an AZ loss                        |
| Secrets      | Secrets Manager: DB master (migrations only), `ledgerlab_app` password, `INTERNAL_API_TOKEN`, `ORIGIN_SECRET`    | Generated, injected as ECS secrets; nothing in git, images or the template |
| ALB          | HTTPS only (ACM certificate, DNS-validated), ingress from Cloudflare's IPv4 ranges only, invalid headers dropped | Origin reachable only through Cloudflare                                   |
| Network      | 2 AZs; public (ALB, NAT), app (tasks), data (RDS, no route out)                                                  | Least exposure                                                             |
| Logs         | CloudWatch, 30 days per service                                                                                  |                                                                            |

The app reads the database as `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGSSLMODE=require`
(ECS injects the password as its own secret), and the rate limiter keys on
`CF-Connecting-IP` (`CLIENT_IP_HEADER`), which is safe only because the ALB
admits nothing but Cloudflare.

## Prerequisites (once)

1. An AWS account. For the Jakarta region, enable `ap-southeast-3` under
   Account → AWS Regions (it is opt-in). Set a billing budget alarm.
2. On your machine, once: AWS CLI v2 signed in (`aws configure sso`), pnpm.
3. CDK bootstrap for the account and region:
   `pnpm --filter @ledgerlab/infra-aws exec cdk bootstrap aws://<account>/ap-southeast-3`
4. The GitHub deploy role (`ledgerlab-github-deploy`, trusted only by this
   repository's `production` environment):
   `pnpm --filter @ledgerlab/infra-aws exec cdk deploy LedgerLabGithub`
   (the repository is `githubRepository` in `infra/aws/cdk.json`).
5. In GitHub → Settings:
   - **Environments → New environment** `production` (optionally add yourself
     as a required reviewer, so each deploy waits for approval).
   - **Secrets and variables → Actions → Variables** (repository variables):
     `AWS_DEPLOY_ROLE_ARN` = the `DeployRoleArn` output of step 4,
     `DOMAIN` = e.g. `ledgerlab.example.com`, and optionally `AWS_REGION`
     (default `ap-southeast-3`). None of these is a secret.
6. The domain added to Cloudflare (nameservers switched at the registrar).

## Deploy

Push to `main`. When CI passes, the **Deploy** workflow runs `deploy.sh` on the
commit CI tested; one deploy at a time. Run it by hand from the Actions tab
(**Deploy → Run workflow**). Until `AWS_DEPLOY_ROLE_ARN` is set, the workflow
is skipped. The script still runs locally with your own credentials:

```bash
DOMAIN=ledgerlab.example.com AWS_REGION=ap-southeast-3 deployment/aws/deploy.sh
```

**First run.** Watch the workflow log: the script creates the stack with 0 tasks. ACM then waits for DNS
validation: copy the CNAME records shown in ACM (console → Certificate Manager)
into Cloudflare as **DNS only**. Next the migration task creates the schema and
the `ledgerlab_app` role, and the script scales every service to 2 tasks.

**Every run after that:** build → push (git SHA tag) → migration task with the
new image (a failure stops here; nothing changes) → rolling update of the three
services, automatically rolled back if the new tasks do not turn healthy.

## Cloudflare (after the first deploy)

Follow [`../cloudflare/README.md`](../cloudflare/README.md), with these AWS specifics:

- DNS: three **proxied** CNAMEs (`@`, `api`, `reports`) → the `AlbDnsName` stack output.
- SSL/TLS **Full (strict)**: the ALB serves the ACM certificate for all three names.
- Transform rule adding `X-Origin-Secret`: the value is in Secrets Manager
  (`OriginSecretArn` output: `aws secretsmanager get-secret-value --secret-id <arn>`).
  The ALB's IP allow-list stops everyone except Cloudflare; the header stops
  other Cloudflare customers from pointing their own zone at our ALB.

## Operations

| Task                                          | How                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roll back                                     | Actions → an earlier successful **Deploy** run → **Re-run jobs** (it redeploys that commit), or locally `pnpm --filter @ledgerlab/infra-aws exec cdk deploy LedgerLab -c domainName=<domain> -c imageTag=<previous sha>`. The schema stays (migrations are backward compatible for one release). A failed roll is undone by the circuit breaker on its own |
| Scale                                         | Automatic 2–6 per service on CPU; change the bounds in `infra/aws/lib/stacks.ts`                                                                                                                                                                                                                                                                           |
| Rotate `ledgerlab_app` password               | Secrets Manager → rotate `AppDbSecret` value → run the Deploy workflow (the migration task re-applies it with `ALTER ROLE`, then services roll)                                                                                                                                                                                                            |
| Rotate `INTERNAL_API_TOKEN` / `ORIGIN_SECRET` | Update the secret (and the Cloudflare rule for the origin secret), then `aws ecs update-service --force-new-deployment` on each service                                                                                                                                                                                                                    |
| Restore                                       | RDS → restore to a point in time (new instance) → point `PGHOST` at it via a stack change; drill procedure in `docs/evidence/G9-restore-drill.md`                                                                                                                                                                                                          |
| Rollup drift check                            | Not scheduled yet: `SELECT count(*) FROM ledger_rollup_drift` must return 0                                                                                                                                                                                                                                                                                |

## Not included (yet)

- CloudWatch alarms and an SNS topic: external uptime monitoring plus ALB/RDS
  metrics cover go-live; alarms on 5xx rate, p95 latency and RDS CPU are the next step.
- A nightly scheduled task for the rollup drift check, wired to the same alarms.
- VPC endpoints instead of the single NAT gateway (see the `ponytail:` note in the stack).
