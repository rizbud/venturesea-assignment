import { inArray } from "drizzle-orm";
import { SEED_ACCOUNTS, buildSeedEntries } from "@ledgerlab/shared";
import type { Database } from "./client";
import { PostgresLedgerRepository } from "./postgres-repository";
import { journalEntries } from "./schema";

/**
 * Load the demo chart of accounts and journal entries. Safe to re-run: accounts
 * are matched by code and entries by reference, so nothing is inserted twice.
 * Demo data only — never run this against production.
 */
export async function seedPostgres(
  db: Database,
  today?: Date,
): Promise<{ accounts: number; entries: number }> {
  const repo = new PostgresLedgerRepository(db);
  const existingCodes = new Set((await repo.listAccounts()).map((a) => a.code));
  for (const account of SEED_ACCOUNTS) {
    if (!existingCodes.has(account.code)) await repo.createAccount(account);
  }
  const accountsByCode = new Map((await repo.listAccounts()).map((a) => [a.code, a]));

  const entries = buildSeedEntries(today);
  const references = entries.map((e) => e.reference).filter((r): r is string => Boolean(r));
  const seeded = new Set(
    (
      await db
        .select({ reference: journalEntries.reference })
        .from(journalEntries)
        .where(inArray(journalEntries.reference, references))
    ).map((row) => row.reference),
  );

  let inserted = 0;
  for (const entry of entries) {
    if (entry.reference && seeded.has(entry.reference)) continue;
    await repo.createJournalEntry({
      date: entry.date,
      memo: entry.memo,
      reference: entry.reference,
      lines: entry.lines.map((line) => {
        const account = accountsByCode.get(line.accountCode);
        if (!account) throw new Error(`Seed account ${line.accountCode} missing`);
        return { accountId: account.id, amountMinor: line.amountMinor, memo: line.memo };
      }),
    });
    inserted += 1;
  }
  return { accounts: accountsByCode.size, entries: inserted };
}
