# Deployment

Target: **AWS ECS Fargate**, Jakarta (`ap-southeast-3`), RDS PostgreSQL 16
Multi-AZ, behind Cloudflare. Infrastructure is CDK code in
[`infra/aws`](../infra/aws); the runbook is
[`deployment/aws/README.md`](../deployment/aws/README.md). Every service runs
**at least 2 tasks** (ADR-001 in the infrastructure plan).

Alternatives kept working, not the target:

- Render — blueprint in [`deployment/render.yaml`](../deployment/render.yaml) (below)
- GCP — [`deployment/gcp/README.md`](../deployment/gcp/README.md)
- Azure — [`deployment/azure/README.md`](../deployment/azure/README.md)
- Cloudflare + TLD — [`deployment/cloudflare/README.md`](../deployment/cloudflare/README.md)

> **Status (2026-10-01):** the production stack is verified locally with the exact
> images and rules ([evidence](evidence/G4-deploy-rehearsal.md)). The AWS stacks
> synthesize and pass assertion tests (`pnpm --filter @ledgerlab/infra-aws test`).
> **Live on AWS since 2026-10-02** (review configuration) at
> https://ledgerlab.rizbud.com ([evidence](evidence/G4-aws-deploy.md)).

## Rehearse the production stack locally (one command)

```bash
export INTERNAL_API_TOKEN=$(openssl rand -hex 32) POSTGRES_PASSWORD=$(openssl rand -hex 16) APP_DB_PASSWORD=$(openssl rand -hex 16)
docker compose -f deployment/docker-compose.prod.yml up -d --build --wait
```

Postgres, a one-off migration job from the ledger image, 2 replicas of each API
behind a round-robin load balancer, and the dashboard on `http://localhost:8080`.
Tear down with `docker compose -f deployment/docker-compose.prod.yml down -v`.

## Deploy to AWS (target)

Deploys are started by hand in GitHub Actions (**Deploy → Run workflow**,
`.github/workflows/deploy.yml`); nothing deploys automatically. The workflow assumes an AWS role through OIDC (no AWS
keys in GitHub) and runs `deployment/aws/deploy.sh`. The script also runs
locally:

```bash
DOMAIN=ledgerlab.example.com AWS_REGION=ap-southeast-3 deployment/aws/deploy.sh
```

It builds and pushes the three images (git SHA tag), runs the migration as a
one-off Fargate task with the new image (a failure stops the deploy before any
service changes), then rolls the services: 2 tasks each, never fewer than 2
healthy during the roll, automatic rollback if new tasks fail health checks.
Prerequisites and the first-run steps are in the
[AWS runbook](../deployment/aws/README.md).

## Deploy to Render (alternative)

First time (about 10 minutes):

1. Push the repository to GitHub.
2. Render Dashboard → **New → Blueprint** → select the repository. The blueprint
   creates the database, both APIs (2 instances each) and the static dashboard.
3. Fill the `sync: false` values: `CORS_ORIGINS` (the dashboard origin) on both
   APIs, and `VITE_LEDGER_API_URL` / `VITE_REPORTING_API_URL` on the dashboard.
   Update the dashboard's `Content-Security-Policy` `connect-src` to the two API
   origins.
4. Confirm the ledger's internal hostname on its **Connect** tab matches
   `LEDGER_API_URL` on the reporting service.

Every deploy after that is **one command**:

```bash
git push origin main
```

`autoDeploy: true` builds the images from the lockfile, runs
`node dist/migrate.js` as the `preDeployCommand` (a failure aborts the deploy
and the old version keeps serving), then rolls the new instances in behind
`/health`.

Verify:

```bash
curl -fsS https://<ledger-api>/health          # {"status":"ok",...,"repository":"postgres"}
curl -fsS https://<reporting-api>/health
curl -s -o /dev/null -w '%{http_code}\n' https://<ledger-api>/api/internal/account-totals   # 401
```

Seed demo data only on a non-production environment
(`pnpm --filter @ledgerlab/db seed` with that environment's `DATABASE_URL`).

## Environment variables

| Variable                 | Service       | Required | Notes                                                                                                     |
| ------------------------ | ------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | both APIs     | prod     | `production` makes missing secrets fatal                                                                  |
| `DATABASE_URL`           | ledger-api    | prod     | `ledgerlab_app` role URL; startup fails without it                                                        |
| `PG*`                    | ledger-api    | or URL   | `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD` `PGSSLMODE`; used when `DATABASE_URL` is unset (ECS) |
| `MIGRATION_DATABASE_URL` | ledger-api    | prod     | owner URL, read only by `dist/migrate.js`; falls back to `DATABASE_URL`, then `PG*`                       |
| `APP_DB_PASSWORD`        | migrate step  | no       | creates `ledgerlab_app` if missing and sets its password                                                  |
| `RATE_LIMIT_PER_MINUTE`  | both APIs     | no       | per IP per instance; ledger 300, reporting 120                                                            |
| `DATABASE_POOL_MAX`      | ledger-api    | no       | default `10` per instance (see DATABASE.md)                                                               |
| `LEDGER_API_PORT`        | ledger-api    | no       | default `$PORT`, then `4001`                                                                              |
| `REPORTING_API_PORT`     | reporting-api | no       | default `$PORT`, then `4002`                                                                              |
| `LEDGER_API_URL`         | reporting-api | yes      | private-network URL of the ledger                                                                         |
| `INTERNAL_API_TOKEN`     | both APIs     | prod     | generated by the platform's secret store                                                                  |
| `CORS_ORIGINS`           | both APIs     | prod     | the dashboard origin; never `*` in production                                                             |
| `ORIGIN_SECRET`          | both APIs     | with CF  | Cloudflare origin lock; else `403` (see cloudflare/)                                                      |
| `CLIENT_IP_HEADER`       | both APIs     | no       | `cf-connecting-ip` only when the origin admits Cloudflare alone (AWS); else right-most `X-Forwarded-For`  |
| `LEDGER_CLOSED_THROUGH`  | ledger-api    | no       | YYYY-MM-DD; books closed through this date                                                                |
| `VITE_LEDGER_API_URL`    | web           | yes      | baked in at build time                                                                                    |
| `VITE_REPORTING_API_URL` | web           | yes      | baked in at build time                                                                                    |
| `CSP_CONNECT_SRC`        | web (Docker)  | yes      | the two API origins, for the CSP                                                                          |

The two `VITE_*` values are **build-time**: change an API host, rebuild the dashboard.

## Images

`deployment/Dockerfile.{ledger-api,reporting-api,web}`, built from the repo root.
Builds install from `pnpm-lock.yaml` (`--frozen-lockfile`). tsup bundles each API
with all of its dependencies, so the runtime image is `node:20-alpine` plus
`dist/`, running as the non-root `node` user: no pnpm and no `node_modules` at
runtime. The ledger image also carries `dist/migrate.js` and the SQL migrations.

```bash
docker build -f deployment/Dockerfile.ledger-api    -t ledgerlab/ledger-api .
docker run --rm -e DATABASE_URL=... ledgerlab/ledger-api node dist/migrate.js   # deploy step
```

CI builds all three images, runs the migration from the runtime image twice, and
boots the API image against Postgres (`.github/workflows/ci.yml`, job `images`).

## What "production-scale" means here (G4)

- [x] **Stateless** services: no local disk; any replica serves any request.
- [x] **≥ 2 replicas** per service: ECS `desiredCount 2`, autoscaling 2–6, minimum
      healthy 100% during deploys (asserted in `infra/aws/test`); rehearsed with
      2 + 2 behind a load balancer.
- [x] **Managed database**: RDS PostgreSQL 16, Multi-AZ, isolated subnets, TLS.
- [x] **Connection pooling**: 10 per instance, idle timeout 20 s (see DATABASE.md).
- [x] **Graceful shutdown**: SIGTERM stops accepting, drains, closes the pool.
      Rehearsal: 300/300 requests succeeded while a replica was stopped.
- [x] **Health checks** gate rollout; `/health` checks the database (503 when down).
- [x] **Migrations as a separate step** (one-off ECS task before the roll), never on boot.
- [x] **Reproducible**: infrastructure as code (CDK); one command deploys.
- [ ] **Observability**: CloudWatch logs and metrics plus an external uptime monitor
      on both `/health` URLs; alert on 5xx and p95. Set up with the real deploy.

## Rollback and migrations

- Keep migrations backward compatible for one release (add columns; never
  rename or drop in the same deploy as the code that stops using them).
- Roll back the app by deploying the previous image tag (AWS runbook,
  Operations), or let the deployment circuit breaker do it for a failed roll. The database still works with it because of the rule above.
- Never roll back by reverting a migration in production unless you have
  verified it is lossless; roll forward with a new migration instead.
