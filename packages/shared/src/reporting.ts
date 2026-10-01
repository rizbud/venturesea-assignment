import type { BalanceSheet, IncomeStatement, TrialBalance, TrialBalanceRow } from "./domain";
import type { PostingRow } from "./repository";
import { sumMinor } from "./money";

const POSTED = "POSTED";

function isPosted(row: PostingRow): boolean {
  return row.entryStatus === POSTED;
}

/** Accumulate debit/credit totals per account from a flat posting list. */
function aggregate(postings: readonly PostingRow[]): Map<string, TrialBalanceRow> {
  const byAccount = new Map<string, TrialBalanceRow>();
  for (const posting of postings) {
    if (!isPosted(posting)) continue;
    const existing = byAccount.get(posting.accountId);
    const row: TrialBalanceRow = existing ?? {
      accountId: posting.accountId,
      code: posting.accountCode,
      name: posting.accountName,
      type: posting.accountType,
      debitMinor: 0,
      creditMinor: 0,
      balanceMinor: 0,
    };
    if (posting.amountMinor > 0) row.debitMinor += posting.amountMinor;
    else row.creditMinor += Math.abs(posting.amountMinor);
    row.balanceMinor = row.debitMinor - row.creditMinor;
    byAccount.set(posting.accountId, row);
  }
  return byAccount;
}

function sortRows(rows: TrialBalanceRow[]): TrialBalanceRow[] {
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Trial balance: every account's debit/credit totals. The fundamental check is
 * totalDebit === totalCredit.
 */
export function buildTrialBalance(postings: readonly PostingRow[], asOf: string): TrialBalance {
  const scoped = postings.filter((p) => p.entryDate <= asOf);
  const rows = sortRows([...aggregate(scoped).values()]);
  const totalDebitMinor = sumMinor(rows.map((r) => r.debitMinor));
  const totalCreditMinor = sumMinor(rows.map((r) => r.creditMinor));
  return {
    asOf,
    rows,
    totalDebitMinor,
    totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor,
  };
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/**
 * Income statement for a period. Revenue accounts are credit-normal, so their
 * natural amount is `credit - debit` (i.e. -balanceMinor); expenses are the
 * opposite.
 */
export function buildIncomeStatement(
  postings: readonly PostingRow[],
  from: string,
  to: string,
): IncomeStatement {
  const scoped = postings.filter((p) => isPosted(p) && inRange(p.entryDate, from, to));
  const rows = [...aggregate(scoped).values()];
  const revenue = sortRows(rows.filter((r) => r.type === "REVENUE")).map((r) => ({
    ...r,
    balanceMinor: -r.balanceMinor,
  }));
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
 * Balance sheet as of a date. Equity is credit-normal; net income for the
 * period is folded into equity so the sheet balances by construction.
 */
export function buildBalanceSheet(
  postings: readonly PostingRow[],
  asOf: string,
  periodStart = "0000-01-01",
): BalanceSheet {
  const scoped = postings.filter((p) => isPosted(p) && p.entryDate <= asOf);
  const rows = [...aggregate(scoped).values()];
  const assets = sortRows(rows.filter((r) => r.type === "ASSET"));
  const liabilities = sortRows(rows.filter((r) => r.type === "LIABILITY")).map((r) => ({
    ...r,
    balanceMinor: -r.balanceMinor,
  }));
  const equity = sortRows(rows.filter((r) => r.type === "EQUITY")).map((r) => ({
    ...r,
    balanceMinor: -r.balanceMinor,
  }));

  const income = buildIncomeStatement(scoped, periodStart, asOf);
  const retained: TrialBalanceRow = {
    accountId: "current-period-earnings",
    code: "3999",
    name: "Current period earnings",
    type: "EQUITY",
    debitMinor: 0,
    creditMinor: 0,
    balanceMinor: income.netIncomeMinor,
  };
  const equityWithEarnings = [...equity, retained];

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
