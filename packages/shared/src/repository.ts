import type {
  Account,
  AccountType,
  TrialBalanceRow,
  CreateAccountInput,
  CreateJournalEntryInput,
  EntryStatus,
  JournalEntry,
} from "./domain";
import type { Paginated } from "./api";

/**
 * A denormalised posting row: one journal line joined with its account and its
 * parent entry's date/status. Reports are built from a flat list of these.
 */
export interface PostingRow {
  entryId: string;
  entryDate: string;
  entryStatus: EntryStatus;
  lineId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  /** Signed minor units: > 0 debit, < 0 credit. */
  amountMinor: number;
}

/** Inclusive YYYY-MM-DD bounds; omitted bounds are open. */
export interface DateRange {
  from?: string;
  to?: string;
}

/** Per-account gross debit/credit totals for POSTED entries in a date range. */
export interface AccountTotals {
  rows: TrialBalanceRow[];
  /** Distinct POSTED entries in the range. */
  entryCount: number;
}

export interface ListJournalEntriesQuery {
  page: number;
  pageSize: number;
  status?: EntryStatus;
  /** Inclusive YYYY-MM-DD bounds on the entry date. */
  from?: string;
  to?: string;
}

/**
 * Storage port for the ledger. Implemented by an in-memory adapter (default,
 * zero-config) and a Postgres adapter (Drizzle). The service layer depends only
 * on this interface.
 */
export interface LedgerRepository {
  readonly kind: "memory" | "postgres";

  /** Resolves when storage is reachable; rejects otherwise. Used by /health. */
  ping(): Promise<void>;

  listAccounts(): Promise<Account[]>;
  getAccountById(id: string): Promise<Account | undefined>;
  getAccountByCode(code: string): Promise<Account | undefined>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  /** Returns undefined when the account does not exist. */
  setAccountActive(id: string, isActive: boolean): Promise<Account | undefined>;

  listJournalEntries(query: ListJournalEntriesQuery): Promise<Paginated<JournalEntry>>;
  getJournalEntry(id: string): Promise<JournalEntry | undefined>;
  createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry>;
  /**
   * Transitions a POSTED entry to VOID. Returns undefined when the entry does
   * not exist; throws ConflictError when it is not POSTED.
   */
  voidJournalEntry(id: string): Promise<JournalEntry | undefined>;

  /** All lines belonging to POSTED entries, joined with account metadata. */
  listPostings(): Promise<PostingRow[]>;

  /** Per-account totals for POSTED entries in the range. The source for every report. */
  accountTotals(range: DateRange): Promise<AccountTotals>;
}
