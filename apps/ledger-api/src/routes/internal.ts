import { Hono } from "hono";
import { z } from "zod";
import { isoDateSchema } from "@ledgerlab/shared";
import type { LedgerService } from "../services/ledger-service";
import { parseQuery } from "./validate";

const rangeSchema = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() });

/**
 * Service-to-service endpoints. Not intended for the browser.
 * If INTERNAL_API_TOKEN is set, callers must send `Authorization: Bearer <token>`.
 */
export function internalRoutes(service: LedgerService, internalToken?: string): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    if (!internalToken) return next();
    const header = c.req.header("authorization");
    if (header !== `Bearer ${internalToken}`) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "Invalid internal token" } }, 401);
    }
    return next();
  });

  // Per-account totals, not raw lines: a report costs one GROUP BY and a few
  // dozen rows over the wire regardless of ledger size.
  app.get("/account-totals", async (c) => {
    const totals = await service.accountTotals(parseQuery(c, rangeSchema));
    return c.json({ data: totals });
  });

  return app;
}
