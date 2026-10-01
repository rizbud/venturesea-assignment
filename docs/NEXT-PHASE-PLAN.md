# Next-phase development plan

|             |                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------- |
| **Author**  | Rizki Budi                                                                               |
| **Date**    | 2026-10-01                                                                               |
| **Horizon** | 13 weeks: 2026-10-01 → 2026-12-31                                                        |
| **Phase**   | Phase 2: from "trustworthy" to "growing"                                                 |
| **Related** | [`INFRASTRUCTURE-PLAN.md`](INFRASTRUCTURE-PLAN.md), [`CLIENT-STORY.md`](CLIENT-STORY.md) |

---

## 1. Where we are

After this engagement the ledger is provably correct: both accountant-facing
defects are fixed and regression-tested, and the database itself refuses
unbalanced or edited entries. Data lives in Postgres with a restore that was
actually performed. The production shape (2 + 2 replicas, migrations as a deploy
step, least-privilege role, secure headers, rate limits, origin lock) is built
and rehearsed end to end, and every AI-assisted change is in the prompt log.
**Not done yet:** the Render account, domain and Cloudflare are not provisioned,
so nothing is publicly live or monitored. There is no user authentication or
tenant separation. The load test found that reports fell from ~70 to ~5
requests/second once a year of history existed; daily balance rollups, built
on 2026-10-01, brought the worst case to 342 req/s
([evidence](evidence/rollups.md)). Warung Books has 1,400 paying
businesses, growing ~30% a month, and one engineer.

## 2. Outcomes for this phase

| #   | Outcome                                          | Success signal (measurable)                                                                                          | For whom                  |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| O1  | The bank approves us and the embed goes live     | Vendor review passed by 17 Oct; first cohort of 100 warungs assessed for working capital through the embed by 31 Dec | Bank, Kira                |
| O2  | The books survive an audit                       | CPA sign-off on the October close; nightly check reports 0 unbalanced entries and 0 rollup/raw mismatches            | CPA reviewer              |
| O3  | Each business sees only its own books            | Every request authenticated; a cross-tenant read test fails closed in CI; pen-test finding count 0 high              | Bank security, customers  |
| O4  | Investors can see reliability, not hear about it | 30 consecutive days ≥ 99.9% on the external monitor before 28 Nov; production PITR drill on file                     | Investors (due diligence) |
| O5  | Payday stays fast as data grows                  | Report p95 < 800 ms and ledger-read p95 < 300 ms in production on the payday peak, with ≥ 1 year of history          | Ops (Budi), customers     |

These are deliberately about what stakeholders can verify. "Ship feature X"
appears only as a means in §4.

## 3. Prioritisation

**Method:** two passes.

1. **Commitments first.** Work with a dated external obligation (bank review
   17 Oct, CPA close mid-October, due diligence 28 Nov) is scheduled first,
   whatever it scores. Missing one of these dates loses the bank, the audit
   or the round; no RICE score captures that.
2. **RICE for everything else.** Reach = businesses affected this quarter;
   Impact 0.25 (minimal) to 3 (massive); Confidence as a percentage; Effort in
   engineer-weeks. Score = R × I × C ÷ E.

| Initiative                                      | Reach | Impact | Confidence | Effort | Score | Decision                                               |
| ----------------------------------------------- | ----- | ------ | ---------- | ------ | ----- | ------------------------------------------------------ |
| Go-live: Render, domain, Cloudflare, monitoring | 1,400 | 3      | 100%       | 1      | 4,200 | **Now** (commitment: bank 17 Oct)                      |
| Structured logs + error alerting                | 1,400 | 1      | 100%       | 0.5    | 2,800 | **Now** (M1)                                           |
| Daily balance rollups (infra ADR-003)           | 1,400 | 2      | 90%        | 1      | 2,520 | **Done** 2026-10-01 (it blocked O5)                    |
| Append-only audit log (who/when/where)          | 1,400 | 1      | 90%        | 1      | 1,260 | **Now** (commitment: CPA, bank)                        |
| Auth + tenant scoping (OIDC + Postgres RLS)     | 1,400 | 3      | 80%        | 4      | 840   | **Now** (commitment: bank embed needs it)              |
| Bank ledger export API (consented, read-only)   | 100   | 3      | 50%        | 3      | 50    | **Now** (commitment: O1; scope set by the bank's spec) |
| Bank statement CSV import                       | 560   | 2      | 50%        | 3      | 187   | Next (M3, if capacity)                                 |
| Bahasa Indonesia UI                             | 1,400 | 1      | 50%        | 2      | 350   | Later: measure support tickets first                   |
| Mobile capture (PWA camera receipts)            | 1,000 | 1      | 50%        | 4      | 125   | Later                                                  |
| Multi-currency reporting (reach assumed ~2%)    | 30    | 1      | 30%        | 3      | 3     | Later                                                  |

The bank export scores lowest of the "Now" items, and that is the point of
pass 1. It is the reason the bank exists in this plan. Its 50% confidence is
real: the bank has not sent its API specification, so its scope is capped (see
the M2 cut line).

**Saying no this quarter:** multi-currency (Indonesian micro-businesses book in one
currency; reach is an assumption, not data), native mobile apps (the dashboard already works at
375 px), localisation, real-time collaboration, a microservice split beyond the
current two, Kubernetes, and multi-region. Each is in §9 with what would change
the answer.

## 4. Milestones

Dates work backward from the two hard dates: the bank review (17 Oct) and due
diligence (28 Nov).

| Milestone                        | Window                    | Contents                                                                                                                                                                                                                                                                          | Exit criteria (testable)                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1 — Go live, pass review**    | 1 Oct → 16 Oct (2 weeks)  | Provision Render from the blueprint; domain + Cloudflare; uptime monitor; daily off-site dump; production PITR drill; nightly `ledger_rollup_drift` check (rollups themselves are done); structured JSON logs; evidence pack for the bank; support the CPA's October close        | Cloudflare verification block passes (`/api/internal` → edge 403, direct origin → 403, burst → 429); PITR drill fingerprints identical; report p95 < 800 ms under the load-test profile with 1 year of data; `reporting-verifier` ties out on production; bank pack delivered 16 Oct |
| **M2 — Tenancy and embed**       | 19 Oct → 27 Nov (6 weeks) | OIDC sign-in (bought, ADR-P1); `business_id` on every table with Postgres row-level security (ADR-P2); audit log written in the same transaction as each post/void/deactivate; bank export API v1 (consented, read-only, per business); staging environment split from production | Cross-tenant test suite (read, write, report) fails closed in CI; audit row exists for 100% of mutations (nightly check); bank sandbox pulls a consented business's trial balance end to end; 30 days ≥ 99.9% on the monitor by 27 Nov; data room ready for 28 Nov                   |
| **M3 — First cohort and growth** | 30 Nov → 31 Dec (5 weeks) | First 100 warungs through the embed; statement CSV import if M2 landed on time; support tooling for the second hire                                                                                                                                                               | 100 businesses assessed by the bank; report p95 < 800 ms at the payday peak in production; zero high pen-test findings; on-call rota of two engineers                                                                                                                                |

**M2 cut line:** if the bank's API specification arrives after 26 Oct, bank
export v1 shrinks to a signed CSV/JSON trial-balance download that a business
shares with the bank. Tenancy and the audit log do not move. The embed cannot
be safe without them.

## 5. Delivery plan

- **Capacity:** one engineer (the author) full time until the first hire.
  About 8 engineer-weeks are available in M2 (6 for me plus ~2 from the new hire
  after onboarding) against 8 planned. That is why there is a cut line. M1 is
  10 working days with ~1 day of buffer.
- **Team shape:** hire 1 removes the single-engineer bus factor before due
  diligence asks about it. Hire 2 absorbs support load, which grows with
  customers (30% a month) and would otherwise land on engineering.
- **Dependencies (lead times):** the bank's API specification and sandbox
  (to request in M1 week 1; needed by 26 Oct); the CPA's October close review (mid-Oct,
  needs reports stable by 14 Oct); domain purchase and DNS (1 day); Render and
  Cloudflare accounts on the company card (Kira, 1 day).
- **Cadence:** deploy to staging on every merge; production releases twice a
  week (Tue/Thu) via manual promote; a Friday demo for Kira and Budi; a
  fortnightly written update to the bank contact; the investor update after
  each milestone.
- **Definition of done:** merged with CI green (typecheck, tests including the
  Postgres contract and challenge suites, build, format, `ai:verify`); a test
  that fails without the change; the migration runs twice cleanly; docs or
  evidence updated; deployed to production and checked on the monitor;
  AI-assisted work logged.

| Role                                                 | Needed by | Why                                                                                          | Cost signal                                                         |
| ---------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Senior backend/platform engineer                     | 2 Nov     | Bus factor before due diligence; owns tenancy/RLS and on-call with the author                | **Estimate** IDR 30–45 m/month (Jakarta senior), plus ~4 weeks ramp |
| Customer operations lead with bookkeeping background | 1 Dec     | Support grows 30%/month; first-line answers for the bank cohort; feeds the backlog with data | **Estimate** IDR 12–18 m/month                                      |

## 6. Technical workstreams

| Workstream                   | Depends on                              | First PR                                                                                                                                                                                                                      | Risk                                                                                       |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Daily balance rollups (done) | Infra plan ADR-003                      | `0004_balance_rollups.sql`: two trigger-maintained tables, backfill, `ledger_rollup_drift` view; `accountTotals` sums the rollups; contract + concurrency tests                                                               | A missed trigger path would drift; the drift view is asserted in tests and checked nightly |
| Authentication + tenancy     | ADR-P1, ADR-P2                          | `0005_business_id.sql` (nullable column, backfill to one tenant, then NOT NULL + RLS policies); JWT verification middleware in `packages/shared/src/http.ts`; `SET LOCAL app.business_id` per request in the Postgres adapter | Migration on live money tables; RLS bypass if any query runs as the owner role             |
| Append-only audit log        | Tenancy (actor = user + business)       | `0006_audit_log.sql` (INSERT-only grant, same transaction as each mutation); writes in `ledger-service.ts`                                                                                                                    | Missing an entry point; nightly "every mutation has an audit row" check                    |
| Bank export API              | Tenancy, the bank's spec, infra plan §7 | `GET /api/export/trial-balance` behind a per-business consent token; WAF rule allowing the bank's egress IPs                                                                                                                  | Spec churn; mitigated by the cut line                                                      |
| Observability                | Go-live                                 | JSON logger in both `app.ts` (request id, route, status, duration, business id); alerts per infra plan §10                                                                                                                    | Low                                                                                        |
| Multi-currency (deferred)    | `packages/shared/src/reporting.ts`      | (not this phase) reports refuse to sum mixed currencies, then FX-rate table                                                                                                                                                   | —                                                                                          |

## 7. Risks and mitigations

| Risk                                              | Likelihood     | Impact | Mitigation                                                                                                                                                                   | Owner           |
| ------------------------------------------------- | -------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Bank review slips (our evidence or their process) | Medium         | High   | Evidence pack is built from files already in the repo (`docs/evidence/*`); deliver 16 Oct; weekly call with their reviewer; Cloudflare done in M1 week 1                     | Author          |
| Schema migration on live money data (tenancy)     | Medium         | High   | Add-backfill-enforce over three releases; rehearse on a restored copy of production (drill procedure); fingerprint before/after; DB triggers already block unbalanced writes | Author + hire 1 |
| Single engineer bus factor                        | High until Nov | High   | Hire 1 by 2 Nov; everything reproducible from the repo (blueprint, runbooks, prompt log); Kira holds admin access                                                            | Kira            |
| Rollups drift from the raw lines                  | Low            | High   | Triggers in the posting transaction; drift view asserted in CI and checked nightly; rebuild from raw lines is one SQL statement                                              | Author          |
| Bank spec arrives late                            | Medium         | Medium | M2 cut line (signed trial-balance download)                                                                                                                                  | Author          |
| Growth outpaces the plan (10× by mid-2027)        | Medium         | Medium | Global rollup lock reviewed at 5 writes/s; infra plan §12 cost path; monthly capacity review against the load-test profile                                                   | Hire 1          |

## 8. Metrics

| Metric                                     | Now                                                                      | Target                          | Source of truth                                                |
| ------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------- |
| Paying businesses                          | 1,400                                                                    | ~3,000 by 31 Dec (1,400 × 1.3³) | Billing system                                                 |
| Weekly active businesses                   | Not measured (no tenant id yet)                                          | ≥ 80% of paying                 | SQL: distinct `business_id` with an entry that week (after M2) |
| % entries posted without support contact   | Not measured                                                             | ≥ 95%                           | Helpdesk tags joined to entry counts (from M3, hire 2)         |
| Unbalanced posted entries                  | 0 (enforced by the DB trigger)                                           | 0                               | Nightly SQL check; trigger `ledger_check_entry_balanced`       |
| p95 ledger-read latency                    | Rehearsal: p99 172 ms (1 year of data); production: none                 | < 300 ms                        | Render metrics + uptime monitor                                |
| p95 report latency                         | Rehearsal at 1 year of history: p99 3.7 s before rollups, ≤ 103 ms after | < 800 ms                        | Render metrics                                                 |
| Availability                               | Not measured (not yet live)                                              | ≥ 99.9% / month                 | External uptime monitor on both `/health`                      |
| Restore time (drill)                       | 17 s local, 1 year of data                                               | < 1 h on production PITR        | `docs/evidence/G9-restore-drill.md`                            |
| Support tickets / 100 businesses / month   | Not measured                                                             | Baseline in M1, then −20%       | Helpdesk                                                       |
| Businesses assessed through the bank embed | 0                                                                        | 100 by 31 Dec                   | Bank export API logs (consented pulls)                         |

Three "not measured" rows are honest. The first deliverable for each is the
instrument, not a number.

## 9. Explicitly deferred

| Item                               | Why deferred                                                                                                         | Revisit when                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Localisation (Bahasa Indonesia UI) | Existing customers already use the product as is; no ticket data says language is the blocker                        | Support tickets (hire 2) show language in the top 3 causes         |
| Native mobile app                  | The dashboard works at 375 px; a store app is months of work for one engineer                                        | > 30% of sessions are mobile and capture friction shows in tickets |
| Real-time collaborative editing    | Micro-businesses have one bookkeeper; a ledger is append-only anyway                                                 | Accountant collaboration becomes a paid tier                       |
| Multi-currency                     | Few businesses are expected to need it (unmeasured); mixed-currency reports must first refuse to sum (a cheap guard) | > 5% of businesses hold a foreign-currency account                 |
| Multi-region / read replicas       | 0.13 writes/s; a priced 4 h region-loss RTO is acceptable (infra ADR-002)                                            | A contract requires a lower RTO, or 10× traffic                    |
| Splitting more services            | Two services already carry the operational cost; boundaries are clean behind the repository port                     | A team owns a domain end to end (≥ 4 engineers)                    |

## 10. Decision log

> **ADR-P1 — Buy an identity provider; do not build auth.**
> _Context:_ the bank requires authenticated, tenant-scoped access by M2; one
> engineer; micro-business owners mostly sign in from phones.
> _Options:_ (a) build email/password + sessions; (b) a hosted OIDC provider
> (Auth0, Clerk, AWS Cognito) with phone OTP; (c) the bank's SSO only.
> _Decision:_ (b), choosing among the three on Indonesian SMS/WhatsApp OTP
> deliverability and price at ~3,000 businesses during M2 week 1.
> _Why:_ password storage, reset flows, MFA and breach response are not our
> product. (c) would lock out the 1,300 businesses that are not bank customers.
> _Consequences:_ a vendor dependency in the sign-in path; the APIs verify JWTs
> locally (no per-request call to the vendor), so an outage blocks new sign-ins
> only.

> **ADR-P2 — Shared schema with `business_id` and Postgres row-level security.**
> _Options:_ (a) `WHERE business_id = ?` in application code; (b) shared
> tables + RLS keyed on a per-transaction setting; (c) schema per tenant;
> (d) database per tenant.
> _Decision:_ (b), with (d) reserved for a future regulated customer that demands it.
> _Why:_ (a) leaks a business's books with one forgotten clause; (b) makes the
> database refuse the cross-tenant read even then, and it matches how invariants
> already live in the database here (balance and append-only triggers). (c) and
> (d) multiply migrations and connections by 1,400 tenants for one engineer.
> _Consequences:_ every request sets `app.business_id` in its transaction; the
> runtime role must never bypass RLS (it is not the owner, and the policy is
> `FORCE`d); a CI suite proves cross-tenant reads return nothing.

> **ADR-P3 — Fix report cost with rollups before buying a bigger database.**
> _Options:_ (a) upgrade the DB plan as history grows; (b) cache report
> responses; (c) monthly rollups plus raw partial months; (d) daily rollups
> maintained in the posting transaction.
> _Decision:_ (d), done on 2026-10-01 ahead of M1.
> _Why:_ the load test showed report cost proportional to history (§1). (a)
> buys months at a rising price, and (b) is wrong on back-dated entries. (c) was
> built and measured: it still seq-scanned every line for the partial month (15
> req/s late in the month). (d) reached 342 req/s. Detail in infra plan ADR-003.
> _Consequences:_ a reconciliation check (`ledger_rollup_drift` must be empty)
> is part of CI and of the nightly checks.
