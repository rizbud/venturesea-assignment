# Database

The scaffold defines one storage port and ships two adapters. **G3 requires you
to run against a real database.** PostgreSQL is wired end to end; **MySQL,
MariaDB, SQLite/libSQL, and SQL Server are all acceptable** if you implement the
port.

## The port

```ts
// packages/shared/src/repository.ts
export interface LedgerRepository {
  readonly kind: "memory" | "postgres"; // extend the union for new engines
  ping(): Promise<void>; // reachability, used by /health
  listAccounts(): Promise<Account[]>;
  getAccountById(id: string): Promise<Account | undefined>;
  getAccountByCode(code: string): Promise<Account | undefined>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  setAccountActive(id: string, isActive: boolean): Promise<Account | undefined>;

  listJournalEntries(query: ListJournalEntriesQuery): Promise<Paginated<JournalEntry>>;
  getJournalEntry(id: string): Promise<JournalEntry | undefined>;
  createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry>;
  voidJournalEntry(id: string): Promise<JournalEntry | undefined>; // POSTED -> VOID, else ConflictError

  /** POSTED lines joined with account metadata. */
  listPostings(): Promise<PostingRow[]>;
  /** Per-account totals in a date range, aggregated in SQL: the source for every report. */
  accountTotals(range: DateRange): Promise<AccountTotals>;
}
```

Business rules live in `LedgerService`, **not** in the adapter. An adapter only
persists and reads back; it must not silently "fix" an unbalanced entry. Every
adapter must pass `apps/ledger-api/src/__tests__/repository-contract.test.ts`.

## Option A — PostgreSQL (wired, recommended)

- Schema: `packages/db/src/schema.ts` (Drizzle, `pg-core`).
- Adapter: `packages/db/src/postgres-repository.ts`.
- Migrations: `packages/db/migrations/*.sql`, applied in filename order.

```bash
docker compose up -d db          # local Postgres 16 (docker-compose.yaml)
cp .env.example .env             # then uncomment DATABASE_URL
export DATABASE_URL=postgres://ledgerlab:ledgerlab@localhost:5432/ledgerlab

pnpm --filter @ledgerlab/db migrate:sql   # apply migrations/*.sql (idempotent)
pnpm --filter @ledgerlab/db seed          # demo data (idempotent; never in production)
pnpm --filter @ledgerlab/ledger-api dev   # now runs on Postgres
```

Without Docker: `createuser ledgerlab --pwprompt && createdb ledgerlab -O ledgerlab`.

Selecting the adapter is automatic: if `DATABASE_URL` is set,
`resolveLedgerRepository()` uses Postgres. Without it the API falls back to the
seeded in-memory adapter for local dev and tests, with a warning, and **refuses
to start when `NODE_ENV=production`**, so a missing secret can never silently
become a ledger that loses its data on restart.

To run the Postgres half of the test suite locally, point `TEST_DATABASE_URL` at
a migrated, **disposable** database (the tests truncate it). CI does this with a
Postgres service container.

## Option B — MySQL / MariaDB

1. Add `mysql2` and a `mysqlTable` schema in `packages/db/src/schema.mysql.ts`.
2. Implement `MySqlLedgerRepository` against the same port.
3. Write the migrations as SQL in the same style (`BIGINT` money, the integrity
   triggers from `0002_integrity.sql`).
4. Extend `resolveLedgerRepository()` to pick it from `DATABASE_URL` (e.g. the
   `mysql://` scheme) and widen the `kind` union.

## Option C — SQLite / libSQL

Useful for local dev and edge. Implement the port over `better-sqlite3` or
`@libsql/client`, store money as `INTEGER` (never `REAL`), and enable
`PRAGMA foreign_keys = ON` plus WAL mode.

## Option D — SQL Server

Implement the port with `mssql`/Drizzle `mssql-core`. Use `BIGINT` for
`amount_minor` and a `VARCHAR(4)` unique index on `accounts.code`.

## Data model

```
accounts(id, code UNIQUE, name, type, currency, is_active, created_at)
journal_entries(id, entry_date DATE, memo, reference, status, created_at)
journal_lines(id, entry_id → journal_entries, account_id → accounts,
              amount_minor BIGINT, position, memo)
```

**Money is `amount_minor`, a signed `BIGINT`**: `> 0` debit, `< 0` credit.
`INTEGER` would cap one line at about Rp 2.1bn (IDR has no minor unit), so
`0001_amount_minor_bigint.sql` widens it; API input is capped at
`Number.MAX_SAFE_INTEGER` so values round-trip through JavaScript exactly.
No `REAL`/`FLOAT`/`DOUBLE` column may ever hold money.

### Enforced by the database (`0002_integrity.sql`)

The app checks these first, but Postgres enforces them too, so a hotfix script,
a future service, or a bug in an adapter cannot corrupt the books:

| Invariant                                  | Mechanism                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Every entry's lines sum to 0, at least two | Deferred constraint triggers on lines and on entries (`0005`: an entry with no lines), checked at commit |
| No zero-amount line                        | `CHECK (amount_minor <> 0)`                                                                              |
| `entry_date` is a real day                 | `DATE` column (rejects `2026-02-31`)                                                                     |
| Lines are never edited or deleted          | `BEFORE UPDATE OR DELETE` trigger raises                                                                 |
| Entries are never deleted                  | `BEFORE DELETE` trigger raises                                                                           |
| Only `POSTED → VOID`; nothing else changes | `BEFORE UPDATE` trigger on `journal_entries`                                                             |

Corrections are made the accounting way: void the entry and post a new one.
`TRUNCATE` bypasses row triggers; only the schema owner can run it, and the
runtime user must not hold that privilege (see Migrations). The API also
rejects impossible dates with `400` before they reach the database.

### Daily balance rollups (`0004_balance_rollups.sql`)

```
account_balances_daily(day, account_id, debit_minor, credit_minor)   PK (day, account_id)
ledger_days(day, posted_entries)
```

Reports sum these, not the lines, so their cost follows days × active accounts
instead of the number of lines (342 req/s vs 4.8 at one year of history;
[evidence](evidence/rollups.md)). Triggers on `journal_lines` insert and on
`journal_entries` insert/status change keep them exact in the same transaction
as each post or void. The trigger functions are `SECURITY DEFINER`, so the
runtime role can only read the rollups. Every rollup writer first takes one
transaction-level advisory lock, so concurrent posts and voids cannot deadlock.

`ledger_rollup_drift` lists every (day, account) where a rollup disagrees with
the raw lines. It must be empty: the contract test asserts it, and production
checks it nightly. If it is ever not empty, rebuild from the raw lines (the
backfill query in the migration) and find the write path that bypassed the
triggers. The test reset (`TRUNCATE`) must include `ledger_days`;
`account_balances_daily` goes with `accounts … CASCADE`.

## Migrations

- Runner: `packages/db/migrate.mjs`. It is plain Node whose only dependency is
  the `postgres` runtime package, so it runs inside the pruned production image
  as a deploy step: `node packages/db/migrate.mjs` (locally:
  `pnpm --filter @ledgerlab/db migrate:sql`). Each file runs as one implicit
  transaction, so a failing migration leaves no partial state.
- The drizzle-kit `generate`/`migrate` scripts were removed: they would write a
  competing journal into `migrations/`. `drizzle-kit studio` still works.
- Never auto-sync schema in production. Run migrations as a deploy step or a
  one-off job, with the DB user that owns the schema.
- The app's runtime user should be least-privilege (SELECT/INSERT/UPDATE on the
  three tables, SELECT only on the rollups; no DDL, no TRUNCATE, outside the
  migration step).
- Keep migrations forward-only and idempotent (`CREATE TABLE IF NOT EXISTS`,
  guarded `ALTER`s, `CREATE OR REPLACE`): `migrate.mjs` has no applied-migrations
  table and re-runs every file on each deploy.

## Seeding

`packages/shared/src/seed.ts` defines the demo chart of accounts and entries.
`seed()` on the in-memory adapter and `seedPostgres()`
(`pnpm --filter @ledgerlab/db seed`) both consume it. Re-running is safe:
accounts match by code and entries by reference, so a second run inserts
nothing (covered by a Postgres test). Demo data only — never seed production.

## Connection pooling

Each ledger-api process holds one `postgres.js` pool:

- `DATABASE_POOL_MAX` connections (default 10); idle connections are released
  after 20 s; connecting times out after 10 s.
- Budget: `replicas × DATABASE_POOL_MAX + 1 (migration job) + headroom` must stay
  under the database's `max_connections`. Example: 2 replicas × 10 + 1 = 21,
  comfortably inside a small managed Postgres. When replicas × pool approaches
  the limit, lower the pool or put PgBouncer in front.
- Behind PgBouncer in **transaction** mode, disable prepared statements
  (`prepare: false` in `createDatabase`).
- TLS: append `?sslmode=require` to `DATABASE_URL` for managed databases.
- The reporting API holds no database connection; it reads per-account totals
  from the ledger over `/api/internal/account-totals`, which Postgres computes
  with one `GROUP BY` (a few dozen rows per request, whatever the ledger size).

## Health and shutdown

`GET /health` runs `select 1` with a 2 s timeout and returns `503 degraded`
when the database is unreachable, so load balancers stop routing to the
instance and uptime monitors record the outage. On `SIGTERM` the server stops
accepting connections, drains in-flight requests, then closes the pool (hard
exit after 10 s).

## Production checklist

- [ ] Managed database (RDS / Cloud SQL / Azure Flexible Server / Render
      Postgres) in a private network; not publicly reachable.
- [ ] TLS required; verify the certificate.
- [x] Connection pool sized to the plan (start at 10); idle timeout enabled.
- [ ] Automated backups with a retention policy; **test a restore**.
- [ ] Point-in-time recovery or daily snapshots.
- [ ] Alerts on connection saturation and slow queries.
- [ ] Migrations applied before the new version starts serving traffic.
