/**
 * HTTP hardening shared by both APIs. Server-only: imported as
 * `@ledgerlab/shared/http` and never re-exported from the package index, so the
 * dashboard bundle does not pull in Hono.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

type Env = Record<string, string | undefined>;

const isProduction = (env: Env) => env.NODE_ENV === "production";

/**
 * Allowed browser origins from CORS_ORIGINS (comma separated). `*` is for local
 * development only: in production a missing or wildcard value stops startup.
 */
export function corsOriginsFromEnv(env: Env): string[] {
  const origins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (isProduction(env) && (origins.length === 0 || origins.includes("*"))) {
    throw new Error("CORS_ORIGINS must list the dashboard origin(s) in production; '*' is not allowed");
  }
  return origins.length > 0 ? origins : ["*"];
}

/** INTERNAL_API_TOKEN, required (32+ chars) in production so /api/internal is never open. */
export function internalTokenFromEnv(env: Env): string | undefined {
  const token = env.INTERNAL_API_TOKEN?.trim() || undefined;
  if (isProduction(env) && (!token || token.length < 32)) {
    throw new Error("INTERNAL_API_TOKEN of at least 32 characters is required in production");
  }
  return token;
}

/** Constant-time comparison; hashing first makes the lengths equal. */
export function tokensMatch(given: string, expected: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Headers for a JSON API: no framing, no sniffing, no referrer leakage, HSTS,
 * and a CSP that forbids everything (responses are data, never documents).
 */
export function apiSecurityHeaders(): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
    xFrameOptions: "DENY",
    referrerPolicy: "no-referrer",
    crossOriginResourcePolicy: "same-site",
  });
}

/** Reject request bodies over `maxKb` (journal entries are a few KB at most). */
export function limitBody(maxKb = 64): MiddlewareHandler {
  return bodyLimit({
    maxSize: maxKb * 1024,
    onError: (c) =>
      c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: `Request body over ${maxKb} KB` } }, 413),
  });
}

/**
 * The client address as seen by the platform's proxy: the right-most
 * X-Forwarded-For entry is the one the proxy appended, so a client cannot spoof
 * it by sending its own header.
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  return forwarded?.split(",").at(-1)?.trim() || "unknown";
}

/**
 * Fixed-window rate limit per client IP: `max` requests per `windowMs`, then 429
 * with Retry-After until the window resets.
 */
// ponytail: per-instance memory, so the effective limit is max x instances. The
// authoritative limit is the Cloudflare rule on /api/* (deployment/cloudflare);
// move to a shared store (Redis) only if the edge limit is not available.
export function rateLimit({ max, windowMs = 60_000 }: { max: number; windowMs?: number }): MiddlewareHandler {
  let counts = new Map<string, number>();
  let windowEnds = Date.now() + windowMs;
  return async (c, next) => {
    const now = Date.now();
    if (now >= windowEnds) {
      counts = new Map();
      windowEnds = now + windowMs;
    }
    const ip = clientIp(c);
    const count = (counts.get(ip) ?? 0) + 1;
    counts.set(ip, count);
    c.header("RateLimit-Limit", String(max));
    c.header("RateLimit-Remaining", String(Math.max(0, max - count)));
    if (count > max) {
      c.header("Retry-After", String(Math.ceil((windowEnds - now) / 1000)));
      return c.json({ error: { code: "RATE_LIMITED", message: "Too many requests; slow down" } }, 429);
    }
    await next();
  };
}

/**
 * Origin lock for platforms that cannot restrict ingress to Cloudflare (Render
 * has no IP allowlist or mTLS origin pulls). A Cloudflare request-header
 * Transform Rule adds `X-Origin-Secret`; requests without it, i.e. anyone
 * calling the *.onrender.com URL directly and skipping the WAF, get 403.
 * `/health` stays open for the platform's own health checks, and
 * `/api/internal/*` for service-to-service calls on the private network (those
 * never pass through Cloudflare and are token-guarded). No-op when unset.
 */
export function requireOriginSecret(secret: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!secret || c.req.path === "/health" || c.req.path.startsWith("/api/internal/")) return next();
    const given = c.req.header("x-origin-secret");
    if (!given || !tokensMatch(given, secret)) {
      return c.json({ error: { code: "FORBIDDEN", message: "Direct origin access is not allowed" } }, 403);
    }
    return next();
  };
}
