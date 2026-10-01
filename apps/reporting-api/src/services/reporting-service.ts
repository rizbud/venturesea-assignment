import type { BalanceSheet, DashboardSummary, IncomeStatement, TrialBalance } from "@ledgerlab/shared";
import { balanceSheetFromTotals, incomeStatementFromTotals, trialBalanceFromTotals } from "@ledgerlab/shared";
import type { TotalsSource } from "../ledger-client";

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * Reporting application layer. Every report is derived from per-account totals
 * that the ledger aggregates in SQL, so the service is stateless and its cost
 * does not grow with the size of the ledger.
 */
export class ReportingService {
  constructor(private readonly source: TotalsSource) {}

  async trialBalance(asOf: string): Promise<TrialBalance> {
    return trialBalanceFromTotals((await this.source.accountTotals({ to: asOf })).rows, asOf);
  }

  async incomeStatement(from: string, to: string): Promise<IncomeStatement> {
    return incomeStatementFromTotals((await this.source.accountTotals({ from, to })).rows, from, to);
  }

  async balanceSheet(asOf: string): Promise<BalanceSheet> {
    return balanceSheetFromTotals((await this.source.accountTotals({ to: asOf })).rows, asOf);
  }

  async dashboard(asOf: string): Promise<DashboardSummary> {
    const [allTime, month] = await Promise.all([
      this.source.accountTotals({ to: asOf }),
      this.source.accountTotals({ from: monthStart(asOf), to: asOf }),
    ]);
    const sheet = balanceSheetFromTotals(allTime.rows, asOf);
    const income = incomeStatementFromTotals(month.rows, monthStart(asOf), asOf);
    return {
      asOf,
      totalAssetsMinor: sheet.totalAssetsMinor,
      totalLiabilitiesMinor: sheet.totalLiabilitiesMinor,
      totalEquityMinor: sheet.totalEquityMinor,
      revenueMonthToDateMinor: income.totalRevenueMinor,
      expensesMonthToDateMinor: income.totalExpensesMinor,
      netIncomeMonthToDateMinor: income.netIncomeMinor,
      cashMinor: allTime.rows.find((r) => r.code === "1000")?.balanceMinor ?? 0,
      accountCount: allTime.rows.length,
      entryCount: allTime.entryCount,
      balanced: sheet.outOfBalanceMinor === 0,
    };
  }
}
