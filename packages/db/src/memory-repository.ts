import type {
  Account,
  CreateAccountInput,
  CreateJournalEntryInput,
  JournalEntry,
  LedgerRepository,
  ListJournalEntriesQuery,
  Paginated,
  PostingRow,
} from "@ledgerlab/shared";
import {
  ConflictError,
  NotFoundError,
  SEED_ACCOUNTS,
  buildSeedEntries,
  createId,
  isBalanced,
  sumMinor,
} from "@ledgerlab/shared";

/**
 * Zero-config in-memory ledger. Implements the exact same port as the Postgres
 * adapter so the API and tests can run without any external services.
 *
 * Data lives for the lifetime of the process. Use `seed()` to load demo data.
 */
export class InMemoryLedgerRepository implements LedgerRepository {
  readonly kind = "memory" as const;

  private readonly accounts = new Map<string, Account>();
  private readonly entries = new Map<string, JournalEntry>();

  constructor(options?: { seed?: boolean; today?: Date }) {
    if (options?.seed ?? false) {
      this.seed(options?.today);
    }
  }

  /** Load the standard demo chart of accounts and journal entries. */
  seed(today: Date = new Date()): void {
    const byCode = new Map<string, Account>();
    for (const input of SEED_ACCOUNTS) {
      const existing = this.getAccountByCodeSync(input.code);
      if (existing) {
        byCode.set(existing.code, existing);
        continue;
      }
      const account: Account = {
        id: createId("acct"),
        code: input.code,
        name: input.name,
        type: input.type,
        currency: input.currency,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      this.accounts.set(account.id, account);
      byCode.set(account.code, account);
    }

    for (const seedEntry of buildSeedEntries(today)) {
      const lines = seedEntry.lines.map((line) => {
        const account = byCode.get(line.accountCode);
        if (!account) throw new NotFoundError(`Seed account ${line.accountCode} not found`);
        return { account, amountMinor: line.amountMinor, memo: line.memo };
      });
      const entryId = createId("je");
      this.entries.set(entryId, {
        id: entryId,
        date: seedEntry.date,
        memo: seedEntry.memo,
        reference: seedEntry.reference,
        status: "POSTED",
        createdAt: new Date().toISOString(),
        lines: lines.map((line) => ({
          id: createId("jl"),
          entryId,
          accountId: line.account.id,
          accountCode: line.account.code,
          accountName: line.account.name,
          amountMinor: line.amountMinor,
          memo: line.memo,
        })),
      });
    }
  }

  private getAccountByCodeSync(code: string): Account | undefined {
    for (const account of this.accounts.values()) {
      if (account.code === code) return account;
    }
    return undefined;
  }

  async listAccounts(): Promise<Account[]> {
    return [...this.accounts.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async getAccountById(id: string): Promise<Account | undefined> {
    return this.accounts.get(id);
  }

  async getAccountByCode(code: string): Promise<Account | undefined> {
    return this.getAccountByCodeSync(code);
  }

  async createAccount(input: CreateAccountInput): Promise<Account> {
    if (this.getAccountByCodeSync(input.code)) {
      throw new ConflictError(`Account code ${input.code} already exists`);
    }
    const account: Account = {
      id: createId("acct"),
      code: input.code,
      name: input.name,
      type: input.type,
      currency: input.currency,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async setAccountActive(id: string, isActive: boolean): Promise<Account | undefined> {
    const account = this.accounts.get(id);
    if (!account) return undefined;
    const updated: Account = { ...account, isActive };
    this.accounts.set(id, updated);
    return updated;
  }

  async listJournalEntries(query: ListJournalEntriesQuery): Promise<Paginated<JournalEntry>> {
    const all = [...this.entries.values()]
      .filter((entry) => !query.status || entry.status === query.status)
      .filter((entry) => (!query.from || entry.date >= query.from) && (!query.to || entry.date <= query.to))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const start = (query.page - 1) * query.pageSize;
    return {
      data: all.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: all.length,
    };
  }

  async getJournalEntry(id: string): Promise<JournalEntry | undefined> {
    return this.entries.get(id);
  }

  async createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry> {
    const amounts = input.lines.map((line) => line.amountMinor);
    if (!isBalanced(amounts)) {
      throw new ConflictError(
        `Journal entry does not balance: debits minus credits = ${sumMinor(amounts)} minor units`,
      );
    }
    for (const line of input.lines) {
      if (!this.accounts.has(line.accountId)) {
        throw new NotFoundError(`Account ${line.accountId} not found`);
      }
    }

    const entryId = createId("je");
    const entry: JournalEntry = {
      id: entryId,
      date: input.date,
      memo: input.memo,
      reference: input.reference,
      status: "POSTED",
      createdAt: new Date().toISOString(),
      lines: input.lines.map((line) => {
        const account = this.accounts.get(line.accountId);
        return {
          id: createId("jl"),
          entryId,
          accountId: line.accountId,
          accountCode: account?.code,
          accountName: account?.name,
          amountMinor: line.amountMinor,
          memo: line.memo,
        };
      }),
    };
    this.entries.set(entryId, entry);
    return entry;
  }

  async voidJournalEntry(id: string): Promise<JournalEntry | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.status !== "POSTED") {
      throw new ConflictError(`Journal entry ${id} is ${entry.status}; only POSTED entries can be voided`);
    }
    const updated: JournalEntry = { ...entry, status: "VOID" };
    this.entries.set(id, updated);
    return updated;
  }

  async listPostings(): Promise<PostingRow[]> {
    const rows: PostingRow[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "POSTED") continue;
      for (const line of entry.lines) {
        const account = this.accounts.get(line.accountId);
        if (!account) continue;
        rows.push({
          entryId: entry.id,
          entryDate: entry.date,
          entryStatus: entry.status,
          lineId: line.id,
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.type,
          amountMinor: line.amountMinor,
        });
      }
    }
    return rows.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  }
}
