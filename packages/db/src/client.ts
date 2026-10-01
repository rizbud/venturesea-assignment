import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema";

export type Database = ReturnType<typeof createDatabase>["db"];

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
