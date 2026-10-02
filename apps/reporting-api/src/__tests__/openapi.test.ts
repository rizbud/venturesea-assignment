import { describe, expect, it } from "vitest";
import type { TotalsSource } from "../ledger-client";
import spec from "../../openapi.json";
import { createReportingApp } from "../app";
import { ReportingService } from "../services/reporting-service";

const METHODS = ["get", "post", "patch", "delete"];

describe("openapi.json", () => {
  it("documents exactly the routes the app serves", () => {
    const unused: TotalsSource = { accountTotals: async () => ({ rows: [], entryCount: 0 }) };
    const app = createReportingApp({ service: new ReportingService(unused) });
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
