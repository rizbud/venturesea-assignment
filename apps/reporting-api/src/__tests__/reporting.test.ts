import { describe, expect, it } from "vitest";
import type { AccountType, EntryStatus, PostingRow } from "@ledgerlab/shared";
import { AppError, accountTotals } from "@ledgerlab/shared";
import { ReportingService } from "../services/reporting-service";
import type { TotalsSource } from "../ledger-client";
import { createReportingApp } from "../app";

let lineCounter = 0;

function posting(
  entryId: string,
  entryDate: string,
  accountId: string,
  accountCode: string,
  accountName: string,
  accountType: AccountType,
  amountMinor: number,
  entryStatus: EntryStatus = "POSTED",
): PostingRow {
  lineCounter += 1;
  return {
    entryId,
    entryDate,
    entryStatus,
    lineId: `jl_${lineCounter}`,
    accountId,
    accountCode,
    accountName,
    accountType,
    amountMinor,
  };
}

const POSTINGS: PostingRow[] = [
  posting("je_1", "2026-01-05", "acct_cash", "1000", "Cash", "ASSET", 5_000),
  posting("je_1", "2026-01-05", "acct_eq", "3000", "Owner's Equity", "EQUITY", -5_000),
  posting("je_2", "2026-01-10", "acct_ar", "1100", "Accounts Receivable", "ASSET", 2_500),
  posting("je_2", "2026-01-10", "acct_rev", "4000", "Service Revenue", "REVENUE", -2_500),
  posting("je_3", "2026-01-12", "acct_rent", "5000", "Rent Expense", "EXPENSE", 1_200),
  posting("je_3", "2026-01-12", "acct_cash", "1000", "Cash", "ASSET", -1_200),
];

const fakeSource: TotalsSource = { accountTotals: async (range) => accountTotals(POSTINGS, range) };

describe("ReportingService", () => {
  const service = new ReportingService(fakeSource);

  it("builds a balanced trial balance", async () => {
    const report = await service.trialBalance("2026-12-31");
    expect(report.balanced).toBe(true);
    expect(report.totalDebitMinor).toBe(report.totalCreditMinor);
    expect(report.totalDebitMinor).toBe(8_700);
  });

  it("computes an income statement for a period", async () => {
    const report = await service.incomeStatement("2026-01-01", "2026-01-31");
    expect(report.totalRevenueMinor).toBe(2_500);
    expect(report.totalExpensesMinor).toBe(1_200);
    expect(report.netIncomeMinor).toBe(1_300);
  });

  it("excludes postings outside the period", async () => {
    const report = await service.incomeStatement("2026-02-01", "2026-02-28");
    expect(report.netIncomeMinor).toBe(0);
  });

  it("builds a balance sheet that balances", async () => {
    const report = await service.balanceSheet("2026-12-31");
    expect(report.totalAssetsMinor).toBe(6_300);
    expect(report.totalLiabilitiesMinor).toBe(0);
    expect(report.totalEquityMinor).toBe(6_300);
    expect(report.outOfBalanceMinor).toBe(0);
  });

  it("summarises the dashboard", async () => {
    const summary = await service.dashboard("2026-01-31");
    expect(summary.cashMinor).toBe(3_800);
    expect(summary.netIncomeMonthToDateMinor).toBe(1_300);
    expect(summary.entryCount).toBe(3);
    expect(summary.balanced).toBe(true);
  });

  it("ignores draft and void entries", async () => {
    const withVoid = [
      ...POSTINGS,
      posting("je_void", "2026-01-15", "acct_cash", "1000", "Cash", "ASSET", 9_999, "VOID"),
    ];
    const source: TotalsSource = { accountTotals: async (range) => accountTotals(withVoid, range) };
    const summary = await new ReportingService(source).dashboard("2026-01-31");
    expect(summary.cashMinor).toBe(3_800);
  });
});

describe("reporting-api routes", () => {
  it("serves reports and health", async () => {
    const app = createReportingApp({ service: new ReportingService(fakeSource) });
    expect((await app.request("/health")).status).toBe(200);

    const res = await app.request("/api/reports/balance-sheet?asOf=2026-12-31");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { outOfBalanceMinor: number } };
    expect(body.data.outOfBalanceMinor).toBe(0);
  });

  it("validates query parameters", async () => {
    const app = createReportingApp({ service: new ReportingService(fakeSource) });
    const res = await app.request("/api/reports/trial-balance?asOf=not-a-date");
    expect(res.status).toBe(400);
  });

  it("maps an upstream outage to 503", async () => {
    const failing: TotalsSource = {
      accountTotals: async () => {
        throw new AppError("UPSTREAM_UNAVAILABLE", "Ledger API is unavailable", 503);
      },
    };
    const app = createReportingApp({ service: new ReportingService(failing) });
    const res = await app.request("/api/reports/dashboard");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
