# G4 evidence: production deploy rehearsal

**Date:** 2026-10-01 · **Where:** local Docker 27.5.1 (Windows 11), `deployment/docker-compose.prod.yml`
**Status of the real cloud deploy:** not yet run. No cloud account or CLI is available on
this machine, so the same images and rules were verified locally. The Render
blueprint (`deployment/render.yaml`) is the target; see `docs/DEPLOYMENT.md`.

The rehearsal uses the exact production images and settings: `NODE_ENV=production`,
secrets from the environment only, migrations as a one-off job from the ledger
image, 2 replicas per API behind a round-robin load balancer.

## 1. Images build from the lockfile and run without node_modules

```
ledgerlab/ledger-api:local     137MB   (was 317MB with the pruned-workspace approach)
ledgerlab/reporting-api:local  136MB
ledgerlab/web:local            50.5MB
```

The original Dockerfiles ran `pnpm prune --prod ... || true`. The prune emptied
every workspace package's `node_modules`, so the APIs could not import
`postgres`, `drizzle-orm` or `hono` at runtime, and `|| true` hid it. Found when
the migration job failed with `Cannot find package 'postgres'`. Fixed by
bundling all dependencies with tsup and shipping `dist/` alone.

## 2. Migrations run as a deploy step, not on boot

```
$ docker logs ledgerlab-prod-migrate-1
Applied 0000_init.sql
Applied 0001_amount_minor_bigint.sql
Applied 0002_integrity.sql
```

The APIs start only after this job exits 0 (`service_completed_successfully`).
On Render the same command is the `preDeployCommand`: `node dist/migrate.js`.

## 3. Health, internal boundary, CORS, headers

```
$ curl localhost:4001/health
{"status":"ok","service":"ledger-api","version":"0.1.0","uptimeSeconds":29,"repository":"postgres"}
$ curl localhost:4001/api/internal/postings            # no token
{"error":{"code":"UNAUTHORIZED","message":"Invalid internal token"}} 401
$ curl -H "Origin: https://evil.example" -D - localhost:4001/api/accounts
(no Access-Control-Allow-Origin header)
$ curl -D - localhost:8080/
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; ... connect-src 'self' http://localhost:4001 http://localhost:4002; frame-ancestors 'none'; ...
```

With the database paused, `/health` returns `503 {"status":"degraded"}` (verified
in G3 against the same code).

## 4. Load is spread across replicas

40 requests through the load balancer: replica 1 served 20, replica 2 served 22.

## 5. Zero-error rolling stop

300 sequential requests to `/api/journal-entries` while `docker stop` sent SIGTERM
to ledger replica 1:

```
    300 200
[ledger-api] SIGTERM received, shutting down
exit=0
```

No failed request; the replica drained and exited cleanly.

## 6. Latency at real volume

One month at the client's real volume was loaded: 31,000 entries / 62,010 lines
(Warung Books records ~62,000 lines a month). `autocannon`, 10 connections, 15 s,
through the load balancer to 2 replicas:

| Endpoint                                     | Before (JS over all postings)           | After (SQL `GROUP BY`)                            |
| -------------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| `GET /api/reports/trial-balance`             | 6 req/s · p50 1,564 ms · p99 2,779 ms   | 73 req/s · p50 128 ms · p97.5 218 ms · p99 250 ms |
| `GET /api/reports/dashboard` (reporting)     | 3.7 req/s · p50 1,234 ms · p99 1,963 ms | 64 req/s · p50 148 ms · p97.5 248 ms · p99 312 ms |
| `GET /api/reports/balance-sheet` (reporting) | —                                       | 71 req/s · p50 130 ms · p97.5 227 ms · p99 264 ms |
| `GET /api/journal-entries?pageSize=25`       | 333 req/s · p50 27 ms · p99 67 ms       | 462 req/s · p50 20 ms · p99 40 ms                 |

Zero non-2xx responses and zero errors in every run. The reports previously
loaded every posting into JavaScript (and the reporting API pulled all 62,010
rows over HTTP per request); they now read per-account totals aggregated by
Postgres. Remaining limit: the aggregate still scans the whole date range, so
cost grows with history; monthly snapshots are the next step (see the
infrastructure plan).
