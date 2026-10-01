import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, errorResponseSchema } from "@ledgerlab/shared";
import type { LedgerService } from "./services/ledger-service";
import { accountRoutes } from "./routes/accounts";
import { healthRoutes } from "./routes/health";
import { internalRoutes } from "./routes/internal";
import { journalEntryRoutes } from "./routes/journal-entries";
import { reportRoutes } from "./routes/reports";

export interface CreateAppOptions {
  service: LedgerService;
  /** Browser origins allowed to call this API. Use ["*"] for local dev only. */
  corsOrigins?: string[];
  /** Optional shared secret guarding /api/internal/*. */
  internalToken?: string;
}

export function createLedgerApp({ service, corsOrigins = ["*"], internalToken }: CreateAppOptions): Hono {
  const app = new Hono();

  if (process.env.NODE_ENV !== "test") app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: (origin) =>
        corsOrigins.includes("*") ? (origin ?? "*") : corsOrigins.includes(origin) ? origin : null,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.route(
    "/",
    healthRoutes("ledger-api", service.repositoryKind, () => service.ping()),
  );
  app.route("/api/accounts", accountRoutes(service));
  app.route("/api/journal-entries", journalEntryRoutes(service));
  app.route("/api/reports", reportRoutes(service));
  app.route("/api/internal", internalRoutes(service, internalToken));

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: `Route ${c.req.method} ${c.req.path} not found` } }, 404),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body = errorResponseSchema.parse({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return c.json(body, err.status as ContentfulStatusCode);
    }
    console.error("[ledger-api] unhandled error:", err);
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  });

  return app;
}
