import { serve } from "@hono/node-server";
import { createReportingApp } from "./app";
import { LedgerClient } from "./ledger-client";
import { ReportingService } from "./services/reporting-service";

const port = Number(process.env.REPORTING_API_PORT ?? process.env.PORT ?? 4002);
const hostname = process.env.REPORTING_API_HOST ?? "0.0.0.0";
const ledgerUrl = process.env.LEDGER_API_URL ?? "http://localhost:4001";
const corsOrigins = (process.env.CORS_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const source = new LedgerClient({ baseUrl: ledgerUrl, internalToken: process.env.INTERNAL_API_TOKEN });
const service = new ReportingService(source);
const app = createReportingApp({ service, corsOrigins });

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`[reporting-api] listening on http://${info.address}:${info.port} (ledger: ${ledgerUrl})`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
