import { z } from "zod";
import { Hono } from "hono";
import { isoDateSchema } from "@ledgerlab/shared";
import type { LedgerService } from "../services/ledger-service";
import { parseQuery } from "./validate";

const asOfSchema = z.object({
  asOf: isoDateSchema.default(() => new Date().toISOString().slice(0, 10)),
});

export function reportRoutes(service: LedgerService): Hono {
  const app = new Hono();

  app.get("/trial-balance", async (c) => {
    const { asOf } = parseQuery(c, asOfSchema);
    const report = await service.trialBalance(asOf);
    return c.json({ data: report });
  });

  return app;
}
