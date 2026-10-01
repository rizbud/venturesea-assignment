import { serve } from "@hono/node-server";
import { createReportingApp } from "./app";
import { LedgerClient } from "./ledger-client";
import { ReportingService } from "./services/reporting-service";
import { corsOriginsFromEnv, internalTokenFromEnv } from "@ledgerlab/shared/http";

const port = Number(process.env.REPORTING_API_PORT ?? process.env.PORT ?? 4002);
const hostname = process.env.REPORTING_API_HOST ?? "0.0.0.0";
const ledgerUrl = process.env.LEDGER_API_URL ?? "http://localhost:4001";
const corsOrigins = corsOriginsFromEnv(process.env);
const internalToken = internalTokenFromEnv(process.env);
const rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120);

const source = new LedgerClient({ baseUrl: ledgerUrl, internalToken });
const service = new ReportingService(source);
const app = createReportingApp({
  service,
  corsOrigins,
  rateLimitPerMinute,
  originSecret: process.env.ORIGIN_SECRET?.trim() || undefined,
  clientIpHeader: process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || undefined,
});

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[reporting-api] listening on http://${info.address}:${info.port} (ledger: ${ledgerUrl})`);
});

// Drain in-flight requests; a stalled upstream call must not block the deploy.
function shutdown(signal: string): void {
  console.log(`[reporting-api] ${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
