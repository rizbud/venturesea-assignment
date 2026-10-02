import { describe, expect, it } from "vitest";
import { InMemoryLedgerRepository } from "@ledgerlab/db";
import spec from "../../openapi.json";
import { createLedgerApp } from "../app";
import { LedgerService } from "../services/ledger-service";

const METHODS = ["get", "post", "patch", "delete"];

describe("openapi.json", () => {
  it("documents exactly the routes the app serves", () => {
    const app = createLedgerApp({ service: new LedgerService(new InMemoryLedgerRepository()) });
    const served = app.routes
      .filter((r) => r.method !== "ALL")
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    const documented = Object.entries(spec.paths)
      .flatMap(([path, item]) =>
        Object.keys(item)
          .filter((key) => METHODS.includes(key))
          .map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`),
      )
      .sort();
    expect(documented).toEqual(served);
  });

  it("has no dangling $ref", () => {
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1]!);
    const resolve = (path: string) =>
      path
        .split("/")
        .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], spec);
    expect(refs.filter((ref) => resolve(ref) === undefined)).toEqual([]);
  });
});
