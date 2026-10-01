import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type {
  Account,
  CreateAccountInput,
  CreateJournalEntryInput,
  JournalEntry,
  JournalLine,
  LedgerRepository,
  ListJournalEntriesQuery,
  Paginated,
  PostingRow,
} from "@ledgerlab/shared";
import { ConflictError, NotFoundError, createId, isBalanced, sumMinor } from "@ledgerlab/shared";
import { accounts, journalEntries, journalLines } from "./schema";
import type { Database } from "./client";

type AccountRow = typeof accounts.$inferSelect;
type EntryRow = typeof journalEntries.$inferSelect;
type LineRow = typeof journalLines.$inferSelect;

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    currency: row.currency,
    isActive: row.isActive === 1,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEntry(row: EntryRow, lines: JournalLine[]): JournalEntry {
  return {
    id: row.id,
    date: row.entryDate,
    memo: row.memo,
    reference: row.reference ?? undefined,
    status: row.status,
    lines,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PostgresLedgerRepository implements LedgerRepository {
  readonly kind = "postgres" as const;

  constructor(private readonly db: Database) {}

  async listAccounts(): Promise<Account[]> {
    const rows = await this.db.select().from(accounts).orderBy(asc(accounts.code));
    return rows.map(toAccount);
  }

  async getAccountById(id: string): Promise<Account | undefined> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
    return row ? toAccount(row) : undefined;
  }

  async getAccountByCode(code: string): Promise<Account | undefined> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.code, code)).limit(1);
    return row ? toAccount(row) : undefined;
  }

  async createAccount(input: CreateAccountInput): Promise<Account> {
    const existing = await this.getAccountByCode(input.code);
    if (existing) throw new ConflictError(`Account code ${input.code} already exists`);
    const [row] = await this.db
      .insert(accounts)
      .values({
        id: createId("acct"),
        code: input.code,
        name: input.name,
        type: input.type,
        currency: input.currency,
        isActive: 1,
      })
      .returning();
    if (!row) throw new Error("Failed to insert account");
    return toAccount(row);
  }

  async setAccountActive(id: string, isActive: boolean): Promise<Account | undefined> {
    const [row] = await this.db
      .update(accounts)
      .set({ isActive: isActive ? 1 : 0 })
      .where(eq(accounts.id, id))
      .returning();
    return row ? toAccount(row) : undefined;
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`select 1`);
  }

  /** Lines for many entries in one query, grouped by entry id. */
  private async linesFor(entryIds: string[]): Promise<Map<string, JournalLine[]>> {
    const byEntry = new Map<string, JournalLine[]>(entryIds.map((id) => [id, []]));
    if (entryIds.length === 0) return byEntry;
    const rows = await this.db
      .select({
        line: journalLines,
        accountCode: accounts.code,
        accountName: accounts.name,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(inArray(journalLines.entryId, entryIds))
      .orderBy(asc(journalLines.position));

    for (const { line, accountCode, accountName } of rows) {
      byEntry.get(line.entryId)?.push({
        id: line.id,
        entryId: line.entryId,
        accountId: line.accountId,
        accountCode,
        accountName,
        amountMinor: line.amountMinor,
        memo: line.memo ?? undefined,
      });
    }
    return byEntry;
  }

  async listJournalEntries(query: ListJournalEntriesQuery): Promise<Paginated<JournalEntry>> {
    const where = and(
      query.status ? eq(journalEntries.status, query.status) : undefined,
      query.from ? gte(journalEntries.entryDate, query.from) : undefined,
      query.to ? lte(journalEntries.entryDate, query.to) : undefined,
    );
    const offset = (query.page - 1) * query.pageSize;

    const rows = await this.db
      .select()
      .from(journalEntries)
      .where(where)
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    const [countRow] = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(where);
    const total = countRow?.value ?? 0;

    const lines = await this.linesFor(rows.map((row) => row.id));
    const data = rows.map((row) => toEntry(row, lines.get(row.id) ?? []));
    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  async getJournalEntry(id: string): Promise<JournalEntry | undefined> {
    const [row] = await this.db.select().from(journalEntries).where(eq(journalEntries.id, id)).limit(1);
    if (!row) return undefined;
    return toEntry(row, (await this.linesFor([row.id])).get(row.id) ?? []);
  }

  async createJournalEntry(input: CreateJournalEntryInput): Promise<JournalEntry> {
    const amounts = input.lines.map((line) => line.amountMinor);
    if (!isBalanced(amounts)) {
      throw new ConflictError(
        `Journal entry does not balance: debits minus credits = ${sumMinor(amounts)} minor units`,
      );
    }

    const id = createId("je");
    const accountIds = [...new Set(input.lines.map((line) => line.accountId))];

    await this.db.transaction(async (tx) => {
      const found = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(inArray(accounts.id, accountIds));
      const missing = accountIds.find((accountId) => !found.some((a) => a.id === accountId));
      if (missing) throw new NotFoundError(`Account ${missing} not found`);

      await tx.insert(journalEntries).values({
        id,
        entryDate: input.date,
        memo: input.memo,
        reference: input.reference ?? null,
        status: "POSTED",
      });
      // The deferred balance trigger (0002_integrity.sql) re-checks the sum at commit.
      await tx.insert(journalLines).values(
        input.lines.map((line, position) => ({
          id: createId("jl"),
          entryId: id,
          accountId: line.accountId,
          amountMinor: line.amountMinor,
          position,
          memo: line.memo ?? null,
        })),
      );
    });

    const created = await this.getJournalEntry(id);
    if (!created) throw new Error("Failed to load created journal entry");
    return created;
  }

  async voidJournalEntry(id: string): Promise<JournalEntry | undefined> {
    // Conditional update so concurrent voids cannot both succeed.
    const updated = await this.db
      .update(journalEntries)
      .set({ status: "VOID" })
      .where(and(eq(journalEntries.id, id), eq(journalEntries.status, "POSTED")))
      .returning({ id: journalEntries.id });
    const entry = await this.getJournalEntry(id);
    if (!entry) return undefined;
    if (updated.length === 0) {
      throw new ConflictError(`Journal entry ${id} is ${entry.status}; only POSTED entries can be voided`);
    }
    return entry;
  }

  async listPostings(): Promise<PostingRow[]> {
    const rows = await this.db
      .select({
        entryId: journalEntries.id,
        entryDate: journalEntries.entryDate,
        entryStatus: journalEntries.status,
        lineId: journalLines.id,
        accountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountType: accounts.type,
        amountMinor: journalLines.amountMinor,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
      .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
      .where(and(eq(journalEntries.status, "POSTED")))
      .orderBy(asc(journalEntries.entryDate), asc(journalLines.position));
    return rows;
  }
}
