import type {
  Account,
  AccountType,
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

export interface ListJournalEntriesQuery {
  page: number;
  pageSize: number;
  status?: EntryStatus;
}

/**
 * Storage port for the ledger. Implemented by an in-memory adapter (default,
 * zero-config) and a Postgres adapter (Drizzle). The service layer depends only
 * on this interface.
 */
export interface LedgerRepository {
  readonly kind: "memory" | "postgres";

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
}
