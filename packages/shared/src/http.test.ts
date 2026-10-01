import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  corsOriginsFromEnv,
  internalTokenFromEnv,
  rateLimit,
  requireOriginSecret,
  tokensMatch,
} from "./http";

describe("production configuration guards", () => {
  it("refuses wildcard or missing CORS origins in production, allows them in dev", () => {
    expect(() => corsOriginsFromEnv({ NODE_ENV: "production", CORS_ORIGINS: "*" })).toThrow(/CORS_ORIGINS/);
    expect(() => corsOriginsFromEnv({ NODE_ENV: "production" })).toThrow(/CORS_ORIGINS/);
    expect(
      corsOriginsFromEnv({ NODE_ENV: "production", CORS_ORIGINS: "https://a.example, https://b.example" }),
    ).toEqual(["https://a.example", "https://b.example"]);
    expect(corsOriginsFromEnv({})).toEqual(["*"]);
  });

  it("requires a 32+ character internal token in production", () => {
    expect(() => internalTokenFromEnv({ NODE_ENV: "production" })).toThrow(/INTERNAL_API_TOKEN/);
    expect(() => internalTokenFromEnv({ NODE_ENV: "production", INTERNAL_API_TOKEN: "short" })).toThrow();
    expect(internalTokenFromEnv({ NODE_ENV: "production", INTERNAL_API_TOKEN: "x".repeat(32) })).toHaveLength(
      32,
    );
    expect(internalTokenFromEnv({})).toBeUndefined();
  });

  it("compares tokens of any length without throwing", () => {
    expect(tokensMatch("Bearer abc", "Bearer abc")).toBe(true);
    expect(tokensMatch("Bearer ab", "Bearer abc")).toBe(false);
    expect(tokensMatch("", "Bearer abc")).toBe(false);
  });
});

describe("rateLimit", () => {
  function app(max: number) {
    const a = new Hono();
    a.use("*", rateLimit({ max, windowMs: 60_000 }));
    a.get("/", (c) => c.text("ok"));
    return a;
  }
  const from = (ip: string) => ({ headers: { "x-forwarded-for": ip } });

  it("allows max requests per IP, then answers 429 with Retry-After", async () => {
    const a = app(2);
    expect((await a.request("/", from("1.1.1.1"))).status).toBe(200);
    expect((await a.request("/", from("1.1.1.1"))).status).toBe(200);
    const blocked = await a.request("/", from("1.1.1.1"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await a.request("/", from("2.2.2.2"))).status).toBe(200);
  });

  it("keys on the proxy-appended (right-most) address, so a spoofed header does not reset the count", async () => {
    const a = app(1);
    expect((await a.request("/", from("9.9.9.9"))).status).toBe(200);
    expect((await a.request("/", from("6.6.6.6, 9.9.9.9"))).status).toBe(429);
  });

  it("behind Cloudflare, keys on CF-Connecting-IP so users sharing an edge address get separate budgets", async () => {
    const a = new Hono();
    a.use("*", rateLimit({ max: 1, clientIpHeader: "cf-connecting-ip" }));
    a.get("/", (c) => c.text("ok"));
    // Same Cloudflare edge address appended by the load balancer, different users.
    const user = (ip: string) => ({ headers: { "x-forwarded-for": "172.68.1.1", "cf-connecting-ip": ip } });
    expect((await a.request("/", user("3.3.3.3"))).status).toBe(200);
    expect((await a.request("/", user("4.4.4.4"))).status).toBe(200);
    expect((await a.request("/", user("3.3.3.3"))).status).toBe(429);
  });
});

describe("requireOriginSecret", () => {
  function app(secret: string | undefined) {
    const a = new Hono();
    a.use("*", requireOriginSecret(secret));
    a.get("/health", (c) => c.text("ok"));
    a.get("/api/x", (c) => c.text("ok"));
    return a;
  }

  it("blocks direct origin calls without the edge-added header, keeps /health open", async () => {
    const a = app("edge-secret-value");
    expect((await a.request("/api/x")).status).toBe(403);
    expect((await a.request("/api/x", { headers: { "x-origin-secret": "wrong" } })).status).toBe(403);
    expect((await a.request("/api/x", { headers: { "x-origin-secret": "edge-secret-value" } })).status).toBe(
      200,
    );
    expect((await a.request("/health")).status).toBe(200);
  });

  it("is a no-op when no secret is configured", async () => {
    expect((await app(undefined).request("/api/x")).status).toBe(200);
  });
});

describe("requireOriginSecret exemptions", () => {
  it("lets token-guarded internal calls through without the edge header", async () => {
    const a = new Hono();
    a.use("*", requireOriginSecret("edge-secret-value"));
    a.get("/api/internal/account-totals", (c) => c.text("ok"));
    expect((await a.request("/api/internal/account-totals")).status).toBe(200);
  });
});
