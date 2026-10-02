# G8 evidence: sub-agents in use

**Date:** 2026-10-01 · **Runner:** opencode 1.18.18, model `opencode/big-pickle`
(free tier, so the demos cost nothing) · **Agents:** `.opencode/agent/*.md`

| Agent                | Mode                  | Owns                                                     | Changed from the starter                                                     |
| -------------------- | --------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ledger-architect`   | read-only             | double-entry invariant, lifecycle, closed periods, port  | rules rewritten to the real code (no DRAFT path, DB triggers, contract test) |
| `test-runner`        | read-only             | every gate, with proof                                   | adds format, Postgres "ran or skipped", challenge suite, ai:verify           |
| `ui-unslop`          | write                 | `apps/web` to `docs/DESIGN.md`                           | lucide removed (no icons), `aria-invalid` lesson, `money()` only, 375 px     |
| `deploy-security`    | read-only (was write) | committed deploy is production-scale and fails closed    | reviewer only; points at the real files; "doc claims vs config" is a gap     |
| `db-migrator`        | write                 | idempotent SQL migrations, schema, both adapters, grants | new                                                                          |
| `reporting-verifier` | read-only, no files   | recomputes reports from raw lines and ties them out      | new                                                                          |

`opencode agent list` shows all six as subagents. `opencode run --agent <name>`
refuses a subagent and falls back to the default agent, so every demo below asks
the default agent to dispatch the subagent through its `task` tool. That is
also how they are used day to day.

## Demo 1: `deploy-security` caught real defects

Prompt (to the default agent):

> Use the deploy-security subagent. Task for it: review the committed deploy and
> security posture against its checklist. In particular: is every environment
> variable that apps/ledger-api/src/index.ts and apps/reporting-api/src/index.ts
> read declared in deployment/render.yaml and documented in the
> docs/DEPLOYMENT.md env table? Does each API shut down gracefully (drain HTTP,
> then close the DB pool)? Return its output contract table verbatim.

It ran for about 20 minutes: it read the code, the Dockerfiles, compose,
render.yaml and the evidence files, and wrote and ran a script that reproduces
the CI boot step. Findings, each checked by hand before acting:

| Finding                                                                                                 | Verified how                                                                                                      | Real?                                                                                           | Fix                                                                  |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **CI `images` job boots the API with `NODE_ENV=production` but no `CORS_ORIGINS`/`INTERNAL_API_TOKEN`** | `docker run -e NODE_ENV=production -e DATABASE_URL=... ledgerlab/ledger-api` → `Error: CORS_ORIGINS must list...` | Yes. Broken since G5 (99f8a41); never noticed because the repo has no remote, so CI has not run | throwaway values in `ci.yml`; boot reproduced locally → `/health` ok |
| `ORIGIN_SECRET` read by both APIs, declared in render.yaml, missing from the DEPLOYMENT.md env table    | grep of `process.env` vs render.yaml keys vs table rows                                                           | Yes                                                                                             | row added                                                            |
| Rehearsal command in DEPLOYMENT.md omits `APP_DB_PASSWORD`, which compose requires (`:?`)               | `docker-compose.prod.yml:31`                                                                                      | Yes                                                                                             | added to the `export` line                                           |
| reporting-api shutdown has no watchdog; a stalled request blocks SIGTERM                                | `apps/reporting-api/src/index.ts` had `server.close(() => process.exit(0))` only                                  | Yes (low impact: upstream calls time out after 5 s, but slow clients do not)                    | same 10 s watchdog as the ledger                                     |

What it missed, found by the main agent the same afternoon: the blueprint's
database had no `region`, so Render would create it in `oregon` (the default,
immutable after creation) while every service is in `singapore`, and private
networking does not cross regions. Fixed in `render.yaml`. The agent prompt now
has "every env var is declared" but nothing on region parity; that gap is
recorded here rather than papered over.

## Demo 2: `reporting-verifier` independently ties out the reports

Setup: a seeded in-memory ledger on `:4101` and reporting on `:4102`, plus three
deliberate edge entries posted by the main agent: a sale dated exactly on the
as-of date (`2026-09-30`), a sale the day after (`2026-10-01`), and a sale on
`2026-09-15` that was then voided.

Prompt:

> Use the reporting-verifier subagent. Task for it: the ledger API is at
> http://localhost:4101 and the reporting API at http://localhost:4102 (not the
> defaults). Recompute and verify the trial balance as of 2026-09-30, the income
> statement for 2026-09-01..2026-09-30, and the balance sheet as of 2026-09-30,
> including the edge checks (entry dated exactly on the as-of date, the
> 2026-10-01 entry, the voided entry). Return its output contract verbatim.

Result: **Ties out: YES**. Every account line and subtotal matched in minor
units (trial balance Dr = Cr = 1,112,345; assets 722,345 = liabilities 80,000 +
equity 642,345; net income 142,345). The edge checks were proved by
counterfactual: including the 2026-10-01 entry would give cash 543,122 and
counting the void would give revenue 362,245; the API returned neither.
Spot-checked by hand: `GET /api/reports/trial-balance?asOf=2026-09-30` →
`1112345 1112345`, cash `542345`; balance sheet assets `722345`.

Two operational lessons, both fixed in the agent file:

1. The first two runs hung forever: the agent wrote scratch scripts to `/tmp`,
   opencode asked for `external_directory` permission, and a headless run cannot
   answer. Fix: `permission: external_directory: deny` in the frontmatter (a
   denial is an error the agent adapts to; an "ask" is a hang) and "write no
   files" in the method.
2. Even so, one run wrote four scripts to `D:\tmp` through bash before switching
   to in-memory heredocs. They were deleted by the main agent. A read-only
   agent with `bash` is not truly read-only; that is the price of letting it
   run `curl` and `node`.

## Demo 3: `test-runner` on the fixed tree

Prompt:

> Use the test-runner subagent. Task for it: run every gate on the current
> working tree (uncommitted changes included) and return its output contract
> verbatim. TEST_DATABASE_URL is not set in this shell, so report whether the
> Postgres tests ran or were skipped.

It ran for 4.5 minutes (12:23 to 12:28 UTC):

| Gate       | Result                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| format     | PASS                                                                       |
| typecheck  | PASS (6/6)                                                                 |
| tests      | PASS: 80 passed, 6 skipped; **postgres: skipped** (no `TEST_DATABASE_URL`) |
| challenges | PASS (4/4)                                                                 |
| build      | PASS                                                                       |
| ai-log     | PASS                                                                       |

What made it useful rather than a rubber stamp:

- It said the suite proves nothing about the Postgres adapter when those 6 tests
  are skipped, and it traced the skip to `repository-contract.test.ts`
  (`describe.skipIf(!pg)`) instead of reporting "all green".
- It found that `pnpm lint` runs **zero tasks** (no linter is configured
  anywhere) yet exits 0. A gate that checks nothing is worse than no gate, so
  the `lint` script and turbo task were removed. Typecheck and Prettier are the
  real static gates.
- It explained the scary-looking `password=hunter2` line in the test output: a
  literal inside the test proving 500s never leak internals.

The main agent then ran every gate with Postgres (`docker compose up -d db`,
`TEST_DATABASE_URL` set; migrations applied twice): format PASS, typecheck 6/6,
**96 tests, 0 skipped** (shared 29, reporting 9, ledger 58 including the
Postgres contract and least-privilege role tests), challenges 4/4, build PASS,
ai:verify PASS.

## Demos 4 to 6: the other three, run in parallel (2026-10-02)

The first three demos were open-ended ("review the deploy posture") and one
took 20 minutes. These three were given one file set and one question each,
launched at the same time with `opencode run` under a 12-minute `timeout`, and
all finished in **7.5 minutes wall clock** (02:07 to 02:15 UTC).

### Demo 4: `ledger-architect` found a hole in the database invariants

Prompt: review `0004_balance_rollups.sql` with the triggers it depends on in
`0002_integrity.sql`, read files only. (1) Can any insert, void or concurrent
post leave the rollups out of step with the raw lines? (2) Can an unbalanced or
rewritten `POSTED` entry still commit? Cite file:line.

Verdict: rollups **SAFE**; posted integrity **VULNERABLE**.

| Finding                                                                                                                                   | Verified how                                                         | Real?                                                                         | Action                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A `journal_entries` row inserted with **no lines** commits: the deferred balance check fires only on a `journal_lines` insert (`0002:43`) | Read the trigger; the new test below failed with the trigger dropped | Yes. The API rejects it, but the database is meant to hold the rule by itself | `0005_entry_needs_lines.sql`: a deferred constraint trigger on the entry side; test "rejects an entry with no lines at commit" |
| Race safety rests on one global advisory lock; a future writer that skips it loses updates                                                | Read `0004:61,81`                                                    | Yes, already recorded as the 10x limit in the infrastructure plan             | none                                                                                                                           |
| The entry-update guard lists allowed columns by hand (`0002:57`); a new column would be silently mutable                                  | Read                                                                 | Yes, latent                                                                   | note for the next schema change                                                                                                |
| Closed periods are enforced in the app only                                                                                               | Known                                                                | Yes, by design (configurable date)                                            | none                                                                                                                           |

It also listed what it could not verify (isolation level, owner-role access in
production), which is the honest answer from a read-only run.

### Demo 5: `db-migrator` fabricated, and was caught

Prompt: read-only. Are migrations `0000` to `0004` idempotent when re-applied on
every deploy? Does `schema.ts` match the SQL for the three ledger tables?

The sub-agent's report cited files that do not exist (`0001_accounts.sql`,
`0002_journal.sql`) and `uuid` columns the schema does not have. The
dispatching opencode agent noticed the mismatch, read the five real files and
returned its own audit: idempotent, schema matches, every guard cited by line.
I spot-checked the citations against the files, and migrations ran twice
against Postgres 16 with no error. **Decision: the sub-agent's output was
rejected**; the parent's corrected audit was kept. Lesson: a reviewer's
citations get checked before its conclusions are believed. The agent's method
now says to list the migrations first and quote every line it cites.

### Demo 6: `ui-unslop` built the CSV export, with three defects

Prompt: add an "Export CSV" text button to the ledger page that downloads the
entries currently shown after filters, one row per line, amounts from `minor()`,
every field quoted, no new dependency; typecheck once.

It followed the design rules (a secondary `Button`, no icon, no colour added,
the forbidden-pattern grep came back empty) and typechecked. Reviewed by hand,
three defects:

1. It exported `data.data`, **the current page of 20**, but the API paginates on
   the server. Fixed: walk every page at 200 (the API's maximum) with the same
   filters.
2. A missing account code became `"----"`, an invented value. Fixed: empty.
3. A memo such as `=HYPERLINK(...)` would run as a formula in Excel (CSV
   injection). Fixed: text fields that start with `= + - @` get a leading `'`;
   the amount column is exempt so credits keep their minus sign.

Verified in the browser against the in-memory API with 210 entries: 420 CSV
rows (two lines each, across two API pages), `'=HYPERLINK` neutralised,
credits as `"-10.50"`.
