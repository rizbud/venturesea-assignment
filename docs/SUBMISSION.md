# Submission

**Candidate:** Rizki Budi
**Date:** 2026-10-01
**Time spent:** one working session on 2026-10-01, AI-assisted (commits from 17:18 to 19:31 WIB; analysis started before the first commit)

## Deployed URLs

| Surface       | URL                                                         | `/health` |
| ------------- | ----------------------------------------------------------- | --------- |
| Dashboard     | Not deployed: no AWS account or domain on the build machine | —         |
| Ledger API    | Not deployed (same reason)                                  | —         |
| Reporting API | Not deployed (same reason)                                  | —         |

The production shape is rehearsed locally with the exact images and rules
(`deployment/docker-compose.prod.yml`, [G4 evidence](evidence/G4-deploy-rehearsal.md)),
and the AWS stacks (`infra/aws`, CDK, tested) deploy it with
`deployment/aws/deploy.sh` once an AWS account and domain exist. No URL here is
invented.

**Cloudflare / custom domain:** not attempted (no domain or Cloudflare account).
The origin side is built and tested, and the exact configuration is in
[`deployment/cloudflare/README.md`](../deployment/cloudflare/README.md).

## What I changed

- **G0, challenges** (`1578da9`): trial balance respects `asOf`; void is guarded.
- **G1, ledger rules** (`9d7587b`, `9bf63d0`): closed periods (`LEDGER_CLOSED_THROUGH`)
  for post and void; inactive accounts rejected; a repository contract suite run
  against both adapters; `BIGINT` money column with safe-integer validation;
  `PATCH /api/accounts/:id` to deactivate/reactivate.
- **G2, dashboard** (`8b673e7`): every page rebuilt from `packages/ui`; icons
  removed; ledger status/date filters; inline field errors with `aria-invalid`;
  report sections with subtotals; mobile navigation.
- **G3, Postgres** (`5c89fa5`): the database enforces the invariants (deferred
  balance trigger, append-only triggers, `DATE`, CHECKs); idempotent migrations
  and seed; pool limits; `/health` checks the DB; graceful shutdown; N+1 fixes.
- **G4, deploy** (`945e50e`): lockfile-reproducible bundled images (137 MB,
  non-root); Render blueprint with 2 + 2 instances and migrations as a pre-deploy
  step; reports aggregate in SQL (trial balance p50 1,564 → 128 ms at one month
  of data); CI builds the images and migrates from them.
- **G5, security** (`99f8a41`): production fails closed on missing secrets or
  `CORS_ORIGINS=*`; constant-time internal token; secure headers; 64 KB body
  limit; per-IP rate limit; least-privilege DB role; dependency upgrade.
- **G6, edge** (`008aa19`): Cloudflare runbook; origin lock (`X-Origin-Secret`).
- **G7, AI log** (`72da17d`): missed, rejected and reverted entries added honestly.
- **Rollups** (`2bb68ec`): daily balance rollups maintained by triggers; reports
  342 req/s at one year of history instead of ~5.
- **AWS target**: ECS Fargate in Jakarta as CDK code with assertion tests
  (2 tasks per service, autoscaling 2–6, never below 2 during deploys; RDS
  Multi-AZ; Cloudflare-only ALB; Secrets Manager); one-command `deploy.sh`; the
  app reads `PG*` variables, the migration step creates the app role, and the
  rate limiter can key on `CF-Connecting-IP`.
- **G8, sub-agents** (`bc49d77`): six agents; three demonstrated; they caught
  a broken CI job and three other gaps (below).
- **G9, infrastructure** (`eec6a29`, `42cfc2a`): plan, restore drill, capacity
  measurements at one year of history, region/plan fixes in the blueprint,
  `shm_size` fix, source map no longer published.
- **G10, next phase** (`45b091e`): the 13-week plan.
- **Daily balance rollups** (after G10): reports read trigger-maintained daily
  totals instead of every line; 4.8 → 342 req/s at one year of history; a drift
  view that must stay empty; a concurrency test that caught a deadlock.

## Challenge suite

```
pnpm --filter @ledgerlab/ledger-api test:challenges
 ✓ src/challenges/asof.challenge.ts (2 tests) 22ms
 ✓ src/challenges/void.challenge.ts (2 tests) 39ms
 Test Files  2 passed (2)
      Tests  4 passed (4)
```

- **Challenge A (trial balance `asOf`):** the trial balance summed every posting
  regardless of date, so a September report included October. It now includes
  only lines dated on or before `asOf` (`packages/shared/src/reporting.ts`). In
  production the same rule runs as a SQL `WHERE entry_date <= $asOf`
  aggregate. The spec files were not touched.
- **Challenge B (void transition):** voiding had no state check, so an entry
  could be voided twice. Both adapters now throw `ConflictError` (409) unless the
  entry is `POSTED`. Postgres does it in one conditional statement (`UPDATE …
WHERE status = 'POSTED' RETURNING`), so two concurrent voids cannot both
  succeed, and a database trigger refuses any other status change.

## Database

- **Engine and version:** PostgreSQL 16.
- **Migrations:** `pnpm --filter @ledgerlab/db migrate:sql` locally; in
  production, `node dist/migrate.js` from the ledger image as a one-off ECS
  task before each roll. Ordered idempotent SQL in `packages/db/migrations/`.
- **Seeding:** `pnpm --filter @ledgerlab/db seed` (idempotent, keyed on
  reference; non-production only).
- **Why this engine:** managed (RDS, Multi-AZ) with point-in-time recovery, in
  the same VPC as the APIs, and able to enforce the ledger's invariants
  itself (deferred constraint triggers). See [`DATABASE.md`](DATABASE.md) and
  infrastructure ADR-002.

## Deployment

- **Target:** AWS ECS Fargate, Jakarta (`ap-southeast-3`), RDS PostgreSQL 16
  Multi-AZ, behind Cloudflare ([`deployment/aws/README.md`](../deployment/aws/README.md)).
  Render (`deployment/render.yaml`) remains a working alternative.
- **Reproduce it:** `DOMAIN=<domain> deployment/aws/deploy.sh` (prerequisites in
  the AWS runbook). Locally:
  `docker compose -f deployment/docker-compose.prod.yml up -d --build --wait`
  (env vars in [`DEPLOYMENT.md`](DEPLOYMENT.md)).
- **Scaling:** at least 2 tasks per service (ledger, reporting, web) across two
  AZs, autoscaling to 6 on CPU; deploys keep 100% healthy (never below 2) and
  roll back automatically. Stateless; DB pool 10 per task. Rehearsed: stopping a
  replica under load lost 0 of 300 requests.
- **Secrets:** AWS Secrets Manager, all generated there (DB master, app role
  password, `INTERNAL_API_TOKEN`, `ORIGIN_SECRET`) and injected by ECS as
  separate secrets. Nothing in git, images or the template.
- **Migrations as a deploy step:** yes. A one-off ECS task runs
  `node dist/migrate.js` as the owner role with the new image; a non-zero exit
  stops the deploy before any service changes.

## Security

- **`INTERNAL_API_TOKEN` evidence:** the endpoint is now
  `/api/internal/account-totals` (the old `/postings`, which exposed every
  journal line, was removed). No token → `401`, wrong token → `401`, right
  token → `200` (test "guards /api/internal" and the rehearsal); compared in
  constant time.
- **CORS:** exactly the dashboard origin; production refuses to boot on unset or
  `*`. A foreign `Origin` is not echoed back (test + `curl` against the
  rehearsal stack).
- **Headers/HSTS:** the APIs send `strict-transport-security: max-age=31536000;
includeSubDomains; preload`, `content-security-policy: default-src 'none';
frame-ancestors 'none'`, `x-content-type-options: nosniff`,
  `x-frame-options: DENY` ([G5 evidence](evidence/G5-security.md)).
- **Rate limiting:** 300 req/min per IP per instance (ledger), 120 (reporting),
  `429` + `Retry-After`; a 700-request burst returned 690 × 200 and 10 × 429.
  The authoritative limit is the Cloudflare rule (50 per 10 s per IP).
- **Known gaps:** no authentication or multi-tenancy. Plan: hosted OIDC with
  phone OTP, `business_id` on every table enforced by Postgres row-level
  security, an append-only audit log in the same transaction ([`SECURITY.md`](SECURITY.md)
  §10, next-phase ADR-P1/P2, milestone M2).

## Cloudflare + TLD (bonus)

- **Domain:** not attempted.
- **`dig +short` output:** n/a.
- **TLS mode:** Full (strict) is specified in the runbook; not applied.
- **WAF rule and rate-limit rule:**
  `(http.host eq "api.ledgerlab.example.com" and starts_with(http.request.uri.path, "/api/internal/"))`
  → Block; rate limit on `starts_with(http.request.uri.path, "/api/")`, 50 per
  10 s per IP.
- **`/api/internal/*` blocked at edge:** configured, not live; the origin lock
  (`requireOriginSecret`) is implemented and tested.
- **Cache rules:** `/assets/*` cached for a year (hashed names); API hosts bypass.

## Infrastructure plan (G9)

- **Document:** [`INFRASTRUCTURE-PLAN.md`](INFRASTRUCTURE-PLAN.md), complete;
  status "Review" until the real deploy exists.
- **Topology in one sentence:** Cloudflare → ALB (Cloudflare IPs only) in AWS
  Jakarta → ECS Fargate, 2+ tasks each of web, ledger-api and reporting-api in
  private subnets → RDS Postgres 16 Multi-AZ in isolated subnets, secrets from
  Secrets Manager.
- **RPO / RTO:** 5 min / 1 h (bad deploy: 5 min RTO; region loss: 24 h / 4 h).
- **Restore drill:** 2026-10-01, 17 s end to end for one year of data (372,001
  entries), fingerprints identical, invariants and role grants intact
  ([evidence](evidence/G9-restore-drill.md)). The RDS PITR drill is step 4 of
  the go-live checklist.
- **Cost at 1× / 3× / 10×:** ≈ $283 / $396 / $697 per month (AWS list prices
  for Jakarta; about $130 of today's figure buys the availability).
- **First bottleneck (found and fixed):** at one year of history reports fell
  to ~5 req/s because each one scanned every line. Daily balance rollups
  (`0004_balance_rollups.sql`) brought the late-month worst case to 342 req/s,
  p99 95 ms ([evidence](evidence/rollups.md)). At 10×, the next limits are the
  global rollup lock on posting and single-region.
- **ADRs:** AWS ECS Fargate in Jakarta (EKS and Render rejected); managed
  Postgres, single region, Multi-AZ; daily balance rollups maintained by
  triggers; idempotent SQL migrations as a pre-deploy step; Cloudflare with an
  IP allow-list and a shared-secret origin lock.

## Next-phase plan (G10)

- **Document:** [`NEXT-PHASE-PLAN.md`](NEXT-PHASE-PLAN.md), complete.
- **Outcomes:** bank approval and a first cohort of 100 warungs; CPA sign-off
  with zero unbalanced entries; tenant isolation; 30 days of measured ≥ 99.9%
  before due diligence; payday-fast reports with a year of history.
- **Prioritisation method and top initiative:** dated commitments first, then
  RICE. Top: go-live (AWS, domain, Cloudflare, monitoring); rollups are done.
- **Milestones + exit criteria:** M1 by 16 Oct (Cloudflare verification passes,
  PITR drill identical, report p95 < 800 ms at one year of data); M2 by 27 Nov
  (cross-tenant suite fails closed, audit row for 100% of mutations, bank
  sandbox pull, 30 days ≥ 99.9%); M3 by 31 Dec (100 businesses assessed).
- **Next hires:** senior backend/platform engineer by 2 Nov; customer
  operations lead by 1 Dec.
- **Explicitly deferred:** localisation, native mobile, real-time collaboration,
  multi-currency, multi-region, more services.

## AI usage

- **Entries in `docs/ai/prompt-log.jsonl`:** 28 (24 accepted, 1 edited, 1 rejected,
  2 reverted).
- **A prompt I rejected and why:** switching the default currency to IDR
  (proposed after "why using $ and not Rp?"). The developer kept USD; nothing
  was changed, and the display limitation is logged.
- **How I verified AI output:** every change ran through typecheck, the test
  suites (including Postgres) and the challenge suite; claims in docs were
  checked against commands (`curl`, `psql`, `docker`, `grep`) before being
  written; sub-agent findings were reproduced by hand before any fix. Several of
  my own draft claims were caught and removed before commit (logged).

## Sub-agents

| Agent                | File                                    | What it did                                                                                                                                   |
| -------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy-security`    | `.opencode/agent/deploy-security.md`    | Reviewed deploy/security; found the broken CI boot step, an undocumented env var, a broken rehearsal command, and a missing shutdown watchdog |
| `reporting-verifier` | `.opencode/agent/reporting-verifier.md` | Recomputed TB, IS and BS from raw lines; tied out to the cent, including as-of, next-day and void edges                                       |
| `test-runner`        | `.opencode/agent/test-runner.md`        | Ran every gate; reported the Postgres tests as skipped, not green; found the no-op `lint` gate                                                |
| `ledger-architect`   | `.opencode/agent/ledger-architect.md`   | Defined; first job is reviewing the rollup migration (M1)                                                                                     |
| `db-migrator`        | `.opencode/agent/db-migrator.md`        | Defined; first job is writing the rollup migration (M1)                                                                                       |
| `ui-unslop`          | `.opencode/agent/ui-unslop.md`          | Defined, carrying the G2 lessons; not yet exercised                                                                                           |

- **Defect a sub-agent caught:** `deploy-security` found that the CI `images`
  job boots the API with `NODE_ENV=production` but without `CORS_ORIGINS` and
  `INTERNAL_API_TOKEN`, so it has failed since G5. Reproduced, fixed with
  throwaway values, and the boot step re-run green
  ([evidence](evidence/G8-subagents.md)).

## Verification

Run on 2026-10-01 with `TEST_DATABASE_URL` pointing at Postgres 16
(`docker compose up -d db`), migrations applied twice:

```
pnpm format:check   # PASS
pnpm typecheck      # PASS (7/7)
pnpm test           # PASS: 109 tests (shared 30, reporting 9, ledger 63 incl. Postgres, infra-aws 7), 0 skipped
pnpm build          # PASS
pnpm ai:verify      # PASS (29 entries)
```

## What I skipped and why

- **The real AWS deploy and Cloudflare:** they need an AWS account, a domain
  and a Cloudflare account the build machine did not have. Everything up to the account
  boundary is built, rehearsed and documented; no URL or screenshot is faked.
- **Authentication and multi-tenancy:** out of scope for the test, and the
  biggest real gap; planned as M2 with ADRs.
- **Legacy SQLite import:** no legacy schema or file is in the repository; the
  approach (write through the repository port, verify trial-balance totals before
  and after) is documented, but it cannot be built blind.
- **Currency display:** amounts render as USD by decision; per-account currency
  and mixed-currency report guards are deferred.
- **Three of six sub-agents** have no demo run yet.

## If I had more time

1. Deploy to AWS, put Cloudflare in front and run the PITR and failover drills (M1).
2. Schedule the nightly `ledger_rollup_drift` check and the off-site backup.
3. Structured JSON logs and alerting per the infrastructure plan.
4. OIDC + `business_id` with row-level security, then the audit log.
