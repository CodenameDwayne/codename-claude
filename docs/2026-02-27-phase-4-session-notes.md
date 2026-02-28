# Phase 4 Session Notes

**Date:** 2026-02-27
**Phase:** 4 — Expand Triggers & CLI
**Status:** Complete
**Branch:** `feature/phase-4-cli-triggers` (worktree at `.worktrees/phase-4-cli`)
**Tests:** 100 passing across 11 suites (up from 86 in Phase 3)

---

## What Worked

### Unix socket IPC was the right choice for daemon <-> CLI communication
The IPC layer (`src/ipc/`) uses newline-delimited JSON over a Unix domain socket at `~/.codename-claude/daemon.sock`. This gives:
- No network exposure (local-only, filesystem permissions)
- Lower latency than TCP loopback
- Clean connection detection — `ECONNREFUSED` / `ENOENT` immediately tells the CLI the daemon isn't running
- Simple protocol — one JSON line per message, no framing complexity

### PID file + socket combo is reliable for lifecycle management
`cc start` spawns the daemon as a detached child process (`spawn` with `detached: true`, `child.unref()`). The daemon writes its PID to `~/.codename-claude/daemon.pid` on startup, and `cc status` uses `process.kill(pid, 0)` to verify the process is alive without sending a signal. `cc stop` sends a `shutdown` IPC command and polls for PID file removal.

### Chokidar file watcher with debounce works well for BACKLOG.md changes
The `FileWatcher` class watches `.brain/BACKLOG.md` in all registered projects with per-project debounce. Key design: the debounce timer is per-project (stored in a `Map<string, Timeout>`), so rapid edits to one project don't suppress triggers for another project. The 5-second default debounce prevents multiple fires from editor save operations.

### Existing architecture extended cleanly again
The daemon's `WorkQueue` serves as the universal integration point. Webhook triggers, file watcher triggers, and CLI `cc run` commands all enqueue work items. The heartbeat loop processes them uniformly through budget checks and concurrency control. No special paths for any trigger type.

### vitest.config.ts prevented test duplication
After `tsc` build created `dist/` with compiled test files, vitest started running both `src/` and `dist/` copies. Adding `vitest.config.ts` with `include: ['src/**/*.test.ts']` fixed this permanently. Also added `exclude` entries to `tsconfig.json` to keep test files out of production builds.

### IPC tests are fast and deterministic
The IPC test suite creates a temp directory per test, spins up a real Unix socket server, and tests actual client-server communication. All 9 tests run in ~25ms because Unix sockets are local. No mocks needed — the real transport is tested.

---

## What Didn't Work

### `tsc` build output polluted test discovery
**Problem:** After running `npx tsc` for the first time, `dist/` contained compiled `.test.js` files. Vitest (with no config) discovered both `src/*.test.ts` and `dist/*.test.js`, doubling the test count and causing race conditions on shared temp files. Two tests failed with `Cannot read properties of null` because the `dist/` copies ran against stale queue state from `src/` copies.

**Resolution:** Created `vitest.config.ts` to restrict test discovery to `src/`:
```typescript
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```
Also added `"exclude": ["src/**/*.test.ts", "vitest.config.ts"]` to `tsconfig.json`.

**Impact on future phases:** Always run `npm test` after `npx tsc` to catch this. The vitest config is now permanent, so this shouldn't recur. But if new config files are added at root level, ensure they're excluded from `tsconfig.json`.

### vitest.config.ts itself got compiled to root
**Problem:** `tsc` tried to compile `vitest.config.ts` (at project root) and emitted `vitest.config.js`, `.d.ts`, and `.d.ts.map` at root (not in `dist/`, because the file is outside `src/` / `rootDir`). This caused a `TS6059` error about the file not being under `rootDir`.

**Resolution:** Added `"vitest.config.ts"` to the `exclude` array in `tsconfig.json`.

**Impact on future phases:** Any new root-level config files (e.g., `playwright.config.ts`, `drizzle.config.ts`) must be added to `tsconfig.json`'s `exclude` array.

### Security hook flagged shell command in CLI
**Problem:** The initial CLI implementation used shell commands to copy the `.brain/` template directory. The project's security hook correctly warned about command injection risks.

**Resolution:** Replaced with Node's native `cp()` from `node:fs/promises` with `{ recursive: true }`. No shell involved.

**Impact on future phases:** Prefer Node.js `fs` APIs over shell commands. If you must shell out, use `execFile` or `spawn` with explicit argument arrays, never template strings.

### `loadConfig` was silently dropping `webhook` field
**Problem:** The daemon's `loadConfig()` function had a bug carried over from Phase 2/3 — it destructured the parsed config but didn't include the `webhook` field in the returned object. The webhook server would never start because `config.webhook` was always `undefined`.

**Resolution:** Added `webhook: parsed.webhook` to the return object in `loadConfig()`.

**Impact on future phases:** When adding new top-level config fields, remember to pass them through in `loadConfig()`. Consider adding a config validation step that warns about unknown fields.

---

## Key Architecture Decisions

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| CLI <-> daemon transport | Unix domain socket | TCP, named pipe, command file | Local-only, fast, OS-level permissions, clean error detection |
| IPC protocol | Newline-delimited JSON | HTTP, gRPC, msgpack | Simplest reliable framing; no additional dependencies |
| CLI run commands | Enqueue to work queue | Directly spawn agent | Respects budget checks, concurrency lock, and queue ordering |
| Daemonization | `spawn` with `detached: true` | `pm2`, `systemd`, `launchd` | Zero external dependencies; the daemon is just a Node.js process |
| File watcher library | chokidar | `fs.watch`, `watchman`, `inotify` | Cross-platform, handles editor temp files, built-in stabilityThreshold |
| Debounce scope | Per-project | Global | Edits to project A shouldn't suppress triggers for project B |
| Template copy on project add | `fs.cp()` recursive | Shell cp, tar | No shell injection risk; built into Node.js |
| Log tailing | `tail -f` via spawn | Custom fs.watch + readline | Standard tool, handles log rotation, no reinvention |

---

## File Inventory

### New in Phase 4
```
src/
├── cli.ts                      — CLI binary with 10+ subcommands (start, stop, status, run, etc.)
├── ipc/
│   ├── protocol.ts             — Shared IPC types, socket/PID/log file paths
│   ├── server.ts               — Unix socket server (embeds in daemon)
│   ├── client.ts               — Unix socket client (used by CLI)
│   └── ipc.test.ts             — 9 tests: send/receive, errors, invalid JSON, cleanup
├── triggers/
│   ├── watcher.ts              — chokidar-based BACKLOG.md watcher with per-project debounce
│   └── watcher.test.ts         — 5 tests: trigger, debounce, multi-project, stop/cleanup
vitest.config.ts                — Restricts test discovery to src/ only
```

### Modified in Phase 4
```
src/
├── daemon.ts                   — Added: IPC server, PID file, file watcher, project registration
│                                 via IPC, queue-list command, shutdown via IPC, loadConfig webhook fix
package.json                    — Added: bin entry for cc, chokidar dependency
tsconfig.json                   — Added: exclude for test files and vitest.config.ts
```

### External Changes
```
~/.codename-claude/
├── config.json                 — Added weekly-prune trigger (0 2 * * 0, memory-janitor agent)
```

---

## Gotchas for Phase 5

1. **`loadConfig()` must explicitly pass through all config fields** — it destructures and rebuilds the config object. New fields will be silently dropped unless added to the return statement.
2. **vitest.config.ts must be in tsconfig exclude** — otherwise `tsc` tries to compile it and errors because it's outside `rootDir`.
3. **Test files must be in tsconfig exclude** — otherwise `tsc` puts `.test.js` files in `dist/` which doubles test runs.
4. **Unix socket cleanup** — the IPC server deletes the socket file on stop. If the daemon crashes without cleanup, the stale socket file prevents restart. The server already handles this (removes existing socket on start), but be aware of it.
5. **PID file can go stale** — if the daemon is killed with SIGKILL (not SIGTERM/SIGINT), the PID file won't be cleaned up. `isDaemonRunning()` handles this correctly by checking `process.kill(pid, 0)`, but the file will persist.
6. **`cc start` uses a 1.5s sleep** to wait for daemon startup — if the system is slow, this may not be enough. Consider polling the PID file instead.
7. **File watcher has timing-based tests** — 5 watcher tests use real timers and `setTimeout` for debounce verification. They add ~8 seconds to the test suite. If test speed becomes an issue, consider extracting the debounce logic into a pure-function unit test.
8. **All Phase 3 gotchas still apply** — especially: hook callbacks must use `HookInput` union type, `ExitReason` valid values, webhook handler is fire-and-forget, Agent Teams is experimental.
9. **`cc interactive` spawns raw `claude` process** — it looks for `claude` in PATH. If claude isn't installed globally, this will fail. Could be improved to use `findClaudeExecutable()` from `runner.ts`.
10. **The daemon log file grows unbounded** — `cc logs` tails `~/.codename-claude/daemon.log` but nothing rotates it. Phase 5 or later should add log rotation or size-based truncation.
