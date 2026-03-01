# Codename Claude

An autonomous multi-agent daemon that plans, builds, reviews, and ships code using Claude. You describe what you want — it runs a pipeline of specialized AI agents to deliver working, tested software.

## How It Works

```
You: "Build a CLI bookmark manager in TypeScript"
                    │
            ┌───────▼───────┐
            │  LLM Router   │  Haiku picks the right agents
            │  (Claude)      │
            └───────┬───────┘
                    │
            ┌───────▼───────┐
            │   Architect   │  Plans, writes PLAN.md with
            │   (Opus)      │  ### Task 1: ... ### Task N: ...
            └───────┬───────┘
                    │
            ┌───────▼───────┐
            │  Orchestrator │  Parses tasks, groups into
            │               │  batches of 3
            └───────┬───────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   Tasks 1-3    Tasks 4-6    Task 7
   ┌────────┐   ┌────────┐   ┌────────┐
   │Builder  │   │Builder  │   │Builder  │
   │ ▼       │   │ ▼       │   │ ▼       │
   │Reviewer │   │Reviewer │   │Reviewer │
   └────────┘   └────────┘   └────────┘
        │           │           │
     APPROVE     APPROVE     APPROVE
        │           │           │
        └───────────┼───────────┘
                    ▼
              Code shipped.
```

The daemon runs in the background, consuming zero tokens when idle. When a task arrives — via CLI, cron schedule, GitHub webhook, or file change — it fires the pipeline and agents work autonomously.

## Quick Start

```bash
# Install dependencies
bun install

# Build
bun run build

# Start the daemon
codename start

# Register a project
codename projects add /path/to/your/project

# Run a pipeline
codename run pipeline my-project "Add user authentication with JWT"

# Watch it work
codename logs
```

## CLI Commands

```
codename start                           Start the daemon
codename stop                            Stop the daemon
codename status                          Show daemon status

codename projects list                   List registered projects
codename projects add <path> [name]      Register a project
codename projects remove <path|name>     Unregister a project

codename run pipeline <project> "task"   Run full pipeline (router picks agents)
codename run <agent> <project> [task]    Run a single agent
codename run team <project> "task"       Run pipeline with Agent Teams

codename logs                            Tail daemon logs
codename queue                           Show work queue
codename interactive <project>           Start interactive Claude session
```

## Architecture

### The Daemon

Always-on background process with a heartbeat that ticks every 60 seconds:

```
Daemon
├── IPC Server          Unix socket for CLI communication
├── Heartbeat Loop      Checks triggers, processes queue, detects stalls
├── Pipeline Engine     Orchestrates multi-agent workflows
├── Budget Manager      Rolling 5-hour token window
├── Triggers
│   ├── Cron            Scheduled tasks (daily scout, weekly prune)
│   ├── Webhook         GitHub events (issues.labeled, PR opened)
│   └── File Watcher    .brain/BACKLOG.md changes → Architect
└── Work Queue          FIFO, persisted to disk
```

When idle, it costs nothing. When a trigger fires and budget allows, it spawns agents.

### Agents

Each agent is a markdown file defining its role, model, tools, and skills:

| Agent | Model | Role |
|-------|-------|------|
| **Architect** | Opus | Plans features, writes specs to `.brain/PLAN.md` |
| **Builder** | Sonnet | Implements code following the plan step by step |
| **Reviewer** | Sonnet | Reviews code, runs tests, scores 1-10, routes verdict |
| **Scout** | Sonnet | Researches libraries, APIs, patterns |
| **Initializer** | Sonnet | Bootstraps new projects, writes `PROJECT.md` |
| **Memory Janitor** | Haiku | Prunes `.brain/` files weekly |
| **Team Lead** | Opus | Orchestrates Agent Teams for complex work |

Agents are sandboxed by role — Builder and Reviewer run in isolated VMs.

### Pipeline Patterns

The LLM router selects one of two patterns:

**Simple** (spec already exists):
```
Builder → Reviewer
```

**Complex** (needs planning):
```
Architect → Orchestrator → Builder(batch 1) → Reviewer(batch 1) → ... → Builder(batch N) → Reviewer(batch N)
```

Scout is invoked on-demand by Architect when research is needed, not as a fixed pipeline stage.

### Batch Orchestration

After the Architect writes `PLAN.md` with `### Task N:` headings, the Orchestrator automatically:

1. Parses task headings from the plan
2. Groups tasks into batches of 3
3. Expands the single `[Builder, Reviewer]` pair into scoped batch pairs

For example, a plan with 7 tasks becomes:
```
Architect → Builder(Tasks 1-3) → Reviewer(Tasks 1-3) → Builder(Tasks 4-6) → Reviewer(Tasks 4-6) → Builder(Task 7) → Reviewer(Task 7)
```

Each Builder/Reviewer receives scoped instructions limiting them to their batch. REVISE loops re-run only the affected batch. If `PLAN.md` has no task headings, the pipeline runs as a single stage (backward compatible).

### Review Loop

After Reviewer scores the code:

| Verdict | Score | Action |
|---------|-------|--------|
| **APPROVE** | 8-10 | Pipeline complete, code ships |
| **REVISE** | 5-7 | Back to Builder with specific fixes |
| **REDESIGN** | 1-4 | Back to Architect for rethinking |

Maximum 3 retry cycles. If code doesn't reach APPROVE by cycle 3, pipeline fails.

## The `.brain/` Directory

Every project gets a `.brain/` directory — shared memory between agents:

```
.brain/
├── PROJECT.md             Project overview, tech stack, architecture
├── BACKLOG.md             Task backlog (file watcher triggers Architect)
├── PLAN.md                Implementation plan from Architect
├── DECISIONS.md           Architectural decisions with rationale
├── PATTERNS.md            Established code patterns and conventions
├── MISTAKES.md            Lessons learned (capped, newest first)
├── REVIEW.md              Review verdict (fallback for structured output)
├── pipeline-state.json    Engine-managed pipeline progress
└── RESEARCH/
    └── *.md               Research reports from Scout
```

Agents read these files at session start and write to them at session end. The system gets smarter with every run.

## Skills

Skills are how-to protocols loaded into agent system prompts:

| Skill | Agent | What it does |
|-------|-------|-------------|
| `plan-feature` | Architect | Strict `### Task N:` plan format with TDD steps |
| `execute-plan` | Builder | Follow plan literally, respect batch scope |
| `verify-completion` | Builder, Reviewer | No claims without fresh test evidence |
| `review-loop` | Reviewer | Score, trend, route with cycle cap |
| `review-code` | Reviewer | Correctness, tests, security, patterns checklist |
| `research-scan` | Scout | Structured research with sources |
| `learning-loop` | All | Log decisions, mistakes, patterns every session |

## Configuration

`~/.codename-claude/config.json`:

```json
{
  "projects": [
    { "path": "/path/to/project", "name": "my-project" }
  ],
  "triggers": [
    {
      "name": "daily-scout",
      "type": "cron",
      "schedule": "0 9 * * *",
      "project": "my-project",
      "agent": "scout",
      "task": "Research scan",
      "mode": "standalone"
    }
  ],
  "budget": {
    "maxPromptsPerWindow": 600,
    "reserveForInteractive": 0.3,
    "windowHours": 5
  },
  "webhook": {
    "port": 3000,
    "github": {
      "secret": "your-secret",
      "events": [
        { "event": "issues.labeled", "label": "auto-build", "mode": "team" },
        { "event": "pull_request.opened", "agent": "reviewer", "mode": "standalone" }
      ]
    }
  }
}
```

## Project Structure

```
src/
├── cli.ts                 CLI entry point
├── daemon.ts              Daemon entry point
├── agents/
│   ├── runner.ts          Spawns agent sessions via SDK
│   └── sandbox.ts         Vercel Sandbox integration
├── pipeline/
│   ├── engine.ts          Pipeline engine (runs stages, review loops)
│   ├── orchestrator.ts    Batch expansion (parses PLAN.md, groups tasks)
│   ├── router.ts          LLM task router (Haiku)
│   └── state.ts           Pipeline state persistence
├── heartbeat/
│   ├── loop.ts            Event loop (60s tick)
│   └── queue.ts           Persistent work queue
├── triggers/
│   ├── cron.ts            Cron-based triggers
│   ├── webhook.ts         GitHub webhook server
│   └── watcher.ts         File system watcher
├── state/
│   ├── budget.ts          Token budget (rolling window)
│   └── projects.ts        Project registry
├── hooks/
│   └── hooks.ts           SDK hooks (tool logging, session tracking)
└── ipc/
    ├── client.ts          Unix socket client (CLI side)
    ├── protocol.ts        IPC message types
    └── server.ts          Unix socket server (daemon side)
```

## Development

```bash
# Run tests
bun run test

# Run daemon in dev mode
bun run dev

# Build
bun run build

# Run a specific test file
bun run test src/pipeline/engine.test.ts
```

## Requirements

- Node.js 22+
- Bun
- Claude Code CLI installed (`claude` binary)
- `ANTHROPIC_API_KEY` environment variable set

## License

ISC
