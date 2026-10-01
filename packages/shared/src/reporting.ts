import type { BalanceSheet, IncomeStatement, TrialBalance, TrialBalanceRow } from "./domain";
import type { AccountTotals, DateRange, PostingRow } from "./repository";
import { sumMinor } from "./money";

/*
 * Reports are built from per-account totals (gross debits and credits), not from
 * raw postings. Postgres computes the totals with one GROUP BY, so a report costs
 * the same whether the ledger holds a hundred lines or a million. `accountTotals`
 * below is the in-memory reference implementation of that query.
 */

/**
 * Per-account gross debit/credit totals over POSTED entries in an inclusive date
 * range, plus the number of distinct entries counted.
 */
export function accountTotals(postings: readonly PostingRow[], range: DateRange = {}): AccountTotals {
  const byAccount = new Map<string, TrialBalanceRow>();
  const entries = new Set<string>();
  for (const posting of postings) {
    if (posting.entryStatus !== "POSTED") continue;
    if (range.from && posting.entryDate < range.from) continue;
    if (range.to && posting.entryDate > range.to) continue;
    entries.add(posting.entryId);
    const row = byAccount.get(posting.accountId) ?? {
      accountId: posting.accountId,
      code: posting.accountCode,
      name: posting.accountName,
      type: posting.accountType,
      debitMinor: 0,
      creditMinor: 0,
      balanceMinor: 0,
    };
    if (posting.amountMinor > 0) row.debitMinor += posting.amountMinor;
    else row.creditMinor -= posting.amountMinor;
    row.balanceMinor = row.debitMinor - row.creditMinor;
    byAccount.set(posting.accountId, row);
  }
  return { rows: [...byAccount.values()], entryCount: entries.size };
}

function sortRows(rows: TrialBalanceRow[]): TrialBalanceRow[] {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code));
}

/** Credit-normal accounts read as `credit - debit`. */
function creditNormal(rows: TrialBalanceRow[]): TrialBalanceRow[] {
  return rows.map((r) => ({ ...r, balanceMinor: -r.balanceMinor }));
}

/**
 * Trial balance from account totals for everything up to `asOf`. The
 * fundamental check is totalDebit === totalCredit.
 */
export function trialBalanceFromTotals(rows: readonly TrialBalanceRow[], asOf: string): TrialBalance {
  const sorted = sortRows([...rows]);
  const totalDebitMinor = sumMinor(sorted.map((r) => r.debitMinor));
  const totalCreditMinor = sumMinor(sorted.map((r) => r.creditMinor));
  return {
    asOf,
    rows: sorted,
    totalDebitMinor,
    totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor,
  };
}

/** Income statement from account totals for exactly the period `from`..`to`. */
export function incomeStatementFromTotals(
  rows: readonly TrialBalanceRow[],
  from: string,
  to: string,
): IncomeStatement {
  const revenue = creditNormal(sortRows(rows.filter((r) => r.type === "REVENUE")));
  const expenses = sortRows(rows.filter((r) => r.type === "EXPENSE"));
  const totalRevenueMinor = sumMinor(revenue.map((r) => r.balanceMinor));
  const totalExpensesMinor = sumMinor(expenses.map((r) => r.balanceMinor));
  return {
    from,
    to,
    revenue,
    expenses,
    totalRevenueMinor,
    totalExpensesMinor,
    netIncomeMinor: totalRevenueMinor - totalExpensesMinor,
  };
}

/**
 * Balance sheet from account totals for everything up to `asOf`. All-time net
 * income is folded into equity, so the sheet balances by construction.
 */
export function balanceSheetFromTotals(rows: readonly TrialBalanceRow[], asOf: string): BalanceSheet {
  const assets = sortRows(rows.filter((r) => r.type === "ASSET"));
  const liabilities = creditNormal(sortRows(rows.filter((r) => r.type === "LIABILITY")));
  const equity = creditNormal(sortRows(rows.filter((r) => r.type === "EQUITY")));
  const income = incomeStatementFromTotals(rows, "0000-01-01", asOf);
  const equityWithEarnings: TrialBalanceRow[] = [
    ...equity,
    {
      accountId: "current-period-earnings",
      code: "3999",
      name: "Current period earnings",
      type: "EQUITY",
      debitMinor: 0,
      creditMinor: 0,
      balanceMinor: income.netIncomeMinor,
    },
  ];

  const totalAssetsMinor = sumMinor(assets.map((r) => r.balanceMinor));
  const totalLiabilitiesMinor = sumMinor(liabilities.map((r) => r.balanceMinor));
  const totalEquityMinor = sumMinor(equityWithEarnings.map((r) => r.balanceMinor));
  return {
    asOf,
    assets,
    liabilities,
    equity: equityWithEarnings,
    totalAssetsMinor,
    totalLiabilitiesMinor,
    totalEquityMinor,
    outOfBalanceMinor: totalAssetsMinor - (totalLiabilitiesMinor + totalEquityMinor),
  };
}

/** Trial balance straight from postings (only those dated on or before `asOf`). */
export function buildTrialBalance(postings: readonly PostingRow[], asOf: string): TrialBalance {
  return trialBalanceFromTotals(accountTotals(postings, { to: asOf }).rows, asOf);
}

/** Income statement straight from postings dated within `from`..`to`. */
export function buildIncomeStatement(
  postings: readonly PostingRow[],
  from: string,
  to: string,
): IncomeStatement {
  return incomeStatementFromTotals(accountTotals(postings, { from, to }).rows, from, to);
}

/** Balance sheet straight from postings dated on or before `asOf`. */
export function buildBalanceSheet(postings: readonly PostingRow[], asOf: string): BalanceSheet {
  return balanceSheetFromTotals(accountTotals(postings, { to: asOf }).rows, asOf);
}
