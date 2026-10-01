import { ENTRY_STATUSES, createJournalEntrySchema, paginationSchema } from "@ledgerlab/shared";
import { z } from "zod";
import { Hono } from "hono";
import type { LedgerService } from "../services/ledger-service";
import { parseBody, parseQuery } from "./validate";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const listQuerySchema = paginationSchema.extend({
  status: z.enum(ENTRY_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export function journalEntryRoutes(service: LedgerService): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const result = await service.listJournalEntries(parseQuery(c, listQuerySchema));
    return c.json(result);
  });

  app.get("/:id", async (c) => {
    const entry = await service.getJournalEntryOrThrow(c.req.param("id"));
    return c.json({ data: entry });
  });

  app.post("/", async (c) => {
    const input = await parseBody(c, createJournalEntrySchema);
    const entry = await service.createJournalEntry(input);
    return c.json({ data: entry }, 201);
  });

  app.post("/:id/void", async (c) => {
    const entry = await service.voidJournalEntry(c.req.param("id"));
    return c.json({ data: entry });
  });

  return app;
}
