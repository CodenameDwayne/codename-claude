# Audit Remediation Design

**Date:** 2026-03-01
**Source:** `docs/AUDIT.md` (105 findings from 6-agent parallel audit)
**Status:** Approved

---

## Decisions Made

### Decision 1: Scout's Pipeline Role
**Choice:** Optional first stage
- Router can include Scout when task involves research, evaluation, or comparison
- Scout runs before Architect in the stage sequence
- No on-demand mid-pipeline invocation
- Remove router's "Do NOT include scout" exclusion
- Add Scout to rule-based routing patterns

### Decision 2: Sandbox Strategy
**Choice:** Sandbox code-touching agents only
- Builder and Reviewer: sandboxed (SDK built-in) — unchanged
- Architect and Scout: unsandboxed — unchanged
- Delete dead `src/agents/sandbox.ts` (Vercel microVM, 159 lines, completely unused)
- Remove vestigial `RunResult.syncedFiles` field

### Decision 3: Plan Format Unification
**Choice:** Unify to literal code format
- Both `plan-feature.md` (solo) and `plan-feature-team.md` (team) produce plans with exact code
- Team mode teammates write literal TDD steps in their PLAN-PART files
- Update `plan-feature-team.md` teammate prompt template to require code blocks
- Update `execute-plan.md` to defensively handle both formats (robustness)

### Decision 4: Router Approach
**Choice:** Simple rule-based router (no LLM)
- Replace LLM Haiku call with keyword/heuristic matching
- 4 routing patterns:
  - Research task → `[scout, architect, builder, reviewer]`
  - Feature needing planning → `[architect, builder, reviewer]`
  - Complex feature (5+ components) → `[architect(teams), builder, reviewer]`
  - Simple fix/bug → `[builder, reviewer]`
- User override via `--agent` flag preserved
- Remove `createDefaultClient` and Haiku dependency from router

### Decision 5: State Persistence
**Choice:** File locking with `proper-lockfile`
- Add `proper-lockfile` dependency
- Wrap all load-modify-save operations in WorkQueue, Budget, and Projects
- Keeps JSON files human-readable and debuggable
- Sufficient for single-process daemon

### Decision 6: Budget System
**Choice:** Track real turn counts
- Runner returns actual turn count from SDK session in `RunResult`
- Remove flat estimates (STANDALONE_PROMPT_ESTIMATE=10, TEAM_PROMPT_ESTIMATE=50)
- Budget records real usage per pipeline run
- Accurate throttling

### Decision 7: Review Scores
**Choice:** Metadata only
- Keep score (1-10) in JSON schema for logging/observability
- Do NOT use scores for routing — verdict string is sole routing signal
- Remove score-based routing fiction from `review-loop.md`
- Keep `patternsCompliance` as metadata, remove the warning-only log

### Decision 8: Retry Strategy
**Choice:** Per-batch retries
- Each batch (e.g., Tasks 1-3) gets its own retry counter
- Default: 2 retries per batch
- Replace global `retries` counter with per-batch tracking in pipeline state
- Total pipeline retries bounded by `batch_count * per_batch_limit`

### Decision 9: Builder Validation
**Choice:** Run tests + check for changes
- `validateBuilder` runs `bun test` (or detected test runner) and checks exit code
- Also verifies `git diff` shows modifications (catches no-op runs)
- Fails validation if tests fail OR no files changed

---

## Direct Fixes

### Category A: Fail-Open → Fail-Closed

| Fix | File | Change |
|-----|------|--------|
| A1 | `src/pipeline/engine.ts` `validateArchitect` | Remove silent catch; error when PLAN.md missing |
| A2 | `src/pipeline/engine.ts` `validateBuilder` | Implement: run `bun test` + check `git diff` |
| A3 | `src/pipeline/engine.ts` `parseReviewVerdict` | Default to `REVISE` instead of `APPROVE` |
| A4 | `src/pipeline/engine.ts` `run()` | Reject empty stage arrays from router |
| A5 | `src/pipeline/engine.ts` | Add `validateScout`: check RESEARCH/ files exist |

### Category B: Blind Retry → Feedback Loop

| Fix | File | Change |
|-----|------|--------|
| B1 | `src/pipeline/engine.ts` | On REVISE: write `lastReviewOutput` to `.brain/REVIEW.md` |
| B2 | `src/pipeline/engine.ts` `buildStageTask` | Builder re-run prompt includes "Read .brain/REVIEW.md and fix all listed issues" |
| B3 | `src/pipeline/engine.ts` `buildStageTask` | REDESIGN: Architect re-run prompt includes review feedback |
| B4 | `src/agents/runner.ts` | Load `.brain/REVIEW.md` into system prompt context |

### Category C: Dead Code Removal

| Fix | File | Change |
|-----|------|--------|
| C1 | `src/agents/sandbox.ts` | Delete entire file (159 lines, unused Vercel microVM) |
| C2 | `src/agents/runner.ts` | Remove `syncedFiles` from `RunResult` type |
| C3 | `src/pipeline/state.ts` | Remove `updateStageStatus` function |
| C4 | `~/.codename-claude/identity/skills/research-scan.md` | Remove Perplexity MCP reference |
| C5 | `~/.codename-claude/identity/skills/review-loop.md` | Remove score-based routing logic |
| C6 | `src/pipeline/engine.ts` | Remove `patternsCompliance` warning log (keep field in schema) |

### Category D: Schema/Type Fixes

| Fix | File | Change |
|-----|------|--------|
| D1 | `src/pipeline/state.ts` | Add `'critical'` to severity enum in `REVIEW_JSON_SCHEMA` and `ReviewOutput` |
| D2 | `~/.codename-claude/agents/*.md` | Add `whenToUse` frontmatter field to all agent definitions |
| D3 | `~/.codename-claude/identity/skills/review-loop.md` | Document JSON schema fields so Reviewer knows its output format |
| D4 | `src/pipeline/engine.ts` + `src/agents/runner.ts` | Unify `RunnerResult`/`RunResult` into single type |

### Category E: Agent Tool Fixes

| Fix | File | Change |
|-----|------|--------|
| E1 | `~/.codename-claude/agents/scout.md` | Add `Bash` to tools list |
| E2 | `~/.codename-claude/agents/reviewer.md` | Add `Write` to tools list |
| E3 | `src/pipeline/engine.ts` `buildStageTask` | Add Scout branch with research-specific task framing |

### Category F: Pipeline Engine Fixes

| Fix | File | Change |
|-----|------|--------|
| F1 | `src/pipeline/orchestrator.ts` | Preserve stages after reviewer in batch expansion |
| F2 | `src/pipeline/engine.ts` | Add per-stage timeout via AbortController |
| F3 | `src/pipeline/engine.ts` | Add pipeline cancellation mechanism (AbortController) |
| F4 | `src/pipeline/engine.ts` | Fix pipeline state rebuild after REDESIGN re-expansion |
| F5 | `src/pipeline/engine.ts` | Per-batch retry counters replacing global counter |
| F6 | `src/pipeline/router.ts` | Replace LLM router with rule-based routing |

### Category G: Daemon Fixes

| Fix | File | Change |
|-----|------|--------|
| G1 | `src/heartbeat/queue.ts`, `src/state/budget.ts`, `src/state/projects.ts` | Add `proper-lockfile` around load-modify-save |
| G2 | `src/cli.ts` | Fix stale PID detection: attempt IPC handshake |
| G3 | `src/daemon.ts` | Add log rotation (rotating-file-stream or similar) |
| G4 | `src/heartbeat/loop.ts` | Run initial tick on start (not just after 60s) |
| G5 | `src/daemon.ts` | Graceful in-flight agent handling on shutdown |
| G6 | `src/triggers/cron.ts` | Persist `lastFiredAt` across daemon restarts |
| G7 | `src/agents/runner.ts` | Return real turn count in `RunResult` for budget tracking |
| G8 | `src/heartbeat/loop.ts` | Use real turn counts instead of flat estimates |

### Category H: Prompt/Skill Fixes

| Fix | File | Change |
|-----|------|--------|
| H1 | `~/.codename-claude/identity/skills/plan-feature-team.md` | Update to require literal code in PLAN-PART files |
| H2 | `~/.codename-claude/identity/skills/execute-plan.md` | Defensively handle both literal and descriptive formats |
| H3 | `~/.codename-claude/agents/architect.md` | Remove "request Scout" reference (replaced by router) |
| H4 | `~/.codename-claude/agents/reviewer.md` | Remove "escalate to Scout" reference |
| H5 | `~/.codename-claude/identity/skills/research-scan.md` | Remove step 5 DECISIONS.md contradiction |
| H6 | `~/.codename-claude/identity/skills/plan-feature-team.md` | Fix team signal protocol (clarify TaskUpdate vs teammate-idle) |
| H7 | `~/.codename-claude/identity/skills/review-loop.md` | Remove score-based routing, align with engine's verdict-only logic |

---

## Implementation Priority

**Phase 1 — Critical Safety (Fail-Closed + Feedback Loop):**
A1-A5, B1-B4

**Phase 2 — Dead Code + Schema Cleanup:**
C1-C6, D1-D4

**Phase 3 — Agent/Tool Fixes:**
E1-E3, H1-H7

**Phase 4 — Engine Improvements:**
F1-F6 (batch fix, timeouts, cancellation, per-batch retries, rule-based router)

**Phase 5 — Daemon Hardening:**
G1-G8 (file locking, PID fix, log rotation, graceful shutdown, real budget)

---

## Out of Scope (Deferred)

- SQLite migration (file locking is sufficient for now)
- Webhook provider extensibility (GitHub-only is fine for MVP)
- Config hot-reload (restart is acceptable)
- Multiple daemon instance prevention (low priority)
- Queue size limits / deduplication (low priority)
- Progress reporting / metrics infrastructure (nice to have)
- Conditional rule injection per agent (minor token waste)
