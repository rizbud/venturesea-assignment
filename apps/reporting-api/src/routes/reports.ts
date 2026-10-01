import { z } from "zod";
import { Hono } from "hono";
import { ValidationError, isoDateSchema as isoDate } from "@ledgerlab/shared";
import type { ReportingService } from "../services/reporting-service";

const today = () => new Date().toISOString().slice(0, 10);

const asOfSchema = z.object({ asOf: isoDate.default(today) });
const rangeSchema = z.object({
  from: isoDate.default(() => `${today().slice(0, 7)}-01`),
  to: isoDate.default(today),
});

function parse<S extends z.ZodTypeAny>(schema: S, input: Record<string, string | undefined>): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Query parameters failed validation", result.error.flatten());
  }
  return result.data;
}

export function reportRoutes(service: ReportingService): Hono {
  const app = new Hono();

  app.get("/dashboard", async (c) => {
    const { asOf } = parse(asOfSchema, c.req.query());
    return c.json({ data: await service.dashboard(asOf) });
  });

  app.get("/trial-balance", async (c) => {
    const { asOf } = parse(asOfSchema, c.req.query());
    return c.json({ data: await service.trialBalance(asOf) });
  });

  app.get("/income-statement", async (c) => {
    const { from, to } = parse(rangeSchema, c.req.query());
    return c.json({ data: await service.incomeStatement(from, to) });
  });

  app.get("/balance-sheet", async (c) => {
    const { asOf } = parse(asOfSchema, c.req.query());
    return c.json({ data: await service.balanceSheet(asOf) });
  });

  return app;
}
