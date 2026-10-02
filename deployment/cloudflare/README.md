# Cloudflare layer (G6, scored bonus): custom domain, TLS, WAF, rate limit

> **Status (2026-10-01): not attempted.** It needs a domain on a real TLD and a
> Cloudflare account, neither of which was available. Everything the origin
> needs is already built and tested (origin lock, headers, rate limit, internal
> token); the steps below are the exact configuration to apply. About 30 minutes
> once the Render deploy (G4) exists.

The bank asked for HTTPS on a domain it recognises, a WAF, rate limiting and
`/api/internal` unreachable from the internet. This layer delivers all four.

## 0. Hostnames

| Host                            | Origin (Render)                         |
| ------------------------------- | --------------------------------------- |
| `ledgerlab.example.com`         | `ledgerlab-web` (static site)           |
| `ledgerlab-api.example.com`     | `ledgerlab-ledger-api` (2 instances)    |
| `ledgerlab-reports.example.com` | `ledgerlab-reporting-api` (2 instances) |

Replace `ledgerlab.example.com` with the real domain everywhere below.

## 1. DNS and TLS

1. Add the domain to Cloudflare; set the registrar's nameservers to the two
   Cloudflare gives you.
2. In Render, add each hostname as a **Custom Domain** on its service. Render
   issues the origin certificate.
3. In Cloudflare DNS, create `CNAME` records to each service's
   `*.onrender.com` hostname, **Proxied** (orange cloud).
4. SSL/TLS → **Full (strict)** (Render's certificate is valid, so strict works).
   Edge Certificates → **Always Use HTTPS** on, **Minimum TLS 1.2**, **HSTS** on
   (max-age 12 months, includeSubDomains, preload), **Automatic HTTPS Rewrites** on.

## 2. Lock the origin to Cloudflare

Render cannot restrict ingress by IP or require mTLS origin pulls, so without
this step anyone could call `*.onrender.com` directly and skip every rule below.

1. Generate a secret: `openssl rand -hex 32`.
2. Render → both API services → set `ORIGIN_SECRET` to it. The APIs then answer
   `403` to any request without a matching `X-Origin-Secret` header, except
   `/health` (Render's health checks) and the token-guarded
   `/api/internal/*` (private-network calls never pass Cloudflare).
   Implementation: `requireOriginSecret` in `packages/shared/src/http.ts`.
3. Cloudflare → Rules → **Transform Rules → Modify Request Header**:
   - When: `(http.host in {"ledgerlab-api.example.com" "ledgerlab-reports.example.com"})`
   - Set static header `X-Origin-Secret` = the secret.

## 3. WAF

Security → WAF:

- **Managed rules:** enable the Cloudflare Managed Ruleset (and the OWASP Core
  Ruleset where the plan includes it) on all hosts.
- **Custom rule "block internal API"**, action **Block**:

  ```
  (http.host eq "ledgerlab-api.example.com" and starts_with(http.request.uri.path, "/api/internal/"))
  ```

  Any method, not just `POST`. The reporting service reaches this path on
  Render's private network, so nothing legitimate is blocked.

- **Custom rule "API methods"**, action **Block**: the dashboard only uses
  `GET`, `POST`, `PATCH`, `OPTIONS`.

  ```
  (http.host in {"ledgerlab-api.example.com" "ledgerlab-reports.example.com"} and not http.request.method in {"GET" "POST" "PATCH" "OPTIONS"})
  ```

## 4. Rate limiting

Security → WAF → **Rate limiting rules**, one rule:

- When: `(http.host in {"ledgerlab-api.example.com" "ledgerlab-reports.example.com"} and starts_with(http.request.uri.path, "/api/"))`
- Characteristic: IP. **50 requests per 10 seconds** (= 300/min, the same
  budget as the app's per-instance limit), action **Block** for 60 s (use the
  shortest period/duration your plan offers if these are not available).

This is the authoritative limit: the app's own limiter counts per instance
(2 instances → up to 600/min), Cloudflare counts per IP across everything.
Tune after a week of real traffic; the dashboard's busiest page makes 3 calls.

## 5. Cache

Rules → **Cache Rules**:

| When                                                                                      | Action                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `http.host eq "ledgerlab.example.com" and starts_with(http.request.uri.path, "/assets/")` | Eligible for cache, Edge TTL 1 year (hashed filenames) |
| `http.host in {"ledgerlab-api.example.com" "ledgerlab-reports.example.com"}`              | **Bypass cache** (financial data, never cached)        |

The SPA document (`/`, `/index.html`) keeps Render's default short caching so a
deploy is visible immediately. Brotli on; Browser Cache TTL "Respect Existing Headers".

## 6. Point the app at the new hostnames

- Both APIs: `CORS_ORIGINS=https://ledgerlab.example.com`.
- Dashboard: `VITE_LEDGER_API_URL=https://ledgerlab-api.example.com`,
  `VITE_REPORTING_API_URL=https://ledgerlab-reports.example.com`, and in
  `render.yaml` set the CSP `connect-src` to those two origins. Redeploy the
  dashboard (the `VITE_*` values are baked in at build time).

## 7. Verification evidence (commit the output to `docs/evidence/G6-cloudflare.md`)

```bash
dig +short ledgerlab.example.com ledgerlab-api.example.com
# expect Cloudflare anycast addresses (104.x / 172.6x.x), not Render's

curl -sI https://ledgerlab-api.example.com/health
# expect HTTP/2 200, a cf-ray header, strict-transport-security

curl -s -o /dev/null -w '%{http_code}\n' https://ledgerlab-api.example.com/api/internal/account-totals
# expect 403 from the edge (WAF), never 200

curl -s -o /dev/null -w '%{http_code}\n' https://ledgerlab-ledger-api.onrender.com/api/accounts
# expect 403 from the origin lock (no X-Origin-Secret)

for i in $(seq 1 80); do curl -s -o /dev/null -w '%{http_code}\n' https://ledgerlab-api.example.com/api/accounts; done | sort | uniq -c
# expect a run of 200s, then 429s from the edge rule

curl -sI http://ledgerlab.example.com | head -1
# expect 301 to https
```

Screenshots: **Security → Events** showing the blocked `/api/internal` request
and the rate-limited burst; **SSL/TLS → Overview** showing Full (strict).
