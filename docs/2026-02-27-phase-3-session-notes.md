# Phase 3 Session Notes

**Date:** 2026-02-27
**Phase:** 3 — Agent Teams
**Status:** Complete
**Branch:** `feature/phase-3-agent-teams` (worktree at `.worktrees/phase-3-agent-teams`)
**Tests:** 86 passing across 9 suites (up from 55 in Phase 2)

---

## What Worked

### Research-first approach for Agent Teams SDK compatibility
Running Task 3.1 (research) before building anything saved significant rework. Key findings:
- Agent Teams is enabled via env var only (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) — no SDK option exists
- The Team Lead spawns teammates via the existing `Task` tool with a `team_name` parameter — no special programmatic API needed
- The SDK already exports `TeammateIdle` and `TaskCompleted` hook event types in TypeScript
- No automatic crash recovery — if a teammate dies, the lead is notified but must manually respawn

This meant the runner changes were clean: pass the env var, inject teammate context, adjust timeouts. No new SDK patterns needed.

### Parallel task execution via batch structure
Tasks 1 (research) and 4 (webhook trigger) had no dependency, so they ran in parallel in Batch 1. Tasks 2 (Team Lead definition) and 3 (runner update) also ran together in Batch 2. This cut effective wall-clock time significantly.

### Existing architecture extended cleanly for team mode
The Phase 2 `HeartbeatDeps` dependency injection pattern made adding `mode` a single-line signature change plus straightforward plumbing. No refactoring was needed — the heartbeat loop, queue, trigger config, and runner all accepted the new parameter without structural changes.

### Integration tests caught real wiring issues
The integration test suite (`src/integration.test.ts`) validates the full pipeline: webhook → queue → heartbeat → runner. One test specifically verifies that `mode: 'team'` survives a round-trip through the queue (enqueue when budget low → dequeue later). This caught a real gap — mode wasn't being passed from the heartbeat to the runner at all until this test forced it.

### Webhook signature verification with timing-safe comparison
Using `crypto.timingSafeEqual()` for GitHub webhook signature verification prevents timing attacks. The `verifyGitHubSignature()` function handles all edge cases: missing header, wrong algorithm prefix, tampered payload, length mismatch.

---

## What Didn't Work

### SDK hook types require generic `HookInput`, not specific subtypes
**Problem:** Phase 2 typed hook callbacks with specific input types (e.g., `PostToolUseHookInput`). This compiled in Phase 2 because the hooks were only assigned locally. In Phase 3, when assembling all 4 hook types into a single `Partial<Record<HookEvent, HookCallbackMatcher[]>>` object, TypeScript correctly flagged that `(input: PostToolUseHookInput) => ...` is not assignable to `HookCallback` which expects `(input: HookInput) => ...`.

**Resolution:** Rewrote all hook factories to accept the generic `HookInput` union type and guard on `input.hook_event_name` before narrowing:
```typescript
export function createPostToolUseHook(logger: HookLogger): HookCallback {
  return async (input: HookInput) => {
    if (input.hook_event_name !== 'PostToolUse') return { continue: true };
    const ptInput = input as PostToolUseHookInput;
    // ... use ptInput safely
  };
}
```

**Impact on future phases:** All new hooks must follow this pattern: accept `HookInput`, guard on `hook_event_name`, then cast. Never type a hook callback parameter more narrowly than `HookInput`.

### `ExitReason` enum doesn't include `'end_turn'`
**Problem:** Phase 2 tests used `reason: 'end_turn'` in SessionEnd hook test inputs. TypeScript was not catching this because the old hook types were narrow (pre-rewrite). After switching to generic `HookInput`, TS correctly flagged `'end_turn'` as not assignable to `ExitReason`.

**Resolution:** Changed to `'other'` which is a valid `ExitReason`. The actual values are: `'clear' | 'logout' | 'prompt_input_exit' | 'other' | 'bypass_permissions_disabled'`.

**Impact on future phases:** If testing session end behavior, use `'other'` as the default reason. Check the SDK types before assuming reason values.

### Hook options use `{ signal }` not `{ abortSignal }`
**Problem:** Phase 2 test helpers passed `{ abortSignal: new AbortController().signal }`. The SDK's actual `HookCallback` third parameter is `{ signal: AbortSignal }`.

**Resolution:** Updated all test helpers to use `{ signal }`.

**Impact on future phases:** The SDK's hook callback signature is `(input: HookInput, toolUseID: string | undefined, options: { signal: AbortSignal }) => Promise<HookJSONOutput>`.

### Webhook handler is fire-and-forget — async operations race with assertions
**Problem:** `WebhookHandler` type is `(result: WebhookTriggerResult) => void` (synchronous). The integration test's handler called `await queue.enqueue()` inside it, but the server calls `this.handler(result)` without awaiting. The HTTP response returned before the enqueue completed, causing `queue.size()` to be 0 in the assertion.

**Resolution:** Used a Promise-based synchronization pattern in the test:
```typescript
let enqueueResolve: () => void;
const enqueuePromise = new Promise<void>((resolve) => { enqueueResolve = resolve; });

// In handler: queue.enqueue(...).then(() => enqueueResolve());
// In test: await enqueuePromise; // before asserting queue state
```

**Impact on future phases:** The WebhookServer handler is intentionally fire-and-forget so the HTTP response isn't blocked by downstream processing. Any async work in webhook handlers must be treated as background work. If the daemon needs to confirm enqueue success, consider making the handler return a Promise and awaiting it in the server.

### Initially defined custom types for SDK-provided hooks
**Problem:** Wrote custom `TeammateIdleHookInput` and `TaskCompletedHookInput` interfaces before checking the SDK. The SDK already exports these types.

**Resolution:** Removed custom types, imported from `@anthropic-ai/claude-agent-sdk`.

**Impact on future phases:** Always check `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` for exported types before defining custom ones. The SDK types file is the source of truth — run `grep 'export declare type' sdk.d.ts | head -50` to survey available types.

---

## Key Architecture Decisions

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Team mode activation | Env var `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | Dedicated SDK option | Only option — SDK has no `agentTeams` parameter |
| Team prompt estimate | 50 prompts per team session | Track actual usage from SDK | SDK doesn't report per-session token counts; 50 is conservative (5 agents × 10 each) |
| Teammate context injection | Full agent definitions appended to Team Lead's system prompt | Separate context files / reference by name | Team Lead needs to know each agent's tools, skills, and personality to give good spawn prompts |
| Webhook → queue (not direct run) | Webhook enqueues to work queue, heartbeat processes | Webhook directly spawns agent | Consistent flow through budget check + concurrency lock; no bypass of daemon controls |
| maxTurns | 200 for team, 50 for standalone | Single value / configurable per trigger | Team sessions involve multiple agents and review cycles; standalone is single-agent |
| Hook event handling | Generic `HookInput` with `hook_event_name` guard | Per-event-type callback registration | SDK requires `HookCallback` signature; guard pattern is the only type-safe approach |
| Webhook signature | HMAC-SHA256 with `timingSafeEqual` | Simple string comparison | Prevents timing attacks; matches GitHub's recommended verification |

---

## File Inventory

### New in Phase 3
```
src/
├── triggers/
│   ├── webhook.ts           — HTTP server for GitHub webhooks, signature verification, event routing
│   └── webhook.test.ts      — 18 tests: signatures, event matching, server lifecycle, HTTP handling
├── integration.test.ts      — 5 tests: webhook→queue→heartbeat→runner pipeline, mode preservation
```

### Modified in Phase 3
```
src/
├── daemon.ts                — Added WebhookServer startup/shutdown, TeammateIdle/TaskCompleted hooks,
│                              async shutdown, webhook config in DaemonConfig, mode passthrough
├── agents/runner.ts         — Added team mode: env var, teammate context injection, maxTurns,
│                              readTeammateDefinitions(), mode in RunResult/RunOptions
├── heartbeat/loop.ts        — runAgent signature now includes mode, executeAgent passes mode,
│                              team prompt estimate (50 vs 10), mode in log messages
├── heartbeat/loop.test.ts   — Updated mocks to include mode in RunResult
├── hooks/hooks.ts           — Rewritten: generic HookCallback with event guards, added
│                              createTeammateIdleHook, createTaskCompletedHook factories
├── hooks/hooks.test.ts      — Rewritten: 13 tests using HookInput casts, fixed ExitReason/signal
├── test-run.ts              — Added --team flag, wires all 4 hook types
```

### External Changes
```
~/.codename-claude/
├── agents/team-lead.md      — Expanded: teammate descriptions, orchestration protocol,
│                              review loop scoring, complexity assessment, spawn examples
├── config.json              — Added webhook config (port 3000, GitHub events)
├── RESEARCH-agent-teams.md  — Agent Teams SDK research findings

~/Projects/cc-test/.brain/
└── BACKLOG.md               — Added "greeting command" feature for pipeline testing
```

---

## Gotchas for Phase 4

1. **Hook callbacks must use `HookInput` union type** — guard with `input.hook_event_name`, then cast to specific type. Never use specific input types in the callback signature.
2. **`ExitReason` valid values** — `'clear' | 'logout' | 'prompt_input_exit' | 'other' | 'bypass_permissions_disabled'`. Not `'end_turn'`.
3. **SDK hook options** — third parameter is `{ signal: AbortSignal }`, not `{ abortSignal }`.
4. **WebhookServer handler is fire-and-forget** — `WebhookHandler` returns `void`. Async operations inside handlers race with HTTP responses. Use promise synchronization in tests.
5. **Agent Teams is experimental** — gated behind env var. If the feature graduates to stable, the activation mechanism may change. Check SDK changelog.
6. **Team sessions are expensive** — 200 maxTurns, 50 prompt estimate. The budget tracker reserves 30% for interactive use, so a team session takes ~12% of the available budget.
7. **No crash recovery for teammates** — if a teammate crashes, the Team Lead is notified but must manually respawn. Consider adding a `TeammateIdle` hook that detects prolonged idle (crash indicator) and logs a warning.
8. **Webhook `port: 0`** — in tests, port 0 asks the OS for a random available port. In production (`config.json`), use an explicit port (3000). Access the actual port via `server.address().port` after `.listen()`.
9. **All Phase 2 gotchas still apply** — especially: `cron-parser` v5 API, background process PATH pollution, unique test state directories, SDK stderr noise.
10. **The integration test suite uses real timers for the webhook test** — it calls `vi.useRealTimers()` locally because the HTTP server needs real I/O. Other tests in the same file use fake timers. Don't mix — each test manages its own timer mode.
