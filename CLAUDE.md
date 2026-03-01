# Codename Claude

Autonomous PM + Developer agent daemon with a multi-stage pipeline (Scout → Architect → Builder → Reviewer).

## Commands

```bash
# Tests — ALWAYS use vitest, NEVER use `bun test` directly
bun run test              # run full test suite (vitest run)
npx vitest run            # equivalent
npx vitest run src/pipeline/  # run tests for a specific directory
npx vitest run -t "test name" # run a specific test by name

# Build
bun run build             # tsc → dist/

# Dev
bun run dev               # run daemon via tsx

# Type checking
npx tsc --noEmit          # check types without emitting
```

## Important: `bun test` vs `bun run test`

- `bun test` uses bun's **built-in** test runner — it is missing `vi.useFakeTimers()`, `vi.setSystemTime()`, and other vitest-specific APIs. **Do not use it.**
- `bun run test` invokes the `test` script from package.json which runs `vitest run` — the correct runner. **Always use this.**

## Project Structure

```
src/
├── agents/runner.ts        # Spawns Claude SDK sessions for each agent role
├── pipeline/
│   ├── engine.ts           # Core pipeline orchestrator (stage loop, validation, retries)
│   ├── router.ts           # Routes tasks to agent stages
│   ├── orchestrator.ts     # Batch expansion (PLAN.md tasks → builder/reviewer pairs)
│   └── state.ts            # Pipeline state types + persistence
├── heartbeat/
│   ├── loop.ts             # Heartbeat tick loop (triggers, queue, budget)
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
