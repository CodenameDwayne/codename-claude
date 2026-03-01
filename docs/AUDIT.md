# Codename Claude Pipeline — Unified Audit Report

**Date:** 2026-03-01
**Method:** 6 parallel analysis agents, each performing deep-dive audit of one component
**Scope:** Scout, Architect, Builder, Reviewer, Pipeline Engine, Daemon
**Files analyzed:** 40+ source files, agent definitions, skills, rules, and configuration

---

## Executive Summary

6 parallel agents analyzed every component of the pipeline system: **Scout, Architect, Builder, Reviewer, Pipeline Engine, and Daemon**. Together they read 40+ source files, agent definitions, skills, rules, and configuration files.

**The system's architecture is fundamentally sound** — the stage-based pipeline with file-system-mediated handoffs (`.brain/`) is elegant and debuggable. But the audit uncovered **systemic patterns of weakness** that repeat across nearly every component.

---

## Table of Contents

- [Systemic Patterns (Cross-Cutting)](#systemic-patterns-cross-cutting)
- [All Findings by Severity](#all-findings-by-severity)
  - [Critical (11)](#critical-11-findings)
  - [Major (28)](#major-28-findings)
  - [Minor](#minor-findings)
  - [Nit](#nit-findings)
- [Cross-Component Inconsistencies](#cross-component-inconsistencies)
- [Individual Component Reports](#individual-component-reports)
  - [Scout Agent](#scout-agent)
  - [Architect Agent](#architect-agent)
  - [Builder Agent](#builder-agent)
  - [Reviewer Agent](#reviewer-agent)
  - [Pipeline Engine](#pipeline-engine)
  - [Daemon System](#daemon-system)
- [Top 10 Prioritized Recommendations](#top-10-prioritized-recommendations)

---

## Systemic Patterns (Cross-Cutting)

These aren't isolated bugs — they're **design-level patterns** that appear everywhere:

### Pattern 1: "Fail Open" — The Pipeline Assumes Success on Silence

| Component | Manifestation |
|-----------|--------------|
| **Scout** | `validateStage` returns `null` (pass) — zero validation of output |
| **Architect** | `validateArchitect` catches missing PLAN.md and returns `null` (pass) |
| **Builder** | `validateBuilder` is literally a no-op — always returns `null` |
| **Reviewer** | `parseReviewVerdict` defaults to `APPROVE` on any error |
| **Router** | Empty LLM response becomes `'[]'` — 0-stage pipeline "completes successfully" |

**This is the #1 systemic flaw.** Every failure mode in the pipeline silently resolves to "success." A crashed agent, a missing output file, a malformed response — all are treated as passing. The quality gate (Reviewer) can be completely bypassed if it crashes.

### Pattern 2: "Blind Retry" — No Feedback Flows Backward

| Flow | What's Missing |
|------|---------------|
| **REVISE → Builder** | Builder re-runs with the exact same prompt. No review feedback passed. Builder doesn't know what to fix. |
| **REDESIGN → Architect** | Architect re-runs with the original task. No review context. Architect doesn't know why the design was rejected. |
| **REVIEW.md** | Not loaded into system prompt by `runner.ts`. Not referenced in Builder or Architect task prompts. |

The retry mechanism exists but is **functionally broken** — agents retry blind, producing the same output until `maxRetries` is exhausted.

### Pattern 3: "Prompt-Only Enforcement" — Critical Contracts Have No Runtime Checks

| Contract | Enforcement |
|----------|------------|
| Architect must write PLAN.md | Prompt says so; validation silently passes if missing |
| Builder must stay within batch scope | Prompt says "ONLY those tasks"; no verification |
| Architect must use TeamCreate in team mode | Prompt is emphatic; no check |
| Builder must run tests | Prompt + skills say TDD; no post-build test run |
| PLAN.md must have TDD steps | Prompt describes format; only heading numbers validated |

### Pattern 4: "Dead or Vestigial Code"

| Item | Status |
|------|--------|
| `sandbox.ts` (159 lines, Vercel microVM) | Completely unused — runner uses SDK's built-in sandbox |
| `RunResult.syncedFiles` field | Never populated |
| `state.ts:updateStageStatus` | Never called in production |
| Scout in pipeline | Router explicitly excludes it; no `buildStageTask` branch; no validation |
| Score-based routing in `review-loop.md` | Engine ignores scores entirely; uses only verdict string |
| `patternsCompliance` field | Logs a warning, affects nothing |

---

## All Findings by Severity

### CRITICAL (11 findings)

| # | Component | Finding | Impact |
|---|-----------|---------|--------|
| 1 | **Scout** | `research-scan.md` references Perplexity MCP tool that doesn't exist | Agent gets confused by instructions to use non-existent tool |
| 2 | **Scout** | Router explicitly excludes Scout from automated pipelines; Architect can't request Scout mid-pipeline | Core design promise (on-demand research) is unimplemented |
| 3 | **Scout** | Zero validation of Scout output — no check that `RESEARCH/` files were written | Failed Scout run treated as success |
| 4 | **Architect** | `validateArchitect` silently passes when PLAN.md is missing (catch returns null) | Builder runs without a plan, freestyles implementation |
| 5 | **Builder** | `validateBuilder` is a no-op — always returns null | Zero post-build quality checks; broken code passes through |
| 6 | **Builder** | REVISE loop is blind — Builder gets no review feedback on re-run | REVISE cycles are "run again and hope"; wastes budget |
| 7 | **Reviewer** | Severity enum mismatch: skill defines `Critical` but JSON schema only allows `major/minor/nit` | Most severe findings get silently downgraded |
| 8 | **Reviewer** | REDESIGN when no architect stage exists falls back to builder (same as REVISE) | REDESIGN becomes meaningless in architect-less pipelines |
| 9 | **Reviewer** | No feedback channel to Builder on REVISE or to Architect on REDESIGN | Retry loops are structurally incapable of converging |
| 10 | **Engine** | Batch expansion drops stages after reviewer | Latent bug; will break when post-review stages are added |
| 11 | **Engine** | Empty router response → 0-stage pipeline silently "completes" | Silent total failure looks like success |

### MAJOR (28 findings)

| # | Component | Finding |
|---|-----------|---------|
| 12 | **Scout** | Missing `Bash` tool — can't verify research findings |
| 13 | **Scout** | No `buildStageTask` branch — gets raw task with no context |
| 14 | **Scout** | Unsandboxed with web access — security risk if Bash is added later |
| 15 | **Scout** | No size cap on RESEARCH files injected into downstream prompts |
| 16 | **Architect** | `Write`, `Bash`, `sandboxed: false` with only prompt-based path restrictions |
| 17 | **Architect** | PLAN.md with no task headings passes validation; breaks batch expansion silently |
| 18 | **Architect** | Solo plans have exact code; team plans have descriptions — Builder skill only handles literal format |
| 19 | **Architect** | No timeout for team mode — hung teammate blocks forever |
| 20 | **Architect** | REDESIGN gives Architect zero context about what Reviewer flagged |
| 21 | **Architect** | No content-level validation of PLAN.md tasks |
| 22 | **Builder** | Batch scope is natural language only — no enforcement |
| 23 | **Builder** | REVISE in early batches doesn't re-run later batches (broken interfaces) |
| 24 | **Builder** | No rollback mechanism on failure |
| 25 | **Builder** | Dead code: entire `sandbox.ts` (159 lines) unused |
| 26 | **Reviewer** | No `Write` tool but skills require writing to `.brain/` files |
| 27 | **Reviewer** | Reviewer never shown the JSON schema fields it must produce |
| 28 | **Reviewer** | `parseReviewVerdict` defaults to APPROVE (fail-open quality gate) |
| 29 | **Reviewer** | No review history visible during REVISE cycles |
| 30 | **Reviewer** | Global retry cap across all batches (not per-batch) |
| 31 | **Engine** | Type mismatch between engine `RunnerOptions` and runner `RunOptions` |
| 32 | **Engine** | Pipeline state data integrity issues on re-expansion after REDESIGN |
| 33 | **Engine** | No pipeline resume after crash (stall recovery starts fresh) |
| 34 | **Engine** | Work queue has real async race condition (can lose items) |
| 35 | **Engine** | No pipeline cancellation/abort mechanism |
| 36 | **Engine** | No per-stage timeout |
| 37 | **Engine** | Router uses full Claude session for trivial JSON classification |
| 38 | **Daemon** | Stale PID file can identify wrong process |
| 39 | **Daemon** | No log rotation — unbounded growth |

### MINOR Findings

| # | Component | Finding |
|---|-----------|---------|
| 40 | **Scout** | Frontmatter `name: Scout` (capital) vs router lowercases — fragile coupling |
| 41 | **Scout** | All rules (coding-standards, git-protocol) injected into Scout which never writes code |
| 42 | **Scout** | `research-scan.md` step 5 says write to DECISIONS.md but Scout "doesn't make decisions" |
| 43 | **Scout** | No cleanup mechanism for stale RESEARCH files |
| 44 | **Architect** | Missing `whenToUse` frontmatter field for cleaner router descriptions |
| 45 | **Architect** | Dual-signal confusion between `TaskUpdate` and `teammate-idle` in team mode |
| 46 | **Architect** | Pre-validation cleanup of PLAN-PART files destroys diagnostic evidence |
| 47 | **Architect** | 5-component team mode threshold is aggressive; doesn't align with 20+ task justification |
| 48 | **Architect** | `plan-feature-team.md` (235 lines) always loaded even in solo mode |
| 49 | **Architect** | BACKLOG.md referenced in agent definition but never loaded into prompt |
| 50 | **Architect** | No mechanism for Architect to request Scout research mid-pipeline |
| 51 | **Architect** | No PLAN.md versioning on REDESIGN cycles |
| 52 | **Architect** | `Agent` tool in base toolset could bypass team mode controls |
| 53 | **Builder** | No tool name validation in frontmatter parsing |
| 54 | **Builder** | No structural validation of PLAN.md content beyond headings |
| 55 | **Builder** | Batch scoping adds session overhead without parallel execution |
| 56 | **Builder** | Global retry counter across batches — multi-batch projects exhaust retries faster |
| 57 | **Builder** | No inter-batch state transfer — each session must rediscover previous work |
| 58 | **Builder** | No diff/change capture after Builder completes |
| 59 | **Builder** | "Setup from scratch" vs "follow plan literally" tension in task prompt |
| 60 | **Builder** | TDD discipline assumes plan has TDD steps — not enforced |
| 61 | **Reviewer** | Batch scope passed as text only — no structured context |
| 62 | **Reviewer** | Unsafe type cast on structured output (`as ReviewOutput`) — no Zod validation |
| 63 | **Reviewer** | Score (1-10) is logged but never used for routing decisions |
| 64 | **Reviewer** | `patternsCompliance` boolean logs a warning, affects nothing else |
| 65 | **Reviewer** | Prompt mentions "escalate to Scout" but no such mechanism exists |
| 66 | **Reviewer** | `review-loop.md` routing logic contradicts engine's actual behavior |
| 67 | **Engine** | Duplicate `RunnerResult`/`RunResult` types across files |
| 68 | **Engine** | `updateStageStatus` in state.ts is dead code |
| 69 | **Engine** | State file writes are not atomic (crash mid-write corrupts JSON) |
| 70 | **Engine** | No project-level locking (mitigated by heartbeat serialization) |
| 71 | **Engine** | No upper bound on batch count for large plans |
| 72 | **Engine** | Unknown agents get raw task with no context from `buildStageTask` |
| 73 | **Engine** | Session ID map overwrites on batched stages |
| 74 | **Engine** | No progress reporting during long runs |
| 75 | **Engine** | No metrics/observability infrastructure |
| 76 | **Engine** | No idempotency/deduplication for enqueued tasks |
| 77 | **Daemon** | `CronTrigger.lastFiredAt` not persisted — double-fires on restart |
| 78 | **Daemon** | `cmdStart` hardcoded 1500ms wait for daemon startup |
| 79 | **Daemon** | Heartbeat does not run initial tick on start — 60s idle gap |
| 80 | **Daemon** | File watcher only watches config projects, not dynamically added ones |
| 81 | **Daemon** | `projects-remove` only removes by key, not by path (in-memory map stale) |
| 82 | **Daemon** | Queue list handler bypasses WorkQueue abstraction — reads file directly |
| 83 | **Daemon** | Budget estimation uses flat constants (10/50 prompts) disconnected from reality |
| 84 | **Daemon** | Webhook project resolution uses repo name, may not match registered project |
| 85 | **Daemon** | No config hot-reload — requires full restart |
| 86 | **Daemon** | No multiple daemon instance prevention |
| 87 | **Daemon** | No queue size limits or deduplication |
| 88 | **Daemon** | No graceful in-flight agent handling on shutdown — orphaned processes |
| 89 | **Daemon** | Unix socket permissions not explicitly set to 0o600 |
| 90 | **Daemon** | Webhook binds to 0.0.0.0 with no rate limiting |
| 91 | **Daemon** | GitHub webhook secret stored in plain text in config JSON |
| 92 | **Daemon** | Agents run with `bypassPermissions` and `allowDangerouslySkipPermissions` |

### NIT Findings

| # | Component | Finding |
|---|-----------|---------|
| 93 | **Scout** | `learning-loop` and `session-handoff` skills overlap significantly |
| 94 | **Scout** | System prompt loads all previous RESEARCH files into Scout's own context |
| 95 | **Builder** | Model version pin (`claude-sonnet-4-6`) coerced to `'sonnet'` — pin is decorative |
| 96 | **Builder** | Redundant instructions across system prompt layers (same instruction 3-4 times) |
| 97 | **Architect** | Teammate prompt template embedded in skill file — could be extracted |
| 98 | **Architect** | PLAN-PART cleanup regex is unnecessarily strict (digits only) |
| 99 | **Reviewer** | No edge case guidance (empty diff, partial implementation, no tests yet) |
| 100 | **Reviewer** | "Write your verdict naturally and SDK handles formatting" is misleading |
| 101 | **Engine** | LLM router is overkill for 3 fixed patterns |
| 102 | **Engine** | `parseReviewVerdict` APPROVE default — philosophically dangerous even if unreachable |
| 103 | **Daemon** | Log timestamp truncated to HH:MM:SS without date |
| 104 | **Daemon** | `HOME` fallback to `~` is not a valid filesystem path in Node.js |
| 105 | **Daemon** | Webhook only supports GitHub HMAC — no extension point for other providers |

---

## Cross-Component Inconsistencies

| Area | Inconsistency |
|------|--------------|
| **Plan format** | `plan-feature.md` says write exact code; `plan-feature-team.md` says write descriptions; Builder's `execute-plan.md` only handles literal code |
| **Severity vocabulary** | `review-code.md` uses Critical/Major/Minor/Nit; JSON schema allows only major/minor/nit |
| **Score-based routing** | `review-loop.md` describes score→routing logic; engine ignores scores completely |
| **Scout references** | Architect says "request Scout"; Reviewer says "escalate to Scout"; neither can actually invoke Scout |
| **Sandbox approach** | `sandbox.ts` implements Vercel microVMs; runner uses SDK built-in sandbox; both exist, only one is used |
| **Rules injection** | All rules (coding-standards, git-protocol, quality-gates) injected into every agent including Scout which never writes code |
| **Team signal protocol** | `plan-feature-team.md` has contradictory guidance on TaskUpdate vs SendMessage vs teammate-idle |
| **`whenToUse` frontmatter** | Router expects it; no agent definition provides it; falls back to body text parsing |

---

## Individual Component Reports

### Scout Agent

**Role:** Research and investigation agent. Finds information, evaluates options, writes reports to `.brain/RESEARCH/`.

**Key files:**
- Agent definition: `~/.codename-claude/agents/scout.md`
- Primary skill: `~/.codename-claude/identity/skills/research-scan.md`
- Runner integration: `src/agents/runner.ts`

**Summary:** Scout is a well-intentioned but **second-class citizen** in the pipeline. It is explicitly excluded from automated routing, has zero output validation, references a non-existent tool (Perplexity MCP), and has no mechanism for on-demand invocation by other agents. Scout only works when manually triggered or via cron.

**Critical findings:**
- `research-scan.md` references "Perplexity (via MCP)" which does not exist — confuses the agent
- Router explicitly says "Do NOT include scout as a pipeline stage" — blocks automated use
- Zero validation of Scout output — failed runs treated as success
- `buildStageTask` has no Scout branch — gets raw task with no framing
- No mechanism for Architect to invoke Scout mid-pipeline (despite docs saying it can)

**Major findings:**
- Missing `Bash` tool — can't verify research findings (install packages, test APIs)
- Unsandboxed with web access — security risk
- No size cap on RESEARCH files loaded into downstream system prompts
- Missing `whenToUse` frontmatter field for router descriptions
- No `validateScout` method in pipeline engine

---

### Architect Agent

**Role:** Planning and design agent. Turns ideas into specs, decomposes into tasks, makes architectural decisions. Uses Opus model.

**Key files:**
- Agent definition: `~/.codename-claude/agents/architect.md`
- Skills: `~/.codename-claude/identity/skills/plan-feature.md`, `plan-feature-team.md`
- Pipeline integration: `src/pipeline/engine.ts`, `src/pipeline/orchestrator.ts`

**Summary:** Architect is the most capable agent (Opus model) with the most responsibility (plan format drives entire pipeline). Its validation has the single most dangerous bug: **silently passing when PLAN.md is missing**. Team mode adds significant complexity for a token-limit problem that could be solved more simply.

**Critical findings:**
- `validateArchitect` catches file-not-found and returns `null` (pass) — Builder runs planless
- The `catch` block comment says "PLAN.md not required for all architect runs" but the entire downstream pipeline depends on it

**Major findings:**
- Has `Write`, `Bash`, `sandboxed: false` with only prompt-based path restrictions
- PLAN.md with no task headings passes validation — breaks batch expansion silently
- Solo plans contain exact code; team plans contain descriptions — Builder only handles literal format
- No timeout for team mode — hung teammate blocks forever
- REDESIGN gives Architect zero feedback from Reviewer
- No content-level validation of PLAN.md tasks (only heading numbers checked)

**Three-way prompt contradiction:**
1. Architect "never writes code" (agent definition)
2. `plan-feature.md` says "write exact code in the plan"
3. `plan-feature-team.md` says "do NOT write full code blocks"

---

### Builder Agent

**Role:** Implementation agent. Writes code, runs tests, commits changes. Runs in sandbox.

**Key files:**
- Agent definition: `~/.codename-claude/agents/builder.md`
- Primary skill: `~/.codename-claude/identity/skills/execute-plan.md`
- Sandbox: `src/agents/sandbox.ts` (unused), SDK built-in sandbox (actual)
- Pipeline integration: `src/pipeline/engine.ts`, `src/pipeline/orchestrator.ts`

**Summary:** Builder is the workhorse agent with the **least validation**. `validateBuilder` is a literal no-op. The REVISE feedback loop is blind — Builder re-runs with the same prompt and no review context. The entire `sandbox.ts` file (159 lines of Vercel microVM logic) is dead code.

**Critical findings:**
- `validateBuilder` always returns `null` — zero post-build quality checks
- REVISE loop is blind — Builder gets identical prompt on re-run, no review feedback
- Dead code: entire `sandbox.ts` with `syncFilesIn`/`syncFilesOut` is unused

**Major findings:**
- Batch scope is natural language only — no enforcement that Builder stays in scope
- REVISE in early batches doesn't re-run later batches (API changes break downstream)
- No rollback mechanism on failure — project left in broken state
- No detection of incomplete Builder sessions (ran out of turns = "success")
- Fragile PLAN.md task heading regex — silent degradation on format variation

**The batch problem:** Sequential batches create overhead (multiple sessions re-reading PLAN.md) without parallel execution. Each new Builder session has no memory of previous batches and must rediscover existing code state.

---

### Reviewer Agent

**Role:** Quality gate. Reviews code, runs tests, routes decisions (APPROVE, REVISE, REDESIGN).

**Key files:**
- Agent definition: `~/.codename-claude/agents/reviewer.md`
- Skills: `~/.codename-claude/identity/skills/review-loop.md`, `review-code.md`
- JSON schema: `src/pipeline/state.ts` (REVIEW_JSON_SCHEMA)
- Pipeline integration: `src/pipeline/engine.ts`

**Summary:** The Reviewer is the pipeline's quality gate, but it's **fail-open by design**. Missing output defaults to APPROVE. The severity vocabulary is mismatched between the skill and JSON schema. The score-based routing described in the skill is completely ignored by the engine. The Reviewer has no `Write` tool despite skills that require writing to `.brain/` files.

**Critical findings:**
- Severity enum mismatch: skill defines `Critical` severity; JSON schema only allows `major/minor/nit`
- REDESIGN with no architect stage silently falls back to builder (REDESIGN = REVISE)
- No feedback channel to Builder on REVISE or to Architect on REDESIGN

**Major findings:**
- No `Write` tool but `learning-loop` and `session-handoff` skills require writing to `.brain/` files
- Reviewer never shown the JSON schema fields it must produce — told "SDK handles formatting"
- `parseReviewVerdict` defaults to APPROVE on any error (fail-open)
- No review history visible during REVISE cycles
- Global retry cap across all batches, not per-batch

**Skill vs. Engine disconnect:** `review-loop.md` describes nuanced score-based routing (5-7 trending down → Architect, 5-7 trending up → Builder). The engine ignores scores entirely and routes based solely on the verdict string.

---

### Pipeline Engine

**Role:** Orchestrates multi-agent workflows — stages agents sequentially, validates outputs, handles retry logic, manages batch expansion.

**Key files:**
- `src/pipeline/engine.ts` — Core orchestration loop
- `src/pipeline/router.ts` — LLM-based agent selection
- `src/pipeline/orchestrator.ts` — Batch expansion from PLAN.md
- `src/pipeline/state.ts` — State types and persistence

**Summary:** The engine's `while` loop and filesystem-mediated handoffs are architecturally sound. But it has **no meaningful validation** for Scout or Builder, silently passes on missing Architect output, and its retry mechanism is blind. The LLM router is over-engineered for the current 3-pattern decision. The work queue has a real async race condition.

**Critical findings:**
- Batch expansion drops stages after reviewer — latent bug for future post-review stages
- Empty router response → 0-stage pipeline silently "completes"

**Major findings:**
- Type mismatch between engine `RunnerOptions` and runner `RunOptions`
- Pipeline state data integrity issues on re-expansion after REDESIGN
- No pipeline resume after crash — stall recovery starts fresh single-agent run
- Work queue async race condition can lose items (concurrent enqueue from webhook + heartbeat)
- No pipeline cancellation/abort mechanism
- No per-stage timeout (stall detection is 30 min, operates on state file timestamps)
- Router spawns full Claude session for trivial JSON classification

**Over-engineering concern:** The LLM router calls Haiku to decide between 3 fixed patterns (`[builder, reviewer]`, `[architect, builder, reviewer]`, `[architect(teams), builder, reviewer]`). A rule-based router would be faster, cheaper, and more reliable.

---

### Daemon System

**Role:** Background service that runs the pipeline on schedules, webhooks, and queue-driven triggers.

**Key files:**
- `src/daemon.ts` — Main daemon process
- `src/cli.ts` — CLI interface
- `src/ipc/server.ts`, `client.ts`, `protocol.ts` — Unix socket IPC
- `src/heartbeat/loop.ts`, `queue.ts` — Work queue and heartbeat
- `src/state/budget.ts`, `projects.ts` — State management
- `src/triggers/cron.ts`, `watcher.ts`, `webhook.ts` — Trigger system

**Summary:** The daemon architecture is sound — long-running process with IPC, heartbeat, and multiple trigger sources. The IPC protocol is clean and the CLI matches perfectly. But file-based state has race conditions, PID handling is fragile, budget estimation is disconnected from reality, and shutdown doesn't handle in-flight agents.

**Critical finding:**
- Race conditions in file-based state (WorkQueue, Budget, Projects) — concurrent enqueue from webhook + heartbeat can lose items

**Major findings:**
- Stale PID file can identify wrong process (PID recycled by OS)
- Queue list handler bypasses WorkQueue abstraction — reads file directly
- Budget estimation uses flat constants (10/50 prompts) regardless of actual usage
- Webhook project resolution uses repo name — may not match registered project
- No log rotation — unbounded file growth
- No graceful in-flight agent handling on shutdown — processes orphaned

**The budget problem:** A 3-stage pipeline always records 30 "prompts" whether the agents ran 5 or 200 turns each. The system can both over-throttle (blocking valid runs) and under-throttle (allowing expensive runs).

---

## Top 10 Prioritized Recommendations

### 1. Fix the "Fail Open" Pattern — Make validation fail-closed

Change `validateArchitect` to error when PLAN.md is missing. Make `validateBuilder` actually run `bun test`. Change `parseReviewVerdict` to default to `REVISE` not `APPROVE`. Reject empty router responses. This single change addresses findings #1-5, #11, #28.

### 2. Build a Feedback Channel for Retries

On REVISE: write `ReviewOutput` to `.brain/REVIEW.md` from the engine; add "Read .brain/REVIEW.md and fix all listed issues" to Builder's re-run prompt. On REDESIGN: same for Architect. Also load `REVIEW.md` into the system prompt in `runner.ts`. This addresses findings #6, #9, #20, #29.

### 3. Remove Dead Code

Delete `sandbox.ts`, `RunResult.syncedFiles`, `updateStageStatus`. Remove Perplexity reference from `research-scan.md`. Remove score-based routing from `review-loop.md` (or implement it in the engine). This addresses findings #1, #25, #63, #64, #68.

### 4. Fix the Severity Enum Mismatch

Add `'critical'` to `REVIEW_JSON_SCHEMA` in `state.ts`, or remove "Critical" from `review-code.md`. This addresses finding #7.

### 5. Add `whenToUse` to All Agent Frontmatter

Give the router clean descriptions instead of relying on body text parsing. This addresses findings #44 and improves router reliability.

### 6. Unify Plan Format Between Solo and Team Mode

Either make both produce the same format, or teach Builder's `execute-plan.md` to handle both literal-code and descriptive plans. This addresses finding #18.

### 7. Fix Batch Expansion to Preserve Trailing Stages

In `orchestrator.ts`, append `stages.slice(reviewerIdx + 1)` to the output. This addresses finding #10.

### 8. Add File Locking to State Files

Queue, budget, and project state files all have race conditions. Use `proper-lockfile` or migrate to SQLite. This addresses finding #34.

### 9. Replace LLM Router with Rule-Based Router

The current 3-pattern decision can be a simple heuristic. Keep LLM as optional fallback for ambiguous tasks. Saves cost, latency, and eliminates a failure mode. This addresses findings #37, #101.

### 10. Add Per-Stage Timeouts and Pipeline Cancellation

Thread an `AbortController` through the engine and into SDK `query()` calls. Add configurable per-stage timeout (default 30 minutes). This addresses findings #35, #36.

---

## Appendix: File Reference Map

| Component | Key Files |
|-----------|-----------|
| Scout definition | `~/.codename-claude/agents/scout.md` |
| Architect definition | `~/.codename-claude/agents/architect.md` |
| Builder definition | `~/.codename-claude/agents/builder.md` |
| Reviewer definition | `~/.codename-claude/agents/reviewer.md` |
| Agent runner | `src/agents/runner.ts` |
| Sandbox (unused) | `src/agents/sandbox.ts` |
| Pipeline engine | `src/pipeline/engine.ts` |
| Router | `src/pipeline/router.ts` |
| Orchestrator | `src/pipeline/orchestrator.ts` |
| Pipeline state | `src/pipeline/state.ts` |
| Daemon | `src/daemon.ts` |
| CLI | `src/cli.ts` |
| IPC server | `src/ipc/server.ts` |
| IPC client | `src/ipc/client.ts` |
| IPC protocol | `src/ipc/protocol.ts` |
| Heartbeat loop | `src/heartbeat/loop.ts` |
| Work queue | `src/heartbeat/queue.ts` |
| Budget state | `src/state/budget.ts` |
| Projects state | `src/state/projects.ts` |
| Cron triggers | `src/triggers/cron.ts` |
| File watcher | `src/triggers/watcher.ts` |
| Webhook server | `src/triggers/webhook.ts` |
| Hooks | `src/hooks/hooks.ts` |
| System prompt | `~/.codename-claude/identity/system-prompt.md` |
| Rules | `~/.codename-claude/identity/rules/*.md` |
| Skills | `~/.codename-claude/identity/skills/*.md` |
