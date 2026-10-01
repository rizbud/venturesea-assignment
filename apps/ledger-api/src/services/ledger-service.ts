import type {
  Account,
  CreateAccountInput,
  CreateJournalEntryInput,
  JournalEntry,
  LedgerRepository,
  ListJournalEntriesQuery,
  Paginated,
  PostingRow,
  TrialBalance,
} from "@ledgerlab/shared";
import {
  ConflictError,
  NotFoundError,
  UnbalancedEntryError,
  ValidationError,
  buildTrialBalance,
  isBalanced,
  sumMinor,
} from "@ledgerlab/shared";

export type ListEntriesParams = ListJournalEntriesQuery;

/**
 * Application layer for the ledger. Owns the business rules:
 *   - a journal entry must have at least two lines
 *   - every line amount must be non-zero
 *   - debits must equal credits (sum of signed minor units === 0)
 *   - referenced accounts must exist and be active
 *   - nothing dated on or before `closedThrough` may be posted or voided
 *
 * The repository only persists; it does not decide what is valid.
 */
export interface LedgerServiceOptions {
  /**
   * Last day of the most recent closed accounting period (YYYY-MM-DD). Entries
   * dated on or before it are immutable: they cannot be posted or voided.
   */
  // ponytail: one global close date from config; add a periods table when
  // periods must be closed/reopened at runtime or per business.
  closedThrough?: string;
}

export class LedgerService {
  constructor(
    private readonly repo: LedgerRepository,
    private readonly options: LedgerServiceOptions = {},
  ) {}

  private assertPeriodOpen(date: string, action: string): void {
    const { closedThrough } = this.options;
    if (closedThrough && date <= closedThrough) {
      throw new ConflictError(
        `Cannot ${action} an entry dated ${date}: the books are closed through ${closedThrough}`,
      );
    }
  }

  get repositoryKind(): "memory" | "postgres" {
    return this.repo.kind;
  }

  ping(): Promise<void> {
    return this.repo.ping();
  }

  listAccounts(): Promise<Account[]> {
    return this.repo.listAccounts();
  }

  async getAccountOrThrow(id: string): Promise<Account> {
    const account = await this.repo.getAccountById(id);
    if (!account) throw new NotFoundError(`Account ${id} not found`);
    return account;
  }

  createAccount(input: CreateAccountInput): Promise<Account> {
    return this.repo.createAccount(input);
  }

  /**
   * Inactive accounts reject new lines; existing postings still count in every
   * report, so deactivating never changes historical figures.
   */
  async setAccountActive(id: string, isActive: boolean): Promise<Account> {
    const account = await this.repo.setAccountActive(id, isActive);
    if (!account) throw new NotFoundError(`Account ${id} not found`);
    return account;
  }

  listJournalEntries(params: ListEntriesParams): Promise<Paginated<JournalEntry>> {
    return this.repo.listJournalEntries(params);
  }

  async getJournalEntryOrThrow(id: string): Promise<JournalEntry> {
    const entry = await this.repo.getJournalEntry(id);
    if (!entry) throw new NotFoundError(`Journal entry ${id} not found`);
    return entry;
  }

  async createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry> {
    if (input.lines.length < 2) {
      throw new ValidationError("A journal entry requires at least two lines");
    }
    for (const line of input.lines) {
      if (line.amountMinor === 0) {
        throw new ValidationError("Journal line amounts must not be zero");
      }
    }
    const amounts = input.lines.map((line) => line.amountMinor);
    if (!isBalanced(amounts)) {
      const total = sumMinor(amounts);
      throw new UnbalancedEntryError(
        `Entry is out of balance by ${total} minor units (debits must equal credits)`,
        total,
      );
    }
    this.assertPeriodOpen(input.date, "post");
    // Ensure every referenced account exists and is active before persisting.
    for (const line of input.lines) {
      const account = await this.getAccountOrThrow(line.accountId);
      if (!account.isActive) {
        throw new ValidationError(`Account ${account.code} ${account.name} is inactive`);
      }
    }
    return this.repo.createJournalEntry(input);
  }

  async voidJournalEntry(id: string): Promise<JournalEntry> {
    const entry = await this.getJournalEntryOrThrow(id);
    this.assertPeriodOpen(entry.date, "void");
    const voided = await this.repo.voidJournalEntry(id);
    if (!voided) throw new NotFoundError(`Journal entry ${id} not found`);
    return voided;
  }

  async trialBalance(asOf: string): Promise<TrialBalance> {
    const postings = await this.repo.listPostings();
    return buildTrialBalance(postings, asOf);
  }

  /** Raw postings for downstream services (used by the reporting API). */
  listPostings(): Promise<PostingRow[]> {
    return this.repo.listPostings();
  }
}
