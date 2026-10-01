import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

/**
 * Apply every hand-written SQL migration in filename order. Each file must be
 * idempotent: there is no applied-migrations table, so all of them run each time.
 */
// ponytail: idempotent re-run instead of a schema_migrations table; switch to
// drizzle-kit migrate once a migration cannot be written idempotently.
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to run migrations");
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const dir = join(here, "..", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await sql.unsafe(await readFile(join(dir, file), "utf8"));
      console.log(`Applied ${file}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
