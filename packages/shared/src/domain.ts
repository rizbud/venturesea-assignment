import { z } from "zod";

/** True when `s` is YYYY-MM-DD and names a real day (2026-02-31 rolls over, so it fails). */
function isCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine(isCalendarDate, "is not a real calendar date");

/**
 * The five fundamental account types of double-entry bookkeeping.
 *
 *   ASSET      -> normal debit balance
 *   EXPENSE    -> normal debit balance
 *   LIABILITY  -> normal credit balance
 *   EQUITY     -> normal credit balance
 *   REVENUE    -> normal credit balance
 */
export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const NORMAL_BALANCE: Record<AccountType, "DEBIT" | "CREDIT"> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
};

/** A monetary amount is ALWAYS an integer number of minor units (cents). */
export const accountSchema = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[0-9]{4}$/, "Account code must be exactly 4 digits"),
  name: z.string().min(1).max(120),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().length(3).default("USD"),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
});
export type Account = z.infer<typeof accountSchema>;

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);

/**
 * A journal line. `amountMinor` is SIGNED:
 *   positive  => DEBIT
 *   negative  => CREDIT
 *
 * Storing one signed integer instead of parallel debit/credit columns makes the
 * core invariant trivial to check: the sum of every entry's lines MUST be 0.
 */
export const journalLineSchema = z.object({
  id: z.string().min(1),
  entryId: z.string().min(1),
  accountId: z.string().min(1),
  accountCode: z.string().optional(),
  accountName: z.string().optional(),
  /** Signed minor units. > 0 = debit, < 0 = credit, never 0. */
  amountMinor: z
    .number()
    .int()
    .refine((n) => n !== 0, "Journal line amount must not be zero"),
  memo: z.string().max(200).optional(),
});
export type JournalLine = z.infer<typeof journalLineSchema>;

export const ENTRY_STATUSES = ["DRAFT", "POSTED", "VOID"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const journalEntrySchema = z.object({
  id: z.string().min(1),
  /** ISO date (YYYY-MM-DD) the entry affects. */
  date: isoDateSchema,
  memo: z.string().min(1).max(280),
  reference: z.string().max(64).optional(),
  status: z.enum(ENTRY_STATUSES),
  lines: z.array(journalLineSchema).min(2, "A journal entry needs at least two lines"),
  createdAt: z.string().datetime(),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

/** Shape accepted by POST /api/journal-entries (server assigns ids/timestamps). */
export const createJournalEntrySchema = z.object({
  date: isoDateSchema,
  memo: z.string().min(1).max(280),
  reference: z.string().max(64).optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        amountMinor: z.number().int().safe(),
        memo: z.string().max(200).optional(),
      }),
    )
    .min(2, "A journal entry needs at least two lines"),
});
export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;

export const createAccountSchema = z.object({
  code: z.string().regex(/^[0-9]{4}$/, "Account code must be exactly 4 digits"),
  name: z.string().min(1).max(120),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().length(3).default("USD"),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/** Shape accepted by PATCH /api/accounts/:id. */
export const updateAccountSchema = z.object({ isActive: z.boolean() }).strict();
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debitMinor: number;
  creditMinor: number;
  /** Signed net: debit - credit. */
  balanceMinor: number;
}

export interface TrialBalance {
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebitMinor: number;
  totalCreditMinor: number;
  /** True when totalDebit === totalCredit, i.e. the ledger is in balance. */
  balanced: boolean;
}

export interface IncomeStatement {
  from: string;
  to: string;
  revenue: TrialBalanceRow[];
  expenses: TrialBalanceRow[];
  totalRevenueMinor: number;
  totalExpensesMinor: number;
  netIncomeMinor: number;
}

export interface BalanceSheet {
  asOf: string;
  assets: TrialBalanceRow[];
  liabilities: TrialBalanceRow[];
  equity: TrialBalanceRow[];
  totalAssetsMinor: number;
  totalLiabilitiesMinor: number;
  totalEquityMinor: number;
  /** Assets - (Liabilities + Equity). Must be 0 for a balanced ledger. */
  outOfBalanceMinor: number;
}

/** Key figures for the dashboard landing page. */
export interface DashboardSummary {
  asOf: string;
  totalAssetsMinor: number;
  totalLiabilitiesMinor: number;
  totalEquityMinor: number;
  revenueMonthToDateMinor: number;
  expensesMonthToDateMinor: number;
  netIncomeMonthToDateMinor: number;
  cashMinor: number;
  accountCount: number;
  entryCount: number;
  balanced: boolean;
}
