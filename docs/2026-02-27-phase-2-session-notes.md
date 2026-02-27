# Phase 2 Session Notes

**Date:** 2026-02-27
**Phase:** 2 — The Heartbeat
**Status:** Complete
**Branch:** `feature/phase-2-heartbeat` (worktree at `.worktrees/phase-2-heartbeat`)
**Tests:** 55 passing across 7 suites

---

## What Worked

### TDD with Vitest was fast and reliable
Writing tests first for every module caught real bugs before they reached integration. Vitest's `vi.useFakeTimers()` + `vi.setSystemTime()` combo was perfect for testing time-dependent logic (budget window expiry, cron schedules). Total test suite runs in ~250ms.

### Dependency injection made the heartbeat loop fully testable
The `HeartbeatDeps` interface accepts all external dependencies (triggers, queue, budget, runAgent, log) as constructor arguments. Tests use fake implementations — no mocking frameworks, no patching globals. This also made integration easy: the daemon wires real implementations in `main()`.

### Synchronous concurrency lock pattern
Setting `this.running = true` synchronously at the top of `tick()` (before any `await`) prevents race conditions when `setInterval` fires while an agent is running. The `try/finally` pattern ensures the lock is always released:
```typescript
async tick() {
  if (this.running) return { action: 'busy' };
  this.running = true;
  try { return await this.tickInner(); }
  finally { this.running = false; }
}
```
This was a real bug — the original version set the flag inside `executeAgent()` after an `await canRunAgent()` yield, allowing two ticks to race past the check.

### Agent SDK programmatic hooks
The SDK's `hooks` option in `query()` accepts callback functions directly — no need for external hook configs. Factory functions (`createPostToolUseHook`, `createSessionEndHook`) produce typed callbacks that the SDK invokes. Clean separation between hook logic and daemon wiring.

### Live Scout integration validated the full pipeline
The daemon successfully: started, ticked, detected a cron trigger as due, checked the budget, spawned Scout via the SDK, logged tool usage through hooks, wrote a 9KB research report to `.brain/RESEARCH/`, recorded budget usage, and returned to idle — all autonomously.

---

## What Didn't Work

### `cron-parser` v5 has a completely different API
**Problem:** The plan assumed `cron-parser`'s `parseExpression()` API. Version 5 removed this entirely and uses `CronExpressionParser.parse()` instead.

**Resolution:** Discovered by running `npx tsx -e` to inspect the module's exports. Updated all code to use the v5 API:
```typescript
import { CronExpressionParser } from 'cron-parser';
const expr = CronExpressionParser.parse(schedule);
```

**Impact on future phases:** If any other module depends on `cron-parser`, use the v5 API. The old examples in blogs/docs are all wrong.

### Background daemon `spawn node ENOENT` — three layers deep
**Problem:** When the daemon runs as a background process (`nohup npx tsx ... &`), the Agent SDK's `query()` fails with `spawn ENOENT` when trying to spawn the Claude Code child process.

**Root causes (all three had to be fixed):**

1. **`npx tsx` pollutes PATH with `node_modules/.bin`**, which contained a `cli.js` shim for claude (`#!/usr/bin/env node`). The `which claude` command inside the daemon found this shim instead of the native binary. Fixed by checking known native binary locations (`~/.local/bin/claude`) before consulting `which`.

2. **The native claude binary is a symlink** (`~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.62`). The SDK's internal `existsSync` check was failing on the symlink in background process context. Fixed by using `realpathSync()` to resolve to the actual Mach-O binary.

3. **Trigger configs use project names, not paths.** The trigger config says `"project": "cc-test"` (a name), but `runAgent()` expects a filesystem path for the SDK's `cwd` option. Node.js `spawn()` with a non-existent `cwd` emits ENOENT — but confusingly reports the **command** path in the error message, not the missing cwd. Fixed by adding `resolveProjectPath()` in `daemon.ts` that maps project names to paths via the config.

**Key debugging insight:** Node.js `child_process.spawn()` ENOENT errors are ambiguous. The error `spawn /path/to/binary ENOENT` can mean either: (a) the binary doesn't exist, OR (b) the `cwd` doesn't exist. Always check both.

**Resolution approach:** Created isolated test scripts (`test-sdk-bg.ts`, `test-runner-bg.ts`, etc.) that incrementally replicated the daemon's call stack in background process context. Each test narrowed the failure to a specific option difference.

**Impact on future phases:** The `findClaudeExecutable()` function in `runner.ts` handles this robustly now, but be aware:
- If claude is installed via npm globally, it may shadow the native binary in PATH
- Always resolve symlinks before passing to the SDK's `pathToClaudeCodeExecutable`
- The SDK has a `spawnClaudeCodeProcess` option for full spawn control if needed

### Parallel test suites share filesystem state
**Problem:** Budget and projects test suites both used `.test-state/` for persistence tests. Vitest runs suites in parallel. Budget's `afterEach` cleaned up the directory while projects tests were still writing to it.

**Resolution:** Give each suite its own subdirectory: `.test-state/budget/`, `.test-state/projects/`, etc.

**Impact on future phases:** Any new test suite that uses filesystem persistence must use a unique test state directory. Add the pattern to `.gitignore` (already done: `.test-state/`).

### Cron trigger timezone and boundary edge cases
**Problem:** Two test failures related to cron time logic:
1. A "not elapsed" test expected `isDue() === false` at 10:01:00 with lastFired at 10:00:30 — but `*/1 * * * *` HAS a boundary at 10:01:00, so isDue() was correctly returning true.
2. A "daily at 9am" test used UTC timestamps but cron evaluates in local timezone.

**Resolution:** Fixed test expectations to match actual cron semantics. Used `new Date().setHours(9,0,0,0)` for local time construction instead of manually computing UTC offsets.

**Impact on future phases:** Cron expressions always evaluate in the daemon's local timezone. If deploying to a server, set `TZ` env var explicitly. Tests that involve specific times should construct dates in local time, not UTC.

### SDK `stderr` callback dumps internal source on stream close
**Problem:** When the Scout agent session ends, the SDK's stderr stream sometimes dumps a chunk of minified SDK source code as an error. The "Stream closed" error appears to be a normal teardown artifact, not a real error.

**Resolution:** No code fix needed — the error doesn't affect functionality. The agent completes successfully before the stream close. Could add filtering in the stderr callback if the log noise becomes an issue.

---

## Key Architecture Decisions

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Budget tracking | Rolling 5-hour window with JSON persistence | Fixed daily window / SQLite | Simple, no external deps, survives daemon restarts |
| Concurrency control | Synchronous flag in tick() with try/finally | Mutex / semaphore / job queue | Simplest correct solution — one agent at a time is the design |
| Work queue | JSON file FIFO | Redis / SQLite / in-memory | Persistence across restarts, no external services |
| Claude binary resolution | Check native locations first, resolve symlinks | Use `which` / PATH lookup | Background daemons have polluted PATHs from npx/node_modules |
| Project name → path mapping | Config-driven lookup in daemon.ts | Project registry lookup | Trigger configs already reference projects by name; config has the path |
| Hook implementation | Factory functions returning typed callbacks | Class-based hooks / config files | Composable, testable, matches SDK's callback interface |
| Test isolation | Unique subdirectories per suite | In-memory state / test databases | Filesystem persistence is the production behavior; test it directly |

---

## File Inventory

### New/Modified in Phase 2
```
src/
├── daemon.ts              — Full entry point: config loading, heartbeat construction, graceful shutdown
├── daemon.test.ts         — 4 tests: config loading, trigger building
├── state/
│   ├── budget.ts          — Rolling window budget tracker with JSON persistence
│   ├── budget.test.ts     — 10 tests: usage recording, window expiry, reserve calculation
│   ├── projects.ts        — Project registry CRUD with name/path lookup
│   └── projects.test.ts   — 12 tests: register, list, get, unregister, lastSession
├── triggers/
│   ├── cron.ts            — Cron trigger with double-fire prevention (cron-parser v5)
│   └── cron.test.ts       — 7 tests: isDue, markFired, timezone, edge cases
├── heartbeat/
│   ├── loop.ts            — Heartbeat loop with synchronous concurrency lock
│   ├── loop.test.ts       — 8 tests: idle, trigger fire, budget queue, concurrency
│   ├── queue.ts           — Persistent FIFO work queue
│   └── queue.test.ts      — 9 tests: enqueue, dequeue, peek, persistence, ordering
├── hooks/
│   ├── hooks.ts           — PostToolUse and SessionEnd hook factories
│   └── hooks.test.ts      — 5 tests: hook invocation, logging, callbacks
└── agents/
    └── runner.ts          — Refactored: added pathToClaudeCodeExecutable, findClaudeExecutable(),
                             eliminated run mode duplication, added RunOptions with hooks support
```

### Dependencies Added
- `cron-parser` — cron expression parsing (v5 API: `CronExpressionParser.parse()`)
- `vitest` (dev) — test runner with fake timers, parallel suites

### Config Changes
- `~/.codename-claude/config.json` — production schedule restored: `0 9 * * *`, 60s heartbeat
- `package.json` — added `"test": "vitest run"` script

---

## Gotchas for Phase 3

1. **`cron-parser` v5 API** — use `CronExpressionParser.parse()`, not the old `parseExpression()`
2. **Background process PATH pollution** — `npx tsx` adds `node_modules/.bin` to PATH. The `findClaudeExecutable()` function in `runner.ts` handles this, but if you add new spawn logic, resolve symlinks with `realpathSync()`
3. **Node.js spawn ENOENT is ambiguous** — could be missing command OR missing cwd. Always check both when debugging
4. **Trigger project field is a name, not a path** — `daemon.ts` resolves names to paths via `resolveProjectPath()`. If adding new trigger types, use the same resolution
5. **Test suites need unique state directories** — use `.test-state/<suite-name>/` pattern to avoid parallel test conflicts
6. **SDK stderr dumps source on session end** — cosmetic noise, not a real error. Filter if log cleanliness matters
7. **Heartbeat concurrency** — must set `this.running = true` BEFORE any `await` in tick(). Moving it after an await creates a race window
8. **Budget is estimated at 10 prompts per session** — `DEFAULT_PROMPT_ESTIMATE = 10` in loop.ts. Real usage tracking (from SDK session metadata) would be more accurate but isn't available yet
9. **The daemon's `main()` is guarded by `!process.env['VITEST']`** — so importing `daemon.ts` in tests doesn't start the daemon. If you add new entry-point behavior, maintain this guard
10. **SDK `pathToClaudeCodeExecutable` expects the actual binary, not a symlink** — the runner resolves this automatically now
