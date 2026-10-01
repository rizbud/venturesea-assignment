import { beforeEach, describe, expect, it } from "vitest";
import type { Account, HealthResponse, JournalEntry, Paginated, TrialBalance } from "@ledgerlab/shared";
import { InMemoryLedgerRepository } from "@ledgerlab/db";
import { createLedgerApp } from "../app";
import { LedgerService } from "../services/ledger-service";

function buildApp() {
  const repository = new InMemoryLedgerRepository({ seed: true });
  return createLedgerApp({ service: new LedgerService(repository) });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

type ErrorBody = { error: { code: string; message: string; details?: { totalMinor?: number } } };

async function postJson(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listAccounts(app: ReturnType<typeof buildApp>): Promise<Account[]> {
  const res = await app.request("/api/accounts");
  return (await json<{ data: Account[] }>(res)).data;
}

describe("ledger-api", () => {
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    app = buildApp();
  });

  it("reports health with the repository kind", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await json<HealthResponse>(res);
    expect(body).toMatchObject({ status: "ok", service: "ledger-api", repository: "memory" });
  });

  it("lists the seeded chart of accounts in code order", async () => {
    const res = await app.request("/api/accounts");
    expect(res.status).toBe(200);
    const body = await json<{ data: Account[] }>(res);
    expect(body.data.length).toBeGreaterThanOrEqual(8);
    const codes = body.data.map((a) => a.code);
    expect(codes).toEqual([...codes].sort());
  });

  it("creates an account and rejects duplicate codes", async () => {
    const created = await postJson(app, "/api/accounts", {
      code: "6100",
      name: "Utilities",
      type: "EXPENSE",
    });
    expect(created.status).toBe(201);

    const duplicate = await postJson(app, "/api/accounts", { code: "6100", name: "Dup", type: "EXPENSE" });
    expect(duplicate.status).toBe(409);
    expect((await json<ErrorBody>(duplicate)).error.code).toBe("CONFLICT");
  });

  it("rejects an account with a malformed code", async () => {
    const res = await postJson(app, "/api/accounts", { code: "61", name: "Bad", type: "EXPENSE" });
    expect(res.status).toBe(400);
    expect((await json<ErrorBody>(res)).error.code).toBe("VALIDATION_ERROR");
  });

  it("deactivates an account via PATCH and then refuses lines on it", async () => {
    const accounts = await listAccounts(app);
    const cash = accounts.find((a) => a.code === "1000")!;
    const revenue = accounts.find((a) => a.code === "4000")!;
    const patch = (id: string, body: unknown) =>
      app.request(`/api/accounts/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const res = await patch(revenue.id, { isActive: false });
    expect(res.status).toBe(200);
    expect((await json<{ data: Account }>(res)).data.isActive).toBe(false);

    const entry = await postJson(app, "/api/journal-entries", {
      date: "2026-01-15",
      memo: "Sale on a closed account",
      lines: [
        { accountId: cash.id, amountMinor: 100 },
        { accountId: revenue.id, amountMinor: -100 },
      ],
    });
    expect(entry.status).toBe(400);

    expect((await patch("acct_missing", { isActive: false })).status).toBe(404);
    expect((await patch(revenue.id, { isActive: "no" })).status).toBe(400);
    expect((await patch(revenue.id, { name: "Renamed" })).status).toBe(400);
  });

  it("posts a balanced journal entry", async () => {
    const accounts = await listAccounts(app);
    const cash = accounts.find((a) => a.code === "1000")!;
    const revenue = accounts.find((a) => a.code === "4000")!;

    const res = await postJson(app, "/api/journal-entries", {
      date: "2026-01-15",
      memo: "Consulting revenue",
      lines: [
        { accountId: cash.id, amountMinor: 50_000 },
        { accountId: revenue.id, amountMinor: -50_000 },
      ],
    });
    expect(res.status).toBe(201);
    const body = await json<{ data: JournalEntry }>(res);
    expect(body.data.status).toBe("POSTED");
    expect(body.data.lines).toHaveLength(2);
  });

  it("rejects an unbalanced journal entry with 422", async () => {
    const accounts = await listAccounts(app);
    const cash = accounts.find((a) => a.code === "1000")!;
    const revenue = accounts.find((a) => a.code === "4000")!;

    const res = await postJson(app, "/api/journal-entries", {
      date: "2026-01-15",
      memo: "Bad entry",
      lines: [
        { accountId: cash.id, amountMinor: 50_000 },
        { accountId: revenue.id, amountMinor: -40_000 },
      ],
    });
    expect(res.status).toBe(422);
    const body = await json<ErrorBody>(res);
    expect(body.error.code).toBe("UNBALANCED_ENTRY");
    expect(body.error.details?.totalMinor).toBe(10_000);
  });

  it("rejects a journal entry referencing an unknown account", async () => {
    const res = await postJson(app, "/api/journal-entries", {
      date: "2026-01-15",
      memo: "Ghost account",
      lines: [
        { accountId: "acct_missing", amountMinor: 100 },
        { accountId: "acct_missing_2", amountMinor: -100 },
      ],
    });
    expect(res.status).toBe(404);
  });

  it("returns a balanced trial balance", async () => {
    const res = await app.request("/api/reports/trial-balance?asOf=2026-12-31");
    expect(res.status).toBe(200);
    const { data } = await json<{ data: TrialBalance }>(res);
    expect(data.balanced).toBe(true);
    expect(data.totalDebitMinor).toBe(data.totalCreditMinor);
    expect(data.totalDebitMinor).toBeGreaterThan(0);
  });

  it("voids an entry and excludes it from the trial balance", async () => {
    const listRes = await app.request("/api/journal-entries");
    const entries = await json<Paginated<JournalEntry>>(listRes);
    const target = entries.data[0]!;
    const before = await json<{ data: TrialBalance }>(
      await app.request("/api/reports/trial-balance?asOf=2026-12-31"),
    );

    const res = await app.request(`/api/journal-entries/${target.id}/void`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await json<{ data: JournalEntry }>(res)).data.status).toBe("VOID");

    const after = await json<{ data: TrialBalance }>(
      await app.request("/api/reports/trial-balance?asOf=2026-12-31"),
    );
    expect(after.data.totalDebitMinor).toBeLessThan(before.data.totalDebitMinor);
    expect(after.data.balanced).toBe(true);
  });

  it("returns 404 for unknown routes with a structured error", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect((await json<ErrorBody>(res)).error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid pagination", async () => {
    const res = await app.request("/api/journal-entries?page=0");
    expect(res.status).toBe(400);
  });
});
