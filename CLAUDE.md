# Codename Claude

Autonomous PM + Developer agent daemon with a multi-stage pipeline (Scout → Architect → Builder → Reviewer).

## Commands

```bash
# Tests — ALWAYS use vitest, NEVER `bun test`
npx vitest run                    # full test suite
npx vitest run src/pipeline/      # tests for a specific directory
npx vitest run -t "test name"     # run a specific test by name

# Build
npx tsc                           # tsc → dist/
npx tsc --noEmit                  # type check only

# Dev
bun run dev                       # run daemon via tsx
```

## WARNING: Never use `bun test`

`bun test` invokes bun's built-in test runner, NOT vitest. It is missing `vi.useFakeTimers()`, `vi.setSystemTime()`, and other vitest APIs. Tests will appear to fail when they actually pass under vitest. Always use `npx vitest run`.

## Project Structure

```
src/
├── agents/runner.ts        # Spawns Claude SDK sessions for each agent role
├── pipeline/
│   ├── engine.ts           # Two-phase pipeline: pre-loop agents + Ralph loop (one task per session)
│   ├── router.ts           # Routes tasks to agent stages
│   ├── orchestrator.ts     # Checkbox parsing (parseCheckboxTasks, markTaskComplete, findNextTask)
│   └── state.ts            # Pipeline state types (TaskProgress) + persistence
├── heartbeat/
│   ├── loop.ts             # Heartbeat tick loop (triggers, queue, budget, stall detection)
│   └── queue.ts            # File-backed work queue
├── state/
│   ├── budget.ts           # Rolling window budget tracking
│   └── projects.ts         # Project registry
├── triggers/               # Cron, webhook, file watcher triggers
├── hooks/                  # SDK hooks (PostToolUse, SessionEnd, etc.)
├── ipc/                    # Unix socket IPC (daemon ↔ CLI)
├── daemon.ts               # Main daemon process
└── cli.ts                  # CLI interface
```

## Agent Definitions

Located at `~/.codename-claude/agents/*.md` — YAML frontmatter + markdown system prompt.

## Conventions

- **TypeScript** with strict mode, ES2022 target, NodeNext modules
- **Vitest** for testing (v4.x) — use `describe`/`it`/`expect`/`vi` from vitest
- **Bun** as package manager and runtime — use `bun add`, never `npm install`
- **Security:** Use `execFileSync`/`execFile` from `node:child_process`, never `exec`/`execSync` with shell strings
- **File state:** JSON files in `~/.codename-claude/state/` — always use load-modify-save pattern
- **Agent handoffs:** Via `.brain/` directory (PLAN.md, REVIEW.md, DECISIONS.md, RESEARCH/)
