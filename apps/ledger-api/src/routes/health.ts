import type { HealthResponse } from "@ledgerlab/shared";
import { Hono } from "hono";

const startedAt = Date.now();
const VERSION = "0.1.0";
const CHECK_TIMEOUT_MS = 2_000;

/**
 * /health reports "ok" only when storage answers within 2s; otherwise 503
 * "degraded", so load balancers stop routing here and uptime monitors see the
 * outage instead of a process that is up but cannot reach its data.
 */
export function healthRoutes(serviceName: string, repositoryKind: string, ping: () => Promise<void>): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    let healthy = true;
    try {
      await Promise.race([
        ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS)),
      ]);
    } catch {
      healthy = false;
    }
    const body: HealthResponse = {
      status: healthy ? "ok" : "degraded",
      service: serviceName,
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      repository: repositoryKind,
    };
    return c.json(body, healthy ? 200 : 503);
  });

  return app;
}
