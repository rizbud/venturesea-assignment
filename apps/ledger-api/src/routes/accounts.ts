import { createAccountSchema, updateAccountSchema } from "@ledgerlab/shared";
import { Hono } from "hono";
import type { LedgerService } from "../services/ledger-service";
import { parseBody } from "./validate";

export function accountRoutes(service: LedgerService): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const accounts = await service.listAccounts();
    return c.json({ data: accounts });
  });

  app.get("/:id", async (c) => {
    const account = await service.getAccountOrThrow(c.req.param("id"));
    return c.json({ data: account });
  });

  app.post("/", async (c) => {
    const input = await parseBody(c, createAccountSchema);
    const account = await service.createAccount(input);
    return c.json({ data: account }, 201);
  });

  app.patch("/:id", async (c) => {
    const { isActive } = await parseBody(c, updateAccountSchema);
    const account = await service.setAccountActive(c.req.param("id"), isActive);
    return c.json({ data: account });
  });

  return app;
}
