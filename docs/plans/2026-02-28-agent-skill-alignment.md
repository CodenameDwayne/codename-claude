# Agent & Skill Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update agent definitions and skills so the autonomous pipeline mirrors the superpowers workflow — architect writes plans with `### Task N:` headings (required by the pipeline orchestrator), builder follows the `execute-plan` skill (mirrors superpowers' `executing-plans`), reviewer runs verification evidence before verdicts, and all agents understand batch-scoped execution.

**Architecture:** Rewrite the `plan-feature` skill to produce writing-plans format. Add two new skills (`execute-plan`, `verify-completion`) adapted from superpowers. Update 3 agent definitions (architect, builder, reviewer) with new skill references and behavior. Update `review-loop` and `review-code` skills with verification and investigation requirements. TDD is not a separate skill — it flows through the plan format (every task has TDD steps that builder follows literally).

**Tech Stack:** Markdown (agent/skill definitions), no code changes

---

### Task 1: Rewrite the `plan-feature` skill to match writing-plans format

**Files:**
- Modify: `~/.codename-claude/identity/skills/plan-feature.md`

**Step 1: Read the current skill**

Run: `cat ~/.codename-claude/identity/skills/plan-feature.md`

**Step 2: Rewrite the skill**

Replace the entire contents of `plan-feature.md` with:

```markdown
# Plan Feature

This skill defines how Architect creates implementation plans. Plans MUST follow a strict format because the pipeline orchestrator parses `### Task N:` headings to batch work for Builder and Reviewer.

## Output Files

- `.brain/PLAN.md` — The implementation plan (primary output)
- `.brain/DECISIONS.md` — Architectural decisions made during planning

## Steps

### 1. Understand the Problem

Before planning:
- Read `.brain/PROJECT.md` for project context
- Read `.brain/RESEARCH/` if Scout has produced research
- Read `.brain/PATTERNS.md` for established conventions
- Read `.brain/MISTAKES.md` for known pitfalls to avoid

### 2. Design the Architecture

- Identify the components, data flow, and interfaces needed
- Choose technologies that fit the existing stack (prefer boring over cutting-edge)
- Consider 2-3 approaches, pick the simplest one that works
- Log decisions to `.brain/DECISIONS.md` with context, alternatives, and rationale

### 3. Write the Plan to `.brain/PLAN.md`

Use this EXACT template:

    # [Feature Name] Implementation Plan

    **Goal:** [One sentence describing what this builds]

    **Architecture:** [2-3 sentences about approach]

    **Tech Stack:** [Key technologies/libraries]

    ---

    ### Task 1: [Component Name]

    **Files:**
    - Create: `exact/path/to/file.ts`
    - Modify: `exact/path/to/existing.ts`
    - Test: `tests/exact/path/to/test.ts`

    **Step 1: Write the failing test**

    [Exact test code]

    **Step 2: Run test to verify it fails**

    Run: `bun test tests/path/test.ts`
    Expected: FAIL with "[specific error]"

    **Step 3: Write minimal implementation**

    [Exact implementation code]

    **Step 4: Run test to verify it passes**

    Run: `bun test tests/path/test.ts`
    Expected: PASS

    **Step 5: Commit**

    Run: `git add [files] && git commit -m "feat: [description]"`

    ### Task 2: [Next Component]

    [Same structure...]

## Critical Rules

1. **`### Task N:` headings are MANDATORY** — The pipeline orchestrator regex-parses these to batch work. Without them, Builder gets all tasks at once with no review checkpoints.

2. **Bite-sized tasks** — Each task should be 2-5 minutes of work. "Implement auth" is too big. "Write the login route handler" is right.

3. **TDD steps in every task** — Every task follows: write failing test, verify fail, implement, verify pass, commit. Builder follows these steps literally via the execute-plan skill.

4. **Exact file paths** — Always specify the full path. Never say "create a file for X" — say "Create: `src/auth/login.ts`".

5. **Exact code** — Write the actual code in the plan, not "add validation logic." Builder should be able to copy-paste and have it work.

6. **Exact commands** — Write the actual commands with expected output. Not "run tests" but "Run: `bun test src/auth/login.test.ts` — Expected: PASS".

7. **One commit per task** — Each task ends with a commit step.

## Quality Check

Before finishing, verify:
- [ ] Every task has a `### Task N:` heading
- [ ] Every task has Files, Steps, and a Commit step
- [ ] Every task has test-first steps (write test, verify fail, implement, verify pass)
- [ ] No task is larger than 5 minutes of implementation work
- [ ] All file paths are exact (no placeholders)
- [ ] All code is complete (no "add logic here" comments)
```

**Step 3: Verify the rewrite**

Run: `grep -c "### Task" ~/.codename-claude/identity/skills/plan-feature.md`
Expected: Multiple matches showing the template has `### Task` references

---

### Task 2: Create the `execute-plan` skill for Builder

**Files:**
- Create: `~/.codename-claude/identity/skills/execute-plan.md`

**Step 1: Create the execute-plan skill**

Write `~/.codename-claude/identity/skills/execute-plan.md`:

```markdown
# Execute Plan

This skill defines how Builder implements work from `.brain/PLAN.md`. Builder follows the plan step by step — including TDD steps — rather than freelancing.

## The Process

### 1. Load and Review the Plan

1. Read `.brain/PLAN.md`
2. Read `.brain/PATTERNS.md` for established conventions
3. Read `.brain/MISTAKES.md` for known pitfalls
4. Review the plan critically — if anything is unclear, contradictory, or missing, log the concern to `.brain/MISTAKES.md` and stop. Do not guess.

### 2. Determine Your Scope

- If the pipeline gives you a **batch scope** (e.g., "Tasks 1-3"), implement ONLY those tasks
- If no batch scope is given, implement all tasks in order
- Never work outside your scope — other builder instances handle other batches

### 3. Execute Each Task

For each task in your scope:

1. Read the task's steps carefully
2. Follow each step EXACTLY as written:
   - If the step says "write this test" — write exactly that test
   - If the step says "run this command" — run exactly that command
   - If the step says "expect FAIL" — verify it actually fails
   - If the step says "expect PASS" — verify it actually passes
3. If a step doesn't work as expected, investigate:
   - Re-read the step — did you miss something?
   - Check `.brain/PATTERNS.md` — is there a convention that applies?
   - Check `.brain/MISTAKES.md` — is this a known pitfall?
   - If still stuck, log the blocker to `.brain/MISTAKES.md` and stop
4. Commit after each task as specified in the plan

### 4. Verify Before Finishing

After all tasks in your scope are done:

1. Run the full test suite: `bun test`
2. Read the COMPLETE output — check for 0 failures
3. If there are failures, fix them before claiming done
4. Follow the **verify-completion** skill — no claims without evidence

## What Builder Does NOT Do

- Does NOT skip plan steps ("I'll do it faster my way")
- Does NOT add features not in the plan ("while I'm here...")
- Does NOT rewrite tests from the plan ("I know a better way to test this")
- Does NOT proceed when stuck (stops and logs the blocker)

## When to Stop

Stop immediately and log to `.brain/MISTAKES.md` when:
- A plan step is unclear or contradictory
- A test fails for a different reason than expected
- A dependency is missing that the plan didn't account for
- You've spent more than 5 minutes on a single step without progress
```

**Step 2: Verify the file exists**

Run: `head -5 ~/.codename-claude/identity/skills/execute-plan.md`
Expected: Shows `# Execute Plan` and first lines

---

### Task 3: Create the `verify-completion` skill

**Files:**
- Create: `~/.codename-claude/identity/skills/verify-completion.md`

**Step 1: Create the verification skill**

Write `~/.codename-claude/identity/skills/verify-completion.md`:

```markdown
# Verify Completion

Before claiming any work is complete, you MUST have fresh verification evidence. This skill applies to both Builder and Reviewer.

## The Rule

**No completion claims without fresh verification evidence.**

"I think it works" is not evidence. "The tests passed last time" is not evidence. Run verification NOW and see results NOW.

## Before Claiming Done

1. **Identify** what command proves your work is correct (usually `bun test` or `bun run build`)
2. **Run** the command fresh — not from cache, not from memory
3. **Read** the complete output — check exit code, check failure count, check for warnings
4. **Verify** the output actually confirms your claim
5. **Only then** claim completion

## What Counts as Evidence

| Claim | Required Evidence |
|-------|-------------------|
| "Tests pass" | Full `bun test` output showing 0 failures |
| "Build succeeds" | Full `bun run build` output with exit code 0 |
| "Bug is fixed" | Test that reproduced the bug now passes |
| "Feature works" | New tests for the feature all pass |

## What Does NOT Count

- "It should work" — Run it.
- "Tests passed before my change" — Run them after.
- "I only changed one line" — One line can break everything. Run it.
- "The linter is happy" — Linting is not testing. Run tests.
- Previous test runs from earlier in the session — Run fresh.

## When to Verify

- After completing each task in a plan
- Before making a commit
- Before claiming a batch is done
- Before any status update that says "complete" or "done"
```

**Step 2: Verify the file exists**

Run: `head -5 ~/.codename-claude/identity/skills/verify-completion.md`
Expected: Shows `# Verify Completion` and first lines

---

### Task 4: Update Builder agent definition

**Files:**
- Modify: `~/.codename-claude/agents/builder.md`

**Step 1: Read the current builder agent**

Run: `cat ~/.codename-claude/agents/builder.md`

**Step 2: Update the frontmatter to add new skills**

Change the skills list from:

```yaml
skills:
  - learning-loop
  - session-handoff
```

To:

```yaml
skills:
  - execute-plan
  - verify-completion
  - learning-loop
  - session-handoff
```

**Step 3: Update the "How Builder Works" section**

Replace the current "How Builder Works" section with:

```markdown
## How Builder Works

1. **Load the plan** — Read `.brain/PLAN.md`, `.brain/PATTERNS.md`, `.brain/MISTAKES.md`
2. **Review critically** — If anything is unclear or contradictory, log to `.brain/MISTAKES.md` and stop. Do not guess.
3. **Determine scope** — If the pipeline gives you a batch scope (e.g., "Tasks 1-3"), implement ONLY those tasks. Never work outside your scope.
4. **Execute each task step by step** — Follow the **execute-plan** skill. Every step in the plan is literal:
   - "Write this test" → write exactly that test
   - "Run it, expect FAIL" → run it, confirm it fails
   - "Write this code" → write exactly that code
   - "Run it, expect PASS" → run it, confirm it passes
   - "Commit" → commit with the specified message
5. **Verify before finishing** — Follow the **verify-completion** skill. Run `bun test`, read the full output, confirm 0 failures. No claims without evidence.
```

**Step 4: Update the "Coding Principles" section**

Replace the coding principles with:

```markdown
## Coding Principles

- Simple over clever
- Explicit error handling
- Typed everything
- One commit = one logical change
- Follow the plan literally — TDD discipline comes through the plan steps, not freestyle
```

**Step 5: Verify the update**

Run: `grep "execute-plan" ~/.codename-claude/agents/builder.md`
Expected: Shows references to execute-plan skill

---

### Task 5: Update Reviewer agent definition

**Files:**
- Modify: `~/.codename-claude/agents/reviewer.md`

**Step 1: Read the current reviewer agent**

Run: `cat ~/.codename-claude/agents/reviewer.md`

**Step 2: Update the frontmatter to add verify-completion skill**

Change the skills list from:

```yaml
skills:
  - review-loop
  - review-code
  - learning-loop
  - session-handoff
```

To:

```yaml
skills:
  - review-loop
  - review-code
  - verify-completion
  - learning-loop
  - session-handoff
```

**Step 3: Update "How Reviewer Works" to include batch scope and verification**

Replace the current "How Reviewer Works" section with:

```markdown
## How Reviewer Works

1. **Determine scope** — If the pipeline gives you a batch scope (e.g., "Tasks 1-3"), focus your review on those specific tasks only
2. **Understand intent** — Read `.brain/PLAN.md` to understand what was supposed to be built
3. **Read the code** — Read the source code that Builder created for the scoped tasks
4. **Run verification fresh** — Follow the **verify-completion** skill:
   - Run `bun test` and read the FULL output
   - Run `bun run build` if applicable
   - Do NOT rely on Builder's claim that tests pass — verify yourself
5. **Evaluate quality** — Follow the **review-code** skill checklist
6. **Investigate before flagging** — If something looks wrong:
   - Find a working example of similar code in the codebase
   - Compare against the working example to identify what's different
   - Only flag issues where you understand WHY it's wrong, not just that it looks different
7. **Score and route** — Follow the **review-loop** skill for scoring and verdict
8. **Output** — Final response is captured as structured JSON by the pipeline engine. Also write to `.brain/REVIEW.md` as fallback.

## When to Escalate to Human

Only escalate when the user NEEDS to provide something you cannot determine from the codebase:
- API keys, credentials, or secrets not in environment
- Ambiguous business requirements the plan doesn't clarify
- External service configuration requiring account access

Do NOT escalate for:
- Code quality issues (use REVISE verdict)
- Architecture concerns (use REDESIGN verdict)
- Missing tests (use REVISE verdict with specific feedback)
```

**Step 4: Verify the update**

Run: `grep -E "verify-completion|batch scope" ~/.codename-claude/agents/reviewer.md`
Expected: Shows both references

---

### Task 6: Update Architect agent definition

**Files:**
- Modify: `~/.codename-claude/agents/architect.md`

**Step 1: Read the current architect agent**

Run: `cat ~/.codename-claude/agents/architect.md`

**Step 2: Add plan format reminder after Critical Constraints**

After the existing "Critical Constraints" section, add:

```markdown
## Plan Format (CRITICAL)

Plans written to `.brain/PLAN.md` MUST use `### Task N:` headings with TDD steps. Follow the **plan-feature** skill exactly. The pipeline orchestrator parses these headings to batch work for Builder and Reviewer — if you don't use this format, the pipeline cannot create review checkpoints and Builder gets all tasks at once with no quality gates.
```

**Step 3: Verify the update**

Run: `grep "Task N:" ~/.codename-claude/agents/architect.md`
Expected: Shows the reference

---

### Task 7: Update `review-loop` skill with verification requirement

**Files:**
- Modify: `~/.codename-claude/identity/skills/review-loop.md`

**Step 1: Read the current review-loop skill**

Run: `cat ~/.codename-claude/identity/skills/review-loop.md`

**Step 2: Add verification requirement before the scoring section**

Find the section that describes review steps / the checklist. Before the scoring/routing section, add:

```markdown
### Verification (MANDATORY)

Before scoring, you MUST run verification yourself. Follow the **verify-completion** skill:

1. Run `bun test` — read the full output, check for 0 failures
2. Run `bun run build` if the project has a build step
3. If Builder claims "all tests pass" but you see failures, that's a REVISE verdict automatically

Do NOT score based on reading code alone. You must have fresh test evidence.
```

**Step 3: Verify the update**

Run: `grep -E "verify-completion|MANDATORY" ~/.codename-claude/identity/skills/review-loop.md`
Expected: Shows both references

---

### Task 8: Update `review-code` skill with root-cause investigation

**Files:**
- Modify: `~/.codename-claude/identity/skills/review-code.md`

**Step 1: Read the current review-code skill**

Run: `cat ~/.codename-claude/identity/skills/review-code.md`

**Step 2: Add root-cause investigation guidance at the end**

At the end of the file, after the existing checklist sections, add:

```markdown
## Investigation Before Flagging

When you find something that looks wrong:

1. **Find a working example** — Search the codebase for similar code that works correctly
2. **Compare** — What's different between the working example and the code under review?
3. **Understand WHY** — Only flag issues where you can explain why the code is wrong, not just that it looks different

This prevents false positives. "This doesn't match the pattern" is not a valid issue. "This skips input validation that the pattern requires because [reason]" is.
```

**Step 3: Verify the update**

Run: `grep "Investigation Before Flagging" ~/.codename-claude/identity/skills/review-code.md`
Expected: Shows the heading

---

### Task 9: Final verification

**Files:**
- None (verification only)

**Step 1: Verify all new skill files exist**

Run: `ls -la ~/.codename-claude/identity/skills/execute-plan.md ~/.codename-claude/identity/skills/verify-completion.md`
Expected: Both files exist

**Step 2: Verify plan-feature uses `### Task N:` format**

Run: `grep "### Task" ~/.codename-claude/identity/skills/plan-feature.md`
Expected: Multiple matches showing the template

**Step 3: Verify builder references execute-plan skill**

Run: `grep "execute-plan" ~/.codename-claude/agents/builder.md`
Expected: Shows execute-plan in skills list and in How Builder Works

**Step 4: Verify reviewer references verify-completion and batch scope**

Run: `grep -E "verify-completion|batch scope" ~/.codename-claude/agents/reviewer.md`
Expected: Shows both

**Step 5: Verify architect references plan format**

Run: `grep "Task N:" ~/.codename-claude/agents/architect.md`
Expected: Shows the critical format reminder

**Step 6: Verify no agent references a skill that doesn't exist**

For each skill referenced in agent frontmatter, verify the file exists:
- `execute-plan` → `~/.codename-claude/identity/skills/execute-plan.md`
- `verify-completion` → `~/.codename-claude/identity/skills/verify-completion.md`
- `plan-feature` → `~/.codename-claude/identity/skills/plan-feature.md`
- `review-loop` → `~/.codename-claude/identity/skills/review-loop.md`
- `review-code` → `~/.codename-claude/identity/skills/review-code.md`
- `learning-loop` → `~/.codename-claude/identity/skills/learning-loop.md`
- `session-handoff` → `~/.codename-claude/identity/skills/session-handoff.md`
- `research-scan` → `~/.codename-claude/identity/skills/research-scan.md`
- `init-project` → `~/.codename-claude/identity/skills/init-project.md`
- `prune-memory` → `~/.codename-claude/identity/skills/prune-memory.md`

Run: `ls ~/.codename-claude/identity/skills/*.md`
Expected: All referenced skills exist as files
