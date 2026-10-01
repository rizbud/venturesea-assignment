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

// Migrations run as the schema owner; the app runs as the least-privilege
// ledgerlab_app role (0003_app_role.sql). MIGRATION_DATABASE_URL carries the
// owner's credentials where the two differ.
// On ECS the owner's credentials arrive as libpq variables (PGHOST, PGUSER,
// PGPASSWORD, ...) instead of a URL; same rule as databaseUrlFromEnv in src/client.ts.
let url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url && process.env.PGHOST) {
  const {
    PGHOST,
    PGPORT = "5432",
    PGDATABASE = "postgres",
    PGUSER = "",
    PGPASSWORD = "",
    PGSSLMODE,
  } = process.env;
  const auth = `${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}`;
  const ssl = PGSSLMODE ? `?sslmode=${encodeURIComponent(PGSSLMODE)}` : "";
  url = `postgres://${auth}@${PGHOST}:${PGPORT}/${encodeURIComponent(PGDATABASE)}${ssl}`;
}
if (!url) {
  console.error("MIGRATION_DATABASE_URL, DATABASE_URL or PGHOST is required to run migrations");
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  // When the platform hands us the app role's password (AWS: from Secrets
  // Manager), create the role or rotate its password before the grants in
  // 0003/0004 run. Elsewhere an operator creates it once (see 0003_app_role.sql).
  const appPassword = process.env.APP_DB_PASSWORD;
  if (appPassword) {
    const literal = `'${appPassword.replaceAll("'", "''")}'`;
    await sql.unsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlab_app') THEN
        CREATE ROLE ledgerlab_app LOGIN;
      END IF; END $$`);
    await sql.unsafe(`ALTER ROLE ledgerlab_app WITH LOGIN PASSWORD ${literal}`);
    console.log("Ensured role ledgerlab_app");
  }
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
