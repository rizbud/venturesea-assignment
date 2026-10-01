import type { LedgerRepository } from "@ledgerlab/shared";
import {
  InMemoryLedgerRepository,
  PostgresLedgerRepository,
  createDatabase,
  databaseUrlFromEnv,
} from "@ledgerlab/db";

export interface RepositoryHandle {
  repository: LedgerRepository;
  close: () => Promise<void>;
}

/**
 * Choose a storage adapter from the environment.
 *
 *   DATABASE_URL (or PGHOST + friends) set -> Postgres via Drizzle
 *                         (pool size: DATABASE_POOL_MAX, default 10)
 *   neither set        -> seeded in-memory, for local dev and tests only.
 *                         Refused when NODE_ENV=production: data would vanish on restart.
 */
export function resolveLedgerRepository(env: NodeJS.ProcessEnv = process.env): RepositoryHandle {
  const url = databaseUrlFromEnv(env);
  if (url) {
    const max = Number(env.DATABASE_POOL_MAX ?? 10);
    if (!Number.isInteger(max) || max < 1) throw new Error(`DATABASE_POOL_MAX must be a positive integer`);
    const { db, close } = createDatabase(url, { max });
    return { repository: new PostgresLedgerRepository(db), close };
  }
  if (env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production; refusing to start on in-memory storage");
  }
  console.warn("[ledger-api] DATABASE_URL not set: using in-memory storage (data is lost on restart)");
  const repository = new InMemoryLedgerRepository({ seed: true });
  return { repository, close: async () => undefined };
}
