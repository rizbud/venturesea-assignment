# G5 evidence: security hardening

**Date:** 2026-10-01 · **Where:** `deployment/docker-compose.prod.yml` (production images,
`NODE_ENV=production`) and the test suites. Real-deploy items (edge TLS, WAF) are in G6.

## Startup refuses unsafe configuration

```
$ docker run -e NODE_ENV=production -e CORS_ORIGINS='*' ... ledgerlab/ledger-api
Error: CORS_ORIGINS must list the dashboard origin(s) in production; '*' is not allowed

$ docker run -e NODE_ENV=production -e CORS_ORIGINS=https://app.example ledgerlab/reporting-api
Error: INTERNAL_API_TOKEN of at least 32 characters is required in production
```

(Missing `DATABASE_URL` in production: `DATABASE_URL is required in production;
refusing to start on in-memory storage`, from G3.)

## API security headers

```
$ curl -D - localhost:4001/api/accounts
content-security-policy: default-src 'none'; frame-ancestors 'none'
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
ratelimit-limit: 300
ratelimit-remaining: 299
```

## Rate limit

700 sequential requests to `/api/accounts` through the load balancer
(limit 300/min per IP per instance, 2 instances):

```
    690 200
     10 429
```

More than 600 got through because the fixed window rolled over during the burst.
This is the per-instance limitation noted in SECURITY.md §6; the Cloudflare rule
is the authoritative limit.

## Least-privilege runtime role

```
$ psql -c "SELECT usename, count(*) FROM pg_stat_activity WHERE datname='ledgerlab' GROUP BY usename"
ledgerlab|1        <- the operator's psql session
ledgerlab_app|2    <- the two ledger-api instances
```

Under that role, through the API: post → 201, void → 200, deactivate → 200,
reporting dashboard → 200. The Postgres test suite additionally proves the role
is denied `TRUNCATE`, `DELETE`, `UPDATE accounts SET name`, `CREATE TABLE` and
`DROP TRIGGER`.

## Rotation

Internal token (new value deployed to both APIs):

```
old token -> 401
new token -> 200
```

App database password (`ALTER ROLE ledgerlab_app PASSWORD :'pw'`, then the
ledger rolled onto the new secret):

```
before rotation: old -> ledgerlab_app
after rotation:  old -> FATAL: password authentication failed
after rotation:  new -> ledgerlab_app
ledger health on new password: {"status":"ok",...,"repository":"postgres"}
```

A first attempt at this check gave a false pass (the old password "worked")
because the verification ran inside the database container, where loopback
connections are `trust` in the official image. Re-run over the Docker network,
where `pg_hba.conf` requires `scram-sha-256`, as shown above.

## Dependency audit

```
$ pnpm audit --prod
No known vulnerabilities found
```

After upgrading `drizzle-orm` 0.38 → 0.45.3 (GHSA-gpj5-g38j-94v9). Full suite,
including the Postgres-only tests, passed after the upgrade (93 tests).
