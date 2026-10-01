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
  listAccounts(): Promise<Account[]>;
  getAccountById(id: string): Promise<Account | undefined>;
  getAccountByCode(code: string): Promise<Account | undefined>;
  createAccount(input: CreateAccountInput): Promise<Account>;

  listJournalEntries(query: ListJournalEntriesQuery): Promise<Paginated<JournalEntry>>;
  getJournalEntry(id: string): Promise<JournalEntry | undefined>;
  createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry>;
  voidJournalEntry(id: string): Promise<JournalEntry | undefined>;

  /** POSTED lines joined with account metadata — the source for all reports. */
  listPostings(): Promise<PostingRow[]>;
}
```

Business rules live in `LedgerService`, **not** in the adapter. An adapter only
persists and reads back; it must not silently "fix" an unbalanced entry.

## Option A — PostgreSQL (wired, recommended)

- Schema: `packages/db/src/schema.ts` (Drizzle, `pg-core`).
- Adapter: `packages/db/src/postgres-repository.ts`.
- Migration SQL: `packages/db/migrations/*.sql`, applied in filename order.

```bash
cp .env.example .env
# DATABASE_URL=postgres://ledgerlab:ledgerlab@localhost:5432/ledgerlab

# Apply the schema (idempotent SQL). Or use drizzle-kit generate/migrate
# once you start evolving the schema.
pnpm --filter @ledgerlab/db migrate:sql

# Load the demo chart of accounts + journal entries (idempotent)
pnpm --filter @ledgerlab/db seed
```

Selecting the adapter is automatic: if `DATABASE_URL` is set, `resolveLedgerRepository()`
uses Postgres; otherwise it falls back to the seeded in-memory adapter.

Local Postgres without Docker:

```bash
createuser ledgerlab --pwprompt
createdb ledgerlab -O ledgerlab
```

Or with Docker (if available):

```bash
docker run --name ledgerlab-db -e POSTGRES_USER=ledgerlab -e POSTGRES_PASSWORD=ledgerlab \
  -e POSTGRES_DB=ledgerlab -p 5432:5432 -d postgres:16
```

## Option B — MySQL / MariaDB

1. Add `mysql2` and a `mysqlTable` schema in `packages/db/src/schema.mysql.ts`.
2. Implement `MySqlLedgerRepository` against the same port.
3. Generate migrations with `drizzle-kit` (`dialect: "mysql"`).
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
journal_entries(id, entry_date, memo, reference, status, created_at)
journal_lines(id, entry_id → journal_entries, account_id → accounts,
              amount_minor, position, memo)
```

**Money is `amount_minor`, a signed `BIGINT`**: `> 0` debit, `< 0` credit.
`INTEGER` would cap one line at about Rp 2.1bn (IDR has no minor unit), so
`0001_amount_minor_bigint.sql` widens it; API input is capped at
`Number.MAX_SAFE_INTEGER` so values round-trip through JavaScript exactly.
No `REAL`/`FLOAT`/`DOUBLE` column may ever hold money.

## Migrations

- Never auto-sync schema in production. Run migrations as a deploy step or a
  one-off job, with the DB user that owns the schema.
- The app's runtime user should be least-privilege (SELECT/INSERT/UPDATE on the
  three tables; no DDL outside the migration step).
- Keep migrations forward-only and idempotent (`CREATE TABLE IF NOT EXISTS`,
  guarded `ALTER`s): `migrate:sql` has no applied-migrations table and re-runs
  every file on each deploy.

## Seeding

`packages/shared/src/seed.ts` defines the demo chart of accounts and entries.
`seed()` on the in-memory adapter and `pnpm --filter @ledgerlab/db seed` against
Postgres both consume it, so behaviour matches. Seeding must be safe to re-run.

## Production checklist

- [ ] Managed database (RDS / Cloud SQL / Azure Flexible Server / Render
      Postgres) in a private network; not publicly reachable.
- [ ] TLS required; verify the certificate.
- [ ] Connection pool sized to the plan (start at 10); enable an idle timeout.
- [ ] Automated backups with a retention policy; **test a restore**.
- [ ] Point-in-time recovery or daily snapshots.
- [ ] Alerts on connection saturation and slow queries.
- [ ] Migrations applied before the new version starts serving traffic.
