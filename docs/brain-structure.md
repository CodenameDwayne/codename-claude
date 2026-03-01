# .brain/ Directory Structure

**Date:** 2026-02-28 (updated)
**Source:** Analysis of `src/pipeline/engine.ts`, `src/pipeline/state.ts`, `src/agents/runner.ts`, `src/daemon.ts`, `src/heartbeat/loop.ts`

---

## Overview

The `.brain/` directory is a shared-memory protocol between agents in the pipeline. Each agent reads from and writes to `.brain/` in a defined sequence, creating a structured handoff chain. This is a **blackboard architecture** — the filesystem is the inter-agent communication bus, and `.brain/` is the structured mailbox.

The engine manages ephemeral pipeline state via `pipeline-state.json`. Agent-written files are persistent project knowledge.

```
.brain/
├── PROJECT.md              — What this project is about (bootstrapped by engine on first run)
├── BACKLOG.md              — Task backlog (watched by file watcher)
├── DECISIONS.md            — Architectural decisions (Architect output)
├── PATTERNS.md             — Common patterns (validated by Reviewer via patternsCompliance)
├── MISTAKES.md             — Lessons learned (capped at 3000 chars in system prompt)
├── PLAN.md                 — Implementation plan (Architect output)
├── REVIEW.md               — Code review verdict (Reviewer fallback output)
├── pipeline-state.json     — Engine-managed pipeline state (ephemeral)
└── RESEARCH/
    └── *.md                — Research scan results (Scout output, read by Architect)
```

### Removed Files

| File | Reason |
|---|---|
| `ACTIVE.md` | Replaced by engine-managed `pipeline-state.json` |
| `SESSIONS/` | Replaced by SDK `getSessionMessages()` via session IDs in `pipeline-state.json` |

---

## File Categories

### Engine-Managed (ephemeral)

| File | Written By | Purpose |
|---|---|---|
| `pipeline-state.json` | `PipelineEngine` | Tracks pipeline progress: stages, status, session IDs, retries, timestamps. Read by heartbeat for stall detection and by runner for system prompt context. |

### Agent-Written (persistent project knowledge)

| File | Written By | Read By | Validated |
|---|---|---|---|
| `PROJECT.md` | Architect (or engine bootstrap) | `runner.ts` (system prompt), `daemon.ts` (router context) | Engine bootstraps from task if missing/empty |
| `PLAN.md` | Architect | Builder (`buildStageTask`), Reviewer (`buildStageTask`) | Engine checks exists + non-empty |
| `DECISIONS.md` | Architect | Builder (`buildStageTask`), `runner.ts` (system prompt) | No |
| `PATTERNS.md` | Architect, Builder | Reviewer, `runner.ts` (system prompt) | Reviewer reports `patternsCompliance` in structured output |
| `MISTAKES.md` | Builder | `runner.ts` (system prompt, capped at 3000 chars newest-first) | No |
| `BACKLOG.md` | User (manual) | `watcher.ts` (file watcher trigger) | No |
| `RESEARCH/` | Scout | Architect (`buildStageTask`), `runner.ts` (system prompt) | No |
| `REVIEW.md` | Reviewer (fallback) | Engine (verdict parsing, fallback path) | Engine validates verdict line regex |

### Review Verdict Path

The Reviewer produces its verdict via two paths:

1. **Primary: Structured output** — SDK `outputFormat` constrains the final message to a JSON schema (`ReviewOutput`). Engine reads `structuredOutput` directly from `RunnerResult`.
2. **Fallback: REVIEW.md** — If the reviewer hits max turns (last message is tool_use, no structured output), the engine falls back to parsing `REVIEW.md` for a `Verdict: APPROVE|REVISE|REDESIGN` line.

The engine tries structured output first. Both paths feed into the same retry logic (APPROVE/REVISE/REDESIGN routing).

---

## Data Flow

```
Scout                 Architect                 Builder                 Reviewer
  |                       |                         |                       |
  +--> RESEARCH/ -------->|                         |                       |
  |                       +--> PLAN.md ------------>|                       |
  |                       +--> DECISIONS.md ------->|                       |
  |                       +--> PATTERNS.md -------->|                       |
  |                       |                         +--> source code ------>|
  |                       |                         |                       |
  |                       |                         |                       +--> structured JSON
  |                       |                         |                       +--> REVIEW.md (fallback)
  |                       |                         |                       +--> Verdict → engine
```

### Engine State Machine

```
pipeline-state.json tracks:

  init → stage[0] running → stage[0] completed → stage[1] running → ...
                                                                      |
                            ← REVISE (restart from builder) ←---------+
                            ← REDESIGN (restart from architect) ←-----+
                            → APPROVE → pipeline completed            |
                            → max retries → pipeline failed            |
                                                                      |
  stall detected (>30min) → status: 'stalled' → recovery enqueued ----+
```

---

## Key Behaviors

### Pipeline State (`pipeline-state.json`)
- Written by the engine at every state transition (init, stage start, stage complete, retry, final)
- Read by heartbeat for stall detection (>30 min since last update)
- Read by runner for system prompt context (pipeline progress injected into agent prompts)
- Contains per-stage session IDs for SDK `getSessionMessages()` cross-session context

### PROJECT.md Bootstrap
- On first pipeline run, if `PROJECT.md` is missing or under 50 chars, the engine generates a scaffold from the task description
- Does not overwrite existing meaningful content

### MISTAKES.md Cap
- `runner.ts` caps MISTAKES.md at 3000 chars when loading into system prompt
- Keeps newest entries (reads from bottom up) since recent lessons are most relevant

### Patterns Compliance
- Reviewer's structured output includes `patternsCompliance: boolean`
- Engine logs a warning when `patternsCompliance === false`

### Stall Detection
- Heartbeat checks `pipeline-state.json` for all registered projects
- If a pipeline has been `running` with no update for >30 minutes, it's marked `stalled`
- A recovery task is enqueued for the current stage's agent

---

## Code References

| Component | File | What it does with `.brain/` |
|---|---|---|
| Pipeline state types | `src/pipeline/state.ts` | `PipelineState`, `StageState`, `ReviewOutput`, `REVIEW_JSON_SCHEMA` |
| Pipeline state read/write | `src/pipeline/state.ts` | `readPipelineState`, `writePipelineState`, `updateStageStatus` |
| Pipeline engine | `src/pipeline/engine.ts` | Writes `pipeline-state.json` at each transition, validates stages, bootstraps `PROJECT.md` |
| System prompt construction | `src/agents/runner.ts` | Loads `.brain/` files + `RESEARCH/` + pipeline state into agent system prompt |
| Structured output capture | `src/agents/runner.ts` | Passes `outputFormat` for reviewer, captures `structured_output` from SDK |
| Stall detection | `src/heartbeat/loop.ts` | Checks `pipeline-state.json` timestamps, enqueues recovery |
| Stall wiring | `src/daemon.ts` | Passes `projectPaths` to heartbeat |
| Role guard hook | `src/hooks/hooks.ts` | Blocks Architect/Scout from writing outside `.brain/` |
| Router context | `src/daemon.ts` | Reads `PROJECT.md` for LLM router |
| File watcher trigger | `src/triggers/watcher.ts` | Watches `BACKLOG.md` for changes |
