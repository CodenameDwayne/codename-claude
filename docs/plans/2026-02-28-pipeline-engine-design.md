# Pipeline Engine Design

## Problem

The current agent orchestration relies on Agent Teams, where a Team Lead agent spawns teammates (Builder, Reviewer) via TeamCreate. This fails because the lead's session ends before the full pipeline completes — Builder finishes but Reviewer never runs.

Agent Teams is designed for parallel collaboration, not sequential pipelines. The daemon is the right orchestrator for sequential work.

## Solution

Replace Agent Teams as the default orchestration with a daemon-orchestrated pipeline. A lightweight LLM router picks which agents to run and in what order. A pipeline engine runs them sequentially, threading context through `.brain/`. Agent Teams stays available as a per-stage option for complex tasks that need parallel work.

## Architecture

```
User/Trigger --> Heartbeat --> Pipeline Engine --> Runner --> Agent Session
                                    |                            |
                               LLM Router                  .brain/ (shared state)
                              (picks agents)                     |
                                    |                     Agent writes output
                               Pipeline executes               |
                              agents in sequence          Pipeline reads result
                                    |                    (e.g. REVIEW.md verdict)
                              Routes based on                   |
                              agent output               Decides next agent
```

### Components

1. **LLM Router** (`src/pipeline/router.ts`) — Takes a task + list of agent definitions, calls Haiku, returns an ordered list of agents to run with per-stage teams flag
2. **Pipeline Engine** (`src/pipeline/engine.ts`) — Executes agents sequentially, reads `.brain/` output between stages, handles review loops (max 3 retries)
3. **Runner** (`src/agents/runner.ts`) — Unchanged. Spawns a single agent, returns when done
4. **Heartbeat** (`src/heartbeat/loop.ts`) — Calls pipeline engine instead of runner directly

## LLM Router

**Input:** Task description + list of available agent definitions (name, whenToUse, skills) + project context from `.brain/PROJECT.md`

**Output:** Ordered list of pipeline stages:
```json
[
  { "agent": "builder", "teams": false },
  { "agent": "reviewer", "teams": false }
]
```

Or for complex tasks:
```json
[
  { "agent": "architect", "teams": false },
  { "agent": "builder", "teams": true },
  { "agent": "reviewer", "teams": false }
]
```

**Implementation:** Single Haiku API call (~500 tokens). Parses structured JSON response.

**Manual override:** When the user runs `codename run builder my-project "task"`, the router is skipped. Pipeline is a single stage.

## Pipeline Engine

**Lifecycle:**
```
engine.run(stages, project, task)
  for each stage:
    1. Log: "[pipeline] Stage X/Y: Running {agent}"
    2. Build task prompt for this stage
       - Include original task
       - Include context from previous stage output
       - If re-running after review: include REVIEW.md feedback
    3. Call runAgent(agent, project, taskPrompt, { mode })
       - mode = "standalone" if teams: false
       - mode = "team" if teams: true
    4. If agent is reviewer, read .brain/REVIEW.md
       - APPROVE: continue to next stage
       - REVISE: re-run previous builder stage (retry++)
       - REDESIGN: re-run from architect stage (retry++)
       - retry >= 3: stop, notify user
    5. Log: "[pipeline] Stage X/Y: {agent} completed"
  Log: "[pipeline] Pipeline complete"
```

**Context threading:** The engine constructs each agent's task prompt to include relevant context. Builder gets the original task. Reviewer gets "review the latest changes." If re-running after REVISE, Builder gets the review feedback.

**Review routing:** The Reviewer writes a verdict to `.brain/REVIEW.md`. The engine parses the verdict:
- APPROVE (score 8-10): Continue to next stage or complete
- REVISE (score 5-7): Re-run Builder with Reviewer feedback
- REDESIGN (score 1-4): Re-run from Architect stage

**Max retries:** 3 attempts before stopping and notifying the user.

## Data Flow Between Agents

Each agent reads `.brain/` on startup. Agents write output to `.brain/` files:

| Agent | Reads | Writes |
|-------|-------|--------|
| Scout | PROJECT.md, task | .brain/RESEARCH.md |
| Architect | PROJECT.md, RESEARCH.md | .brain/PLAN.md |
| Builder | PROJECT.md, PLAN.md | Code files (git commit) |
| Reviewer | Git diff, code files | .brain/REVIEW.md |

The daemon doesn't parse complex output. It only reads `.brain/REVIEW.md` to extract the verdict for routing decisions.

## Agent Teams Integration

Agent Teams is not removed. Instead, it becomes a per-stage capability:

- The LLM router decides per-agent whether to enable teams
- When `teams: true`, the runner spawns the agent with Agent Teams enabled (200 turns, teammates available)
- The agent can then spawn sub-teammates for parallel work
- When `teams: false`, the runner spawns standalone (50 turns)

This means any agent can be a team lead when the task warrants it, decided by the router.

## Changes to Existing Components

### Runner (src/agents/runner.ts)
- No structural changes
- Remove the team-specific delegation prompt injection ("You are a coordinator..." preamble)
- Teams mode agents get Agent Teams tools naturally without forced delegation

### Heartbeat (src/heartbeat/loop.ts)
- Calls `pipeline.run()` instead of `runAgent()` directly
- Pipeline handles router + sequential execution

### Hooks (src/hooks/hooks.ts)
- Remove: `createPreToolUseDenyHook`, `createUserPromptSubmitHook` (no longer needed)
- Keep: `PostToolUse` (logging), `SessionEnd` (registry), `TeammateIdle`, `TaskCompleted`

### Daemon (src/daemon.ts)
- Remove `teamHooks` — use `baseHooks` for all runs
- Pipeline engine decides mode per-stage

### CLI (src/cli.ts)
- `codename run <agent> <project> "task"` — single agent, no router
- `codename run pipeline <project> "task"` — full pipeline with router

## New Files

- `src/pipeline/router.ts` — LLM router
- `src/pipeline/engine.ts` — Pipeline engine
- `src/pipeline/router.test.ts`
- `src/pipeline/engine.test.ts`

## Success Criteria

1. A `codename run pipeline` command completes Builder then Reviewer sequentially without session lifecycle issues
2. Reviewer feedback routes correctly (APPROVE completes, REVISE re-runs builder)
3. LLM router correctly selects agents based on task complexity
4. Agent Teams works when router enables it on a specific stage
5. Existing manual `codename run <agent>` still works as before
6. All pipeline activity is visible in daemon logs
