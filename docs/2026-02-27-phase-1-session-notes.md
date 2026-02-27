# Phase 1 Session Notes

**Date:** 2026-02-27
**Phase:** 1 — The Foundation
**Status:** Complete

---

## What Worked

### Agent SDK `query()` is the right abstraction
The Agent SDK's `query()` function handled everything we needed: custom system prompts, model selection, tool restriction, permission bypassing, and streaming output. The layered system prompt approach (identity + rules + skills + role + .brain/ context) works well — agents follow their skills without additional prompting.

### .brain/ context preservation is solid
Scout Run 1 produced research. Scout Run 2 read the previous session's output, identified a gap (Stricli was cited but never evaluated), filled it, and logged the oversight to MISTAKES.md. The second session was meaningfully different from the first — it built on prior work instead of repeating it.

### Builder followed the full protocol autonomously
Builder read the research report, picked Commander.js (per recommendation), scaffolded a complete CLI project with tests (3/3 passing), committed code, and ran session-handoff — all without human intervention. It even split logic into `greet.ts` (pure function) and `index.ts` (CLI adapter) and documented the pattern.

### YAML frontmatter agent definitions are flexible
Defining agents as markdown files with YAML frontmatter (name, model, sandboxed, tools, skills) works well. The runner parses them and maps to Agent SDK options cleanly. Adding a new agent is just creating a markdown file — no TypeScript changes needed.

---

## What Didn't Work

### Vercel Sandbox microVMs can't run `query()` directly
**Problem:** The plan assumed we'd create Vercel Sandbox microVMs and run `query()` inside them with `cwd` set to the sandbox workspace path. But `query()` spawns a Claude Code child process on the **host** machine — it can't target a remote sandbox path.

**Resolution:** Used the Agent SDK's built-in `sandbox` option instead (`sandbox: { enabled: true }`). This uses macOS Seatbelt to sandbox Bash commands locally. The Vercel Sandbox wrapper (`sandbox.ts`) was kept for potential future cloud VM use.

**Impact on future phases:** Phase 3 (Agent Teams) describes per-cycle fresh sandboxes for Builder/Reviewer. The SDK's built-in sandbox is simpler but provides less isolation than Vercel microVMs. If stronger isolation is needed later, we may need to explore the SDK's `spawnClaudeCodeProcess` option to run agents inside Vercel Sandbox VMs.

### `CLAUDECODE` env var blocks nested sessions
**Problem:** Running `test-run.ts` from within a Claude Code session fails because the `CLAUDECODE` environment variable is set, and the SDK refuses to nest.

**Resolution:** Clear `CLAUDECODE` from the env passed to `query()`:
```typescript
const env = { ...process.env };
delete env['CLAUDECODE'];
```

**Impact on future phases:** The daemon (`daemon.ts`) will run standalone (not inside Claude Code), so this won't be an issue in production. But during development/testing, always clear this env var.

### OIDC token confusion
**Problem:** `vercel link` was done but `VERCEL_OIDC_TOKEN` in `.env` was set to a Vercel access token (`vck_` prefix) instead of an OIDC JWT. The Sandbox SDK rejected it.

**Resolution:** User ran `vercel env pull` to get the real OIDC token and put it in `.env` directly (not `.env.local`).

**Impact on future phases:** When deploying the daemon, use `VERCEL_TOKEN` (access token) for non-Vercel environments, or ensure OIDC tokens are refreshed (they expire after 12 hours in dev).

### Sandbox blocks some npm operations
**Problem:** Builder running inside the SDK sandbox couldn't install `@commander-js/extra-typings` (403 on scoped packages) and `tsx` failed with EPERM (named-pipe IPC blocked).

**Resolution:** Builder adapted — dropped the scoped package (Commander's built-in types sufficed) and used `tsc && node dist/` instead of `tsx` for smoke testing.

**Impact on future phases:** Sandboxed agents may hit friction with network-dependent operations or IPC-heavy tools. Consider using `sandbox.excludedCommands` or `sandbox.allowUnsandboxedCommands` for specific trusted operations (like `npm install`).

---

## Key Architecture Decisions

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Agent definitions format | Markdown + YAML frontmatter | TypeScript objects / JSON | Human-readable, no compile step, easy to edit |
| Sandbox approach | Agent SDK built-in sandbox | Vercel Sandbox microVMs | SDK sandbox works out of the box; Vercel VMs can't run `query()` directly |
| System prompt layering | Identity → Rules → Skills → Role → .brain/ | Single monolithic prompt | Composable, each layer has a clear purpose, easy to modify independently |
| Model mapping | Frontmatter `model` field → SDK model name | Hardcoded per agent | Flexible, can change models without touching runner code |
| Environment isolation | `~/.codename-claude/` separate from `~/.claude/` | Shared config | Zero risk of interfering with normal Claude Code usage |

---

## File Inventory

### Project (`~/Projects/codename-claude/`)
```
src/
├── daemon.ts              — Entry point (placeholder for Phase 2)
├── test-run.ts            — Manual agent test harness
├── agents/
│   ├── runner.ts          — Core agent runner (reads definitions, builds prompts, calls SDK)
│   └── sandbox.ts         — Vercel Sandbox wrapper (available, not used for agents yet)
├── heartbeat/             — Empty (Phase 2)
├── triggers/              — Empty (Phase 2)
├── hooks/                 — Empty (Phase 2)
├── state/                 — Empty (Phase 2)
└── utils/                 — Empty
```

### Config (`~/.codename-claude/`)
```
config.json                — Projects, triggers, budget config
identity/
├── system-prompt.md       — Core identity and protocols
├── rules/                 — 3 files: coding-standards, git-protocol, quality-gates
└── skills/                — 8 files: session-handoff, learning-loop, review-loop,
                             research-scan, plan-feature, review-code, init-project, prune-memory
agents/                    — 7 files: scout, architect, builder, reviewer,
                             team-lead, memory-janitor, initializer
templates/brain/           — 9 files: the .brain/ template for new projects
state/                     — Empty (Phase 2)
```

---

## Gotchas for Phase 2

1. **Always clear `CLAUDECODE` env var** when spawning agents via `query()` during development
2. **Sandbox network restrictions** may block npm installs — consider `excludedCommands: ['npm', 'npx']` or `allowUnsandboxedCommands: true` for Builder
3. **OIDC tokens expire after 12 hours** in dev — the daemon will need token refresh logic or use access tokens instead
4. **The `yaml` package** was added as a dependency for frontmatter parsing — it's lightweight (single dep)
5. **Agent SDK's `stderr` callback** is essential for debugging — always include it when spawning agents
6. **tsconfig needed fixes**: added `"types": ["node"]`, removed `exactOptionalPropertyTypes` (too strict for this project), `noUncheckedIndexedAccess` requires explicit handling of array index access
