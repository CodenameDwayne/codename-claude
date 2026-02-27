# Codename Claude — Implementation Plan

**Date:** 2026-02-27
**Design doc:** [2026-02-26-codename-claude-design.md](2026-02-26-codename-claude-design.md)

## Prerequisites

- [ ] Claude Max 20x plan active ($200/month)
- [ ] Perplexity Pro subscription active ($20/month) + API key
- [ ] Vercel account with Sandbox access (Hobby: free 5 CPU hrs, Pro: $0.128/hr)
- [ ] Vercel CLI installed (`npm install -g vercel`) and project linked
- [ ] Claude Code CLI installed and authenticated
- [ ] Node.js >= 22 installed
- [ ] Git configured

---

## Phase 1: The Foundation

**Goal:** Create the standalone `codename-claude` application scaffold and all knowledge files (identity, skills, agents, brain template). After this phase, the app exists but doesn't run the heartbeat yet — you can manually trigger a single agent session via the Agent SDK to verify everything works.

### Task 1.1 — Initialize the codename-claude repo

Create the TypeScript project that will become the standalone app.

**Do:**
1. `mkdir ~/Projects/codename-claude && cd ~/Projects/codename-claude`
2. `npm init -y` — set name to `codename-claude`
3. Install core dependencies:
   - `@anthropic-ai/claude-agent-sdk`
   - `@vercel/sandbox`
   - `ms`
   - `dotenv`
   - `tsx` (dev)
   - `typescript` (dev)
   - `@types/ms` (dev)
4. `npx tsc --init` — strict mode, ESM, Node22 target, outDir `dist/`
5. Create the source directory structure:
   ```
   src/
   ├── daemon.ts
   ├── heartbeat/
   ├── agents/
   │   ├── runner.ts
   │   └── sandbox.ts
   ├── triggers/
   ├── hooks/
   ├── state/
   └── utils/
   ```
6. Create `.env` with `PERPLEXITY_API_KEY=` and `VERCEL_OIDC_TOKEN=`
7. Create `.gitignore` (node_modules, dist, .env)
8. `git init && git add -A && git commit -m "init: codename-claude scaffold"`

**Verify:** `npx tsx src/daemon.ts` runs without crashing (even if it just exits).

### Task 1.2 — Create the ~/.codename-claude/ directory structure

Set up Codename Claude's own config home, completely separate from `~/.claude/`.

**Do:**
1. Create the full directory structure:
   ```
   ~/.codename-claude/
   ├── config.json
   ├── identity/
   │   ├── system-prompt.md
   │   ├── rules/
   │   └── skills/
   ├── agents/
   ├── templates/
   │   └── brain/
   └── state/
   ```
2. Create `config.json` with placeholder structure:
   ```json
   {
     "projects": [],
     "triggers": [],
     "budget": {
       "maxPromptsPerWindow": 600,
       "reserveForInteractive": 0.3,
       "windowHours": 5
     }
   }
   ```

**Verify:** `ls ~/.codename-claude/` shows the full directory tree.

### Task 1.3 — Write the identity system prompt

This is who Codename Claude IS. The daemon reads this and includes it at the top of every agent session's system prompt.

**Write to:** `~/.codename-claude/identity/system-prompt.md`

**Contents:**
- Identity: "You are Codename Claude, an autonomous PM + Developer agent for Dwayne."
- Context loading protocol: always read .brain/ files at session start (PROJECT.md, ACTIVE.md, DECISIONS.md, PATTERNS.md, MISTAKES.md, SESSIONS/latest.md)
- Session end protocol: always update ACTIVE.md, log decisions, log mistakes, write session summary
- Quality mindset: never ship without tests, always explain decisions, cite research sources

**Verify:** Read the file. It should clearly define a personality and protocol that any agent role can inherit.

### Task 1.4 — Write global rules

Rules are constraints every Codename Claude session follows.

**Write to:** `~/.codename-claude/identity/rules/`

| File | Contents |
|---|---|
| `coding-standards.md` | TypeScript strict, ESM, prefer Bun, Vitest for tests, descriptive variable names |
| `git-protocol.md` | Descriptive commits, branch per feature, PR before merge, never force push |
| `quality-gates.md` | Tests must pass, linter must pass, review before merge, no TODO comments in shipped code |

**Verify:** Three files exist with clear, specific rules.

### Task 1.5 — Write core skills

Skills are step-by-step processes. The daemon reads the relevant skill file and appends it to the agent's system prompt.

**Write to:** `~/.codename-claude/identity/skills/`

| File | Priority | What it describes |
|---|---|---|
| `session-handoff.md` | Must | Steps to end a session: update ACTIVE.md, log to DECISIONS.md, log to MISTAKES.md, update PATTERNS.md, write SESSIONS/{timestamp}.md, update SESSIONS/latest.md |
| `learning-loop.md` | Must | When something fails: log what/why/do-instead to MISTAKES.md. When pattern found: log to PATTERNS.md. When decision made: log alternatives + rationale to DECISIONS.md |
| `review-loop.md` | Must | Reviewer scoring protocol: score 1-10, track trends, route by score (8+ approve, 5-7 revise if improving, 3-4 send to Architect, 1-2 send to Scout). 3-cycle cap, stall = escalate, drop = stop |
| `research-scan.md` | Must | Use Perplexity to research a topic. Check multiple sources. Output format: findings, approaches, tradeoffs, recommendation, sources with URLs. Save to .brain/RESEARCH/{date}-{topic}.md |
| `plan-feature.md` | Should | Take an idea → research it → write spec → break into tasks → update BACKLOG.md and ACTIVE.md |
| `review-code.md` | Should | Code review checklist: correctness, tests, error handling, security, patterns compliance, readability |
| `init-project.md` | Should | How to bootstrap .brain/ for a new project: scan codebase, create PROJECT.md, create empty state files |
| `prune-memory.md` | Later | Pruning thresholds: DECISIONS keep 50, PATTERNS consolidate, MISTAKES archive resolved, RESEARCH archive >30 days, SESSIONS keep 10 |

**Verify:** Each skill file reads as a clear, actionable checklist an agent can follow step-by-step.

### Task 1.6 — Write agent definitions

Each agent role is a markdown file defining who it is, what model it uses, what tools it can access, and which skills it follows.

**Write to:** `~/.codename-claude/agents/`

| File | Model | Tools | Sandboxed | Skills referenced |
|---|---|---|---|---|
| `scout.md` | sonnet-4-6 | Read, Write, Glob, Grep, Perplexity MCP | No | research-scan, learning-loop, session-handoff |
| `architect.md` | opus-4-6 | Read, Write, Edit | No | plan-feature, learning-loop, session-handoff |
| `builder.md` | sonnet-4-6 | Read, Write, Edit, Bash, Glob, Grep | **Yes** | learning-loop, session-handoff |
| `reviewer.md` | sonnet-4-6 | Read, Grep, Glob, Bash | **Yes** | review-loop, review-code, learning-loop, session-handoff |
| `team-lead.md` | opus-4-6 | Read, Write, Glob, Grep | No | (orchestrates other agents, doesn't follow a single skill) |
| `memory-janitor.md` | haiku-4-5 | Read, Write, Edit, Glob | No | prune-memory |
| `initializer.md` | sonnet-4-6 | Read, Write, Glob, Grep, Bash | No | init-project |

**Format for each file:**
```markdown
---
name: Scout
model: claude-sonnet-4-6
sandboxed: false
tools:
  - Read
  - Write
  - Glob
  - Grep
  - mcp__perplexity
skills:
  - research-scan
  - learning-loop
  - session-handoff
---

You are Scout, Codename Claude's research agent.

[Role-specific instructions here]
```

The `sandboxed` flag tells the agent runner whether to create a Vercel Sandbox microVM for this agent. Builder and Reviewer set `sandboxed: true` because they execute code. All other agents set `sandboxed: false`.

**Verify:** Each file has valid YAML frontmatter including the `sandboxed` flag and a clear system prompt section.

### Task 1.7 — Create the .brain/ project template

A copyable template for bootstrapping new projects.

**Write to:** `~/.codename-claude/templates/brain/`

**Contents:**
```
brain/
├── PROJECT.md       ← "# Project Name\n\nDescribe your project here.\n\n## Tech Stack\n\n## Architecture\n\n## Key Constraints"
├── BACKLOG.md       ← "# Backlog\n\nNo tasks yet."
├── ACTIVE.md        ← "# Active Work\n\nNothing in progress."
├── DECISIONS.md     ← "# Decision Log"
├── PATTERNS.md      ← "# Patterns"
├── MISTAKES.md      ← "# Mistakes & Lessons Learned"
├── RESEARCH/
│   └── .gitkeep
└── SESSIONS/
    ├── .gitkeep
    └── latest.md    ← "No previous sessions."
```

**Verify:** Copy the template to a test directory. All files exist with headers.

### Task 1.8 — Build the sandbox wrapper

Write `src/agents/sandbox.ts` — the Vercel Sandbox lifecycle manager for code-executing agents.

**Do:**
1. `createSandbox(config)` — creates a Vercel Sandbox microVM with configurable vCPUs (default 4) and timeout (default 30 min)
2. `syncFilesIn(sandbox, projectPath)` — copies project source files and `.brain/` directory into the sandbox workspace
3. `syncFilesOut(sandbox, projectPath)` — diffs sandbox workspace against original, copies changed files back to host project
4. `stopSandbox(sandbox)` — stops the sandbox and cleans up (always called, even on error — use try/finally)
5. Install Claude Code CLI and Agent SDK inside the sandbox on creation
6. Handle OIDC token refresh (tokens expire after 12 hours in dev)

**Verify:** Create a sandbox, write a test file inside it, sync it back, verify the file exists on host. Stop the sandbox, verify it's gone.

### Task 1.9 — Build the agent runner (minimal)

Write `src/agents/runner.ts` — the core function that reads an agent definition and spawns a Claude Code session via the Agent SDK, optionally inside a Vercel Sandbox.

**Do:**
1. Read agent definition from `~/.codename-claude/agents/{role}.md`
2. Parse YAML frontmatter (name, model, tools, skills, **sandboxed**)
3. Read identity system prompt from `~/.codename-claude/identity/system-prompt.md`
4. Read each referenced skill from `~/.codename-claude/identity/skills/`
5. Read all rule files from `~/.codename-claude/identity/rules/`
6. Read relevant `.brain/` files from the target project
7. Construct the full system prompt: identity + rules + skills + agent role + project context
8. **If `sandboxed: true`:** create Vercel Sandbox via sandbox.ts, sync project files in, set cwd to sandbox workspace
9. Call the Agent SDK `query()` with: systemPrompt, allowedTools, mcpServers, cwd
10. **If sandboxed:** sync file changes back to host, stop sandbox (always, even on error)
11. Stream output to console
12. Return session result (session ID, completion status)

**Verify:**
- Spawn Scout (non-sandboxed) in a test project — verify it runs directly on host
- Spawn Builder (sandboxed) in a test project — verify it runs inside a sandbox, and file changes sync back to host

**Verify:** Manually call the runner from a test script: spawn Scout in a test project. Verify it uses Perplexity, writes to .brain/RESEARCH/, and follows the session-handoff skill.

### Task 1.10 — End-to-end test: manual agent run

Prove the full chain works without the heartbeat.

**Do:**
1. Create a test project: `mkdir ~/Projects/cc-test && cd ~/Projects/cc-test && git init`
2. Copy the .brain/ template: `cp -r ~/.codename-claude/templates/brain/ .brain/`
3. Edit `.brain/PROJECT.md` with a simple project description
4. Run the agent runner manually: `npx tsx src/test-run.ts scout cc-test "Do a research scan on CLI frameworks for Node.js"`
5. Check: `.brain/RESEARCH/` should have a new markdown file with research findings
6. Check: `.brain/SESSIONS/` should have a session summary
7. Run Scout AGAIN — verify it reads the previous session summary and doesn't repeat work

**Verify:** Two sessions produce different results. The second session references the first. Context is preserved across sessions via .brain/ files.

### Phase 1 Done When:

- [x] `codename-claude` repo exists with TypeScript scaffold
- [x] `~/.codename-claude/` has identity, rules, skills, agents, and brain template
- [x] Sandbox wrapper can create/sync/stop Vercel Sandbox microVMs *(revised: using Agent SDK built-in sandbox instead — see notes)*
- [x] Agent runner can spawn sessions with or without sandboxing based on agent definition
- [x] A manual Scout run (non-sandboxed) produces research in .brain/RESEARCH/ and a session summary
- [x] A manual Builder run (sandboxed) writes code inside a sandbox and syncs changes back to host
- [x] A second run demonstrates context preservation (reads first run's output)
- [x] None of this touches `~/.claude/` — your normal Claude Code is unaffected

> **✅ Phase 1 completed 2026-02-27.** Session notes: [2026-02-27-phase-1-session-notes.md](2026-02-27-phase-1-session-notes.md)

---

## Phase 2: The Heartbeat

**Goal:** The daemon runs 24/7 with the heartbeat loop. It costs zero tokens idle and spawns agents when cron triggers fire. Scout runs automatically every morning.

### Task 2.1 — Build the token budget tracker

**File:** `src/state/budget.ts`

**Behavior:**
- Track prompt count per 5-hour rolling window
- `recordUsage(promptCount)` — log a session's usage
- `canRunAgent()` — returns false if < 30% budget remaining (reserved for interactive)
- `getRemainingBudget()` — how many prompts left in current window
- Persist to `~/.codename-claude/state/budget.json`
- Auto-roll windows based on timestamps

**Verify:** Unit test: record usage, check remaining, verify window rollover.

### Task 2.2 — Build the project registry

**File:** `src/state/projects.ts`

**Behavior:**
- `registerProject(path, name)` — add a project to Codename Claude
- `listProjects()` — list all registered projects
- `getProject(pathOrName)` — get project details
- `unregisterProject(pathOrName)` — remove a project
- Each entry: `{ path, name, registered, lastSession }`
- Persist to `~/.codename-claude/state/projects.json`

**Verify:** Register a project, list it, restart the process, verify it persists.

### Task 2.3 — Build the cron trigger

**File:** `src/triggers/cron.ts`

**Behavior:**
- Takes a cron expression, project, agent role, task description, mode
- `isDue()` — checks if the schedule has fired since last check
- Tracks last fire time to prevent double-firing
- Reads trigger config from `~/.codename-claude/config.json`

**Verify:** Set a trigger for "every minute." Verify it fires once, then not again until the next minute.

### Task 2.4 — Build the work queue

**File:** `src/heartbeat/queue.ts`

**Behavior:**
- `enqueue(triggerResult)` — add work when budget is low
- `dequeue()` — get next queued item (FIFO)
- `peek()` — check without removing
- `isEmpty()` — check if queue is empty
- Persist to `~/.codename-claude/state/queue.json`

**Verify:** Enqueue items, restart, verify they persist. Dequeue in order.

### Task 2.5 — Build the heartbeat loop

**File:** `src/heartbeat/loop.ts`

**Behavior:**
- Runs every 60 seconds (configurable in config.json)
- Each tick:
  1. Evaluate all registered triggers — any due?
  2. Check the work queue — anything waiting?
  3. If work exists: check token budget → enough? → run agent. Low? → queue it.
  4. Log: "tick #N — no triggers" or "tick #N — firing {trigger}"
- Graceful shutdown on SIGINT/SIGTERM (finish current session if running)
- Prevent concurrent agent sessions (one at a time, queue the rest)

**Verify:** Start the loop. Watch 3-4 ticks log "no triggers." Configure a "every minute" cron. Watch it fire. Ctrl+C cleanly shuts down.

### Task 2.6 — Build the Agent SDK hooks

**File:** `src/hooks/post-tool-use.ts`, `src/hooks/session-end.ts`

**post-tool-use:**
- Log tool name and target (e.g., "Write: .brain/RESEARCH/2026-02-27.md")
- If Bash exits non-zero, flag it for the learning loop

**session-end:**
- Check if `.brain/SESSIONS/` got a new file during this session
- If not, log a warning: "Session ended without writing a summary"
- Update project registry with lastSession timestamp

**Verify:** Run an agent session with hooks. Check logs show tool use. End session. Check project registry updated.

### Task 2.7 — Wire daemon.ts as the main entry point

**File:** `src/daemon.ts`

**Do:**
1. Load config from `~/.codename-claude/config.json` and `.env`
2. Initialize budget tracker, project registry
3. Register all triggers from config
4. Start the heartbeat loop
5. Log startup: "Codename Claude daemon started. Tracking N projects. M triggers registered. Budget: X/Y prompts remaining."

**Verify:** `npx tsx src/daemon.ts` starts cleanly, logs the startup banner, and ticks quietly.

### Task 2.8 — Configure and test daily Scout

**Do:**
1. Register the test project: add it to `config.json`'s projects array
2. Add a cron trigger to `config.json`:
   ```json
   {
     "name": "daily-scout",
     "type": "cron",
     "schedule": "0 9 * * *",
     "project": "cc-test",
     "agent": "scout",
     "task": "Run your daily research scan for this project",
     "mode": "standalone"
   }
   ```
3. For testing, temporarily set schedule to `*/2 * * * *` (every 2 minutes)
4. Start the daemon
5. Watch Scout fire, run, write to .brain/RESEARCH/, and return to idle
6. Restore the 9am schedule

**Verify:** Scout runs automatically. .brain/ gets new research. Budget tracker records usage. Daemon goes back to idle.

### Phase 2 Done When:

- [x] Daemon starts with `npx tsx src/daemon.ts` and runs the heartbeat loop
- [x] Heartbeat ticks every 60s with zero token cost
- [x] Cron trigger fires on schedule
- [x] Token budget tracker prevents overspending (queues work when low)
- [x] Work queue persists across daemon restarts
- [x] Scout runs automatically on schedule and writes to .brain/
- [x] Hooks log tool use and verify session summaries
- [x] Daemon shuts down cleanly on Ctrl+C

> **✅ Phase 2 completed 2026-02-27.** Session notes: [2026-02-27-phase-2-session-notes.md](2026-02-27-phase-2-session-notes.md)

---

## Phase 3: Agent Teams

**Goal:** Enable the full pipeline: Scout → Architect → Builder → Reviewer with the review loop. Complex tasks trigger an Agent Team instead of a single agent.

### Task 3.1 — Research Agent Teams + Agent SDK compatibility

Before building, answer these questions with actual testing:
- Can you enable Agent Teams on SDK-spawned sessions? (set env var `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
- How does the Team Lead spawn teammates from within an SDK session?
- Can hooks observe teammate activity?
- What happens if a teammate crashes — does the team recover?

Write findings to `~/.codename-claude/RESEARCH-agent-teams.md`.

### Task 3.2 — Write the Team Lead agent definition

**File:** `~/.codename-claude/agents/team-lead.md`

The Team Lead is the orchestrator. Its system prompt must include:
- How to assess task complexity and pick which teammates to spawn
- How to create the shared task list with dependencies (Scout → Architect → Builder → Reviewer)
- How to monitor progress and synthesize results
- When to scale down (not every task needs all 4 teammates)
- Reference to the review-loop protocol

### Task 3.3 — Update agent runner for team mode

**File:** `src/agents/runner.ts`

When a trigger has `mode: "team"`:
- Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in the session environment
- Use the Team Lead agent definition as the system prompt
- Include all teammate agent definitions in the context so the Team Lead knows how to describe them
- The session will be longer-running — adjust timeout accordingly
- **Sandbox in team mode:** When the Team Lead spawns Builder or Reviewer teammates, those teammates run inside Vercel Sandbox. The Team Lead itself runs unsandboxed (it only orchestrates). Each review loop cycle gets a fresh sandbox — Builder writes code in sandbox A, Reviewer checks in sandbox B, Builder revises in sandbox C. The `.brain/` files on host are the persistent communication layer between sandboxed cycles.

### Task 3.4 — Build the webhook trigger

**File:** `src/triggers/webhook.ts`

- Start an HTTP server on a configurable port
- Listen for GitHub webhook payloads
- Map events to triggers:
  - `issues.labeled` with label "auto-build" → team mode
  - `pull_request.opened` → reviewer standalone
- Verify webhook signatures

Add webhook config to `config.json`:
```json
{
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

### Task 3.5 — End-to-end pipeline test

1. Add a feature idea to `.brain/BACKLOG.md` in the test project
2. Trigger the team pipeline via CLI or webhook
3. Watch: Scout researches → Architect plans → Builder codes → Reviewer scores
4. Verify the review loop catches at least one issue and sends back to Builder
5. Verify: code committed, .brain/ files updated throughout
6. Verify: session summaries exist for each phase

### Phase 3 Done When:

- [ ] Agent Teams spawns via the daemon with SDK
- [ ] Team Lead orchestrates Scout → Architect → Builder → Reviewer
- [ ] Review loop scores, trends, and routes correctly
- [ ] 3-cycle cap and stall detection work
- [ ] Webhook trigger fires on GitHub events
- [ ] Full pipeline produces working code from a feature idea

---

## Phase 4: Expand Triggers & CLI

**Goal:** Rich trigger ecosystem. CLI commands for manual control. Maintenance agents on schedules.

### Task 4.1 — Build the CLI interface

Create a `cc` command that talks to the running daemon.

**Subcommands:**
| Command | What it does |
|---|---|
| `cc start` | Start the daemon (if not running) |
| `cc stop` | Stop the daemon |
| `cc status` | Show: running?, projects, budget remaining, queue |
| `cc run scout [project]` | Manually trigger Scout |
| `cc run team [project] "task"` | Manually trigger a full team pipeline |
| `cc projects list` | List registered projects |
| `cc projects add [path]` | Register a new project (copies .brain/ template) |
| `cc projects remove [path]` | Unregister a project |
| `cc logs` | Tail the daemon logs |
| `cc queue` | Show queued work |
| `cc interactive [project]` | Start an interactive Codename Claude session |

**Communication:** CLI talks to daemon via Unix socket (`~/.codename-claude/daemon.sock`) or writes to a command file the heartbeat picks up.

### Task 4.2 — Build the file watcher trigger

**File:** `src/triggers/watcher.ts`

Uses `chokidar` to watch `.brain/BACKLOG.md` in registered projects. When a new task is added, trigger the Architect agent. Debounce at 5 seconds.

### Task 4.3 — Wire up the memory janitor

Add cron trigger:
```json
{
  "name": "weekly-prune",
  "type": "cron",
  "schedule": "0 2 * * 0",
  "agent": "memory-janitor",
  "task": "Prune .brain/ files following the prune-memory skill",
  "mode": "standalone"
}
```

Test: populate .brain/ with many entries, trigger janitor, verify pruning and archiving.

### Task 4.4 — Add package.json bin entry for `cc` command

Add to `codename-claude/package.json`:
```json
{ "bin": { "cc": "./dist/cli.js" } }
```

`npm link` to make `cc` available globally.

### Phase 4 Done When:

- [ ] `cc` CLI works for all subcommands
- [ ] File watcher triggers on .brain/ changes
- [ ] Memory janitor prunes and archives on schedule
- [ ] `cc interactive` starts a full Codename Claude session at your keyboard

---

## Phase 5: Remote Control & Notifications

**Goal:** Observe and steer heartbeat-spawned sessions from your phone. Get notified when work completes or needs attention.

### Task 5.1 — Research Remote Control + Agent SDK

Test whether Remote Control can be enabled on SDK-spawned sessions. Document findings and workaround if needed.

### Task 5.2 — Integrate Remote Control into agent runner

When spawning a session, enable Remote Control. Capture the session URL. Log it and optionally send it as a notification.

### Task 5.3 — Build notification system

Start with macOS native notifications (`osascript`):
- Session started: "Codename Claude: Scout is researching [project]" + Remote Control URL
- Session complete: "Codename Claude: Scout finished. 3 findings saved."
- Review escalated: "Codename Claude: Reviewer needs your input on [project]"
- Budget low: "Codename Claude: 15% budget remaining"

Later: add webhook notifications (Slack, Discord) if needed.

### Task 5.4 — End-to-end copilot test

1. Start the daemon
2. Trigger a feature build
3. Receive notification with Remote Control URL
4. Connect from phone, observe, steer
5. Receive completion notification
6. Open `cc interactive` — verify full context

### Phase 5 Done When:

- [ ] Remote Control works on daemon-spawned sessions
- [ ] Notifications fire for start/complete/escalate/budget-low
- [ ] You can observe and steer from another device
- [ ] The full "drop in and out" experience works end-to-end

---

## Summary: What You're Building

```
Phase 1: Foundation     → The brain (files) + app scaffold + sandbox wrapper + manual agent run
Phase 2: Heartbeat      → Daemon loop + cron triggers + Scout on schedule
Phase 3: Agent Teams    → Full pipeline + review loop + sandboxed Builder/Reviewer + webhooks
Phase 4: CLI & Triggers → cc command + file watchers + maintenance agents
Phase 5: Remote Control → Mobile observation + notifications
```

Each phase is independently useful. You get value from Phase 1 alone (context preservation). Each subsequent phase adds capability on top. Sandboxing is built into Phase 1 so that every code-executing agent is isolated from day one — you never have an unsandboxed Builder running on your machine.
