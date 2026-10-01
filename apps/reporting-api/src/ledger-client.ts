import type { AccountTotals, DateRange } from "@ledgerlab/shared";
import { AppError } from "@ledgerlab/shared";

/**
 * Where the reporting service reads per-account totals from. The production
 * implementation is LedgerClient (HTTP); tests inject a fake.
 */
export interface TotalsSource {
  accountTotals(range: DateRange): Promise<AccountTotals>;
}

export interface LedgerClientOptions {
  baseUrl: string;
  internalToken?: string;
  /** Milliseconds before the upstream request is aborted. */
  timeoutMs?: number;
}

/** HTTP client for the ledger API's internal account-totals endpoint. */
export class LedgerClient implements TotalsSource {
  private readonly baseUrl: string;
  private readonly internalToken?: string;
  private readonly timeoutMs: number;

  constructor(options: LedgerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.internalToken = options.internalToken;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async accountTotals(range: DateRange): Promise<AccountTotals> {
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/internal/account-totals?${params}`, {
        headers: this.internalToken ? { authorization: `Bearer ${this.internalToken}` } : {},
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AppError("UPSTREAM_ERROR", `Ledger API responded with ${response.status}`, 502);
      }
      return ((await response.json()) as { data: AccountTotals }).data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("UPSTREAM_TIMEOUT", "Ledger API request timed out", 504);
      }
      throw new AppError("UPSTREAM_UNAVAILABLE", "Ledger API is unavailable", 503);
    } finally {
      clearTimeout(timer);
    }
  }
}
