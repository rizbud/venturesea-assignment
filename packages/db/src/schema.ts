import { bigint, date, integer, pgEnum, pgTable, text, timestamp, varchar, index } from "drizzle-orm/pg-core";

export const accountTypeEnum = pgEnum("account_type", ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);

export const entryStatusEnum = pgEnum("entry_status", ["DRAFT", "POSTED", "VOID"]);

export const accounts = pgTable(
  "accounts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    code: varchar("code", { length: 4 }).notNull().unique(),
    name: varchar("name", { length: 120 }).notNull(),
    type: accountTypeEnum("type").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("accounts_type_idx").on(table.type)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    memo: text("memo").notNull(),
    reference: varchar("reference", { length: 64 }),
    status: entryStatusEnum("status").notNull().default("POSTED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("journal_entries_date_idx").on(table.entryDate)],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    entryId: varchar("entry_id", { length: 64 })
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: varchar("account_id", { length: 64 })
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    /** Signed minor units: > 0 debit, < 0 credit. */
    /** BIGINT read as a JS number; inputs are capped at Number.MAX_SAFE_INTEGER. */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    position: integer("position").notNull().default(0),
    memo: varchar("memo", { length: 200 }),
  },
  (table) => [
    index("journal_lines_entry_idx").on(table.entryId),
    index("journal_lines_account_idx").on(table.accountId),
  ],
);

// Invariants enforced in SQL (migrations/0002_integrity.sql), not modelled here:
// balanced entries, non-zero lines, append-only lines/entries, POSTED -> VOID only.
export const schema = { accounts, journalEntries, journalLines };
