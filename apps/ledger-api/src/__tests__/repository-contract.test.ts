/**
 * LedgerRepository contract: every adapter must uphold the same invariants.
 *
 * In-memory always runs. Postgres runs when TEST_DATABASE_URL points at a
 * MIGRATED, DISPOSABLE database — each test truncates the ledger tables. The
 * Postgres-only suite at the bottom lives in this file on purpose: vitest runs
 * files in parallel, and two files truncating one database would race.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryLedgerRepository,
  PostgresLedgerRepository,
  createDatabase,
  seedPostgres,
} from "@ledgerlab/db";
import type { Account, LedgerRepository } from "@ledgerlab/shared";
import { ConflictError, NotFoundError, accountTotals, sumMinor } from "@ledgerlab/shared";

interface Adapter {
  name: string;
  create: () => Promise<LedgerRepository>;
}

const adapters: Adapter[] = [{ name: "memory", create: async () => new InMemoryLedgerRepository() }];

const pgUrl = process.env.TEST_DATABASE_URL;
const pg = pgUrl ? createDatabase(pgUrl, { max: 4 }) : undefined;
// TRUNCATE skips row triggers, so the append-only guards do not block test resets.
const resetPg = async () => pg!.sql`TRUNCATE journal_lines, journal_entries, accounts CASCADE`;
if (pg) {
  adapters.push({
    name: "postgres",
    create: async () => {
      await resetPg();
      return new PostgresLedgerRepository(pg.db);
    },
  });
}

afterAll(async () => {
  await pg?.close();
});

describe.each(adapters)("LedgerRepository contract ($name)", (adapter) => {
  let repo: LedgerRepository;
  let cash: Account;
  let revenue: Account;

  beforeEach(async () => {
    repo = await adapter.create();
    cash = await repo.createAccount({ code: "1000", name: "Cash", type: "ASSET", currency: "USD" });
    revenue = await repo.createAccount({ code: "4000", name: "Revenue", type: "REVENUE", currency: "USD" });
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

  it("filters the entry list by inclusive date range and status", async () => {
    await sale(100, "2026-03-01");
    const mid = await sale(200, "2026-03-15");
    await sale(300, "2026-03-31");
    const range = await repo.listJournalEntries({
      page: 1,
      pageSize: 50,
      from: "2026-03-15",
      to: "2026-03-31",
    });
    expect(range.data.map((e) => e.date)).toEqual(["2026-03-31", "2026-03-15"]);
    expect(range.total).toBe(2);

    await repo.voidJournalEntry(mid.id);
    const posted = await repo.listJournalEntries({
      page: 1,
      pageSize: 50,
      status: "POSTED",
      from: "2026-03-15",
    });
    expect(posted.data.map((e) => e.date)).toEqual(["2026-03-31"]);
  });

  it("aggregates account totals exactly like the reference implementation", async () => {
    await sale(100, "2026-03-01");
    await sale(250, "2026-03-15");
    const voided = await sale(7_777, "2026-03-15");
    await sale(400, "2026-03-31");
    await repo.voidJournalEntry(voided.id);
    // Same postings, same ranges: SQL GROUP BY must equal the JS reference, edges inclusive.
    const postings = await repo.listPostings();
    const byCode = (rows: { code: string }[]) => [...rows].sort((a, b) => a.code.localeCompare(b.code));
    for (const range of [
      {},
      { to: "2026-03-15" },
      { from: "2026-03-15", to: "2026-03-15" },
      { from: "2026-04-01" },
    ]) {
      const actual = await repo.accountTotals(range);
      const expected = accountTotals(postings, range);
      expect(byCode(actual.rows)).toEqual(byCode(expected.rows));
      expect(actual.entryCount).toBe(expected.entryCount);
    }
    const march = await repo.accountTotals({ to: "2026-03-15" });
    expect(march.entryCount).toBe(2);
    expect(march.rows.find((r) => r.code === "1000")?.debitMinor).toBe(350);
  });

  it("returns undefined when voiding an unknown entry", async () => {
    expect(await repo.voidJournalEntry("je_missing")).toBeUndefined();
  });
});

describe.skipIf(!pg)("Postgres enforces the invariants itself (bypassing the app)", () => {
  let entryId: string;
  let lineId: string;

  beforeEach(async () => {
    await resetPg();
    const repo = new PostgresLedgerRepository(pg!.db);
    const cash = await repo.createAccount({ code: "1000", name: "Cash", type: "ASSET", currency: "USD" });
    const revenue = await repo.createAccount({
      code: "4000",
      name: "Revenue",
      type: "REVENUE",
      currency: "USD",
    });
    const entry = await repo.createJournalEntry({
      date: "2026-03-01",
      memo: "Sale",
      lines: [
        { accountId: cash.id, amountMinor: 500 },
        { accountId: revenue.id, amountMinor: -500 },
      ],
    });
    entryId = entry.id;
    lineId = entry.lines[0]!.id;
  });

  it("rejects an unbalanced entry at commit", async () => {
    const [{ id: accountId }] = await pg!.sql<[{ id: string }]>`SELECT id FROM accounts WHERE code = '1000'`;
    await expect(
      pg!.sql.begin(async (tx) => {
        await tx`INSERT INTO journal_entries (id, entry_date, memo) VALUES ('je_raw', '2026-03-02', 'raw')`;
        await tx`INSERT INTO journal_lines (id, entry_id, account_id, amount_minor) VALUES ('jl_raw', 'je_raw', ${accountId}, 100)`;
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(await pg!.sql`SELECT 1 FROM journal_entries WHERE id = 'je_raw'`).toHaveLength(0);
  });

  it("refuses to edit or delete posted lines", async () => {
    await expect(pg!.sql`UPDATE journal_lines SET amount_minor = 999 WHERE id = ${lineId}`).rejects.toThrow(
      /append-only/,
    );
    await expect(pg!.sql`DELETE FROM journal_lines WHERE id = ${lineId}`).rejects.toThrow(/append-only/);
  });

  it("refuses to delete entries or move them anywhere but POSTED -> VOID", async () => {
    await expect(pg!.sql`DELETE FROM journal_entries WHERE id = ${entryId}`).rejects.toThrow(/append-only/);
    await expect(pg!.sql`UPDATE journal_entries SET memo = 'edited' WHERE id = ${entryId}`).rejects.toThrow(
      /POSTED -> VOID/,
    );
    await pg!.sql`UPDATE journal_entries SET status = 'VOID' WHERE id = ${entryId}`;
    await expect(pg!.sql`UPDATE journal_entries SET status = 'POSTED' WHERE id = ${entryId}`).rejects.toThrow(
      /POSTED -> VOID/,
    );
  });

  it("rejects impossible dates and zero-amount lines", async () => {
    await expect(
      pg!.sql`INSERT INTO journal_entries (id, entry_date, memo) VALUES ('je_bad', '2026-02-31', 'bad')`,
    ).rejects.toThrow();
    await expect(
      pg!
        .sql`INSERT INTO journal_lines (id, entry_id, account_id, amount_minor) SELECT 'jl_zero', ${entryId}, id, 0 FROM accounts LIMIT 1`,
    ).rejects.toThrow(/amount_nonzero/);
  });

  it("seeds idempotently: a second run inserts nothing", async () => {
    await resetPg();
    const first = await seedPostgres(pg!.db);
    const second = await seedPostgres(pg!.db);
    expect(first.entries).toBeGreaterThan(0);
    expect(second.entries).toBe(0);
    const [{ count }] = await pg!.sql<
      [{ count: number }]
    >`SELECT count(*)::int AS count FROM journal_entries`;
    expect(count).toBe(first.entries);
  });
});
