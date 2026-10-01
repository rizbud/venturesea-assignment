#!/usr/bin/env node
/**
 * Apply every SQL migration in ./migrations in filename order.
 *
 * Plain ESM with one runtime dependency (`postgres`) so it runs in the pruned
 * production image as a deploy step — `node packages/db/migrate.mjs` — with no
 * TypeScript toolchain. Never run it on app boot.
 *
 * Each file must be idempotent: there is no applied-migrations table, so all of
 * them run on every deploy.
 */
// ponytail: idempotent re-run instead of a schema_migrations table; switch to
// drizzle-kit migrate once a migration cannot be written idempotently.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required to run migrations");
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    // One file = one implicit transaction (simple query protocol), so a failing
    // migration leaves no half-applied state.
    await sql.unsafe(await readFile(join(dir, file), "utf8"));
    console.log(`Applied ${file}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
