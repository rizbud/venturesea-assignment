# Evidence: daily balance rollups (next-phase M1, infra ADR-003)

**Date:** 2026-10-01 · **Where:** the production-rehearsal stack
(`deployment/docker-compose.prod.yml`, 2 + 2 replicas, Postgres 16) holding one
year at the client's volume: 372,001 entries / 744,002 lines. autocannon, 10
connections, 15 s, per-instance rate limit raised for the test.

## What changed

`packages/db/migrations/0004_balance_rollups.sql`:

- `account_balances_daily (day, account_id, debit_minor, credit_minor)` and
  `ledger_days (day, posted_entries)`, maintained by triggers **in the same
  transaction** as each post and void, so they are never stale.
- The trigger functions are `SECURITY DEFINER`: the app role can read the
  rollups, not write them (tested).
- `ledger_rollup_drift` lists every (day, account) where the rollup disagrees
  with the raw lines. It must be empty; it is the nightly reconciliation.
- A one-time backfill runs under a `SHARE` lock, so no posting can land between
  the backfill and the triggers.

`PostgresLedgerRepository.accountTotals` now sums the rollups instead of
joining every line. The in-memory adapter keeps the reference implementation,
and the contract test holds Postgres to it.

## Results (late-month worst case, `asOf=2026-09-29`)

| Endpoint                                   | Before (lines)                          | Monthly rollups (first attempt)       | **Daily rollups**                               |
| ------------------------------------------ | --------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| `GET /api/reports/trial-balance`           | 4.8 req/s · p50 1,550 ms · p99 3,709 ms | 15 req/s · p50 545 ms · p99 1,662 ms  | **342 req/s · p50 24 ms · p99 95 ms**           |
| `GET /api/reports/dashboard`               | 4.7 req/s · p50 1,568 ms · p99 4,101 ms | 7 req/s · p50 1,322 ms · p99 3,157 ms | **213 req/s · p50 43 ms · p99 103 ms**          |
| `GET /api/reports/balance-sheet`           | 4.9 req/s · p50 1,470 ms                | —                                     | **452 req/s · p50 20 ms · p99 44 ms**           |
| `GET /api/reports/income-statement` (Sept) | —                                       | —                                     | **417 req/s · p50 22 ms · p99 54 ms**           |
| `GET /api/journal-entries` (list)          | 108 req/s · p50 87 ms                   | —                                     | 114 req/s · p50 82 ms (unchanged; not a report) |

Zero non-2xx responses. The trial balance totals are unchanged
(`totalDebitMinor = totalCreditMinor = 2036817000`, balanced).

## Why the first attempt (monthly) was replaced

Monthly rollups covered whole months and summed raw lines for the partial
months at the edges. On 1 October (an empty current month) they looked great:
383 req/s. The honest worst case is late in a month, and there they managed
only 15 req/s. `EXPLAIN ANALYZE` showed why: to fetch one partial month's
59,102 lines, Postgres seq-scanned **all 744,002** lines and hash-joined them to
the month's entries, so cost still grew with history.

Daily rollups make every range a set of whole days: there is no raw part, no
month-splitting code, and less code than the monthly version. Ceiling: a report
reads days × active accounts rows (730 here for a year). A monthly level on top
is the upgrade when that gets large; it is marked `ponytail:` in the migration.

## Correctness checks

- Contract test across month and year boundaries (both adapters, nine ranges,
  voids on a day with other entries and on a day with none): Postgres equals
  the reference implementation for every row and the entry count.
- Concurrency test: 5 voids and 3 posts in parallel, then `ledger_rollup_drift`
  is empty and the entry counts match. **It caught a real deadlock** in the first
  version: a post touched `ledger_days` before taking the rollup lock, while a
  void took the lock first. Fixed by taking the lock before any rollup write;
  passed 5 out of 5 repeated runs.
- The least-privilege role test posts, voids and reads totals as
  `ledgerlab_app` (the triggers run) and is denied `UPDATE`/`INSERT` on the
  rollups.
- On the rehearsal database after the backfill: 730 rollup rows,
  `sum(posted_entries) = 372000`, `ledger_rollup_drift` = 0 rows.
- Migration job (`node dist/migrate.js` from the image, including the
  backfill): 12 s on 744k lines. Writes block for that window. At the client's
  actual history (~1 year) that is inside the 5-minute downtime budget.
