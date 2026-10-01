# LedgerLab — Technical Test Scaffold

A **double-entry accounting** scaffold: a React dashboard, a **ledger API**, a
**reporting API**, and shared domain packages in a pnpm/Turborepo monorepo.

Your job is **not** to build a finished product. It is to take this scaffold,
**fix its intentional defects, remove the UI slop, harden it for production, and
deploy it** — while logging every AI prompt you use and building your own
sub-agents to do the work.

> Read this file end to end before writing code. Then read
> [`docs/TASKS.md`](docs/TASKS.md) for the ordered backlog.

## The scenario

You have been hired by **Warung Books**, a seed-stage bookkeeping app for
Indonesian micro-businesses. Its non-technical founder built it with an AI app
builder in a weekend; it now has 1,400 paying customers, an **accountant about to
review the numbers**, a **bank partnership with a security review**, and a seed
round in due diligence. This repository is their codebase. Every technical goal
below exists because of something in that story.

Read the full brief first: **[`docs/CLIENT-STORY.md`](docs/CLIENT-STORY.md)**.

---

## 1. What already works

| Area                                                             | Status                       |
| ---------------------------------------------------------------- | ---------------------------- |
| Monorepo (pnpm workspaces + Turborepo)                           | ✅ builds, typechecks, tests |
| Double-entry domain (integer minor units, signed amounts)        | ✅ with unit tests           |
| Ledger API: accounts, journal entries, trial balance, void       | ✅ tested                    |
| Reporting API: dashboard, income statement, balance sheet        | ✅ tested                    |
| Postgres adapter (Drizzle) + in-memory adapter                   | ✅ same port                 |
| Dashboard: dashboard, ledger, new entry, accounts, reports       | ⚠️ functional, needs review  |
| Dockerfiles + Render blueprint + AWS/GCP/Azure/Cloudflare notes  | ✅ present                   |
| **Challenge suite (2 failing specs that define required fixes)** | ❌ **red on purpose**        |

Run the default suite and everything is green. Run the challenge suite and you
will see exactly what is broken:

```bash
pnpm install
pnpm test                                  # green
pnpm --filter @ledgerlab/ledger-api test:challenges   # red — this is the work
```

---

## 2. Goals

Each goal has acceptance criteria. "Done" means the criteria are met **and
evidenced** (a command, a file, or a screenshot in your submission).

### G0 — Fix the errors (highest priority)

- [ ] Make `pnpm --filter @ledgerlab/ledger-api test:challenges` green by fixing
      the **source**, not the tests. The two defects are documented in
      [`apps/ledger-api/src/challenges/`](apps/ledger-api/src/challenges/).
- [ ] `pnpm typecheck && pnpm test && pnpm build` all pass on a clean checkout.
- [ ] No `TODO(candidate)` left unresolved in code paths you claim are finished.

### G1 — Finish the core ledger

- [ ] Every mutation path preserves the invariant: **sum of signed minor units
      === 0** for each entry.
- [ ] Voiding is a guarded `POSTED → VOID` transition (no re-voiding).
- [ ] Trial balance, income statement, and balance sheet are correct for any
      `asOf` / date range.
- [ ] Tests cover each rule; each new test would fail if the rule broke.

### G2 — Un-slop the UI

- [ ] Dashboard reads as a product, not a template: clear hierarchy, one accent
      colour, no decorative icon boxes, no emojis, no gradients/glassmorphism.
- [ ] Money is right-aligned and uses tabular figures; empty and error states
      are designed, not default.
- [ ] Follow [`docs/DESIGN.md`](docs/DESIGN.md) (the enforced design rules).

### G3 — Real database (required)

- [ ] The ledger runs against a **real database**, not the in-memory adapter.
      PostgreSQL is wired up; **MySQL, MariaDB, SQLite/libSQL, or SQL Server are
      acceptable** if you implement the `LedgerRepository` port.
- [ ] Schema is migrated (not auto-synced) and seeded via a repeatable script.
- [ ] See [`docs/DATABASE.md`](docs/DATABASE.md).

### G4 — Production-scale deployment

- [ ] Deployed to **at least one** of Render / AWS / GCP / Azure, reachable over
      HTTPS, with `/health` monitored.
- [ ] Stateless services, ≥2 replicas (or `min-instances ≥ 1`), managed database,
      connection pooling, graceful shutdown.
- [ ] A **one-command** reproducible deploy is documented and was actually run.
- [ ] See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### G5 — Security-aware hardening

- [ ] No secrets in git; all from the platform secret store.
- [ ] `INTERNAL_API_TOKEN` set and `/api/internal/*` unreachable from the public
      internet.
- [ ] `CORS_ORIGINS` restricted to the real dashboard origin (never `*` in prod).
- [ ] HTTPS/HSTS, secure headers, least-privilege DB user, no stack traces in
      API error bodies, rate limiting in front of `/api/*`.
- [ ] See [`docs/SECURITY.md`](docs/SECURITY.md).

### G6 — Cloudflare + custom TLD domain (scored bonus)

- [ ] A **real TLD** you control (not `*.onrender.com` / `*.run.app`).
- [ ] Cloudflare proxying, TLS **Full (strict)**, WAF managed rules, and a
      rate-limit rule on `/api/*`.
- [ ] `/api/internal/*` blocked at the edge; cache rules separate static assets
      from API traffic.
- [ ] Evidence: `dig`, `curl -I`, and a WAF event screenshot.
- [ ] See [`deployment/cloudflare/README.md`](deployment/cloudflare/README.md).

### G7 — AI usage with a prompt log (required)

- [ ] Every AI prompt that influenced the code is recorded via `pnpm ai:log`.
- [ ] `pnpm ai:verify` passes in CI.
- [ ] Each entry has: tool, model, task, prompt, summary, decision, files.
- [ ] **Show your rejected AI suggestions too** — judgment is what is scored.
- [ ] See [`docs/AI-USAGE.md`](docs/AI-USAGE.md).

### G8 — Build your own sub-agents (required)

- [ ] At least **three** working sub-agents under [`.opencode/agent/`](.opencode/agent/).
- [ ] Starter agents are provided (`ledger-architect`, `ui-unslop`,
      `test-runner`, `deploy-security`) — you must **extend or replace** them
      with agents that fit your workflow, and demonstrate them working.
- [ ] See [`docs/SUBAGENTS.md`](docs/SUBAGENTS.md).

### G9 — Infrastructure plan (required)

- [ ] Produce `docs/INFRASTRUCTURE-PLAN.md` from the template: target topology,
      environments, compute and scaling, data durability with **RPO/RTO and an
      actually-performed restore drill**, networking/edge, secrets and identity,
      CI/CD and rollback, observability with SLOs, a cost model with arithmetic,
      failure modes, and at least three ADRs with rejected options.
- [ ] Every section is specific and matches what is really deployed.
- [ ] See [`docs/INFRASTRUCTURE-PLAN.md`](docs/INFRASTRUCTURE-PLAN.md).

### G10 — Next-phase development plan (required)

- [ ] Produce `docs/NEXT-PHASE-PLAN.md`: measurable outcomes tied to
      stakeholders, a stated prioritisation method, three milestones with
      testable exit criteria and dates, delivery capacity and the next hires,
      technical workstreams, risks, metrics with sources, and what you are
      explicitly deferring.
- [ ] See [`docs/NEXT-PHASE-PLAN.md`](docs/NEXT-PHASE-PLAN.md).

---

## 3. Scoring rubric

| #   | Criterion                         | Weight | What earns full marks                                                             |
| --- | --------------------------------- | ------ | --------------------------------------------------------------------------------- |
| 1   | **Correctness** — G0/G1           | 20     | Challenge suite green by fixing source; invariant proven by tests; no regressions |
| 2   | **Engineering quality** — G1/G3   | 12     | Clean ports/adapters, migrations, typed boundaries, readable tests                |
| 3   | **UI quality** — G2               | 12     | Design rules met; dashboard is clear and trustworthy                              |
| 4   | **Production-scale deploy** — G4  | 12     | Reproducible deploy, health checks, scaling, managed DB, pooling                  |
| 5   | **Security** — G5                 | 12     | Secrets, CORS, internal-token boundary, headers, least privilege                  |
| 6   | **Infrastructure plan** — G9      | 12     | Specific, deployable-from-the-doc, tested restore, costed, ADR-backed             |
| 7   | **Next-phase plan** — G10         | 10     | Outcomes, prioritisation method, milestones with exit criteria, capacity honesty  |
| 8   | **AI prompt log** — G7            | 5      | Complete, honest, includes decisions and rejected suggestions                     |
| 9   | **Sub-agents** — G8               | 5      | ≥3 agents, clearly scoped, demonstrably used                                      |
| 10  | **Cloudflare + TLD** — G6 (bonus) | +5     | Real domain, proxied, Full (strict), WAF + rate limit, evidence                   |
| 11  | **Extra credit**                  | +5     | Multi-currency reporting, audit trail, CSV/PDF export, OpenAPI, load test         |

Automatic fail: tests edited to pass without fixing source; secrets committed;
`CORS_ORIGINS=*` in production; fake AI log entries; a plan document submitted
with `TODO`s still in it.

---

## 4. Architecture

```
                    ┌──────────────────────────┐
   Browser ───────▶ │  apps/web  (React SPA)   │
                    │  dashboard · ledger · UI │
                    └───────┬──────────┬───────┘
                            │          │
              VITE_LEDGER_API_URL   VITE_REPORTING_API_URL
                            ▼          ▼
        ┌───────────────────────────┐  ┌──────────────────────────────┐
        │ apps/ledger-api (Hono)    │  │ apps/reporting-api (Hono)    │
        │ accounts · journal entries│◀─│ dashboard · P&L · balance    │
        │ trial balance · postings  │  │ sheet (reads account totals  │
        │                           │  │ /api/internal/account-totals)│
        └─────────────┬─────────────┘  └──────────────────────────────┘
                      │ LedgerRepository (port)
          ┌───────────┴───────────┐
          ▼                       ▼
  InMemoryLedgerRepository   PostgresLedgerRepository
  (zero-config default)      (Drizzle + PostgreSQL)

  packages/shared → domain types, money math, reporting engine, errors
  packages/db     → Drizzle schema + both repository adapters
  packages/ui     → design system (unslop primitives)
```

**Key invariant.** `amountMinor` is a **signed integer**: `> 0` is a debit,
`< 0` is a credit. For every entry, `Σ amountMinor === 0`. Never introduce
floating point for money.

---

## 5. Repository map

```
apps/
  web/                       React + Vite dashboard (Tailwind v4)
  ledger-api/                Accounts, journal entries, trial balance
    src/app.ts               Hono app factory (testable, no listen)
    src/services/            Business rules (LedgerService)
    src/repositories/        Storage adapter selection
    src/challenges/          🔴 Red specs that define your work
  reporting-api/             Reports built from postings (service-to-service)
packages/
  shared/                    Domain types, money, reporting engine, seed, errors
  db/                        Drizzle schema, Postgres + in-memory adapters, seed
  ui/                        Design system (Button, Card, Stat, Table, …)
deployment/
  Dockerfile.*, nginx.conf, render.yaml
  aws/ gcp/ azure/ cloudflare/
docs/                        Scenario, tasks, design, database, deployment, security, AI,
                             sub-agents, infrastructure plan, next-phase plan, submission
scripts/                     log-ai-prompt.mjs, verify-ai-log.mjs
.opencode/agent/             Your sub-agents live here
```

---

## 6. Quick start

Requirements: **Node ≥ 20.11**, **pnpm 10** (`corepack enable`). Docker optional.

```bash
pnpm install

# Terminal 1 — ledger API          (in-memory, seeded, no DB needed)
pnpm --filter @ledgerlab/ledger-api dev

# Terminal 2 — reporting API
pnpm --filter @ledgerlab/reporting-api dev

# Terminal 3 — dashboard  → http://localhost:5173
pnpm --filter @ledgerlab/web dev
```

Or run everything: `pnpm dev` (Turborepo, parallel).

Useful commands:

```bash
pnpm typecheck                       # all packages
pnpm test                            # green baseline
pnpm build                           # bundles APIs + builds the SPA
pnpm ai:log -- --help                # log an AI interaction
pnpm ai:verify                       # CI gate for the prompt log
pnpm --filter @ledgerlab/ledger-api test:challenges   # red — your work
```

Copy `.env.example` to `.env` if you want to override ports or point at a
database.

---

## 7. Databases

The scaffold ships two adapters behind one port. The **default is in-memory**
so reviewers can run it instantly; **G3 requires you to use a real database**.

| Option              | Notes                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| **PostgreSQL**      | Wired via Drizzle: `packages/db/src/postgres-repository.ts`. Recommended. |
| **MySQL / MariaDB** | Implement `LedgerRepository` and add a Drizzle MySQL schema.              |
| **SQLite / libSQL** | Great for local + edge; same port.                                        |
| **SQL Server**      | Acceptable; add the Drizzle/mssql adapter.                                |

```bash
cp .env.example .env
# DATABASE_URL=postgres://ledgerlab:ledgerlab@localhost:5432/ledgerlab
pnpm --filter @ledgerlab/db migrate:sql
pnpm --filter @ledgerlab/db seed
```

Details, schema, and the port contract: [`docs/DATABASE.md`](docs/DATABASE.md).

---

## 8. Deployment

Pick one target and make it reproducible. Notes for all of:

- **Render** — `deployment/render.yaml` Blueprint (DB + 2 services + static site).
- **AWS** — `deployment/aws/` (ECS Fargate, RDS, S3+CloudFront).
- **GCP** — `deployment/gcp/` (Cloud Run, Cloud SQL).
- **Azure** — `deployment/azure/` (Container Apps, Flexible Server).
- **Cloudflare + TLD** — `deployment/cloudflare/` (scored bonus).

Full walkthrough and the definition of "production-scale": [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## 9. AI usage rules

AI is allowed and expected. The rule is simple: **if an AI helped, it is logged.**

```bash
pnpm ai:log -- \
  --tool "opencode" --model "deepseek/deepseek-v4.1-flash" \
  --subagent "ledger-architect" \
  --task "Fix trial balance asOf filtering" \
  --prompt "buildTrialBalance ignores asOf; make it filter postings by date" \
  --summary "Added date filter in reporting aggregate; kept balanced flag" \
  --decision "accepted" \
  --files "packages/shared/src/reporting.ts"
```

This appends to `docs/ai/prompt-log.jsonl` and regenerates
[`docs/AI-PROMPT-LOG.md`](docs/AI-PROMPT-LOG.md). `pnpm ai:verify` (run in CI)
fails on missing or incomplete records. Full policy:
[`docs/AI-USAGE.md`](docs/AI-USAGE.md).

---

## 10. Sub-agents

You must build sub-agents and use them for the work. Starter agents exist under
`.opencode/agent/`; extend or replace them. Suggested additions:

| Agent                              | Job                                                  |
| ---------------------------------- | ---------------------------------------------------- |
| `ledger-architect` _(provided)_    | Owns the double-entry invariant and posting rules    |
| `ui-unslop` _(provided)_           | Enforces the design rules on every screen            |
| `test-runner` _(provided)_         | Runs typecheck/test/build and reports minimal fixes  |
| `deploy-security` _(provided)_     | Production-scale + security review of the deploy     |
| `db-migrator` _(suggested)_        | Schema, migrations, seeding, and the repository port |
| `reporting-verifier` _(suggested)_ | Proves reports tie out to the ledger                 |

Spec and definition of done: [`docs/SUBAGENTS.md`](docs/SUBAGENTS.md).

---

## 11. Submission

1. Push a branch; keep the build green (`pnpm typecheck && pnpm test && pnpm build`).
2. Attach **deployed URLs** (dashboard + APIs) and `/health` responses.
3. Include the **AI prompt log** (`docs/AI-PROMPT-LOG.md`) and your **sub-agent**
   definitions (`.opencode/agent/`).
4. Fill in both planning deliverables: **`docs/INFRASTRUCTURE-PLAN.md`** (G9) and
   **`docs/NEXT-PHASE-PLAN.md`** (G10).
5. Add `docs/SUBMISSION.md` with: what you changed, what you skipped and why,
   your deploy commands, Cloudflare/TLD evidence, and known limitations.

**Suggested time budget:** 6–8 hours. G0 + G1 first (correctness), then G2,
then G3–G5, then G6 if time allows. Underscope deliberately and document it.

---

## 12. Non-goals

- Real auth / multi-tenancy (mention how you would add it; do not build it).
- Payments, invoicing, payroll, tax filing.
- A pixel-perfect design system — clarity beats polish.
- 100% test coverage — test the invariants and the edges that matter.
