# Sub-agents

You are required to **build your own sub-agents** and use them for the work
(G8). Four starter agents are provided in `.opencode/agent/`; extend or replace
them. An agent you actually used and can demonstrate scores; a folder of
unused boilerplate does not.

## What a sub-agent is

A narrowly-scoped collaborator with its own system prompt, tools, and definition
of done. Good sub-agents:

- own **one** concern (the ledger invariant, the design rules, the deploy);
- are **read-only** when they review and **write-enabled** only when they build;
- produce **evidence**, not opinions;
- have an explicit output contract so their results are checkable.

## Provided starters

| Agent              | Mode      | Job                                                 |
| ------------------ | --------- | --------------------------------------------------- |
| `ledger-architect` | read-only | Guards the double-entry invariant and posting rules |
| `ui-unslop`        | write     | Enforces `docs/DESIGN.md` on every screen           |
| `test-runner`      | read-only | Runs typecheck/test/build, reports the minimal fix  |
| `deploy-security`  | write     | Production-scale + security review of the deploy    |

## What you must do

- [x] Keep **at least three** working agents (they may be the starters, improved).
- [x] Add **at least one** agent of your own that fits your workflow. Likely candidates:

| Suggested agent      | Job                                                                        |
| -------------------- | -------------------------------------------------------------------------- |
| `db-migrator`        | Schema, migrations, seeding, repository port; refuses `REAL` money columns |
| `reporting-verifier` | Independently recomputes reports and proves they tie out                   |
| `challenge-fixer`    | Works only on `src/challenges/*`; returns source diffs, never test edits   |
| `api-contract`       | Keeps the API surface, Zod schemas, and OpenAPI in sync                    |
| `perf-probe`         | Load-tests an endpoint and reports p50/p95 before and after                |

- [x] Write, for each agent, the exact prompt you used and the outcome — logged
      via `pnpm ai:log` with `--subagent <name>`. (Three agents demonstrated;
      `ledger-architect`, `db-migrator`, `ui-unslop` not yet; see the evidence.)
- [x] Demonstrate at least one agent **catching a real defect** and the fix
      that followed.

**Status (2026-10-01):** six agents in `.opencode/agent/`. Demo runs, prompts,
findings and the fixes they led to are in
[`evidence/G8-subagents.md`](evidence/G8-subagents.md).

## Format

An agent is a markdown file in `.opencode/agent/` with YAML frontmatter:

```markdown
---
description: When to use this agent, in one sentence.
mode: subagent
temperature: 0.1
tools:
  write: false
  edit: false
  bash: true
---

The system prompt: scope, method, constraints, output contract.
```

## Definition of done for each agent

1. **Scoped** — one concern, stated in the first line of the prompt.
2. **Tooled** — read-only unless it must write; no unnecessary `bash`.
3. **Evidence-based** — every claim ties to a file, command, or test output.
4. **Contract** — a fixed output shape a human can verify at a glance.
5. **Used** — at least one logged interaction referencing it.
6. **Bounded** — it says what it will _not_ do (scope creep is a defect).

## Anti-patterns

- A "do everything" agent that owns the whole repo.
- An agent that claims success without pasting command output.
- An agent that edits tests to make them pass.
- Agents that duplicate each other's scope.
