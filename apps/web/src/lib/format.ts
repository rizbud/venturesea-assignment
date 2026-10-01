import { formatCurrency, formatMinor, type JournalEntry } from "@ledgerlab/shared";

export function money(minor: number, currency = "USD"): string {
  return formatCurrency(minor, currency);
}

/** Plain signed decimal, e.g. "-1234.56" (useful for CSV / debugging). */
export function minor(minorUnits: number): string {
  return formatMinor(minorUnits);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthStart(): string {
  return `${today().slice(0, 7)}-01`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** An entry's size: the sum of its debit lines (equal to its credits when balanced). */
export function entryAmount(entry: JournalEntry): number {
  return entry.lines.reduce((sum, line) => (line.amountMinor > 0 ? sum + line.amountMinor : sum), 0);
}
