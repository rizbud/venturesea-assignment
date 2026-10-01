import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema";

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * `DATABASE_URL`, or one built from the libpq variables (`PGHOST`, `PGPORT`,
 * `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`). ECS injects the RDS
 * password as its own secret, so it cannot arrive pre-assembled in a URL.
 * Undefined when neither is set.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.DATABASE_URL?.trim();
  if (url) return url;
  if (!env.PGHOST) return undefined;
  // encodeURIComponent, not the URL setters: those leave "%" unencoded.
  const auth = `${encodeURIComponent(env.PGUSER ?? "")}:${encodeURIComponent(env.PGPASSWORD ?? "")}`;
  const db = encodeURIComponent(env.PGDATABASE ?? "postgres");
  const ssl = env.PGSSLMODE ? `?sslmode=${encodeURIComponent(env.PGSSLMODE)}` : "";
  return `postgres://${auth}@${env.PGHOST}:${env.PGPORT ?? 5432}/${db}${ssl}`;
}

/**
 * Create a Drizzle client bound to a Postgres connection pool.
 * Call `close()` on shutdown so the process can exit.
 *
 * Pool size is per process: replicas x max must stay under the database's
 * connection limit (see docs/DATABASE.md). TLS is set in the URL (`?sslmode=require`).
 */
export function createDatabase(url: string, options?: { max?: number }) {
  const sql = postgres(url, {
    max: options?.max ?? 10,
    idle_timeout: 20, // seconds; release idle connections back to the server
    connect_timeout: 10, // seconds; fail fast instead of hanging requests
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}
