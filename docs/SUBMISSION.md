# Submission

**Candidate:** Rizki Budi
**Date:** 2026-10-01
**Time spent:** one working session on 2026-10-01, AI-assisted (commits from 17:18 to 19:31 WIB; analysis started before the first commit)

## Deployed URLs

| Surface       | URL                                                                | `/health` |
| ------------- | ------------------------------------------------------------------ | --------- |
| Dashboard     | Not deployed: no Render account/GitHub remote on the build machine | —         |
| Ledger API    | Not deployed (same reason)                                         | —         |
| Reporting API | Not deployed (same reason)                                         | —         |

The production shape is rehearsed locally with the exact images and rules
(`deployment/docker-compose.prod.yml`, [G4 evidence](evidence/G4-deploy-rehearsal.md)),
and the blueprint (`deployment/render.yaml`) deploys it with `git push` once the
repository is on GitHub. No URL here is invented.

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
- **G8, sub-agents** (`bc49d77`): six agents; three demonstrated; they caught
  a broken CI job and three other gaps (below).
- **G9, infrastructure** (`eec6a29`, `42cfc2a`): plan, restore drill, capacity
  measurements at one year of history, region/plan fixes in the blueprint,
  `shm_size` fix, source map no longer published.
- **G10, next phase** (`45b091e`): the 13-week plan.

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
  production, `node dist/migrate.js` from the ledger image as Render's
  `preDeployCommand`. Ordered idempotent SQL in `packages/db/migrations/`.
- **Seeding:** `pnpm --filter @ledgerlab/db seed` (idempotent, keyed on
  reference; non-production only).
- **Why this engine:** managed with tested point-in-time recovery, on the same
  private network as the APIs, and able to enforce the ledger's invariants
  itself (deferred constraint triggers). See [`DATABASE.md`](DATABASE.md) and
  infrastructure ADR-002.

## Deployment

- **Target:** Render, Singapore (`deployment/render.yaml`).
- **Reproduce it:** push to GitHub → Render → New → Blueprint; every later
  deploy is `git push origin main`. Locally:
  `docker compose -f deployment/docker-compose.prod.yml up -d --build --wait`
  (env vars in [`DEPLOYMENT.md`](DEPLOYMENT.md)).
- **Scaling:** 2 instances per API (`numInstances: 2`), stateless; DB pool 10 per
  instance (21 of 100 connections). Rehearsed: stopping a replica under load
  lost 0 of 300 requests.
- **Secrets:** Render env vars: `INTERNAL_API_TOKEN` is generated and shared with
  `fromService`; the owner URL comes from `fromDatabase`; the app role URL and
  `ORIGIN_SECRET` are `sync: false`. Nothing in git or in images.
- **Migrations as a deploy step:** yes. `preDeployCommand: node dist/migrate.js`
  runs as the owner role; a failure aborts the deploy and the old version keeps
  serving.

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
- **Topology in one sentence:** Cloudflare → Render (Singapore): static
  dashboard, 2 ledger-api + 2 reporting-api instances, managed Postgres 16 on
  the private network, secrets from Render's store.
- **RPO / RTO:** 5 min / 1 h (bad deploy: 5 min RTO; region loss: 24 h / 4 h).
- **Restore drill:** 2026-10-01, 17 s end to end for one year of data (372,001
  entries), fingerprints identical, invariants and role grants intact
  ([evidence](evidence/G9-restore-drill.md)). The Render PITR drill is step 3 of
  the go-live checklist.
- **Cost at 1× / 3× / 10×:** ≈ $100 / $181 / $480 per month.
- **First bottleneck at 10×:** database CPU on reports. Measured: at one year
  of history, reports drop from ~70 to ~5 req/s because every report scans all
  lines. Monthly rollups fix it; at 10× they must go daily.
- **ADRs:** Render over AWS/GCP/Azure; managed Postgres, single region; SQL
  aggregation now and rollups next; idempotent SQL migrations as a pre-deploy
  step; Cloudflare with a shared-secret origin lock.

## Next-phase plan (G10)

- **Document:** [`NEXT-PHASE-PLAN.md`](NEXT-PHASE-PLAN.md), complete.
- **Outcomes:** bank approval and a first cohort of 100 warungs; CPA sign-off
  with zero unbalanced entries; tenant isolation; 30 days of measured ≥ 99.9%
  before due diligence; payday-fast reports with a year of history.
- **Prioritisation method and top initiative:** dated commitments first, then
  RICE. Top: go-live (Render, domain, Cloudflare, monitoring), then rollups.
- **Milestones + exit criteria:** M1 by 16 Oct (Cloudflare verification passes,
  PITR drill identical, report p95 < 800 ms at one year of data); M2 by 27 Nov
  (cross-tenant suite fails closed, audit row for 100% of mutations, bank
  sandbox pull, 30 days ≥ 99.9%); M3 by 31 Dec (100 businesses assessed).
- **Next hires:** senior backend/platform engineer by 2 Nov; customer
  operations lead by 1 Dec.
- **Explicitly deferred:** localisation, native mobile, real-time collaboration,
  multi-currency, multi-region, more services.

## AI usage

- **Entries in `docs/ai/prompt-log.jsonl`:** 27 (23 accepted, 1 edited, 1 rejected,
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
pnpm typecheck      # PASS (6/6)
pnpm test           # PASS: 96 tests (shared 29, reporting 9, ledger 58 incl. Postgres), 0 skipped
pnpm build          # PASS
pnpm ai:verify      # PASS (27 entries)
```

## What I skipped and why

- **The real Render deploy and Cloudflare:** they need accounts, a GitHub remote
  and a domain the build machine did not have. Everything up to the account
  boundary is built, rehearsed and documented; no URL or screenshot is faked.
- **Authentication and multi-tenancy:** out of scope for the test, and the
  biggest real gap; planned as M2 with ADRs.
- **Report rollups:** the load test at one year of history showed they are
  needed. They are a schema change on money tables, so they get their own
  milestone with a reconciliation check rather than a rushed change today.
- **Legacy SQLite import:** no legacy schema or file is in the repository; the
  approach (write through the repository port, verify trial-balance totals before
  and after) is documented, but it cannot be built blind.
- **Currency display:** amounts render as USD by decision; per-account currency
  and mixed-currency report guards are deferred.
- **Three of six sub-agents** have no demo run yet.

## If I had more time

1. Provision Render + Cloudflare and run the production PITR drill (M1).
2. Monthly balance rollups with a nightly rollup-vs-raw reconciliation, written
   by `db-migrator`, reviewed by `ledger-architect`, proved by `reporting-verifier`.
3. Structured JSON logs and alerting per the infrastructure plan.
4. OIDC + `business_id` with row-level security, then the audit log.
