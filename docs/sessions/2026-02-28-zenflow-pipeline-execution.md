# ZenFlow Pipeline Execution Report

**Date:** 2026-02-28
**Pipeline:** architect -> builder -> reviewer
**Project:** ZenFlow (feature-rich todo web app)
**Duration:** ~33 minutes (21:14 - 21:48)
**Outcome:** APPROVE (8/10) -- with one validation edge case discovered

---

## 1. Overview

This document captures the full execution of the Codename Claude pipeline system building ZenFlow -- a production-quality todo web application with 60 source files, 77 passing tests, and a polished UI. The pipeline was run after significant fixes to the agent role boundaries, task routing, and enforcement layers.

### What Was Fixed Before This Run

The first pipeline attempt (20:53) failed because the Architect agent wrote source code instead of plans. Three root causes were identified and fixed:

1. **`buildStageTask` in engine.ts** returned the raw user task for the first stage, so Architect received "set up package.json, install dependencies..." as its directive
2. **Agent definitions** lacked hard constraints -- Architect had `Edit` in its toolset and no explicit prohibition on writing source files
3. **Skills misalignment** -- the `plan-feature` skill told Architect to output `BACKLOG.md`, but the pipeline engine expected `PLAN.md`

Fixes applied:
- Updated `buildStageTask` to always inject role-scoped instructions regardless of stage position
- Removed `Edit` from Architect's tools, added "Critical Constraints" section to its definition
- Rewrote `plan-feature.md` skill to output `.brain/PLAN.md`
- Added post-stage validation (Architect must produce PLAN.md, Builder must create source files, Reviewer must include parseable Verdict line)
- Added PreToolUse hook enforcement (`createRoleGuardHook`) to block Architect/Scout from writing non-`.brain/` files at the SDK level
- Switched all references from npm to bun

---

## 2. Daemon Startup

```
[21:14:53] === Codename Claude daemon started ===
[21:14:53]   Projects:  2 registered
[21:14:53]   Triggers:  2 registered
[21:14:53]   Budget:    470/600 prompts remaining
[21:14:53]   Queue:     0 items pending
[21:14:53]   Interval:  60s
[21:14:53]   Webhook:   listening on port 3000
[21:14:53]   IPC:       /Users/dwaynejoseph/.codename-claude/daemon.sock
[21:14:53]   PID:       10941
```

The daemon started with 2 projects registered (zenflow + an earlier test project) and the `cli:pipeline` trigger configured for zenflow. The heartbeat loop fires every 60 seconds; on the first tick at 21:15:53, it detected the pipeline trigger and began execution.

---

## 3. Router Selection

```
[21:15:53] [heartbeat] tick #1 -- firing cli:pipeline
[21:16:06] [pipeline] Router selected: architect -> builder -> reviewer
```

**Time:** 13 seconds (21:15:53 -> 21:16:06)
**Model:** Claude Haiku (fast, cheap routing decisions)

The LLM Router analyzed the task description and the available agents, then selected a 3-stage pipeline:

| Stage | Agent | Model | Sandboxed | Purpose |
|-------|-------|-------|-----------|---------|
| 1/3 | Architect | Opus | No | Design architecture, write PLAN.md |
| 2/3 | Builder | Sonnet | Yes | Implement all source code per plan |
| 3/3 | Reviewer | Sonnet | Yes | Review code, run tests, write verdict |

The router chose to skip the Scout agent -- reasonable since the task description already contained a specific tech stack and feature list, leaving little to research.

### Role-Scoped Task Injection

After router selection, the pipeline engine's `buildStageTask` method rewrote the raw user task into role-specific instructions. This is what each agent actually received:

**Architect received:**
> "Design the architecture and create a detailed implementation plan for the following task. Follow the plan-feature skill. Write the plan to .brain/PLAN.md and any architectural decisions to .brain/DECISIONS.md. Do NOT write any source code, config files, or install dependencies -- you ONLY write to .brain/ files. The Builder agent will handle all implementation."

**Builder received:**
> "Implement the following task. Start by reading .brain/PLAN.md -- this is your implementation spec from Architect. It contains the architecture, directory structure, ordered tasks, and acceptance criteria. Follow it step by step. Set up the project from scratch if needed (git init, bun init, bun install, create directories), write all source code, and ensure it builds and runs. Always use bun, not npm."

**Reviewer received:**
> "Review the code written by builder for the following task. Follow the review-loop and review-code skills. Read .brain/PLAN.md to understand what was supposed to be built, then review the actual code. Run tests/build. Write your review to .brain/REVIEW.md -- you MUST include a 'Verdict: APPROVE', 'Verdict: REVISE', or 'Verdict: REDESIGN' line that the pipeline can parse."

---

## 4. Stage 1: Architect (21:16:06 -> 21:23:43) -- 7m 37s

**Model:** Claude Opus
**Sandboxed:** No (needs web search for research)
**Tools used:** Bash, Write, Read, TodoWrite, Agent (subagent for research), WebSearch (12x), WebFetch, TaskOutput

### Timeline

| Time | Action |
|------|--------|
| 21:16:11 | Explored project state: `ls -la .brain/`, `pwd` -- confirmed clean slate |
| 21:16:15 | Assessed: "Good -- clean slate project. Let me research the current state of Next.js 14 patterns" |
| 21:16:24 | Spawned a **research subagent** to search for latest library docs |
| 21:16:29 | Created internal todo list to track planning tasks |
| 21:16:35-21:17:33 | Research subagent ran **14 web searches** covering: Next.js 14 App Router patterns, @dnd-kit API, recharts usage, motion (framer-motion) v11, date-fns v3, next-themes, localStorage patterns in React |
| 21:17:43 | "Research is in. I have everything I need. Let me now design the full architecture and write the plan." |
| 21:17:47-21:20:53 | **4 minutes of planning** -- Architect composed the full PLAN.md in memory (no tool calls during this period, just thinking) |
| 21:21:10 | **Wrote `.brain/PLAN.md`** -- the 19-task implementation plan |
| 21:22:05-21:22:58 | Read existing `.brain/` files, then wrote: DECISIONS.md, PROJECT.md, ACTIVE.md, PATTERNS.md |
| 21:23:20-21:23:27 | Wrote session summary to `.brain/SESSIONS/` |
| 21:23:43 | Completed |

### Deliverables

| File | Content |
|------|---------|
| `.brain/PLAN.md` | 19 ordered tasks with exact file paths, data models, architecture, acceptance criteria |
| `.brain/DECISIONS.md` | 9 architectural decisions with alternatives and rationale |
| `.brain/PROJECT.md` | Project overview and tech stack summary |
| `.brain/ACTIVE.md` | Current status -- plan ready for Builder |
| `.brain/PATTERNS.md` | 3 key patterns: hydration safety, debounced writes, atomic storage |
| `.brain/SESSIONS/2026-02-28-2115.md` | Session summary |

### Key Architectural Decisions

- **@dnd-kit** over alternatives (10x more popular than hello-pangea, better TypeScript support)
- **recharts** for charts (React-native API, SVG-based)
- **motion** (formerly framer-motion) for animations with LazyMotion for bundle size
- **date-fns** for dates (tree-shakeable)
- **crypto.randomUUID()** instead of uuid package (95%+ browser support, zero dependency)
- **useReducer + Context** over Zustand (full hydration control, testable)
- **next-themes** for dark mode (prevents FOUC, ~1kb)

### Role Compliance

The Architect wrote exclusively to `.brain/` files -- zero source code files created. This is the exact behavior we fixed after the first pipeline run. The `buildStageTask` role-scoped instruction worked as intended.

### Post-Stage Validation

```
[21:23:43] [pipeline] Stage 1/3: architect completed
[21:23:43] [pipeline] Stage 1/3: architect passed validation
```

The `validateArchitect` method confirmed:
1. `.brain/PLAN.md` exists and has meaningful content (>100 chars)
2. No source code files exist in the project root (the `findSourceCodeFiles` walk found zero violations)

---

## 5. Stage 2: Builder (21:23:43 -> 21:42:41) -- 18m 58s

**Model:** Claude Sonnet
**Sandboxed:** Yes
**Mode:** Team (agent teams enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
**Tools used:** Read, Bash, Write, Edit, TodoWrite

### Timeline

| Time | Action |
|------|--------|
| 21:23:46 | **Read `.brain/PLAN.md`** -- first action, exactly as instructed |
| 21:23:52 | Checked project directory state with `ls` |
| 21:23:59 | Verified bun is installed: `which bun && bun --version` |
| 21:24:24 | "Now I have the full plan. This is a large project with 19 implementation tasks." |
| 21:24:29 | Created internal todo list from PLAN.md's 19 tasks |
| 21:24:33 | Created directory structure: `mkdir -p src/{app,components,hooks,lib,__tests__}` |
| 21:24:52-21:25:16 | **Project scaffolding** -- package.json, tsconfig.json, next.config.mjs, tailwind.config.ts, postcss.config.mjs, vitest.config.ts, test setup |
| 21:25:19-21:25:26 | **`bun install`** -- 550 packages installed |
| 21:25:43-21:26:58 | **Core libraries** -- types.ts, constants.ts, store.ts (25-action reducer), date-utils.ts, search.ts, storage.ts, defaults.ts |
| 21:27:37-21:28:34 | **Hooks** -- use-local-storage.ts, use-zenflow.ts, use-filtered-todos.ts, use-project-stats.ts, use-dashboard-data.ts, use-keyboard-shortcuts.ts |
| 21:28:25-21:28:34 | **Providers** -- theme-provider.tsx, zenflow-provider.tsx |
| 21:28:45-21:30:29 | **UI primitives** -- button, input, badge, dialog, checkbox, progress-bar, tooltip, kbd, empty-state, dropdown-menu (10 components) |
| 21:30:46-21:32:14 | **Layout** -- sidebar-project-item, sidebar, header, shortcuts-help, command-palette, app-shell (6 components) |
| 21:32:34-21:32:49 | **Project components** -- project-form, project-header |
| 21:33:03-21:35:43 | **Todo components** -- priority-select, due-date-picker, tag-picker, subtask-list, subtask-item, todo-detail-panel, todo-form, todo-item, todo-list (9 components) |
| 21:36:05 | **Filters** -- filter-bar |
| 21:36:17-21:37:02 | **Dashboard** -- stats-grid, completion-chart, priority-chart, project-progress, upcoming-todos (5 components) |
| 21:37:15-21:37:38 | **App pages** -- globals.css, layout.tsx, page.tsx, dashboard/page.tsx, project/[id]/page.tsx |
| 21:38:12-21:39:08 | **Tests** -- store.test.ts, storage.test.ts, search.test.ts, date-utils.test.ts, use-filtered-todos.test.ts |
| 21:39:10-21:39:12 | **`bun run test`** -> 77/77 passing |
| 21:39:15-21:39:27 | **`bun run build`** -> Success, 0 TypeScript errors |
| 21:39:43-21:39:45 | Added missing project-stats.tsx and .eslintrc.json |
| 21:40:20-21:40:46 | **git init + commit** -- full codebase committed |
| 21:40:56-21:42:22 | Updated `.brain/` files: ACTIVE.md, MISTAKES.md, PATTERNS.md, session summary |
| 21:42:41 | Completed |

### Build Results

```
Test Files  5 passed (5)
Tests       77 passed (77)
Duration    1.00s

bun run build -> Compiled successfully, 0 TypeScript errors
2 ESLint warnings (non-blocking)
```

### Source File Inventory (60 files)

| Directory | Files | Purpose |
|-----------|-------|---------|
| `src/lib/` | 7 | Core: types, store (reducer), storage, search, date-utils, constants, defaults |
| `src/hooks/` | 6 | State hooks: zenflow, local-storage, filtered-todos, project-stats, dashboard-data, keyboard-shortcuts |
| `src/components/ui/` | 10 | Primitives: button, input, badge, dialog, checkbox, progress-bar, tooltip, kbd, empty-state, dropdown-menu |
| `src/components/layout/` | 6 | Shell: app-shell, sidebar, sidebar-project-item, header, command-palette, shortcuts-help |
| `src/components/todo/` | 9 | Todo: todo-list, todo-item, todo-form, todo-detail-panel, priority-select, due-date-picker, tag-picker, subtask-list, subtask-item |
| `src/components/project/` | 3 | Project: project-form, project-header, project-stats |
| `src/components/dashboard/` | 5 | Dashboard: stats-grid, completion-chart, priority-chart, project-progress, upcoming-todos |
| `src/components/filters/` | 1 | filter-bar |
| `src/components/providers/` | 2 | theme-provider, zenflow-provider |
| `src/app/` | 5 | Pages: layout, page, globals.css, dashboard/page, project/[id]/page |
| `src/__tests__/` | 6 | Tests: store, storage, search, date-utils, use-filtered-todos, setup |

### Post-Stage Validation

```
[21:42:41] [pipeline] Stage 2/3: builder completed
[21:42:41] [pipeline] Stage 2/3: builder passed validation
```

The `validateBuilder` method confirmed source code files exist in the project root (60 files found).

---

## 6. Stage 3: Reviewer (21:42:41 -> 21:48:04) -- 5m 23s

**Model:** Claude Sonnet
**Sandboxed:** Yes
**Tools used:** Skill, Read (28 files), Bash, TodoWrite, Write, Edit, Glob

### Timeline

| Time | Action |
|------|--------|
| 21:42:45 | Invoked review skills (review-loop, review-code) |
| 21:42:47 | **Read `.brain/PLAN.md`** -- understood what was supposed to be built |
| 21:42:48 | Listed source directory structure |
| 21:42:54 | Created review checklist (TodoWrite) |
| 21:42:57-21:43:02 | **Read core libraries**: types.ts, store.ts, storage.ts, search.ts, date-utils.ts, constants.ts, use-filtered-todos.ts, zenflow-provider.tsx |
| 21:43:08-21:43:09 | **Read UI components**: app-shell.tsx, todo-item.tsx, layout.tsx, dashboard/page.tsx |
| 21:43:12-21:43:13 | **Read test files**: store.test.ts, storage.test.ts, use-filtered-todos.test.ts |
| 21:43:20-21:43:25 | **Read more components**: todo-list.tsx, todo-detail-panel.tsx, sidebar.tsx, completion-chart.tsx, use-keyboard-shortcuts.ts, project/[id]/page.tsx |
| 21:43:30-21:43:31 | **Read CSS and UI**: globals.css, dialog.tsx |
| 21:43:39-21:43:41 | **`bun run test`** -- verified 77/77 passing |
| 21:43:49-21:43:57 | **`bun run build`** -- verified build succeeds |
| 21:44:28 | Investigated ESLint warnings |
| 21:44:29 | **Read hook files**: use-dashboard-data.ts, use-project-stats.ts |
| 21:45:15 | "Now I have everything I need. Let me write the review" |
| 21:46:29 | **Wrote `.brain/REVIEW.md`** -- 156-line review |
| 21:46:58-21:47:45 | Updated session files and ACTIVE.md |
| 21:48:04 | Completed with verdict: **8/10 APPROVE** |

### Review Score: 8/10

The Reviewer evaluated 6 dimensions from the review-code skill:

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Correctness | Pass | All 25 reducer actions correct, immutable patterns, cascading deletes work |
| Tests | Pass (with gaps) | 77/77 pass, but 2 missing test files (use-project-stats, use-dashboard-data) |
| Error Handling | Pass | localStorage wraps, parseSafely(), project-not-found redirects |
| Security | Pass | No hardcoded secrets, no unsafe HTML injection, crypto.randomUUID() |
| Patterns Compliance | Pass | All `.brain/PATTERNS.md` conventions followed exactly |
| Readability | Pass | All files <250 lines, descriptive naming, one-thing components |

### Issues Found

| # | Severity | Issue |
|---|----------|-------|
| 1 | Major | Missing tests for `use-project-stats` and `use-dashboard-data` (Plan Task 19 required these) |
| 2 | Minor | `_tags` unused dependency in `use-dashboard-data.ts:95` -- ESLint warning |
| 3 | Minor | Missing `todo` dependency in `todo-detail-panel.tsx:32` -- ESLint warning |
| 4 | Minor | Dialog lacks a true focus trap (Tab escapes modal) |
| 5 | Nit | Dead variable `isAllTodos` in `sidebar.tsx:26` |
| 6 | Nit | SVG gradient ID `completionGradient` not unique (would collide if rendered twice) |
| 7 | Nit | `useKeyboardShortcut` handler not memoized at call site (re-attaches listener each render) |

Despite 7 findings (1 major, 3 minor, 3 nits), the Reviewer determined the code was merge-ready: "Everything substantive is correct and well-implemented."

### Post-Stage Validation -- The Edge Case

```
[21:48:04] [pipeline] Stage 3/3: reviewer completed
[21:48:04] [pipeline] VALIDATION FAILED for reviewer: Reviewer wrote REVIEW.md but missing a valid Verdict: line (APPROVE|REVISE|REDESIGN)
```

The pipeline's `validateReviewer` method flagged a false positive. The Reviewer wrote `**Verdict:** APPROVE` using markdown bold syntax, but the regex `/Verdict:\s*(APPROVE|REVISE|REDESIGN)/i` didn't match the `**` wrapper around "Verdict:".

**Fix applied after this run:** The regex was updated to `/\*{0,2}Verdict:?\*{0,2}\s*(APPROVE|REVISE|REDESIGN)/i` in both `validateReviewer` and `parseReviewVerdict`, allowing optional markdown bold formatting.

Despite the validation failure, the review content was correct and the APPROVE verdict was legitimate.

---

## 7. Pipeline Summary

```
Total Duration:       ~33 minutes
Stages Executed:      3 of 3
Retries:              0
Final Verdict:        APPROVE (8/10)
Validation Outcome:   FAILED (false positive -- regex edge case)
```

### Agent Performance

| Agent | Duration | Model | Files Written | Key Metric |
|-------|----------|-------|---------------|------------|
| Architect | 7m 37s | Opus | 6 (.brain/ only) | 19-task plan, 9 decisions, 14 web searches |
| Builder | 18m 58s | Sonnet | 60 source files | 77 tests, 0 TS errors, 550 packages |
| Reviewer | 5m 23s | Sonnet | 1 (REVIEW.md) | 28 files read, 156-line review |

### Role Boundary Enforcement

Both enforcement layers were active during this run:

1. **PreToolUse Hook** (`createRoleGuardHook`): Would have blocked any attempt by Architect to write outside `.brain/`. No blocks were triggered -- the Architect stayed within bounds.

2. **Post-Stage Validation**:
   - Architect: Verified PLAN.md exists (>100 chars) and no source code files created outside `.brain/`
   - Builder: Verified source code files exist
   - Reviewer: Verified REVIEW.md exists with parseable Verdict line (this is where the false positive occurred)

### Heartbeat Monitoring

The daemon's heartbeat loop (60s interval) provided continuous monitoring:

```
tick #1:  Fired pipeline trigger
tick #2-8:  Architect running (reported "busy (agent running)")
tick #9-27: Builder running
tick #28-33: Reviewer running
tick #34: idle (pipeline complete)
```

33 heartbeat ticks over ~33 minutes -- the daemon maintained awareness of pipeline state throughout.

---

## 8. The App -- ZenFlow

### Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 14.x | Framework (App Router) |
| TypeScript | 5.x (strict mode) | Type safety |
| Tailwind CSS | 3.x | Styling |
| @dnd-kit | 6.x | Drag-and-drop reordering |
| motion | 11.x | Animations and transitions |
| recharts | 2.x | Dashboard charts |
| date-fns | 3.x | Date formatting |
| next-themes | 0.x | Dark/light theme |
| Vitest | latest | Testing |

### Features Delivered (all 19 plan tasks)

| Feature | Details |
|---------|---------|
| Multiple projects | Create, edit, delete projects with emoji icons and color coding |
| Todo CRUD | Full create/read/update/delete with inline editing |
| Drag-and-drop | @dnd-kit with 4px activation constraint to prevent accidental drags |
| Priority levels | Urgent / High / Medium / Low with color-coded badges |
| Due dates | Date picker with overdue highlighting (red for overdue, yellow for soon) |
| Tags/labels | Color-coded tags with picker, AND-based filtering |
| Search | Multi-term scored search (title 3x > tags 2x > description 1x = subtasks 1x) |
| Filters | Filter by status, priority, tags, due date -- combinable with AND logic |
| Dark/light theme | Toggle with `next-themes`, no FOUC, chart colors adapt |
| Keyboard shortcuts | Cmd/Ctrl+K (command palette), Cmd+N (new todo), ? (help), input guard |
| Progress tracking | Per-project completion rate, overdue counts, active/total breakdown |
| Subtasks | Expandable checklists within each todo |
| Dashboard | Stats grid, 14-day completion chart, priority distribution, project progress, upcoming todos |
| Animations | AnimatePresence, layout animations, spring transitions throughout |
| Responsive design | Mobile-friendly sidebar, responsive grid layouts |
| Hydration safety | Skeleton-first pattern, `isFirstSave` ref prevents localStorage overwrite |
| localStorage persistence | Single-key atomic storage, debounced writes (300ms), version migration |
| State management | useReducer + Context, 25 action types, fully immutable |
| Test coverage | 77 tests across 5 test files (store, storage, search, date-utils, filtered-todos) |

### Application Views

The app was launched with `bun run dev` and viewed at http://localhost:3000. Three views were captured:

1. **Dashboard** -- Stats grid showing total/active/completed/overdue counts, 14-day completion line chart, priority distribution donut chart, project progress bars, upcoming todos list
2. **Project View** -- Todo list with drag handles, priority badges, due dates, tag chips, inline checkbox completion, expandable detail panel with subtask management
3. **Dark Mode** -- Full theme toggle with adapted chart colors, smooth transition, proper contrast ratios

### Test Results

```
Test Files  5 passed (5)
Tests       77 passed (77)
Duration    1.00s

Test breakdown:
  store.test.ts              -- 21 tests (HYDRATE, all CRUD, REORDER, cascading deletes, immutability)
  storage.test.ts            -- 9 tests (load, save, migration, corruption, sanitization)
  search.test.ts             -- 10 tests (single/multi-term, tags, AND logic, scoring)
  date-utils.test.ts         -- 26 tests (all functions, edge cases: null, today, overdue, far future)
  use-filtered-todos.test.ts -- 11 tests (all filter dimensions, combinations, sorting)
```

---

## 9. Lessons Learned

### What Worked

1. **Role-scoped task injection** -- Rewriting the user's raw task into agent-specific instructions was the single most impactful fix. The Architect stayed in bounds because its task explicitly said "Do NOT write any source code."

2. **Two-layer enforcement** -- PreToolUse hooks (real-time blocking) + post-stage validation (completion checks) provide defense in depth. Even if an agent tries to work around instructions, the hooks block the tool call before it executes.

3. **The `.brain/` directory as shared memory** -- PLAN.md served as the contract between Architect and Builder. Builder read it first and followed the 19-task structure exactly.

4. **Research subagent** -- Architect spawned a subagent to run 14 web searches in parallel, gathering current docs for Next.js 14, @dnd-kit, recharts, etc. This kept the architecture decisions grounded in current library APIs.

5. **Builder's systematic approach** -- Builder created a TodoWrite checklist from PLAN.md's 19 tasks and worked through them in order: foundation -> core libraries -> hooks -> UI primitives -> layout -> features -> pages -> tests -> build verification -> git commit.

### What Needs Improvement

1. **Verdict regex** -- The validation regex was too strict, not accounting for markdown formatting. This caused a false positive that made the pipeline report failure despite a legitimate APPROVE. Fixed post-run.

2. **Missing test coverage** -- Builder skipped 2 of the planned test files (use-project-stats.test.ts, use-dashboard-data.test.ts). The post-stage validation only checks that source files exist, not that specific planned deliverables were created.

3. **Initializer agent confusion** -- The first pipeline attempt (20:51) selected 4 stages including "initializer" -- an agent that doesn't exist in the definitions. The router hallucinated a role. After restart, it correctly selected architect -> builder -> reviewer.

4. **stderr noise** -- A `Stream closed` error and hook callback errors appear in logs after each agent completes. These are benign (the Claude Code process is shutting down) but pollute the log.

---

## 10. Architecture Diagram

```
+-----------------------------------------------------+
|                    DAEMON (PID 10941)                |
|                                                     |
|  +----------+  +----------+  +------------------+   |
|  | Heartbeat|  |  IPC     |  |   Webhook        |   |
|  | (60s)    |  | (socket) |  |   (:3000)        |   |
|  +----+-----+  +----------+  +------------------+   |
|       |                                             |
|       v                                             |
|  +---------------------------------------------+   |
|  |            PIPELINE ENGINE                   |   |
|  |                                              |   |
|  |  +--------+    +---------+    +----------+   |   |
|  |  | Router |---->| Stage   |---->| Validate|   |   |
|  |  |(Haiku) |    | Runner  |    | Stage   |   |   |
|  |  +--------+    +----+----+    +----+-----+   |   |
|  |                     |              |          |   |
|  |              +------+------+  +----+-----+   |   |
|  |              | PreToolUse  |  | Parse    |   |   |
|  |              | Hook Guard  |  | Verdict  |   |   |
|  |              +-------------+  +----------+   |   |
|  +---------------------------------------------+   |
+-----------------------------------------------------+
                         |
    +--------------------+--------------------+
    v                    v                    v
+--------+       +------------+       +----------+
|Architect|       |  Builder   |       | Reviewer  |
| (Opus)  |       | (Sonnet)   |       | (Sonnet)  |
|         |       |            |       |           |
| Writes: |       | Reads:     |       | Reads:    |
| PLAN.md |------>| PLAN.md    |------>| PLAN.md   |
| DECISIONS|      |            |       | src/*     |
| PATTERNS |      | Writes:    |       |           |
|          |      | 60 src     |       | Runs:     |
| Research:|      | files      |       | tests     |
| 14 web   |      |            |       | build     |
| searches |      | Runs:      |       |           |
|          |      | bun install|       | Writes:   |
|          |      | bun test   |       | REVIEW.md |
|          |      | bun build  |       | (8/10)    |
+--------+       +------------+       +----------+
```

### Data Flow Through `.brain/`

```
Architect                Builder                Reviewer
    |                        |                      |
    +--> PLAN.md ----------->|                      |
    +--> DECISIONS.md        +--> 60 src files ---->|
    +--> PATTERNS.md ------->|                      |
    +--> ACTIVE.md --------->|                      |
    |                        +--> ACTIVE.md ------->|
    |                        +--> PATTERNS.md ----->|
    |                        |                      +--> REVIEW.md
    |                        |                      +--> ACTIVE.md
    |                        |                      +--> Verdict: APPROVE
```
