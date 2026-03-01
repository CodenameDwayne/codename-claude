# Audit Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 37 issues identified in the pipeline audit across 5 phases — from critical safety fixes through daemon hardening.

**Architecture:** Systematic remediation of the existing pipeline engine, runner, router, state, and daemon modules. Each fix is surgically scoped to minimize blast radius. TDD throughout — write failing tests first, then implement.

**Tech Stack:** TypeScript, Vitest, Bun, Claude Agent SDK, proper-lockfile

---

## Phase 1: Critical Safety (Fail-Closed + Feedback Loop)

### Task 1: Fix `validateArchitect` to fail-closed when PLAN.md is missing

**Files:**
- Modify: `src/pipeline/engine.ts:310-337`
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('validateArchitect fails when PLAN.md does not exist', async () => {
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });

  // Run with architect stage — no PLAN.md written by mock
  const result = await engine.run({
    stages: [{ agent: 'architect', teams: false }],
    project: tmpDir,
    task: 'test task',
  });

  expect(result.completed).toBe(false);
  expect(result.finalVerdict).toContain('VALIDATION_FAILED');
  expect(result.finalVerdict).toContain('PLAN.md');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "validateArchitect fails when PLAN.md"`
Expected: FAIL — currently the catch block silently returns `null`

**Step 3: Write minimal implementation**

In `engine.ts` `validateArchitect`, replace the catch block (lines 332-334):

```typescript
private async validateArchitect(project: string): Promise<string | null> {
  const planPath = join(project, '.brain', 'PLAN.md');
  let content: string;
  try {
    content = await readFile(planPath, 'utf-8');
  } catch {
    return 'Architect did not produce .brain/PLAN.md';
  }

  if (!content.trim()) return 'Architect wrote empty .brain/PLAN.md';

  // Validate task headings exist and are sequential
  const taskRegex = /^###\s+Task\s+(\d+):/gm;
  const taskNumbers: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = taskRegex.exec(content)) !== null) {
    taskNumbers.push(parseInt(match[1]!, 10));
  }

  if (taskNumbers.length > 0) {
    for (let i = 0; i < taskNumbers.length; i++) {
      if (taskNumbers[i] !== i + 1) {
        return `PLAN.md has non-sequential task numbering: expected Task ${i + 1}, found Task ${taskNumbers[i]}`;
      }
    }
  }

  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "validateArchitect fails when PLAN.md"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "fix(pipeline): make validateArchitect fail-closed when PLAN.md missing"
```

---

### Task 2: Implement `validateBuilder` with test runner + git diff check

**Files:**
- Modify: `src/pipeline/engine.ts:339-342`
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('validateBuilder fails when no files were changed', async () => {
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });

  // Write a PLAN.md so architect passes, then builder runs but changes nothing
  await mkdir(join(tmpDir, '.brain'), { recursive: true });
  await writeFile(join(tmpDir, '.brain', 'PLAN.md'), '### Task 1: Test\nSome content');

  // Init a git repo so git diff returns empty
  execFileSync('git', ['init'], { cwd: tmpDir });
  execFileSync('git', ['add', '.'], { cwd: tmpDir });
  execFileSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: tmpDir });

  const result = await engine.run({
    stages: [
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
    ],
    project: tmpDir,
    task: 'test task',
  });

  expect(result.completed).toBe(false);
  expect(result.finalVerdict).toContain('VALIDATION_FAILED');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "validateBuilder fails when no files were changed"`
Expected: FAIL — `validateBuilder` currently always returns `null`

**Step 3: Write minimal implementation**

Replace `validateBuilder` in `engine.ts`:

```typescript
private async validateBuilder(project: string): Promise<string | null> {
  // 1. Check for file changes via git diff
  try {
    const { execFileSync } = await import('node:child_process');
    const diff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: project,
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: project,
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();

    if (!diff && !untracked) {
      return 'Builder did not modify any files (no git diff, no new files)';
    }
  } catch {
    // Not a git repo or git not available — skip diff check
  }

  // 2. Run test suite if available
  try {
    const { execFileSync } = await import('node:child_process');
    const pkgRaw = await readFile(join(project, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    if (pkg.scripts?.['test']) {
      execFileSync('bun', ['test'], {
        cwd: project,
        encoding: 'utf-8',
        timeout: 120_000,
        stdio: 'pipe',
      });
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status !== null) {
      return `Builder validation failed: tests did not pass`;
    }
    // No package.json or no test script — skip test check
  }

  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "validateBuilder fails"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): implement validateBuilder with git diff + test runner"
```

---

### Task 3: Fix `parseReviewVerdict` to default to REVISE instead of APPROVE

**Files:**
- Modify: `src/pipeline/engine.ts:285-295`
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('parseReviewVerdict defaults to REVISE when verdict not found', async () => {
  // Write a REVIEW.md without a verdict line
  await mkdir(join(tmpDir, '.brain'), { recursive: true });
  await writeFile(join(tmpDir, '.brain', 'REVIEW.md'), 'Some review text without a verdict');

  // Access private method via engine['parseReviewVerdict']
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });
  const verdict = await (engine as any).parseReviewVerdict(tmpDir);
  expect(verdict).toBe('REVISE');
});

it('parseReviewVerdict defaults to REVISE when REVIEW.md missing', async () => {
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });
  const verdict = await (engine as any).parseReviewVerdict(tmpDir);
  expect(verdict).toBe('REVISE');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "parseReviewVerdict defaults to REVISE"`
Expected: FAIL — currently returns 'APPROVE' in both cases

**Step 3: Write minimal implementation**

```typescript
private async parseReviewVerdict(project: string): Promise<string> {
  try {
    const reviewPath = join(project, '.brain', 'REVIEW.md');
    const content = await readFile(reviewPath, 'utf-8');
    const match = content.match(/\*{0,2}Verdict:?\*{0,2}\s*(APPROVE|REVISE|REDESIGN)/i);
    return match ? match[1]!.toUpperCase() : 'REVISE';
  } catch {
    // No REVIEW.md — fail-closed: assume revision needed
    return 'REVISE';
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "parseReviewVerdict defaults to REVISE"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "fix(pipeline): parseReviewVerdict defaults to REVISE (fail-closed)"
```

---

### Task 4: Reject empty stage arrays from router

**Files:**
- Modify: `src/pipeline/engine.ts:60-70`
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('rejects empty stages array', async () => {
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });

  await expect(engine.run({
    stages: [],
    project: tmpDir,
    task: 'test task',
  })).rejects.toThrow('Pipeline received empty stages array');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "rejects empty stages"`
Expected: FAIL — currently runs the while loop zero times and returns completed

**Step 3: Write minimal implementation**

Add at the top of `run()` method, after `let stages = [...options.stages];`:

```typescript
if (stages.length === 0) {
  throw new Error('Pipeline received empty stages array — router returned no stages');
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "rejects empty stages"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "fix(pipeline): reject empty stages array from router"
```

---

### Task 5: Add `validateScout` for research output verification

**Files:**
- Modify: `src/pipeline/engine.ts:297-308` (add scout case to `validateStage`)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('validateScout fails when RESEARCH/ directory is empty', async () => {
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });

  const result = await engine.run({
    stages: [{ agent: 'scout', teams: false }],
    project: tmpDir,
    task: 'research task',
  });

  expect(result.completed).toBe(false);
  expect(result.finalVerdict).toContain('VALIDATION_FAILED');
  expect(result.finalVerdict).toContain('RESEARCH');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "validateScout fails"`
Expected: FAIL — no scout case in validateStage, returns null

**Step 3: Write minimal implementation**

Add to `validateStage`:

```typescript
private async validateStage(agent: string, project: string, structuredOutput?: unknown): Promise<string | null> {
  if (agent === 'scout' || agent.includes('scout')) {
    return this.validateScout(project);
  }
  if (agent === 'architect' || agent.includes('architect')) {
    return this.validateArchitect(project);
  }
  // ... rest unchanged
}

private async validateScout(project: string): Promise<string | null> {
  const researchDir = join(project, '.brain', 'RESEARCH');
  try {
    const entries = await readdir(researchDir);
    const mdFiles = entries.filter(e => e.endsWith('.md'));
    if (mdFiles.length === 0) {
      return 'Scout did not produce any research files in .brain/RESEARCH/';
    }
  } catch {
    return 'Scout did not create .brain/RESEARCH/ directory';
  }
  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "validateScout fails"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): add validateScout to verify research output"
```

---

### Task 6: Write review feedback to `.brain/REVIEW.md` on REVISE/REDESIGN

**Files:**
- Modify: `src/pipeline/engine.ts:219-253` (the REVISE/REDESIGN handling block)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('writes lastReviewOutput to REVIEW.md on REVISE verdict', async () => {
  // Mock runner: architect writes PLAN.md, builder is no-op, reviewer returns REVISE then APPROVE
  let reviewCallCount = 0;
  const runner: PipelineRunnerFn = async (role, project, task, options) => {
    if (role === 'architect') {
      await mkdir(join(project, '.brain'), { recursive: true });
      await writeFile(join(project, '.brain', 'PLAN.md'), '### Task 1: Test\nContent');
    }
    if (role === 'reviewer') {
      reviewCallCount++;
      return {
        agentName: 'reviewer', sandboxed: true, mode: 'standalone' as const,
        structuredOutput: {
          verdict: reviewCallCount === 1 ? 'REVISE' : 'APPROVE',
          score: reviewCallCount === 1 ? 4 : 8,
          summary: reviewCallCount === 1 ? 'Issues found' : 'Looks good',
          issues: reviewCallCount === 1 ? [{ severity: 'major', description: 'Missing error handling' }] : [],
          patternsCompliance: true,
        },
      };
    }
    return { agentName: role, sandboxed: false, mode: 'standalone' as const };
  };

  const engine = new PipelineEngine({ runner, log: vi.fn(), maxRetries: 3 });
  await engine.run({
    stages: [
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ],
    project: tmpDir,
    task: 'test',
  });

  // After REVISE, REVIEW.md should contain the feedback
  const reviewContent = await readFile(join(tmpDir, '.brain', 'REVIEW.md'), 'utf-8');
  expect(reviewContent).toContain('Missing error handling');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "writes lastReviewOutput to REVIEW.md"`
Expected: FAIL — no code writes REVIEW.md on REVISE

**Step 3: Write minimal implementation**

In the REVISE/REDESIGN handling section (after `retries++`), add:

```typescript
// Write review feedback so builder/architect can read it on retry
if (lastReviewOutput) {
  const reviewMd = [
    `# Review Feedback (Retry ${retries})`,
    '',
    `**Verdict:** ${lastReviewOutput.verdict}`,
    `**Score:** ${lastReviewOutput.score}/10`,
    `**Summary:** ${lastReviewOutput.summary}`,
    '',
    '## Issues to Fix',
    '',
    ...lastReviewOutput.issues.map(
      (issue, idx) => `${idx + 1}. **[${issue.severity}]** ${issue.description}${issue.file ? ` (${issue.file})` : ''}`
    ),
  ].join('\n');

  await mkdir(join(project, '.brain'), { recursive: true });
  await writeFile(join(project, '.brain', 'REVIEW.md'), reviewMd);
  this.config.log(`[pipeline] Wrote review feedback to .brain/REVIEW.md for retry`);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "writes lastReviewOutput to REVIEW.md"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): write review feedback to REVIEW.md on REVISE/REDESIGN"
```

---

### Task 7: Builder re-run prompt includes review feedback instruction

**Files:**
- Modify: `src/pipeline/engine.ts:401-407` (builder branch in `buildStageTask`)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('buildStageTask includes review feedback instruction for builder on retry', () => {
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });
  const stages: PipelineStage[] = [
    { agent: 'architect', teams: false },
    { agent: 'builder', teams: false },
    { agent: 'reviewer', teams: false },
    { agent: 'builder', teams: false },  // re-run after REVISE
    { agent: 'reviewer', teams: false },
  ];

  // Index 3 is the second builder run (after reviewer at index 2)
  const task = (engine as any).buildStageTask('builder', 'original task', 3, stages);
  expect(task).toContain('REVIEW.md');
  expect(task).toContain('fix all listed issues');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "includes review feedback instruction"`
Expected: FAIL — builder prompt doesn't mention REVIEW.md

**Step 3: Write minimal implementation**

Modify the builder branch in `buildStageTask` to detect re-runs:

```typescript
if (agent === 'builder' || agent.includes('build')) {
  const scope = stages[index]?.batchScope;
  const scopeInstruction = scope
    ? `\n\nIMPORTANT: You are working on ${scope} only. Read PLAN.md and implement ONLY those tasks. Do not implement tasks outside your batch scope.`
    : '';

  // Detect if this is a retry (a reviewer ran before this builder in the stages list)
  const isRetry = stages.slice(0, index).some(
    (s, idx) => (s.agent === 'reviewer' || s.agent.includes('review')) && idx > 0
  );
  const retryInstruction = isRetry
    ? `\n\nCRITICAL — RETRY: A previous review found issues. Read .brain/REVIEW.md FIRST and fix all listed issues before doing anything else. Address every issue mentioned.`
    : '';

  return `Implement the following task. Start by reading .brain/PLAN.md — this is your implementation spec from Architect. It contains the architecture, directory structure, ordered tasks, and acceptance criteria. Also read .brain/DECISIONS.md for architectural decisions. Follow the plan step by step. Set up the project from scratch if needed (git init, bun init, bun install, create directories), write all source code, and ensure it builds and runs. Always use bun, not npm.${scopeInstruction}${retryInstruction}\n\nTask: ${originalTask}`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "includes review feedback instruction"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): builder retry prompt includes review feedback instruction"
```

---

### Task 8: Architect REDESIGN prompt includes review feedback

**Files:**
- Modify: `src/pipeline/engine.ts:409-415` (architect branch in `buildStageTask`)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('buildStageTask includes review feedback instruction for architect on REDESIGN', () => {
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });
  const stages: PipelineStage[] = [
    { agent: 'architect', teams: false },
    { agent: 'builder', teams: false },
    { agent: 'reviewer', teams: false },
    { agent: 'architect', teams: false },  // re-run after REDESIGN
  ];

  const task = (engine as any).buildStageTask('architect', 'original task', 3, stages);
  expect(task).toContain('REVIEW.md');
  expect(task).toContain('REDESIGN');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "includes review feedback instruction for architect"`
Expected: FAIL — architect prompt doesn't mention REVIEW.md

**Step 3: Write minimal implementation**

Add retry detection to the architect branch:

```typescript
if (agent === 'architect' || agent.includes('architect')) {
  // Detect redesign (a reviewer ran before this architect in the stages list)
  const isRedesign = stages.slice(0, index).some(
    s => s.agent === 'reviewer' || s.agent.includes('review')
  );
  const redesignInstruction = isRedesign
    ? `\n\nCRITICAL — REDESIGN: A reviewer rejected the previous architecture. Read .brain/REVIEW.md FIRST for their feedback. Your new plan must address all the reviewer's concerns.`
    : '';

  const isTeamMode = stages[index]?.teams ?? false;
  const teamInstruction = isTeamMode
    ? `\n\nCRITICAL — TEAM MODE IS MANDATORY: You are running with Claude Agent Teams enabled. This is NON-NEGOTIABLE — you MUST use the TeamCreate tool to create a planning team, then spawn teammates via the Task tool (with name and team_name parameters) to write plan sections in parallel. Follow the plan-feature-team skill EXACTLY. Do NOT write the plan yourself. Do NOT skip team creation regardless of plan size. The user explicitly requested team mode — if you write PLAN.md directly without creating a team first, you are violating a hard requirement. Your first tool call after reading context and writing DECISIONS.md MUST be TeamCreate.`
    : '';
  return `Design the architecture and create a detailed implementation plan for the following task. Start by reading .brain/RESEARCH/ if it exists — this contains research from the Scout agent. Then follow the plan-feature skill. Write the plan to .brain/PLAN.md and any architectural decisions to .brain/DECISIONS.md. Do NOT write any source code, config files, or install dependencies — you ONLY write to .brain/ files. The Builder agent will handle all implementation.${teamInstruction}${redesignInstruction}\n\nTask: ${originalTask}`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "includes review feedback instruction for architect"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): architect REDESIGN prompt includes review feedback"
```

---

### Task 9: Load `.brain/REVIEW.md` into runner system prompt context

**Files:**
- Modify: `src/agents/runner.ts:184-189`
- Test: manual verification (runner is integration-level code)

**Step 1: Add REVIEW.md to brainFiles array**

In `runner.ts`, change the `brainFiles` array (line 184):

```typescript
const brainFiles = [
  'PROJECT.md',
  'DECISIONS.md',
  'PATTERNS.md',
  'MISTAKES.md',
  'REVIEW.md',
];
```

**Step 2: Run existing tests to verify no regression**

Run: `bun test`
Expected: All existing tests pass

**Step 3: Commit**

```bash
git add src/agents/runner.ts
git commit -m "feat(runner): load .brain/REVIEW.md into agent system prompt context"
```

---

### Task 10: Add Scout branch to `buildStageTask`

**Files:**
- Modify: `src/pipeline/engine.ts:386-418` (add scout case before return)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('buildStageTask returns research-specific prompt for scout', () => {
  const engine = new PipelineEngine({ runner: mockRunner, log: vi.fn() });
  const stages: PipelineStage[] = [
    { agent: 'scout', teams: false },
    { agent: 'architect', teams: false },
    { agent: 'builder', teams: false },
    { agent: 'reviewer', teams: false },
  ];

  const task = (engine as any).buildStageTask('scout', 'build a web scraper', 0, stages);
  expect(task).toContain('research');
  expect(task).toContain('RESEARCH');
  expect(task).toContain('web scraper');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/engine.test.ts -t "returns research-specific prompt for scout"`
Expected: FAIL — scout falls through to the default `return originalTask`

**Step 3: Write minimal implementation**

Add scout branch in `buildStageTask` (before the final return):

```typescript
if (agent === 'scout' || agent.includes('scout')) {
  return `Research the following task thoroughly. Follow the research-scan skill. Write your findings to .brain/RESEARCH/ directory — create one markdown file per research topic. Include technology evaluations, API comparisons, best practices, and any other findings relevant to planning. Do NOT write code or make architectural decisions — you ONLY research and document findings. The Architect agent will use your research to create the implementation plan.\n\nTask: ${originalTask}`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts -t "returns research-specific prompt for scout"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): add scout branch to buildStageTask"
```

---

## Phase 2: Dead Code + Schema Cleanup

### Task 11: Delete dead `src/agents/sandbox.ts`

**Files:**
- Delete: `src/agents/sandbox.ts`
- Verify: no imports reference it

**Step 1: Verify no imports**

Run: `grep -r "sandbox" src/ --include="*.ts" | grep -v ".test." | grep -v "node_modules" | grep import`
Expected: No imports of `./agents/sandbox` or `../agents/sandbox`

**Step 2: Delete the file**

```bash
rm src/agents/sandbox.ts
```

**Step 3: Run tests to confirm no breakage**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add -u src/agents/sandbox.ts
git commit -m "chore: delete dead sandbox.ts (159 lines, unused Vercel microVM)"
```

---

### Task 12: Remove `syncedFiles` from `RunResult` and dead `updateStageStatus`

**Files:**
- Modify: `src/agents/runner.ts:74-81` (remove `syncedFiles` from `RunResult`)
- Modify: `src/pipeline/state.ts:82-96` (delete `updateStageStatus` function)
- Test: `src/pipeline/state.test.ts`

**Step 1: Remove `syncedFiles` from `RunResult`**

In `runner.ts`, change the `RunResult` interface:

```typescript
export interface RunResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
  sessionId?: string;
  structuredOutput?: unknown;
}
```

**Step 2: Delete `updateStageStatus` function from state.ts**

Remove lines 82-96 entirely.

**Step 3: Verify no references remain**

Run: `grep -r "syncedFiles\|updateStageStatus" src/ --include="*.ts" | grep -v ".test."`
Expected: No matches

**Step 4: Run tests**

Run: `bun test`
Expected: All pass (remove any tests referencing deleted function)

**Step 5: Commit**

```bash
git add src/agents/runner.ts src/pipeline/state.ts src/pipeline/state.test.ts
git commit -m "chore: remove dead syncedFiles field and updateStageStatus function"
```

---

### Task 13: Add `'critical'` severity to ReviewOutput schema

**Files:**
- Modify: `src/pipeline/state.ts:52` (add `'critical'` to severity union)
- Modify: `src/pipeline/state.ts:70` (add `'critical'` to JSON schema enum)
- Test: `src/pipeline/state.test.ts`

**Step 1: Write the failing test**

```typescript
it('REVIEW_JSON_SCHEMA includes critical severity', () => {
  const severityEnum = (REVIEW_JSON_SCHEMA.properties.issues.items.properties.severity as any).enum;
  expect(severityEnum).toContain('critical');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/state.test.ts -t "includes critical severity"`
Expected: FAIL — enum is `['major', 'minor', 'nit']`

**Step 3: Write minimal implementation**

In `state.ts`, update line 52:
```typescript
severity: 'critical' | 'major' | 'minor' | 'nit';
```

And line 70:
```typescript
severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/state.test.ts -t "includes critical severity"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/state.ts src/pipeline/state.test.ts
git commit -m "fix(state): add critical severity level to ReviewOutput schema"
```

---

### Task 14: Unify `RunnerResult`/`RunResult` into single type + add `turnCount`

**Files:**
- Modify: `src/pipeline/engine.ts:7-13` (use RunResult from runner.ts)
- Modify: `src/agents/runner.ts:74-81` (add `turnCount`)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Add `turnCount` to `RunResult` in runner.ts**

```typescript
export interface RunResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
  sessionId?: string;
  structuredOutput?: unknown;
  turnCount: number;
}
```

**Step 2: Track turn count in `runAgent`**

In the `for await` loop, add a counter:

```typescript
let turnCount = 0;
for await (const message of query({ ... })) {
  const msg = message as Record<string, unknown>;
  if (msg['type'] === 'assistant') {
    turnCount++;
  }
  // ... existing handling
}

return {
  agentName: agent.frontmatter.name,
  sandboxed,
  mode,
  sessionId,
  structuredOutput,
  turnCount,
};
```

**Step 3: Update engine.ts to import and use RunResult from runner.ts**

Remove the `RunnerResult` interface from engine.ts. Update the import:

```typescript
import type { RunResult } from '../agents/runner.js';
```

Update `PipelineRunnerFn` to use `RunResult`:

```typescript
export type PipelineRunnerFn = (
  role: string,
  projectPath: string,
  task: string,
  options: RunnerOptions,
) => Promise<RunResult>;
```

**Step 4: Run tests**

Run: `bun test`
Expected: All pass (update any tests that reference RunnerResult)

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/agents/runner.ts src/pipeline/engine.test.ts
git commit -m "refactor: unify RunnerResult/RunResult types, add turnCount"
```

---

### Task 15: Remove `patternsCompliance` warning log

**Files:**
- Modify: `src/pipeline/engine.ts:196-198`

**Step 1: Remove the warning log block**

Delete:
```typescript
// Log patterns compliance warning
if (review.patternsCompliance === false) {
  this.config.log(`[pipeline] WARNING: Reviewer reports patterns non-compliance. Review .brain/PATTERNS.md adherence.`);
}
```

Keep the `patternsCompliance` field in the ReviewOutput type and schema (metadata only).

**Step 2: Run tests**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/pipeline/engine.ts
git commit -m "chore: remove patternsCompliance warning log (keep as metadata)"
```

---

## Phase 3: Agent/Tool + Prompt/Skill Fixes

### Task 16: Add `Bash` to Scout agent tools

**Files:**
- Modify: `~/.codename-claude/agents/scout.md`

**Step 1: Read current scout.md frontmatter**

**Step 2: Add `Bash` to tools list**

Add `Bash` to the tools array in the YAML frontmatter.

**Step 3: Commit**

```bash
git add ~/.codename-claude/agents/scout.md
git commit -m "fix(agents): add Bash tool to scout agent definition"
```

---

### Task 17: Add `Write` to Reviewer agent tools

**Files:**
- Modify: `~/.codename-claude/agents/reviewer.md`

**Step 1: Read current reviewer.md frontmatter**

**Step 2: Add `Write` to tools list**

Add `Write` to the tools array in the YAML frontmatter.

**Step 3: Commit**

```bash
git add ~/.codename-claude/agents/reviewer.md
git commit -m "fix(agents): add Write tool to reviewer agent definition"
```

---

### Task 18: Add `whenToUse` frontmatter to all agent definitions

**Files:**
- Modify: `~/.codename-claude/agents/scout.md`
- Modify: `~/.codename-claude/agents/architect.md`
- Modify: `~/.codename-claude/agents/builder.md`
- Modify: `~/.codename-claude/agents/reviewer.md`

**Step 1: Add `whenToUse` to each agent**

Scout: `whenToUse: "Research tasks, technology evaluation, API comparison, or when the task requires exploring options before planning"`

Architect: `whenToUse: "Feature planning, architecture design, or when the task needs a detailed implementation plan before building"`

Builder: `whenToUse: "Code implementation, applying a plan, fixing bugs, or any task that involves writing source code"`

Reviewer: `whenToUse: "Code review after builder completes, verifying implementation matches plan, checking patterns compliance"`

**Step 2: Run tests**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add ~/.codename-claude/agents/*.md
git commit -m "fix(agents): add whenToUse frontmatter to all agent definitions"
```

---

### Task 19: Fix prompt/skill issues (H1-H7)

**Files:**
- Modify: `~/.codename-claude/identity/skills/plan-feature-team.md` — require literal code in PLAN-PART files
- Modify: `~/.codename-claude/identity/skills/execute-plan.md` — handle both literal and descriptive formats
- Modify: `~/.codename-claude/agents/architect.md` — remove "request Scout" reference
- Modify: `~/.codename-claude/agents/reviewer.md` — remove "escalate to Scout" reference
- Modify: `~/.codename-claude/identity/skills/research-scan.md` — remove Perplexity MCP ref + DECISIONS.md contradiction
- Modify: `~/.codename-claude/identity/skills/plan-feature-team.md` — fix team signal protocol
- Modify: `~/.codename-claude/identity/skills/review-loop.md` — remove score-based routing

**Step 1: Read each file**
**Step 2: Apply targeted edits to each file based on design doc**
**Step 3: Run tests**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add ~/.codename-claude/identity/skills/*.md ~/.codename-claude/agents/*.md
git commit -m "fix(skills): apply prompt/skill fixes H1-H7 from audit"
```

---

### Task 20: Document JSON schema in review-loop.md

**Files:**
- Modify: `~/.codename-claude/identity/skills/review-loop.md`

**Step 1: Add the JSON schema documentation**

Add a section explaining the ReviewOutput JSON structure:

```markdown
## Output Format

Your final response is captured as structured JSON. The schema:

- `verdict`: "APPROVE" | "REVISE" | "REDESIGN"
- `score`: 1-10 (metadata only — verdict is the routing signal)
- `summary`: Brief overall assessment
- `issues`: Array of `{ severity: "critical"|"major"|"minor"|"nit", description: string, file?: string }`
- `patternsCompliance`: boolean — does the code follow .brain/PATTERNS.md?
```

**Step 2: Commit**

```bash
git add ~/.codename-claude/identity/skills/review-loop.md
git commit -m "docs(skills): document review JSON schema in review-loop.md"
```

---

## Phase 4: Engine Improvements

### Task 21: Fix batch expansion — preserve stages after reviewer

**Files:**
- Modify: `src/pipeline/orchestrator.ts:50`
- Test: `src/pipeline/orchestrator.test.ts`

**Step 1: Write the failing test**

```typescript
it('preserves stages after reviewer in batch expansion', () => {
  const stages: PipelineStage[] = [
    { agent: 'architect', teams: false },
    { agent: 'builder', teams: false },
    { agent: 'reviewer', teams: false },
    { agent: 'deployer', teams: false },  // hypothetical post-review stage
  ];

  const result = expandStagesWithBatches(stages, 3, 'builder');
  const agentNames = result.map(s => s.agent);
  expect(agentNames[agentNames.length - 1]).toBe('deployer');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/orchestrator.test.ts -t "preserves stages after reviewer"`
Expected: FAIL — line 50 drops everything after reviewer

**Step 3: Write minimal implementation**

Change line 50 in `orchestrator.ts`:

```typescript
const after = stages.slice(reviewerIdx + 1);
return [...before, ...batches, ...after];
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/orchestrator.test.ts -t "preserves stages after reviewer"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/orchestrator.ts src/pipeline/orchestrator.test.ts
git commit -m "fix(orchestrator): preserve stages after reviewer in batch expansion"
```

---

### Task 22: Per-batch retry counters replacing global counter

**Files:**
- Modify: `src/pipeline/engine.ts` (replace `retries` with per-batch tracking)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('per-batch retry allows later batches to retry after earlier exhaustion', async () => {
  // After batch 1 uses all retries, batch 2 should still get its own retry budget
  // This test verifies per-batch isolation
  // ... (complex mock with multiple batches)
});
```

**Step 2: Implement per-batch tracking**

Add a `Map<string, number>` for batch retry counts:

```typescript
const batchRetries = new Map<string, number>();
const perBatchLimit = 2;
```

In the REVISE/REDESIGN handling:

```typescript
const batchKey = stage.batchScope ?? `global-${i}`;
const currentRetries = batchRetries.get(batchKey) ?? 0;

if (currentRetries >= perBatchLimit) {
  this.config.log(`[pipeline] Max retries (${perBatchLimit}) reached for ${batchKey}. Stopping.`);
  // ... fail
}

batchRetries.set(batchKey, currentRetries + 1);
```

**Step 3: Run tests**

Run: `bun test src/pipeline/engine.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): per-batch retry counters replacing global counter"
```

---

### Task 23: Replace LLM router with rule-based routing

**Files:**
- Modify: `src/pipeline/router.ts` (replace `routeTask` implementation)
- Test: `src/pipeline/router.test.ts`

**Step 1: Write failing tests for rule-based patterns**

```typescript
describe('rule-based router', () => {
  it('routes simple fix to [builder, reviewer]', async () => {
    const result = await routeTask({
      task: 'fix the typo in header component',
      agents: mockAgents,
      projectContext: '',
    });
    expect(result.map(s => s.agent)).toEqual(['builder', 'reviewer']);
  });

  it('routes research task to [scout, architect, builder, reviewer]', async () => {
    const result = await routeTask({
      task: 'research the best auth library and build login',
      agents: mockAgents,
      projectContext: '',
    });
    expect(result.map(s => s.agent)).toEqual(['scout', 'architect', 'builder', 'reviewer']);
  });

  it('routes feature to [architect, builder, reviewer]', async () => {
    const result = await routeTask({
      task: 'add user authentication with JWT',
      agents: mockAgents,
      projectContext: '',
    });
    expect(result.map(s => s.agent)).toEqual(['architect', 'builder', 'reviewer']);
  });

  it('routes complex feature with teams on architect', async () => {
    const result = await routeTask({
      task: 'build a web app with auth, dashboard, API, database, notifications, and payment',
      agents: mockAgents,
      projectContext: '',
    });
    expect(result.map(s => s.agent)).toEqual(['architect', 'builder', 'reviewer']);
    expect(result[0]!.teams).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/pipeline/router.test.ts`
Expected: FAIL — current router calls LLM

**Step 3: Replace `routeTask` with rule-based logic**

```typescript
const RESEARCH_KEYWORDS = ['research', 'evaluate', 'compare', 'investigate', 'explore options', 'which library', 'what framework'];
const SIMPLE_KEYWORDS = ['fix', 'typo', 'bug', 'update', 'change', 'rename', 'remove', 'delete', 'tweak', 'adjust'];
const COMPLEX_INDICATORS = /\b(and|with|plus)\b/g;

export async function routeTask(options: RouteOptions): Promise<PipelineStage[]> {
  const { task, manualAgent, manualTeams } = options;

  if (manualAgent) {
    return [{ agent: manualAgent, teams: manualTeams ?? false }];
  }

  const taskLower = task.toLowerCase();

  // Pattern 1: Research tasks
  if (RESEARCH_KEYWORDS.some(kw => taskLower.includes(kw))) {
    return [
      { agent: 'scout', teams: false },
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];
  }

  // Pattern 2: Simple fix/bug
  const isSimple = SIMPLE_KEYWORDS.some(kw => taskLower.startsWith(kw) || taskLower.includes(`${kw} `));
  const hasNoPlanning = !taskLower.includes('implement') && !taskLower.includes('build') && !taskLower.includes('create') && !taskLower.includes('add') && !taskLower.includes('design');
  if (isSimple && hasNoPlanning) {
    return [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];
  }

  // Pattern 3: Complex (5+ components heuristic)
  const componentMatches = taskLower.match(COMPLEX_INDICATORS) ?? [];
  if (componentMatches.length >= 4) {
    return [
      { agent: 'architect', teams: true },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];
  }

  // Pattern 4: Default — feature needing planning
  return [
    { agent: 'architect', teams: false },
    { agent: 'builder', teams: false },
    { agent: 'reviewer', teams: false },
  ];
}
```

**Step 4: Remove `createDefaultClient` and `CreateMessageFn`**

Delete the `createDefaultClient` function and the `CreateMessageFn` type. Remove the `@anthropic-ai/claude-agent-sdk` import if no longer needed. Remove the `createMessage` field from `RouteOptions`.

**Step 5: Run tests**

Run: `bun test src/pipeline/router.test.ts`
Expected: All pass

**Step 6: Commit**

```bash
git add src/pipeline/router.ts src/pipeline/router.test.ts
git commit -m "feat(router): replace LLM router with rule-based keyword routing"
```

---

### Task 24: Fix pipeline state rebuild after REDESIGN

**Files:**
- Modify: `src/pipeline/engine.ts` (REDESIGN handling block, lines 223-236)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

```typescript
it('rebuilds pipeline state correctly after REDESIGN re-expansion', async () => {
  // After REDESIGN, architect re-runs and may produce a different task count
  // Verify the pipeline state stages array is rebuilt to match new stages
});
```

**Step 2: Add state rebuild logic after REDESIGN restart**

After `i = restartIdx; continue;` in the REDESIGN block, the `while` loop will re-run architect. After architect's batch expansion, the state is already rebuilt via `pipelineState.stages = stages.map(...)`. Verify this path works correctly with a test.

**Step 3: Run tests**

Run: `bun test src/pipeline/engine.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "fix(pipeline): verify state rebuild after REDESIGN re-expansion"
```

---

## Phase 5: Daemon Hardening

### Task 25: Add `proper-lockfile` around file state operations

**Files:**
- Install: `bun add proper-lockfile`
- Modify: `src/heartbeat/queue.ts` (wrap load-modify-save)
- Modify: `src/state/budget.ts` (wrap load-modify-save)
- Modify: `src/state/projects.ts` (wrap load-modify-save)
- Test: `src/heartbeat/queue.test.ts`, `src/state/budget.test.ts`

**Step 1: Install dependency**

```bash
bun add proper-lockfile
bun add -D @types/proper-lockfile
```

**Step 2: Write the failing test for queue**

```typescript
it('handles concurrent enqueue operations safely', async () => {
  const queue = new WorkQueue(tmpFile);
  const item = { triggerName: 'test', project: '/tmp', agent: 'builder', task: 'test', mode: 'standalone' as const, enqueuedAt: Date.now() };

  // Concurrent enqueues should not lose items
  await Promise.all([
    queue.enqueue({ ...item, triggerName: 'a' }),
    queue.enqueue({ ...item, triggerName: 'b' }),
    queue.enqueue({ ...item, triggerName: 'c' }),
  ]);

  expect(await queue.size()).toBe(3);
});
```

**Step 3: Implement file locking in queue.ts**

```typescript
import { lock, unlock } from 'proper-lockfile';

async enqueue(item: QueueItem): Promise<void> {
  const release = await lock(this.stateFile, { retries: 3, realpath: false });
  try {
    const state = await this.load();
    state.items.push(item);
    await this.save(state);
  } finally {
    await release();
  }
}

async dequeue(): Promise<QueueItem | null> {
  const release = await lock(this.stateFile, { retries: 3, realpath: false });
  try {
    const state = await this.load();
    const item = state.items.shift() ?? null;
    await this.save(state);
    return item;
  } finally {
    await release();
  }
}
```

Apply similar pattern to `budget.ts` `recordUsage` and `projects.ts` `registerProject`/`unregisterProject`.

**Step 4: Run tests**

Run: `bun test`
Expected: All pass

**Step 5: Commit**

```bash
git add package.json bun.lockb src/heartbeat/queue.ts src/state/budget.ts src/state/projects.ts src/heartbeat/queue.test.ts src/state/budget.test.ts
git commit -m "feat(state): add proper-lockfile for file state operations"
```

---

### Task 26: Fix stale PID detection with IPC handshake

**Files:**
- Modify: `src/cli.ts` (`isDaemonRunning` function)
- Test: manual verification

**Step 1: Read current `isDaemonRunning`**

**Step 2: Replace `process.kill(pid, 0)` with IPC probe**

```typescript
async function isDaemonRunning(): Promise<boolean> {
  try {
    const pidStr = await readFile(PID_FILE_DEFAULT, 'utf-8');
    const pid = parseInt(pidStr.trim(), 10);
    if (isNaN(pid)) return false;

    // Attempt IPC handshake instead of just checking PID exists
    try {
      const client = new IpcClient(SOCKET_PATH_DEFAULT);
      const response = await client.send({ type: 'status' });
      return response.ok === true;
    } catch {
      // IPC failed — stale PID file, clean up
      await unlink(PID_FILE_DEFAULT).catch(() => {});
      return false;
    }
  } catch {
    return false;
  }
}
```

**Step 3: Run tests**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "fix(cli): use IPC handshake for stale PID detection"
```

---

### Task 27: Run initial heartbeat tick on daemon start

**Files:**
- Modify: `src/heartbeat/loop.ts:158-165` (`start` method)
- Test: `src/heartbeat/loop.test.ts`

**Step 1: Write the failing test**

```typescript
it('runs initial tick immediately on start', async () => {
  const deps = mockDeps();
  const loop = new HeartbeatLoop(deps, { intervalMs: 60_000 });

  loop.start();

  // Wait a small amount for the initial tick to fire
  await new Promise(resolve => setTimeout(resolve, 50));

  expect(loop.getTickCount()).toBeGreaterThanOrEqual(1);
  loop.stop();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/heartbeat/loop.test.ts -t "runs initial tick immediately"`
Expected: FAIL — first tick only after 60s

**Step 3: Modify `start()` method**

```typescript
start(): void {
  if (this.timer) return;
  this.deps.log(`[heartbeat] starting (interval: ${this.intervalMs}ms)`);

  // Run initial tick immediately
  this.tick().catch((err) => {
    this.deps.log(`[heartbeat] initial tick error: ${err}`);
  });

  this.timer = setInterval(() => {
    this.tick().catch((err) => {
      this.deps.log(`[heartbeat] tick error: ${err}`);
    });
  }, this.intervalMs);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/heartbeat/loop.test.ts -t "runs initial tick immediately"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/heartbeat/loop.ts src/heartbeat/loop.test.ts
git commit -m "feat(heartbeat): run initial tick immediately on start"
```

---

### Task 28: Use real turn counts instead of flat estimates

**Files:**
- Modify: `src/heartbeat/loop.ts:27-28` (remove STANDALONE_PROMPT_ESTIMATE, TEAM_PROMPT_ESTIMATE)
- Modify: `src/heartbeat/loop.ts:145-148` (use result.turnCount)
- Modify: `src/pipeline/engine.ts` (propagate turnCount through PipelineResult)
- Test: `src/heartbeat/loop.test.ts`

**Step 1: Add `totalTurnCount` to `PipelineResult`**

In `engine.ts`, add to `PipelineResult`:

```typescript
export interface PipelineResult {
  completed: boolean;
  stagesRun: number;
  teamStagesRun: number;
  retries: number;
  finalVerdict?: string;
  sessionIds?: Record<string, string>;
  review?: ReviewOutput;
  totalTurnCount: number;
}
```

Accumulate turn counts in the `run()` method:

```typescript
let totalTurnCount = 0;
// ... in the while loop after runner call:
totalTurnCount += result.turnCount ?? 0;
// ... in return:
return { ..., totalTurnCount };
```

**Step 2: Update HeartbeatLoop to use real turn counts**

```typescript
// Remove these:
// const STANDALONE_PROMPT_ESTIMATE = 10;
// const TEAM_PROMPT_ESTIMATE = 50;

// In executeAgent:
const promptCount = result.totalTurnCount || 1;  // fallback to 1 if somehow zero
await this.deps.recordUsage(promptCount);
```

**Step 3: Update HeartbeatDeps runPipeline return type**

Make sure `runPipeline` in `HeartbeatDeps` returns `PipelineResult` (it already does via import).

**Step 4: Run tests**

Run: `bun test`
Expected: All pass (update mocks as needed)

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/heartbeat/loop.ts src/heartbeat/loop.test.ts src/pipeline/engine.test.ts
git commit -m "feat(budget): use real turn counts instead of flat estimates"
```

---

### Task 29: Add graceful in-flight agent handling on daemon shutdown

**Files:**
- Modify: `src/daemon.ts:362-374` (shutdown function)

**Step 1: Add shutdown flag and in-flight tracking**

Add an `AbortController` at the daemon level:

```typescript
const shutdownController = new AbortController();
```

Pass it through to the pipeline engine. In the `shutdown` function:

```typescript
const shutdown = async (signal: string) => {
  log(`Received ${signal} — shutting down...`);

  // Signal in-flight agents to stop
  shutdownController.abort();

  // Give in-flight work 10 seconds to complete
  const gracePeriod = new Promise(resolve => setTimeout(resolve, 10_000));
  await Promise.race([gracePeriod]);

  heartbeat.stop();
  await fileWatcher.stop();
  await ipcServer.stop();
  if (webhookServer) {
    await webhookServer.stop();
  }
  await unlink(PID_FILE_DEFAULT).catch(() => {});
  log(`Heartbeat stopped after ${heartbeat.getTickCount()} ticks. Goodbye.`);
  process.exit(0);
};
```

**Step 2: Run tests**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/daemon.ts
git commit -m "feat(daemon): add graceful in-flight agent handling on shutdown"
```

---

### Task 30: Persist cron `lastFiredAt` across daemon restarts

**Files:**
- Modify: `src/triggers/cron.ts` (add persistence)
- Test: `src/triggers/cron.test.ts`

**Step 1: Write the failing test**

```typescript
it('persists lastFiredAt to state file', async () => {
  const trigger = new CronTrigger(config, { stateDir: tmpDir });
  trigger.markFired();

  // Create new trigger instance — should restore lastFiredAt
  const trigger2 = new CronTrigger(config, { stateDir: tmpDir });
  await trigger2.loadState();
  expect(trigger2.getLastFiredAt()).toBeTruthy();
});
```

**Step 2: Add state persistence to CronTrigger**

Add `stateDir` option. On `markFired()`, write timestamp to a JSON file. On construction, optionally load from file.

**Step 3: Run tests**

Run: `bun test src/triggers/cron.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add src/triggers/cron.ts src/triggers/cron.test.ts
git commit -m "feat(triggers): persist cron lastFiredAt across daemon restarts"
```

---

### Task 31: Remove `@vercel/sandbox` dependency

**Files:**
- Modify: `package.json` (remove `@vercel/sandbox`)

**Step 1: Verify no imports remain**

After Task 11 deleted `sandbox.ts`, verify no code references `@vercel/sandbox`.

Run: `grep -r "@vercel/sandbox" src/`
Expected: No matches

**Step 2: Remove the dependency**

```bash
bun remove @vercel/sandbox
```

**Step 3: Run tests**

Run: `bun test`
Expected: All pass

**Step 4: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: remove unused @vercel/sandbox dependency"
```

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1 | 1-10 | Critical safety: fail-closed validators, feedback loop, scout support |
| 2 | 11-15 | Dead code removal, schema fixes, type unification |
| 3 | 16-20 | Agent tool fixes, prompt/skill corrections |
| 4 | 21-24 | Engine: batch expansion fix, per-batch retries, rule-based router |
| 5 | 25-31 | Daemon: file locking, PID fix, real budget, graceful shutdown |

Total: 31 tasks across 5 phases.
