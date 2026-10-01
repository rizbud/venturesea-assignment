import { createDatabase, databaseUrlFromEnv } from "./client";
import { seedPostgres } from "./seed";

async function main(): Promise<void> {
  const url = databaseUrlFromEnv();
  if (!url) throw new Error("DATABASE_URL (or PGHOST etc.) is required to seed Postgres");
  const { db, close } = createDatabase(url, { max: 1 });
  try {
    const { accounts, entries } = await seedPostgres(db);
    console.log(`Seeded: ${accounts} accounts present, ${entries} new entries (existing ones skipped).`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
