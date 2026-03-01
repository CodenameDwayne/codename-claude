# Agent Definition Sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update all agent definitions, skills, and the system prompt to reflect the pipeline-state refactor — removing references to deprecated `ACTIVE.md` and `SESSIONS/` files, and correcting `REVIEW.md` instructions to reflect structured output as the primary path.

**Architecture:** The pipeline-state refactor (2026-02-28-brain-pipeline-state.md) correctly updated the TypeScript source code (`runner.ts`, `engine.ts`, `state.ts`, `loop.ts`) but never propagated changes to the markdown files that get loaded into agent system prompts at runtime. These files live in `~/.codename-claude/` and are loaded by `runner.ts:buildSystemPrompt()` — identity, rules, skills, and agent role definitions are all concatenated into the system prompt. Stale references cause agents to waste turns reading/writing files that no longer exist.

**Tech Stack:** Markdown files in `~/.codename-claude/` (identity, skills, agents). No TypeScript changes. Verification via grep.

**Scope:** 10 files across 3 directories under `~/.codename-claude/`. No source code changes. No tests to write (these are prompt configuration files, not code).

---

## What's Changing

| File | What's Wrong | Fix |
|---|---|---|
| `identity/system-prompt.md` | References ACTIVE.md and SESSIONS/ in both loading and end-of-session protocols | Remove both, replace with pipeline-state-aware instructions |
| `identity/skills/session-handoff.md` | Steps 1, 5, 6 reference ACTIVE.md and SESSIONS/ | Remove those steps, keep DECISIONS/PATTERNS/MISTAKES logging |
| `identity/skills/plan-feature.md` | References ACTIVE.md as output file | Remove ACTIVE.md, keep PLAN.md and DECISIONS.md |
| `identity/skills/review-loop.md` | Says REVIEW.md is the mandatory output | Clarify structured JSON is primary, REVIEW.md is fallback |
| `identity/skills/prune-memory.md` | SESSIONS/ in threshold table and steps | Remove SESSIONS/ entirely |
| `agents/architect.md` | Lists ACTIVE.md as allowed write target | Remove from constraints |
| `agents/builder.md` | References ACTIVE.md throughout (4 locations) | Remove all, use PLAN.md as primary instruction source |
| `agents/reviewer.md` | Says REVIEW.md is "mandatory" | Clarify structured JSON primary, REVIEW.md fallback |
| `agents/team-lead.md` | References ACTIVE.md and SESSIONS/ throughout | Remove all, use pipeline-state-aware language |
| `agents/memory-janitor.md` | References SESSIONS/ in duties | Remove, keep DECISIONS/PATTERNS/MISTAKES/RESEARCH pruning |

---

### Task 1: Update system-prompt.md — remove ACTIVE.md and SESSIONS/

**Files:**
- Modify: `~/.codename-claude/identity/system-prompt.md`

**Step 1: Replace the Context Loading Protocol section (lines 9-20)**

Replace the entire "Context Loading Protocol" section with:

```markdown
## Context Loading Protocol

**At the start of every session**, read the following `.brain/` files from the current project directory. These are your memory — they tell you what's happened, what's in progress, and what matters.

1. `PROJECT.md` — What this project is, its tech stack, architecture, and constraints
2. `DECISIONS.md` — Key decisions made, alternatives considered, and rationale
3. `PATTERNS.md` — Recurring patterns, conventions, and things that work well
4. `MISTAKES.md` — What went wrong before, why, and what to do instead

The pipeline engine manages session state automatically via `pipeline-state.json` — you don't need to track what's in progress or write session summaries. Focus on the persistent knowledge files above.

If any of these files are missing or empty, note it but continue. Don't block on missing context — work with what you have.
```

**Step 2: Replace the Session End Protocol section (lines 22-38)**

Replace the entire "Session End Protocol" section with:

```markdown
## Session End Protocol

**Before ending any session**, you MUST:

1. **Log decisions** — If you made any non-trivial decisions, add them to `DECISIONS.md` with alternatives considered and rationale
2. **Log mistakes** — If anything failed or you discovered a better approach, add it to `MISTAKES.md` with what/why/do-instead
3. **Update patterns** — If you discovered a useful pattern or convention, add it to `PATTERNS.md`

The pipeline engine tracks session state and progress automatically. You do not need to write session summaries or update status files.
```

**Step 3: Verify no ACTIVE.md or SESSIONS references remain**

Run: `grep -n 'ACTIVE.md\|SESSIONS' ~/.codename-claude/identity/system-prompt.md`
Expected: No output (zero matches)

**Step 4: Commit**

```bash
cd /Users/dwaynejoseph/Projects/codename-claude
git add -f ~/.codename-claude/identity/system-prompt.md
```

Note: These files are outside the repo. Defer commit until Task 10.

---

### Task 2: Update session-handoff.md — remove ACTIVE.md and SESSIONS/ steps

**Files:**
- Modify: `~/.codename-claude/identity/skills/session-handoff.md`

**Step 1: Replace the entire file content**

The old file has 6 steps. Steps 1 (ACTIVE.md), 5 (SESSIONS/), and 6 (latest.md) are dead. Keep steps 2, 3, 4.

```markdown
# Session Handoff

Follow these steps at the end of every session, without exception. This is how you preserve knowledge for future sessions.

## Steps

### 1. Log Decisions

If you made any non-trivial decision during this session, add an entry to `.brain/DECISIONS.md`:

```
## [Date] — [Decision Title]

**Context:** Why did this decision come up?
**Decision:** What was decided?
**Alternatives considered:** What else could we have done?
**Rationale:** Why this approach over the alternatives?
```

### 2. Log Mistakes

If anything failed, broke, or you discovered a better approach, add an entry to `.brain/MISTAKES.md`:

```
## [Date] — [What Happened]

**What:** What went wrong?
**Why:** Root cause or contributing factors
**Do Instead:** What to do differently next time
**Status:** resolved | open
```

### 3. Update Patterns

If you discovered a useful pattern, convention, or technique, add it to `.brain/PATTERNS.md`:

```
## [Pattern Name]

**When:** When does this pattern apply?
**Do:** What's the pattern?
**Why:** Why does this work well?
```

## Remember

- Never skip this process. A session without handoff is a session wasted.
- Be specific. "Made progress on the feature" is useless. "Implemented the token budget tracker with 5-hour rolling windows, tests passing" is useful.
- The next session reading this might be a different agent role. Write for them, not for yourself.
- The pipeline engine tracks session state automatically — you don't need to write session summaries or update status files.
```

**Step 2: Verify no ACTIVE.md or SESSIONS references remain**

Run: `grep -n 'ACTIVE.md\|SESSIONS\|latest.md' ~/.codename-claude/identity/skills/session-handoff.md`
Expected: No output (zero matches)

---

### Task 3: Update plan-feature.md — remove ACTIVE.md references

**Files:**
- Modify: `~/.codename-claude/identity/skills/plan-feature.md`

**Step 1: Update the Output Files section (lines 7-11)**

Replace:
```markdown
## Output Files

Your primary output is **`.brain/PLAN.md`** — this is what Builder reads to know what to build. Everything else is secondary.

- `.brain/PLAN.md` — The implementation plan (spec + ordered tasks). **Builder reads this.**
- `.brain/DECISIONS.md` — Architectural decisions made during planning.
- `.brain/ACTIVE.md` — Updated with current status.
```

With:
```markdown
## Output Files

Your primary output is **`.brain/PLAN.md`** — this is what Builder reads to know what to build. Everything else is secondary.

- `.brain/PLAN.md` — The implementation plan (spec + ordered tasks). **Builder reads this.**
- `.brain/DECISIONS.md` — Architectural decisions made during planning.
```

**Step 2: Remove step 4 "Update Active" (lines 71-75)**

Delete the entire "### 4. Update Active" section:
```
### 4. Update Active

Update `.brain/ACTIVE.md` with:
- What was planned
- Status: "Plan ready — awaiting Builder"
```

**Step 3: Renumber step 5 to step 4**

The old "### 5. Log Decisions" becomes "### 4. Log Decisions".

**Step 4: Verify no ACTIVE.md references remain**

Run: `grep -n 'ACTIVE.md' ~/.codename-claude/identity/skills/plan-feature.md`
Expected: No output (zero matches)

---

### Task 4: Update review-loop.md — structured output is primary, REVIEW.md is fallback

**Files:**
- Modify: `~/.codename-claude/identity/skills/review-loop.md`

**Step 1: Replace the Output Format section (lines 54-76)**

Replace the entire "## Output Format" section with:

```markdown
## Output Format

Your review verdict is captured two ways:

**1. Structured JSON (primary):** The pipeline engine captures your final response as structured JSON via SDK `outputFormat`. Your last message will be constrained to this schema automatically — just write your verdict naturally and the SDK handles the formatting.

**2. REVIEW.md (fallback):** As a backup, also write your review to **`.brain/REVIEW.md`**. If structured output fails (e.g., you hit max turns), the engine falls back to parsing the `Verdict:` line from this file.

Write REVIEW.md in this format:

```
## Review — [What's Being Reviewed]

**Score:** N/10
**Cycle:** M of 3
**Trend:** ↑ improving | → flat | ↓ declining
**Verdict:** APPROVE | REVISE | REDESIGN

### Findings
- [Finding 1: description and severity]
- [Finding 2: description and severity]

### Required Changes (if verdict is REVISE)
1. [Specific change needed]
2. [Specific change needed]

### Redesign Notes (if verdict is REDESIGN)
[What needs to be rethought at the architecture level]
```
```

**Step 2: Verify the file reads correctly**

Run: `grep -n 'mandatory' ~/.codename-claude/identity/skills/review-loop.md`
Expected: No output (the word "mandatory" should be gone)

---

### Task 5: Update prune-memory.md — remove SESSIONS/ references

**Files:**
- Modify: `~/.codename-claude/identity/skills/prune-memory.md`

**Step 1: Remove SESSIONS/ from the threshold table (line 13)**

Delete the row:
```
| `SESSIONS/` | Most recent 10 sessions | Move older sessions to `SESSIONS/archive/` |
```

**Step 2: Remove SESSIONS/ from the audit step (line 24)**

Delete the line:
```
- SESSIONS/: N files (threshold: 10)
```

**Step 3: Remove step 4 "Update latest.md" (lines 40-42)**

Delete the entire section:
```
### 4. Update latest.md

After pruning sessions, ensure `SESSIONS/latest.md` still points to the most recent session.
```

Renumber the old "### 5. Report" to "### 4. Report".

**Step 4: Remove SESSIONS line from the report template (line 53)**

Delete:
```
- SESSIONS: archived N old sessions
```

**Step 5: Verify no SESSIONS references remain**

Run: `grep -n 'SESSIONS\|latest.md' ~/.codename-claude/identity/skills/prune-memory.md`
Expected: No output (zero matches)

---

### Task 6: Update architect.md — remove ACTIVE.md from constraints

**Files:**
- Modify: `~/.codename-claude/agents/architect.md`

**Step 1: Update the Critical Constraints section (line 47)**

Replace:
```markdown
- You ONLY write to `.brain/` files — specifically `.brain/PLAN.md`, `.brain/DECISIONS.md`, `.brain/ACTIVE.md`, and `.brain/PATTERNS.md`
```

With:
```markdown
- You ONLY write to `.brain/` files — specifically `.brain/PLAN.md`, `.brain/DECISIONS.md`, and `.brain/PATTERNS.md`
```

**Step 2: Verify no ACTIVE.md references remain**

Run: `grep -n 'ACTIVE.md' ~/.codename-claude/agents/architect.md`
Expected: No output (zero matches)

---

### Task 7: Update builder.md — remove ACTIVE.md references

**Files:**
- Modify: `~/.codename-claude/agents/builder.md`

**Step 1: Fix the role intro (line 19)**

Replace:
```markdown
Your job is to write code, run tests, and ship working software. You take tasks from ACTIVE.md and turn them into committed, tested code. You run inside a sandboxed environment for safety.
```

With:
```markdown
Your job is to write code, run tests, and ship working software. You follow the implementation plan in `.brain/PLAN.md` and turn it into committed, tested code. You run inside a sandboxed environment for safety.
```

**Step 2: Remove ACTIVE.md from "How You Work" (lines 32-33, 39)**

Replace the entire "## How You Work" numbered list with:

```markdown
## How You Work

1. **First, read `.brain/PLAN.md`** — this is your implementation spec from Architect. It contains the architecture, file structure, ordered tasks, and acceptance criteria. Follow it.
2. Read `.brain/PATTERNS.md` to follow established conventions
3. If this is a new project, set it up from scratch: `git init`, `bun init`, install dependencies with `bun install`, create directory structure — whatever PLAN.md specifies. Always use bun, not npm.
4. Implement each task from PLAN.md in order
5. Write tests alongside implementation code (TDD when acceptance criteria are clear)
6. Run the build and tests before considering work done
7. Make small, incremental commits — don't hold work until everything's done
```

**Step 3: Fix the "When You're Stuck" section (line 53)**

Replace:
```markdown
- If none of those help, note the blocker in ACTIVE.md and stop. Don't guess at architecture — that's Architect's job.
```

With:
```markdown
- If none of those help, log the blocker to `.brain/MISTAKES.md` and stop. Don't guess at architecture — that's Architect's job.
```

**Step 4: Verify no ACTIVE.md references remain**

Run: `grep -n 'ACTIVE.md' ~/.codename-claude/agents/builder.md`
Expected: No output (zero matches)

---

### Task 8: Update reviewer.md — structured output primary, REVIEW.md fallback

**Files:**
- Modify: `~/.codename-claude/agents/reviewer.md`

**Step 1: Update the "How You Work" section (lines 36-39)**

Replace lines 36-39:
```markdown
6. **Write your review to `.brain/REVIEW.md`** — this is mandatory
7. The `Verdict:` line in REVIEW.md MUST be exactly one of: `APPROVE`, `REVISE`, or `REDESIGN`
   - The pipeline engine parses this line to decide what happens next
   - If it's missing or misspelled, the pipeline assumes APPROVE
```

With:
```markdown
6. Your final response is captured as **structured JSON** by the pipeline engine automatically — this is the primary verdict path
7. As a backup, also **write your review to `.brain/REVIEW.md`** with a `Verdict: APPROVE`, `Verdict: REVISE`, or `Verdict: REDESIGN` line
   - The engine tries structured output first, falls back to REVIEW.md if needed
   - Both paths feed into the same retry logic
```

**Step 2: Verify the word "mandatory" is gone**

Run: `grep -n 'mandatory' ~/.codename-claude/agents/reviewer.md`
Expected: No output (zero matches)

---

### Task 9: Update team-lead.md — remove ACTIVE.md and SESSIONS/ references

**Files:**
- Modify: `~/.codename-claude/agents/team-lead.md`

**Step 1: Update "Architect" teammate description (line 43)**

Replace:
```markdown
- **What it produces:** Specs, task breakdowns in `.brain/PLAN.md` and `ACTIVE.md`
```

With:
```markdown
- **What it produces:** Specs, task breakdowns in `.brain/PLAN.md` and `.brain/DECISIONS.md`
```

**Step 2: Update the spawn template context section (lines 74-75)**

Replace:
```
[Paste relevant .brain/ file contents — PROJECT.md, ACTIVE.md, etc.]
```

With:
```
[Paste relevant .brain/ file contents — PROJECT.md, PLAN.md, DECISIONS.md, etc.]
```

**Step 3: Update the Builder spawn example (lines 98-112)**

Replace:
```
## ACTIVE.md
[paste contents]

# Your Task
Implement the todo list API endpoints as specified in ACTIVE.md:
1. POST /todos — create a todo
2. GET /todos — list all todos
3. PATCH /todos/:id — mark done

Run tests after each endpoint. Commit after all tests pass.

# Output
Update ACTIVE.md to mark completed tasks. Write a summary to .brain/SESSIONS/.
```

With:
```
## PLAN.md
[paste contents]

# Your Task
Implement the todo list API endpoints as specified in PLAN.md:
1. POST /todos — create a todo
2. GET /todos — list all todos
3. PATCH /todos/:id — mark done

Run tests after each endpoint. Commit after all tests pass.

# Output
Log any decisions to .brain/DECISIONS.md. Log any mistakes to .brain/MISTAKES.md.
```

**Step 4: Update the Orchestration Protocol (lines 128-134)**

Replace:
```markdown
## Orchestration Protocol

1. **Read context:** Load `.brain/ACTIVE.md` and `.brain/PROJECT.md` to understand current state
2. **Assess:** What kind of task is this? What's the minimum set of teammates needed?
3. **Spawn first teammate:** Use the Task tool with the full spawn template above
4. **Wait and read outputs:** After the teammate completes, read their `.brain/` outputs
5. **Spawn next teammate:** Pass the previous teammate's outputs as context to the next one
6. **Handle review loop:** If Reviewer scores < 8, respawn Builder with the specific feedback. Max 3 cycles.
7. **Report:** Summarize what was accomplished and update `.brain/ACTIVE.md`
```

With:
```markdown
## Orchestration Protocol

1. **Read context:** Load `.brain/PROJECT.md` and `.brain/PLAN.md` to understand current state
2. **Assess:** What kind of task is this? What's the minimum set of teammates needed?
3. **Spawn first teammate:** Use the Task tool with the full spawn template above
4. **Wait and read outputs:** After the teammate completes, read their `.brain/` outputs
5. **Spawn next teammate:** Pass the previous teammate's outputs as context to the next one
6. **Handle review loop:** If Reviewer scores < 8, respawn Builder with the specific feedback. Max 3 cycles.
7. **Report:** Summarize what was accomplished. Log decisions and patterns discovered.
```

**Step 5: Update Session End section (lines 151-157)**

Replace:
```markdown
## Session End

When the pipeline completes:
1. Summarize what was accomplished
2. List any open items or follow-ups
3. Update `.brain/ACTIVE.md` with final status
4. Write a session summary to `.brain/SESSIONS/`
```

With:
```markdown
## Session End

When the pipeline completes:
1. Summarize what was accomplished
2. List any open items or follow-ups
3. Log decisions to `.brain/DECISIONS.md`
4. Log any mistakes or learnings to `.brain/MISTAKES.md`
```

**Step 6: Verify no ACTIVE.md or SESSIONS references remain**

Run: `grep -n 'ACTIVE.md\|SESSIONS' ~/.codename-claude/agents/team-lead.md`
Expected: No output (zero matches)

---

### Task 10: Update memory-janitor.md — remove SESSIONS/ references

**Files:**
- Modify: `~/.codename-claude/agents/memory-janitor.md`

**Step 1: Update "What You Do" section (lines 19-24)**

Replace:
```markdown
## What You Do

- Prune old entries from DECISIONS.md, MISTAKES.md, and SESSIONS/
- Consolidate duplicate patterns in PATTERNS.md
- Archive old research files
- Ensure SESSIONS/latest.md is accurate
- Report what was pruned
```

With:
```markdown
## What You Do

- Prune old entries from DECISIONS.md and MISTAKES.md
- Consolidate duplicate patterns in PATTERNS.md
- Archive old research files
- Report what was pruned
```

**Step 2: Verify no SESSIONS references remain**

Run: `grep -n 'SESSIONS\|latest.md' ~/.codename-claude/agents/memory-janitor.md`
Expected: No output (zero matches)

---

### Task 11: Final verification — grep all files for stale references

**Files:**
- None to modify — verification only

**Step 1: Verify no ACTIVE.md references remain in any identity/agent/skill file**

Run: `grep -rn 'ACTIVE.md' ~/.codename-claude/identity/ ~/.codename-claude/agents/`
Expected: No output (zero matches across all files)

**Step 2: Verify no SESSIONS references remain**

Run: `grep -rn 'SESSIONS' ~/.codename-claude/identity/ ~/.codename-claude/agents/`
Expected: No output (zero matches across all files)

**Step 3: Verify no latest.md references remain**

Run: `grep -rn 'latest.md' ~/.codename-claude/identity/ ~/.codename-claude/agents/`
Expected: No output (zero matches across all files)

**Step 4: Verify REVIEW.md is referenced correctly (fallback, not mandatory)**

Run: `grep -rn 'mandatory' ~/.codename-claude/identity/ ~/.codename-claude/agents/`
Expected: No output (zero matches — no file should call REVIEW.md "mandatory")

**Step 5: Spot-check that the correct files ARE still referenced**

Run: `grep -rn 'PLAN.md\|DECISIONS.md\|PATTERNS.md\|MISTAKES.md' ~/.codename-claude/identity/system-prompt.md`
Expected: All four files appear in the Context Loading Protocol

**Step 6: Commit all changes**

Since these files are outside the repo (in `~/.codename-claude/`), they won't appear in `git status` for the codename-claude repo. The changes are configuration files that take effect immediately on the next agent session.

Optionally, verify by reading the updated system-prompt.md to confirm it looks correct:

Run: `cat ~/.codename-claude/identity/system-prompt.md`

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `grep -rn 'ACTIVE.md' ~/.codename-claude/identity/ ~/.codename-claude/agents/` → zero matches
- [ ] `grep -rn 'SESSIONS' ~/.codename-claude/identity/ ~/.codename-claude/agents/` → zero matches
- [ ] `grep -rn 'latest.md' ~/.codename-claude/identity/ ~/.codename-claude/agents/` → zero matches
- [ ] `grep -rn 'mandatory' ~/.codename-claude/identity/ ~/.codename-claude/agents/` → zero matches
- [ ] `system-prompt.md` Context Loading lists: PROJECT.md, DECISIONS.md, PATTERNS.md, MISTAKES.md (no ACTIVE.md, no SESSIONS/)
- [ ] `system-prompt.md` Session End lists: log decisions, log mistakes, update patterns (no ACTIVE.md update, no SESSIONS/ write)
- [ ] `session-handoff.md` has 3 steps: Decisions, Mistakes, Patterns (no ACTIVE.md, no SESSIONS/)
- [ ] `plan-feature.md` output files list: PLAN.md, DECISIONS.md (no ACTIVE.md)
- [ ] `review-loop.md` output format mentions structured JSON as primary, REVIEW.md as fallback
- [ ] `prune-memory.md` thresholds table has 4 rows (no SESSIONS/)
- [ ] `architect.md` constraints list: PLAN.md, DECISIONS.md, PATTERNS.md (no ACTIVE.md)
- [ ] `builder.md` "How You Work" starts with PLAN.md (no ACTIVE.md anywhere)
- [ ] `reviewer.md` mentions structured JSON as primary, REVIEW.md as backup
- [ ] `team-lead.md` orchestration protocol starts with PROJECT.md + PLAN.md (no ACTIVE.md)
- [ ] `memory-janitor.md` duties list: DECISIONS.md, MISTAKES.md, PATTERNS.md, RESEARCH/ (no SESSIONS/)
