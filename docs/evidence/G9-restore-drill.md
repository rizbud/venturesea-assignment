# G9 evidence: backup and restore drill

**Date:** 2026-10-01 · **Performed by:** Rizki Budi (with Claude Code) ·
**Where:** local Docker, Postgres 16 (`postgres:16-alpine`, the same major as
Render). The source is the production-rehearsal database from
`deployment/docker-compose.prod.yml`, with all migrations (0000–0003) applied.

## Data volume

One year at the client's current volume was loaded first, so the drill is not
run against a toy database: 12 × 31,000 entries.

```
entries | lines  | size
--------+--------+--------
 372001 | 744002 | 209 MB
```

## Procedure

1. Fingerprint the source (counts, per-account posted totals, trial-balance
   net, an MD5 over every journal line, number of integrity triggers).
2. `pg_dump -Fc -Z 6` (custom format, compressed).
3. Start a **brand-new** Postgres 16 container (nothing shared with the source).
4. Create the runtime role (`CREATE ROLE ledgerlab_app LOGIN PASSWORD ...`);
   roles are cluster-level and not in a database dump, which is why the runbook
   creates it first.
5. `pg_restore --jobs 4 --exit-on-error`.
6. Fingerprint the target and `diff` against the source.
7. Prove the restored database still enforces the ledger's rules and serves the app.

## Timings

| Step                                         | Time  |
| -------------------------------------------- | ----- |
| `pg_dump` (209 MB database → 8.4 MB dump)    | 1.7 s |
| Fresh Postgres ready to accept connections   | 3 s   |
| `pg_restore --jobs 4`                        | 9.2 s |
| Fingerprint + diff                           | ~3 s  |
| Fresh container → verified data (end to end) | 17 s  |
| Ledger API image healthy on the restored DB  | 1 s   |

The dump is small because the synthetic lines repeat; real data compresses less.
Budget 10× the dump size and time for capacity planning (§6 of the plan).

## Fingerprints (identical)

```
entries=372001 posted=372000 void=1
account 1000 total=2036817000
account 4000 total=-2036817000
trial balance net=0
lines md5=b9faa757e5731fced97288c8cfc81bce
triggers=4

FINGERPRINTS IDENTICAL
```

## The restored database still enforces the rules

```
unbalanced entry (as owner)  -> ERROR raised by ledger_check_entry_balanced()
UPDATE a posted line (owner) -> ERROR raised by ledger_forbid_change()
DELETE as ledgerlab_app      -> ERROR: permission denied for table journal_lines
```

## The app runs on it

`ledgerlab/ledger-api:local` started against the restored database as
`ledgerlab_app`:

```
GET /health -> {"status":"ok",...,"repository":"postgres"}
GET /api/reports/trial-balance?asOf=2026-10-01
  -> totalDebitMinor 2036817000, totalCreditMinor 2036817000, balanced: true
```

## What this does and does not prove

- Proves: a logical backup of this schema restores losslessly into an empty
  Postgres 16, with triggers, grants and data intact, in well under a minute at
  one year of volume, and the app needs no change to run on it.
- Does not prove: Render's own PITR restore (it restores into a new database
  instance from the dashboard; it needs the real account). That drill is the
  first item on the go-live checklist in `docs/INFRASTRUCTURE-PLAN.md` §6, and
  its result gets appended here.
