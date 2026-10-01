import { describe, expect, it } from "vitest";
import { InMemoryLedgerRepository } from "@ledgerlab/db";
import { ConflictError, NotFoundError, UnbalancedEntryError, ValidationError } from "@ledgerlab/shared";
import { LedgerService } from "../services/ledger-service";

function buildService() {
  return new LedgerService(new InMemoryLedgerRepository({ seed: true }));
}

describe("LedgerService business rules", () => {
  it("refuses a single-line entry", async () => {
    const service = buildService();
    const [cash] = await service.listAccounts();
    await expect(
      service.createJournalEntry({
        date: "2026-02-01",
        memo: "one liner",
        lines: [{ accountId: cash!.id, amountMinor: 100 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses zero-amount lines", async () => {
    const service = buildService();
    const accounts = await service.listAccounts();
    const cash = accounts.find((a) => a.code === "1000")!;
    const revenue = accounts.find((a) => a.code === "4000")!;
    await expect(
      service.createJournalEntry({
        date: "2026-02-01",
        memo: "zero line",
        lines: [
          { accountId: cash.id, amountMinor: 0 },
          { accountId: revenue.id, amountMinor: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("flags an out-of-balance entry", async () => {
    const service = buildService();
    const accounts = await service.listAccounts();
    const cash = accounts.find((a) => a.code === "1000")!;
    const revenue = accounts.find((a) => a.code === "4000")!;
    await expect(
      service.createJournalEntry({
        date: "2026-02-01",
        memo: "imbalanced",
        lines: [
          { accountId: cash.id, amountMinor: 100 },
          { accountId: revenue.id, amountMinor: -99 },
        ],
      }),
    ).rejects.toBeInstanceOf(UnbalancedEntryError);
  });

  it("throws NotFound for unknown entries", async () => {
    await expect(buildService().getJournalEntryOrThrow("je_missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFound when voiding an unknown entry", async () => {
    await expect(buildService().voidJournalEntry("je_missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws Conflict for duplicate account codes", async () => {
    const service = buildService();
    await expect(
      service.createAccount({ code: "1000", name: "Duplicate cash", type: "ASSET", currency: "USD" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("LedgerService account and period rules", () => {
  async function accountsOf(service: LedgerService) {
    const accounts = await service.listAccounts();
    return {
      cash: accounts.find((a) => a.code === "1000")!,
      revenue: accounts.find((a) => a.code === "4000")!,
    };
  }

  function sale(cashId: string, revenueId: string, date: string) {
    return {
      date,
      memo: "Sale",
      lines: [
        { accountId: cashId, amountMinor: 1_00 },
        { accountId: revenueId, amountMinor: -1_00 },
      ],
    };
  }

  it("refuses lines on an inactive account and accepts them again once reactivated", async () => {
    const service = buildService();
    const { cash, revenue } = await accountsOf(service);
    await service.setAccountActive(revenue.id, false);
    await expect(service.createJournalEntry(sale(cash.id, revenue.id, "2026-09-01"))).rejects.toThrow(
      /inactive/,
    );
    await service.setAccountActive(revenue.id, true);
    expect((await service.createJournalEntry(sale(cash.id, revenue.id, "2026-09-01"))).status).toBe("POSTED");
  });

  it("throws NotFound when deactivating an unknown account", async () => {
    await expect(buildService().setAccountActive("acct_missing", false)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  describe("with the books closed through 2026-08-31", () => {
    function closedService() {
      return new LedgerService(new InMemoryLedgerRepository({ seed: true }), { closedThrough: "2026-08-31" });
    }

    it("refuses to post into the closed period, including its last day", async () => {
      const service = closedService();
      const { cash, revenue } = await accountsOf(service);
      for (const date of ["2026-08-31", "2026-01-15"]) {
        await expect(service.createJournalEntry(sale(cash.id, revenue.id, date))).rejects.toBeInstanceOf(
          ConflictError,
        );
      }
    });

    it("accepts entries dated after the close", async () => {
      const service = closedService();
      const { cash, revenue } = await accountsOf(service);
      const entry = await service.createJournalEntry(sale(cash.id, revenue.id, "2026-09-01"));
      expect(entry.status).toBe("POSTED");
    });

    it("refuses to void an entry in the closed period", async () => {
      const repo = new InMemoryLedgerRepository({ seed: true });
      const open = new LedgerService(repo);
      const { cash, revenue } = await accountsOf(open);
      const entry = await open.createJournalEntry(sale(cash.id, revenue.id, "2026-08-15"));

      const closed = new LedgerService(repo, { closedThrough: "2026-08-31" });
      await expect(closed.voidJournalEntry(entry.id)).rejects.toBeInstanceOf(ConflictError);
      expect((await repo.getJournalEntry(entry.id))?.status).toBe("POSTED");
    });
  });
});
