import { describe, expect, it } from "vitest";
import type { AccountType, EntryStatus } from "./domain";
import type { PostingRow } from "./repository";
import { buildBalanceSheet, buildIncomeStatement, buildTrialBalance } from "./reporting";

const ACCOUNTS: Record<string, { name: string; type: AccountType }> = {
  "1000": { name: "Cash", type: "ASSET" },
  "3000": { name: "Owner's Equity", type: "EQUITY" },
  "4000": { name: "Revenue", type: "REVENUE" },
  "5000": { name: "Rent", type: "EXPENSE" },
};

/** A balanced two-line entry: debit `dr`, credit `cr`. */
function entry(
  id: string,
  date: string,
  dr: string,
  cr: string,
  amount: number,
  status: EntryStatus = "POSTED",
) {
  return [dr, cr].map((code, i): PostingRow => ({
    entryId: id,
    entryDate: date,
    entryStatus: status,
    lineId: `${id}_${i}`,
    accountId: `acct_${code}`,
    accountCode: code,
    accountName: ACCOUNTS[code]!.name,
    accountType: ACCOUNTS[code]!.type,
    amountMinor: i === 0 ? amount : -amount,
  }));
}

const POSTINGS: PostingRow[] = [
  ...entry("je_capital", "2026-01-01", "1000", "3000", 10_000),
  ...entry("je_sale", "2026-01-31", "1000", "4000", 2_000),
  ...entry("je_rent", "2026-02-01", "5000", "1000", 500),
  // Voided entries must never reach any report.
  ...entry("je_void_sale", "2026-01-15", "1000", "4000", 99_999, "VOID"),
  ...entry("je_void_rent", "2026-01-15", "5000", "1000", 77_777, "VOID"),
];

describe("reports exclude VOID entries", () => {
  it("trial balance", () => {
    const report = buildTrialBalance(POSTINGS, "2026-12-31");
    expect(report.totalDebitMinor).toBe(12_500);
    expect(report.balanced).toBe(true);
  });

  it("income statement", () => {
    const report = buildIncomeStatement(POSTINGS, "2026-01-01", "2026-12-31");
    expect(report.totalRevenueMinor).toBe(2_000);
    expect(report.totalExpensesMinor).toBe(500);
  });

  it("balance sheet", () => {
    const report = buildBalanceSheet(POSTINGS, "2026-12-31");
    expect(report.totalAssetsMinor).toBe(11_500);
    expect(report.outOfBalanceMinor).toBe(0);
  });
});

describe("report date boundaries are inclusive", () => {
  it("trial balance includes entries dated exactly asOf and nothing after", () => {
    expect(buildTrialBalance(POSTINGS, "2026-01-31").totalDebitMinor).toBe(12_000);
    expect(buildTrialBalance(POSTINGS, "2026-01-30").totalDebitMinor).toBe(10_000);
  });

  it("income statement includes both ends of the range", () => {
    expect(buildIncomeStatement(POSTINGS, "2026-01-31", "2026-02-01").netIncomeMinor).toBe(1_500);
    expect(buildIncomeStatement(POSTINGS, "2026-02-02", "2026-12-31").netIncomeMinor).toBe(0);
  });

  it("balance sheet excludes entries after asOf and still balances", () => {
    const report = buildBalanceSheet(POSTINGS, "2026-01-31");
    expect(report.totalAssetsMinor).toBe(12_000);
    expect(report.outOfBalanceMinor).toBe(0);
  });
});
