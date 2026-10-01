import { serve } from "@hono/node-server";
import { createLedgerApp } from "./app";
import { LedgerService } from "./services/ledger-service";
import { resolveLedgerRepository } from "./repositories/resolve";

const port = Number(process.env.LEDGER_API_PORT ?? 4001);
const hostname = process.env.LEDGER_API_HOST ?? "0.0.0.0";
const corsOrigins = (process.env.CORS_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const closedThrough = process.env.LEDGER_CLOSED_THROUGH?.trim() || undefined;
if (closedThrough && !/^\d{4}-\d{2}-\d{2}$/.test(closedThrough)) {
  throw new Error(`LEDGER_CLOSED_THROUGH must be YYYY-MM-DD, got "${closedThrough}"`);
}

const { repository, close } = resolveLedgerRepository();
const service = new LedgerService(repository, { closedThrough });
const app = createLedgerApp({
  service,
  corsOrigins,
  internalToken: process.env.INTERNAL_API_TOKEN,
});

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[ledger-api] listening on http://${info.address}:${info.port} (repo: ${repository.kind})`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[ledger-api] ${signal} received, shutting down`);
  await close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
