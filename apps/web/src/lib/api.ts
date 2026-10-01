import type {
  Account,
  BalanceSheet,
  CreateAccountInput,
  CreateJournalEntryInput,
  DashboardSummary,
  HealthResponse,
  IncomeStatement,
  JournalEntry,
  Paginated,
  TrialBalance,
} from "@ledgerlab/shared";

const LEDGER_URL = (import.meta.env.VITE_LEDGER_API_URL ?? "http://localhost:4001").replace(/\/$/, "");
const REPORTING_URL = (import.meta.env.VITE_REPORTING_API_URL ?? "http://localhost:4002").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", `Cannot reach ${baseUrl}. Is the service running?`);
  }

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const parsed = body as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
    throw new ApiError(
      response.status,
      parsed?.error?.code ?? "HTTP_ERROR",
      parsed?.error?.message ?? `Request failed with ${response.status}`,
      parsed?.error?.details,
    );
  }
  return body as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : "";
}

export const api = {
  ledger: {
    health: () => request<HealthResponse>(LEDGER_URL, "/health"),
    listAccounts: async () => (await request<{ data: Account[] }>(LEDGER_URL, "/api/accounts")).data,
    createAccount: async (input: CreateAccountInput) =>
      (
        await request<{ data: Account }>(LEDGER_URL, "/api/accounts", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).data,
    setAccountActive: async (id: string, isActive: boolean) =>
      (
        await request<{ data: Account }>(LEDGER_URL, `/api/accounts/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ isActive }),
        })
      ).data,
    listJournalEntries: (
      params: { page?: number; pageSize?: number; status?: string; from?: string; to?: string } = {},
    ) => request<Paginated<JournalEntry>>(LEDGER_URL, `/api/journal-entries${query(params)}`),
    createJournalEntry: async (input: CreateJournalEntryInput) =>
      (
        await request<{ data: JournalEntry }>(LEDGER_URL, "/api/journal-entries", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).data,
    voidJournalEntry: async (id: string) =>
      (
        await request<{ data: JournalEntry }>(LEDGER_URL, `/api/journal-entries/${id}/void`, {
          method: "POST",
        })
      ).data,
    trialBalance: async (asOf: string) =>
      (await request<{ data: TrialBalance }>(LEDGER_URL, `/api/reports/trial-balance${query({ asOf })}`))
        .data,
  },
  reporting: {
    health: () => request<HealthResponse>(REPORTING_URL, "/health"),
    dashboard: async (asOf: string) =>
      (await request<{ data: DashboardSummary }>(REPORTING_URL, `/api/reports/dashboard${query({ asOf })}`))
        .data,
    incomeStatement: async (from: string, to: string) =>
      (
        await request<{ data: IncomeStatement }>(
          REPORTING_URL,
          `/api/reports/income-statement${query({ from, to })}`,
        )
      ).data,
    balanceSheet: async (asOf: string) =>
      (await request<{ data: BalanceSheet }>(REPORTING_URL, `/api/reports/balance-sheet${query({ asOf })}`))
        .data,
  },
};
