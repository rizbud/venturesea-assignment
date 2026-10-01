/**
 * LedgerRepository contract: every adapter must uphold the same invariants.
 *
 * In-memory always runs. Postgres runs when TEST_DATABASE_URL points at a
 * MIGRATED, DISPOSABLE database — each test truncates the ledger tables.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryLedgerRepository, PostgresLedgerRepository, createDatabase } from "@ledgerlab/db";
import type { Account, LedgerRepository } from "@ledgerlab/shared";
import { ConflictError, NotFoundError, sumMinor } from "@ledgerlab/shared";

interface Adapter {
  name: string;
  create: () => Promise<LedgerRepository>;
  close?: () => Promise<void>;
}

const adapters: Adapter[] = [{ name: "memory", create: async () => new InMemoryLedgerRepository() }];

const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) {
  const { db, sql, close } = createDatabase(pgUrl, { max: 4 });
  adapters.push({
    name: "postgres",
    create: async () => {
      await sql`TRUNCATE journal_lines, journal_entries, accounts CASCADE`;
      return new PostgresLedgerRepository(db);
    },
    close,
  });
}

describe.each(adapters)("LedgerRepository contract ($name)", (adapter) => {
  let repo: LedgerRepository;
  let cash: Account;
  let revenue: Account;

  beforeEach(async () => {
    repo = await adapter.create();
    cash = await repo.createAccount({ code: "1000", name: "Cash", type: "ASSET", currency: "USD" });
    revenue = await repo.createAccount({ code: "4000", name: "Revenue", type: "REVENUE", currency: "USD" });
  });

  afterAll(async () => {
    await adapter.close?.();
  });

  function sale(amountMinor: number, date = "2026-03-01") {
    return repo.createJournalEntry({
      date,
      memo: "Sale",
      lines: [
        { accountId: cash.id, amountMinor },
        { accountId: revenue.id, amountMinor: -amountMinor },
      ],
    });
  }

  async function entryCount(): Promise<number> {
    return (await repo.listJournalEntries({ page: 1, pageSize: 1 })).total;
  }

  it("every persisted entry and the posting list net to zero", async () => {
    await sale(12_345);
    await sale(1);
    const entries = await repo.listJournalEntries({ page: 1, pageSize: 50 });
    expect(entries.total).toBe(2);
    for (const entry of entries.data) {
      expect(sumMinor(entry.lines.map((l) => l.amountMinor))).toBe(0);
    }
    expect(sumMinor((await repo.listPostings()).map((p) => p.amountMinor))).toBe(0);
  });

  it("refuses an unbalanced entry even when called without the service", async () => {
    await expect(
      repo.createJournalEntry({
        date: "2026-03-01",
        memo: "Unbalanced",
        lines: [
          { accountId: cash.id, amountMinor: 100 },
          { accountId: revenue.id, amountMinor: -99 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await entryCount()).toBe(0);
  });

  it("persists nothing when a line references an unknown account", async () => {
    await expect(
      repo.createJournalEntry({
        date: "2026-03-01",
        memo: "Half valid",
        lines: [
          { accountId: cash.id, amountMinor: 100 },
          { accountId: "acct_missing", amountMinor: -100 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await entryCount()).toBe(0);
    expect(await repo.listPostings()).toHaveLength(0);
  });

  it("voids a POSTED entry exactly once and drops it from postings", async () => {
    const entry = await sale(500);
    const voided = await repo.voidJournalEntry(entry.id);
    expect(voided?.status).toBe("VOID");
    await expect(repo.voidJournalEntry(entry.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.getJournalEntry(entry.id))?.status).toBe("VOID");
    expect(await repo.listPostings()).toHaveLength(0);
  });

  it("lets only one of two concurrent voids succeed", async () => {
    const entry = await sale(500);
    const results = await Promise.allSettled([
      repo.voidJournalEntry(entry.id),
      repo.voidJournalEntry(entry.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
  });

  it("stores amounts beyond the 32-bit range exactly", async () => {
    const rp5bn = 5_000_000_000; // IDR has no minor unit, so this is Rp 5bn
    const entry = await sale(rp5bn);
    const stored = await repo.getJournalEntry(entry.id);
    expect(stored?.lines.map((l) => l.amountMinor)).toEqual([rp5bn, -rp5bn]);
    expect((await repo.listPostings()).map((p) => p.amountMinor)).toEqual([rp5bn, -rp5bn]);
  });

  it("toggles an account's active flag and persists it", async () => {
    expect((await repo.setAccountActive(revenue.id, false))?.isActive).toBe(false);
    expect((await repo.getAccountById(revenue.id))?.isActive).toBe(false);
    expect((await repo.setAccountActive(revenue.id, true))?.isActive).toBe(true);
    expect(await repo.setAccountActive("acct_missing", false)).toBeUndefined();
  });

  it("returns undefined when voiding an unknown entry", async () => {
    expect(await repo.voidJournalEntry("je_missing")).toBeUndefined();
  });
});
