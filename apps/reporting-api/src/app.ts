import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "@ledgerlab/shared";
import { apiSecurityHeaders, rateLimit, requireOriginSecret } from "@ledgerlab/shared/http";
import type { ReportingService } from "./services/reporting-service";
import { healthRoutes } from "./routes/health";
import { reportRoutes } from "./routes/reports";

export interface CreateAppOptions {
  service: ReportingService;
  corsOrigins?: string[];
  /** Requests per minute per client IP on /api/*. Reports are heavier than ledger reads. */
  rateLimitPerMinute?: number;
  /** When set, every request except /health must carry it in X-Origin-Secret (added by Cloudflare). */
  originSecret?: string;
  /** Header holding the real client IP when only Cloudflare can reach us (CLIENT_IP_HEADER). */
  clientIpHeader?: string;
}

export function createReportingApp({
  service,
  corsOrigins = ["*"],
  rateLimitPerMinute = 120,
  originSecret,
  clientIpHeader,
}: CreateAppOptions): Hono {
  const app = new Hono();

  if (process.env.NODE_ENV !== "test") app.use("*", logger());
  app.use("*", apiSecurityHeaders());
  app.use("*", requireOriginSecret(originSecret));
  app.use(
    "*",
    cors({
      origin: (origin) =>
        corsOrigins.includes("*") ? (origin ?? "*") : corsOrigins.includes(origin) ? origin : null,
      allowMethods: ["GET", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.use("/api/*", rateLimit({ max: rateLimitPerMinute, clientIpHeader }));

  app.route("/", healthRoutes("reporting-api"));
  app.route("/api/reports", reportRoutes(service));

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: `Route ${c.req.method} ${c.req.path} not found` } }, 404),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        err.status as ContentfulStatusCode,
      );
    }
    console.error("[reporting-api] unhandled error:", err);
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  });

  return app;
}
