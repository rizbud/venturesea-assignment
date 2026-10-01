import { serve } from "@hono/node-server";
import { createLedgerApp } from "./app";
import { LedgerService } from "./services/ledger-service";
import { resolveLedgerRepository } from "./repositories/resolve";
import { corsOriginsFromEnv, internalTokenFromEnv } from "@ledgerlab/shared/http";

const port = Number(process.env.LEDGER_API_PORT ?? process.env.PORT ?? 4001);
const hostname = process.env.LEDGER_API_HOST ?? "0.0.0.0";
// Both throw in production when unset or unsafe, so a misconfigured deploy fails its health check.
const corsOrigins = corsOriginsFromEnv(process.env);
const internalToken = internalTokenFromEnv(process.env);
const rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300);

const closedThrough = process.env.LEDGER_CLOSED_THROUGH?.trim() || undefined;
if (closedThrough && !/^\d{4}-\d{2}-\d{2}$/.test(closedThrough)) {
  throw new Error(`LEDGER_CLOSED_THROUGH must be YYYY-MM-DD, got "${closedThrough}"`);
}

const { repository, close } = resolveLedgerRepository();
const service = new LedgerService(repository, { closedThrough });
const app = createLedgerApp({
  service,
  corsOrigins,
  internalToken,
  rateLimitPerMinute,
});

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[ledger-api] listening on http://${info.address}:${info.port} (repo: ${repository.kind})`);
});

// Stop accepting connections, let in-flight requests finish, then release the
// DB pool. Closing the pool first would fail those requests mid-transaction.
async function shutdown(signal: string): Promise<void> {
  console.log(`[ledger-api] ${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await close();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
