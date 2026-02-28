# Codename Claude — Autonomous PM + Developer Agent Stack Design

**Date:** 2026-02-26
**Author:** Dwayne + Claude
**Status:** Approved

## Overview

Codename Claude is a fully autonomous, self-learning PM + Developer agent system built on Claude Code's Agent SDK, Agent Teams, and Perplexity MCP. It manages any software project end-to-end: researching, planning, building, reviewing, and shipping code — while accumulating institutional knowledge so it never repeats the same mistake.

This is a personal workflow tool for Dwayne, not a product. It replaces the manual "you are the PM, AI is the assistant" model with a heartbeat-driven copilot — always listening, never idle-burning. The daemon runs 24/7 as a lightweight event loop that costs zero tokens. It only spins up Claude Code sessions when a trigger fires (schedule, webhook, CLI command, or file change). Agents do focused work, write their results to the project brain, and shut down. You drop in via Remote Control to observe and steer whenever you want.

## Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  CODENAME CLAUDE DAEMON                      │
│              (TypeScript, Claude Agent SDK)                   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              HEARTBEAT LOOP (always running)          │   │
│  │          Lightweight event loop — zero token cost     │   │
│  │                                                      │   │
│  │  Every 60s:                                          │   │
│  │    • Check cron schedule — any agents due?           │   │
│  │    • Check webhook queue — any events waiting?       │   │
│  │    • Check .brain/ACTIVE.md — any stalled work?      │   │
│  │    • Check CLI input — any manual commands?          │   │
│  │                                                      │   │
│  │  99% of the time → nothing to do → stay idle (free)  │   │
│  │  Trigger fires  → route to Task Router               │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │ (only when triggered)              │
│                         ▼                                    │
│  ┌──────────────┐  ┌────────────────────────┐               │
│  │ Task Router   │  │ Session Manager        │               │
│  │ Reads .brain/ │→ │ Spawns Claude Code     │               │
│  │ Picks task    │  │ via Agent SDK          │               │
│  │ Selects role  │  │ Session ends when done │               │
│  └──────────────┘  └────────────────────────┘               │
│                         │                                    │
│                         ▼                                    │
│  ┌──────────────────────────────────────┐                   │
│  │           Sandbox Layer               │                   │
│  │  Builder/Reviewer → Vercel Sandbox    │                   │
│  │  Scout/Architect  → direct (no sandbox)│                  │
│  │  Syncs files in/out of microVM        │                   │
│  └──────────────────────────────────────┘                   │
│                         │                                    │
│                         ▼                                    │
│  ┌──────────────────────────────────────┐                   │
│  │      State Manager + Token Budget     │                   │
│  │  Reads/writes .brain/ files in repos  │                   │
│  │  Tracks token usage per 5-hour window │                   │
│  └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
          ┌──────────┐ ┌────────┐ ┌──────────┐
          │ Project A │ │ Proj B │ │ Project C │
          │ .brain/   │ │ .brain/│ │ .brain/   │
          └──────────┘ └────────┘ └──────────┘
```

### Components

| Component | Responsibility |
|---|---|
| **Heartbeat Loop** | The always-running core. A lightweight Node.js event loop that checks triggers every 60 seconds. Costs zero tokens — it only reads local files and checks timestamps. This is what makes the system "always on." |
| **Triggers** | Conditions that wake the system up: cron schedules, CLI commands, GitHub webhooks, file watchers. A trigger firing is the only thing that causes token spend. |
| **Task Router** | Reads project state from `.brain/`, selects complexity level and agent role. Only runs when a trigger fires. |
| **Session Manager** | Spawns/resumes Claude Code sessions via Agent SDK. Passes context, hooks, MCP servers. Sessions are bounded — they do focused work and shut down. |
| **State Manager** | All state is structured markdown files in each project's `.brain/` directory. Read by the heartbeat (free) and by agent sessions (costs tokens). |
| **Sandbox Layer** | Code-executing agents (Builder, Reviewer) run inside Vercel Sandbox — isolated Firecracker microVMs with their own filesystem, network, and process space. Project files are synced in before the session and changes are synced back after. Non-code agents (Scout, Architect) run directly without sandboxing. |
| **Token Budget** | Tracks usage per 5-hour rolling window. Reserves 30% for interactive sessions. When budget is low, the heartbeat queues triggers instead of firing them. |

## Three Operating Modes

The system scales up and down based on how work enters:

### Mode 1: Interactive (you're at the keyboard)

You use the `cc` CLI to start an interactive Codename Claude session in a registered project. The daemon constructs the full system prompt (identity + skills + project context from `.brain/`) and launches a Claude Code session via the Agent SDK. You drive, it assists — but with full Codename Claude context. Alternatively, you can use normal `claude` in the same project and it just sees the source code — no Codename Claude behavior.

### Mode 2: Agent Teams (heartbeat-triggered pipeline)

The heartbeat detects a trigger (cron schedule, webhook, or CLI command) and spawns Claude Code's Agent Teams for complex work:

- **Team Lead** orchestrates the pipeline
- **Teammates** (Scout, Architect, Builder, Reviewer) work through a shared task list
- Peer-to-peer messaging via filesystem mailbox
- Scale: 1 agent (solo) → 2 agents (plan+build) → 4 agents (full pipeline)
- Observable via Remote Control from phone/browser
- **Sessions are bounded** — each teammate has clear "done" criteria, then shuts down

### Mode 3: Standalone Agents (heartbeat-triggered single jobs)

The heartbeat fires a single-purpose agent for a focused task:
- Daily research scans (cron: 9am)
- Weekly dependency checks (cron: Monday 8am)
- Memory pruning/archiving (cron: Sunday 2am)
- Any custom automation you add

Each standalone agent runs, writes results to `.brain/`, and exits. One agent, one job, done.

### How the Modes Relate to the Heartbeat

```
Heartbeat loop (always running, zero cost)
  │
  ├─ Cron trigger fires       → Mode 3 (standalone) or Mode 2 (team)
  ├─ Webhook event arrives     → Mode 2 (team) or Mode 3 (standalone)
  ├─ CLI command received      → Mode 2 (team) or Mode 3 (standalone)
  ├─ File change detected      → Mode 3 (standalone)
  │
  └─ You run `cc` interactively → Mode 1 (daemon constructs session for you)
```

All three modes share the same `.brain/` directory. Work done by a heartbeat-triggered agent at 9am is visible when you open a `cc` interactive session at 10am. If you open normal `claude` instead, you won't see Codename Claude behavior — just regular Claude Code.

## Agent Roles

Four core roles, each defined as an agent definition in `~/.codename-claude/agents/`:

| Role | Job | Model | Key Tools | Sandboxed |
|---|---|---|---|---|
| **Scout** | Research & intelligence gathering | Sonnet 4.6 | Perplexity MCP, Read, Write, Glob, Grep | No |
| **Architect** | Planning, specs, task breakdown | Opus 4.6 | Read, Write, Edit | No |
| **Builder** | Code implementation, testing | Sonnet 4.6 | Read, Write, Edit, Bash, Glob, Grep | **Yes** |
| **Reviewer** | Quality gate with routing intelligence | Sonnet 4.6 | Read, Grep, Glob, Bash | **Yes** |

### Pipeline — The Review Loop

The pipeline is not linear — the Reviewer creates a feedback loop that routes work back to the right agent until quality is met:

```
Scout → Architect → Builder → Reviewer
                                  │
                                  ├─ ✅ Score ≥ 8       → APPROVED (ship it)
                                  ├─ 🔄 Score improving → REVISE (route to right agent)
                                  ├─ ⚠️  Score stalled   → ESCALATE to Team Lead
                                  └─ 🛑 Score dropped   → STOP + notify human
```

**How it works:** The Reviewer scores each submission 1-10 and tracks the trend across cycles:

| Score | Meaning | Action |
|---|---|---|
| **9-10** | Production-ready | APPROVED — merge and ship |
| **8** | Good with minor nits | APPROVED — merge, log nits for next session |
| **5-7** | Has real issues | REVISE if score trending up; ESCALATE if stalled |
| **3-4** | Fundamentally flawed | Route to Architect (design problem, not code problem) |
| **1-2** | Wrong approach entirely | Route to Scout (need different research/approach) |

**Score trend determines loop behavior:**
- **Improving** (e.g., 4→6→7): keep looping, work is getting better
- **Stalled** (e.g., 5→5→5): escalate to Team Lead — "we're going in circles"
- **Dropped** (e.g., 6→4): stop immediately, notify human via Remote Control

**Safety valves:**
- **Max 3 review cycles** — hard cap even if scores keep improving. After 3 cycles, ship or escalate.
- **Score must improve by ≥1** each cycle, or it counts as stalled.
- **Each cycle is bounded** — Reviewer follows a clear checklist, not an open-ended conversation.

**Worst case token cost:** Builder → Reviewer → Builder → Reviewer → Builder → Reviewer → done. Three review passes, then the loop exits regardless.

**Review log:** Every cycle, the Reviewer appends a structured entry to the review record including: score, trend, what's good, what needs fixing, routing decision, and specific tasks for the next agent.

### Task Routing Without the Full Pipeline

Not every task goes through all four roles:
- Quick fix → solo, no agents
- Research only → Scout
- Spec already exists → Builder + Reviewer loop
- Full feature → all four roles with review loop

### Agent Definitions

Located in `~/.codename-claude/agents/`. Each is a markdown file with YAML frontmatter defining name, model, allowed tools, sandboxed flag, and system prompt. When the daemon spawns a Claude Code session, it reads the agent definition and passes the system prompt and tool config inline via the Agent SDK — Claude Code itself never reads these files. If `sandboxed: true`, the agent runner creates a Vercel Sandbox microVM, syncs project files in, runs the session inside it, and syncs changes back. This keeps Codename Claude fully separated from your normal Claude Code setup.

## The Self-Learning Memory System

### Three Memory Layers

| Layer | What | Scope | Who Manages |
|---|---|---|---|
| **Layer 1: Session Context** | 200K token window during a session | One session | Automatic |
| **Layer 2: Project Brain** | Structured markdown files in `.brain/` | Per project, forever (git-tracked) | All agents + you |
| **Layer 3: Auto-Memory** | Claude Code's own implicit learning | Per project, persists across sessions | Claude Code automatically |

### The .brain/ Directory

Every project managed by Codename Claude has this structure:

```
.brain/
├── PROJECT.md       ← What this project is. You write this once.
├── BACKLOG.md       ← Prioritized task list. Architect writes, Builder reads.
├── ACTIVE.md        ← Current work in progress. All agents update.
├── DECISIONS.md     ← Decision log with rationale. ALL agents write.
├── PATTERNS.md      ← Coding patterns for this project. Builder + Reviewer write.
├── MISTAKES.md      ← Failed approaches and lessons learned. ALL agents write.
├── RESEARCH/        ← Research findings (dated markdown files). Scout writes.
└── SESSIONS/        ← Session summaries. ALL agents write at session end.
    └── latest.md    ← Most recent session summary.
```

### Tiered Reading Strategy

Not all files are read every session. This keeps context usage under control:

| Tier | Files | When Read | Token Budget |
|---|---|---|---|
| **Always** | PROJECT.md, ACTIVE.md, DECISIONS.md, PATTERNS.md, MISTAKES.md | Every session start | ~15K tokens |
| **On demand** | BACKLOG.md | When planning | ~5K tokens |
| **On demand** | RESEARCH/ | Only relevant files | Varies |
| **On demand** | SESSIONS/ | latest.md always; older when context needed | Varies |

### Memory Pruning

A `memory-janitor` standalone agent runs weekly to keep files within budget:

- DECISIONS.md: keep last 50 entries, archive older
- PATTERNS.md: consolidate duplicates, remove patterns for deleted code
- MISTAKES.md: archive resolved mistakes, keep active ones
- RESEARCH/: archive files older than 30 days
- SESSIONS/: keep last 10 summaries

### The Self-Learning Loop

```
Session N:
  1. Agent reads MISTAKES.md → "Don't try approach X, use Z instead"
  2. Agent does work, encounters a new issue
  3. Agent fixes it
  4. Agent logs to MISTAKES.md: "Tried Y, failed because... do W instead"
  5. Agent updates PATTERNS.md, DECISIONS.md
  6. Session summary written to SESSIONS/

Session N+1:
  1. Agent reads updated MISTAKES.md → now includes lesson from Session N
  2. Agent avoids both X and Y, uses Z and W directly
  3. System is measurably smarter.
```

### Learning Promotion

When a pattern or mistake appears across multiple projects, it gets promoted to global:

- Project-specific → `.brain/PATTERNS.md` or `.brain/MISTAKES.md`
- Cross-project → `~/.codename-claude/identity/rules/*.md` (applies to all Codename Claude sessions)

## Skills Architecture

Skills are reusable, process-level workflows that any agent can follow. They are defined in `~/.codename-claude/identity/skills/` and loaded by the daemon when constructing agent system prompts. They are NOT stored in Claude Code's `~/.claude/` directory — keeping Codename Claude fully isolated from your normal workflow.

### Core Skills

| Skill | Purpose |
|---|---|
| `session-handoff.md` | How to properly end a session (update ACTIVE.md, log decisions, write summary) |
| `learning-loop.md` | How to learn from mistakes (log failures, discover patterns, promote learnings) |
| `review-loop.md` | How the Reviewer scores work (1-10), tracks trends, and routes back to the right agent. Includes the 3-cycle cap, stall detection, and escalation protocol. |
| `research-scan.md` | How to do a research scan (sources, format, quality gates) |
| `plan-feature.md` | How to go from idea → spec → tasks |
| `review-code.md` | How to do a thorough code review (checklist the Reviewer follows each cycle) |
| `init-project.md` | How to bootstrap .brain/ for a new project |
| `prune-memory.md` | How to keep .brain/ files within token budget |
| `promote-learning.md` | How to promote project-specific knowledge to global rules |

### Relationship: Skills ↔ Agents

- **Agents** define WHO (role, model, tools, personality)
- **Skills** define HOW (step-by-step process for a workflow)
- Agents reference skills: "Follow the `research-scan` skill for your workflow"

### Skill Growth

Start with core skills in Phase 1. New skills emerge from actual usage as Codename Claude discovers repeatable processes.

## Standalone App Architecture

Codename Claude is a standalone application, completely separated from Claude Code. It uses the Claude Agent SDK as its engine but has its own config, state, and identity. Your normal `claude` command and `~/.claude/` config are untouched.

### Two Separate Workflows

| | Normal Claude Code | Codename Claude |
|---|---|---|
| **Command** | `claude` | `cc` (CLI) or daemon |
| **Config** | `~/.claude/` | `~/.codename-claude/` |
| **Purpose** | Interactive coding assistant | Autonomous PM + Dev system |
| **Who drives** | You | Heartbeat + agents |
| **Affects each other?** | No | No |

### File Hierarchy

```
~/.claude/                              ← YOUR CLAUDE CODE (untouched)
├── CLAUDE.md                           ← Your personal preferences
└── ...                                 ← Normal Claude Code config

~/.codename-claude/                     ← CODENAME CLAUDE (standalone)
├── config.json                         ← Daemon config: triggers, budget, projects
├── identity/
│   ├── system-prompt.md                ← Core identity: who Codename Claude is
│   ├── rules/                          ← Coding standards, git protocol, quality gates
│   │   ├── coding-standards.md
│   │   ├── git-protocol.md
│   │   └── quality-gates.md
│   └── skills/                         ← Reusable workflows
│       ├── session-handoff.md
│       ├── learning-loop.md
│       ├── review-loop.md
│       ├── research-scan.md
│       └── ...
├── agents/                             ← Agent role definitions
│   ├── scout.md
│   ├── architect.md
│   ├── builder.md
│   ├── reviewer.md
│   ├── team-lead.md
│   ├── memory-janitor.md
│   └── initializer.md
├── templates/
│   └── brain/                          ← .brain/ template for new projects
└── state/
    ├── projects.json                   ← Registered projects
    ├── budget.json                     ← Token budget tracking
    └── queue.json                      ← Queued work

~/Projects/any-project/                 ← ANY REGISTERED PROJECT
├── .brain/                             ← Project memory (managed by Codename Claude)
│   ├── PROJECT.md
│   ├── BACKLOG.md / ACTIVE.md
│   ├── DECISIONS.md / PATTERNS.md / MISTAKES.md
│   ├── RESEARCH/ / SESSIONS/
└── src/                                ← Your actual code
```

### How Sessions Are Constructed

When the daemon spawns a Claude Code session via the Agent SDK, it builds the session inline — it does NOT rely on `~/.claude/` files:

1. Reads the agent definition from `~/.codename-claude/agents/{role}.md`
2. Reads relevant skills from `~/.codename-claude/identity/skills/`
3. Reads the project's `.brain/` files for context
4. Constructs a system prompt that combines: identity + rules + skills + agent role + project context
5. If `sandboxed: true` — creates a Vercel Sandbox microVM, syncs project files in, sets `cwd` to the sandbox workspace
6. Passes everything to the Agent SDK: `systemPrompt`, `allowedTools`, `mcpServers`, `cwd`
7. If sandboxed — syncs file changes back to host project, stops sandbox

The Claude Code session receives all its context from the daemon — it has no idea about `~/.codename-claude/`. Sandboxed sessions have no idea they're in a sandbox either — they just see the project files in their working directory. This is what makes the separation clean.

## Integration Layer

### Perplexity MCP

The daemon passes the Perplexity MCP server configuration inline when spawning agent sessions via the Agent SDK — it does NOT register it in your global Claude Code config:

```typescript
// Passed inline per session, not installed globally
mcpServers: {
  perplexity: {
    command: "bunx",
    args: ["@perplexity-ai/mcp-server"],
    env: { PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY }
  }
}
```

Used by Scout for research scans. Budget: $5/month API credit included with Perplexity Pro ($20/month). Only Codename Claude sessions have access — your normal Claude Code sessions are unaffected.

### Vercel Sandbox

Code-executing agents (Builder, Reviewer) run inside [Vercel Sandbox](https://vercel.com/sandbox) — ephemeral Firecracker microVMs that provide complete isolation: own filesystem, network, and process space. This prevents autonomous agents from accidentally running destructive commands, accessing sensitive files, or consuming unlimited resources on your machine.

**Which agents are sandboxed:**

| Agent | Sandboxed | Reason |
|---|---|---|
| Builder | **Yes** | Writes code, runs `bun install`, executes builds and scripts |
| Reviewer | **Yes** | Runs tests, linters, type checkers — all code execution |
| Scout | No | Web research via Perplexity MCP, file reads only |
| Architect | No | Writes specs and plans, no code execution |
| Team Lead | No | Orchestration only |

**How it works:**

1. Agent runner checks the agent definition's `sandboxed: true` flag
2. Creates a Vercel Sandbox with 4 vCPUs and a timeout matching the session's expected duration
3. Installs Claude Code CLI and the Agent SDK inside the sandbox
4. Syncs the project's source files and `.brain/` directory INTO the sandbox
5. Spawns the Agent SDK session inside the sandbox (code runs in isolation)
6. When the session completes, syncs file changes BACK to the host project
7. Stops the sandbox (cleanup — no lingering resources)

**The sandbox and the review loop:** The review loop communicates through `.brain/` files on the host, not through the sandbox. Each review cycle gets a fresh sandbox — Builder writes code in sandbox A, changes sync back, Reviewer checks them in sandbox B, feedback syncs back, Builder gets sandbox C for revisions. The sandboxes are disposable; the `.brain/` is persistent.

**Configuration:**

```typescript
// Passed inline when creating a sandboxed session
const sandbox = await Sandbox.create({
  resources: { vcpus: 4 },
  timeout: ms('30m'),   // Adjustable per agent role
  runtime: 'node22',
});
```

**Cost:** ~$6-10/month at $0.128/CPU hour (Builder ~1-2 hrs/day + Reviewer ~30 min/day). 5 free CPU hours on Hobby plan for testing.

**Sandbox limits:**
- Max 5 hours per session (Pro/Enterprise) — aligns with Claude Max's 5-hour rolling window
- ~150ms cold start — negligible overhead
- Ephemeral by design — no state persists between sandboxes (that's what `.brain/` is for)

### Remote Control

Launched Feb 25, 2026 (Max plan, research preview). Enables connecting to a running Claude Code session from phone, browser, or another device.

In Codename Claude: the daemon spawns a session → you connect via Remote Control → watch and steer from your phone. This is the "drop in and out" copilot experience.

### GitHub

Agent Teams + Builder agent can create branches, commit, and open PRs via the GitHub MCP server or CLI.

## Budget

| Item | Cost/month | What It Provides |
|---|---|---|
| Claude Max 20x | $200 | ~200-800 prompts per 5-hour rolling window |
| Perplexity Pro | $20 | $5 API credit (Sonar MCP), 20 Deep Research/day, Spaces |
| Vercel Sandbox | ~$10 | ~75 CPU hours for Builder/Reviewer isolation ($0.128/hr). 5 free hrs on Hobby. |
| **Total** | **~$230** | |

### The 5-Hour Rolling Window

Claude Max doesn't provide "unlimited" usage. It provides a budget of prompts within a rolling 5-hour window. The window starts from your first message and rolls forward — after 5 hours, early messages expire and free up capacity. On the Max 20x plan, this is approximately 200-800 prompts per window (varies by model and complexity).

### Why the Heartbeat Model Is Token-Efficient

The daemon costs zero tokens when idle. Tokens are only consumed in focused bursts when the heartbeat fires a trigger:

| Daemon State | Token Cost |
|---|---|
| Heartbeat loop checking triggers | **0** — pure Node.js, no API calls |
| Scout runs a 10-minute research scan | ~20-50 prompts |
| Full 4-agent team builds a feature | ~100-300 prompts |
| Memory janitor prunes .brain/ files | ~10-20 prompts |
| You working interactively | Whatever you use |

A typical day might look like: one Scout scan (30 prompts) + one build session (200 prompts) + your interactive work (150 prompts) = ~380 prompts. Well within the 5-hour window budget, with the daemon idle the rest of the day.

### Token Management Rules

- **70/30 split**: Heartbeat-triggered work uses at most 70% of the window budget. 30% is always reserved for your interactive sessions.
- **Sonnet for agents, Opus for steering**: Agent roles run on Sonnet 4.6 (cheaper per prompt). Opus 4.6 is used for the Architect role and when you interact directly.
- **Bounded sessions**: Every agent has a clear "done" condition. No open-ended conversations that burn tokens.
- **Budget-aware heartbeat**: The heartbeat checks the token budget before spawning an agent. If the budget is low, it queues the trigger and waits for the next window to roll over.
- **No idle burn**: The heartbeat never calls the Claude API. Tokens are only spent on actual work.

## The Daemon

A separate TypeScript project using the Claude Agent SDK. The daemon is a lightweight Node.js process — the heartbeat loop runs locally and costs nothing. It only reaches out to the Claude API when a trigger fires.

```
codename-claude/
├── package.json
├── src/
│   ├── daemon.ts               ← Main entry: starts heartbeat loop
│   ├── heartbeat/
│   │   ├── loop.ts             ← The core event loop (runs every 60s, zero cost)
│   │   ├── triggers.ts         ← Evaluates trigger conditions
│   │   └── queue.ts            ← Queues work when budget is low
│   ├── agents/
│   │   ├── runner.ts           ← Spawns Claude Code sessions via Agent SDK
│   │   └── sandbox.ts          ← Vercel Sandbox wrapper (create, sync files, cleanup)
│   ├── triggers/
│   │   ├── cron.ts             ← Scheduled triggers (daily scan, weekly prune)
│   │   ├── webhook.ts          ← GitHub webhook listener
│   │   ├── cli.ts              ← Manual CLI commands
│   │   └── watcher.ts          ← File system watcher
│   ├── hooks/
│   │   ├── post-tool-use.ts    ← Log actions, detect failures for learning
│   │   └── session-end.ts      ← Ensure session summary was written
│   ├── state/
│   │   ├── projects.ts         ← Track registered projects
│   │   └── budget.ts           ← Token budget tracking per 5-hour window
│   └── utils/
│       ├── mcp.ts              ← MCP server configs (Perplexity, GitHub)
│       └── templates.ts        ← Project initialization templates
├── config/
│   └── default.json            ← Trigger schedules, budget limits, project paths
└── .env                        ← API keys (PERPLEXITY_API_KEY, etc.)
```

### Daemon Lifecycle

```
Start daemon → Heartbeat loop begins (zero cost)
  │
  ├─ 99% of time: check triggers → nothing to do → sleep 60s → repeat
  │
  ├─ Trigger fires:
  │   1. Check token budget → enough? → proceed. Low? → queue it.
  │   2. Read .brain/ state for the target project (local file read, free)
  │   3. Route to the right agent via Task Router
  │   4. Spawn Claude Code session via Agent SDK (tokens consumed HERE)
  │   5. Session does focused work → writes results to .brain/
  │   6. Session ends → daemon logs outcome → back to idle
  │
  └─ You connect via Remote Control → observe/steer active session
```

## Rollout Phases

| Phase | What to Build | Outcome |
|---|---|---|
| **Phase 1: The Brain** | Create `~/.codename-claude/` with identity, skills, agent definitions, and `.brain/` template. Set up the `codename-claude` repo. No heartbeat yet. | Codename Claude exists as a standalone app scaffold with all its knowledge files. |
| **Phase 2: The Heartbeat** | Build the daemon with the heartbeat loop, trigger system, and token budget tracker. Wire up a single Scout agent on a daily cron schedule via Agent SDK. | System is "always on" — listening for triggers, zero idle cost. First automated agent runs daily. |
| **Phase 3: Agent Teams** | Enable experimental Agent Teams. Wire Scout → Architect → Builder → Reviewer pipeline. Add webhook triggers (GitHub issues). | Full autonomous pipeline. Heartbeat routes complex work to teams. |
| **Phase 4: Expand Triggers** | Add CLI commands, file watchers, more cron schedules. Add standalone agents (memory-janitor, dependency-bot). | Rich trigger ecosystem. System reacts to many event types. |
| **Phase 5: Remote Control** | Integrate Remote Control so heartbeat-spawned sessions are observable from phone/browser. Push notifications when work completes. | True "drop in and out" copilot. |

## Design Decisions

| Decision | Rationale |
|---|---|
| **Standalone app, not Claude Code extension** | Codename Claude lives in `~/.codename-claude/`, completely separate from `~/.claude/`. Your normal Claude Code workflow is untouched. Sessions are constructed inline via Agent SDK. |
| **Heartbeat-driven, not always-running** | The daemon's heartbeat loop checks triggers locally (zero tokens). Agents only spin up when triggered. "Always on" = always listening, not always spending. |
| **Agent SDK everywhere** | Full programmatic control: hooks, streaming, session management. No `claude -p` shortcuts. |
| **Agent Teams over custom orchestrator** | Native coordination (shared task list, peer messaging, lifecycle management) without building it ourselves. |
| **.brain/ per project** | Each project has unique context. Knowledge is git-tracked, portable, human-readable. |
| **Skills and agents in ~/.codename-claude/** | Codename Claude's identity and processes are consistent across all registered projects, but isolated from normal Claude Code. |
| **Tiered reading + pruning** | Keeps context usage under ~15K tokens for always-read files. Weekly janitor maintains hygiene. |
| **Sonnet for agents, Opus for steering** | Cost-efficient: focused agent work on Sonnet, complex planning and human interaction on Opus. |
| **70/30 token split** | Heartbeat-triggered work never starves interactive sessions. Safety margin built in. |
| **Markdown files as state** | Simple, version-controlled, human-readable, no external dependencies. The repo is the message bus. |
| **Vercel Sandbox for code-executing agents only** | Builder and Reviewer run code autonomously — sandboxing prevents destructive commands, credential access, and resource abuse. Scout and Architect don't execute code, so sandboxing them adds overhead for no safety benefit. |

## What This Design Does NOT Cover

- **Perplexity Computer / Comet integration** — No API available. Revisit when APIs ship.
- **Multi-user / team use** — This is a personal tool for Dwayne. No auth, no multi-tenancy.
- **Production hosting** — Daemon runs on Dwayne's machine. No cloud deployment.
- **Specific project implementations** — This designs the system, not what it builds.
