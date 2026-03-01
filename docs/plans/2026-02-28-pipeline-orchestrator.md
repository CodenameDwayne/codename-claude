# Pipeline Orchestrator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a pipeline orchestrator that reads PLAN.md after the architect completes, counts tasks, and dynamically expands the `[builder, reviewer]` stages into batched pairs (e.g., `[builder(batch1), reviewer, builder(batch2), reviewer, ...]`).

**Architecture:** A new `orchestrator.ts` module exports two pure functions: `parsePlanTasks` (regex-extracts `### Task N:` headings from PLAN.md) and `expandStagesWithBatches` (groups tasks into batches of 3, generates scoped builder/reviewer stage pairs). The engine calls the orchestrator after the architect stage completes, dynamically replacing the remaining stages. A new optional `batchScope` field on `PipelineStage` scopes builder/reviewer prompts to specific tasks.

**Tech Stack:** TypeScript, Vitest, bun

---

### Task 1: Add `batchScope` to PipelineStage and StageState

**Files:**
- Modify: `src/pipeline/router.ts:14-17`
- Modify: `src/pipeline/state.ts:4-11`

**Step 1: Add optional `batchScope` field to PipelineStage**

In `src/pipeline/router.ts`, update the `PipelineStage` interface:

```typescript
export interface PipelineStage {
  agent: string;
  teams: boolean;
  batchScope?: string;
}
```

**Step 2: Add optional `batchScope` field to StageState**

In `src/pipeline/state.ts`, update the `StageState` interface:

```typescript
export interface StageState {
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  sessionId?: string;
  validation?: 'passed' | string;
  batchScope?: string;
}
```

**Step 3: Verify existing tests still pass**

Run: `bun test src/pipeline/engine.test.ts`
Expected: All existing tests PASS (adding optional fields is non-breaking)

**Step 4: Commit**

```bash
git add src/pipeline/router.ts src/pipeline/state.ts
git commit -m "feat(pipeline): add optional batchScope to PipelineStage and StageState"
```

---

### Task 2: Create `parsePlanTasks` with TDD

**Files:**
- Create: `src/pipeline/orchestrator.ts`
- Create: `src/pipeline/orchestrator.test.ts`

**Step 1: Write the failing test**

Create `src/pipeline/orchestrator.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { parsePlanTasks } from './orchestrator.js';

describe('parsePlanTasks', () => {
  test('extracts task numbers and titles from PLAN.md content', () => {
    const plan = `# Implementation Plan

## Architecture
Some architecture notes.

### Task 1: Set up project structure
Step 1: Create directories...

### Task 2: Implement auth module
Step 1: Write login function...

### Task 3: Add database layer
Step 1: Configure connection...
`;

    const tasks = parsePlanTasks(plan);

    expect(tasks).toEqual([
      { number: 1, title: 'Set up project structure' },
      { number: 2, title: 'Implement auth module' },
      { number: 3, title: 'Add database layer' },
    ]);
  });

  test('returns empty array when no tasks found', () => {
    const plan = '# Plan\n\nJust some notes, no tasks.';
    expect(parsePlanTasks(plan)).toEqual([]);
  });

  test('handles task headings with varied formatting', () => {
    const plan = `### Task 1: First thing
### Task 2:  Extra spaces
###  Task 3: Leading space in heading
`;
    const tasks = parsePlanTasks(plan);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.title).toBe('First thing');
    expect(tasks[1]!.title).toBe('Extra spaces');
    expect(tasks[2]!.title).toBe('Leading space in heading');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/orchestrator.test.ts`
Expected: FAIL with "Cannot find module './orchestrator.js'"

**Step 3: Write minimal implementation**

Create `src/pipeline/orchestrator.ts`:

```typescript
export interface PlanTask {
  number: number;
  title: string;
}

export function parsePlanTasks(planContent: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  const regex = /^###\s+Task\s+(\d+):\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(planContent)) !== null) {
    tasks.push({
      number: parseInt(match[1]!, 10),
      title: match[2]!.trim(),
    });
  }

  return tasks;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/orchestrator.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add src/pipeline/orchestrator.ts src/pipeline/orchestrator.test.ts
git commit -m "feat(pipeline): add parsePlanTasks to extract tasks from PLAN.md"
```

---

### Task 3: Create `expandStagesWithBatches` with TDD

**Files:**
- Modify: `src/pipeline/orchestrator.ts`
- Modify: `src/pipeline/orchestrator.test.ts`

**Step 1: Write the failing tests**

Add to `src/pipeline/orchestrator.test.ts`:

```typescript
import { parsePlanTasks, expandStagesWithBatches } from './orchestrator.js';
import type { PipelineStage } from './router.js';

describe('expandStagesWithBatches', () => {
  test('expands builder+reviewer into batched pairs for 7 tasks (batch size 3)', () => {
    const stages: PipelineStage[] = [
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];

    const expanded = expandStagesWithBatches(stages, 7, 'builder');

    // 7 tasks / batch of 3 = batches [1-3], [4-6], [7]
    expect(expanded).toEqual([
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false, batchScope: 'Tasks 1-3' },
      { agent: 'reviewer', teams: false, batchScope: 'Tasks 1-3' },
      { agent: 'builder', teams: false, batchScope: 'Tasks 4-6' },
      { agent: 'reviewer', teams: false, batchScope: 'Tasks 4-6' },
      { agent: 'builder', teams: false, batchScope: 'Task 7' },
      { agent: 'reviewer', teams: false, batchScope: 'Task 7' },
    ]);
  });

  test('returns stages unchanged when taskCount is 0', () => {
    const stages: PipelineStage[] = [
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];

    const expanded = expandStagesWithBatches(stages, 0, 'builder');
    expect(expanded).toEqual(stages);
  });

  test('handles exact batch size (3 tasks, batch size 3)', () => {
    const stages: PipelineStage[] = [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];

    const expanded = expandStagesWithBatches(stages, 3, 'builder');

    expect(expanded).toEqual([
      { agent: 'builder', teams: false, batchScope: 'Tasks 1-3' },
      { agent: 'reviewer', teams: false, batchScope: 'Tasks 1-3' },
    ]);
  });

  test('uses custom batch size', () => {
    const stages: PipelineStage[] = [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];

    const expanded = expandStagesWithBatches(stages, 5, 'builder', 2);

    // 5 tasks / batch of 2 = [1-2], [3-4], [5]
    expect(expanded).toEqual([
      { agent: 'builder', teams: false, batchScope: 'Tasks 1-2' },
      { agent: 'reviewer', teams: false, batchScope: 'Tasks 1-2' },
      { agent: 'builder', teams: false, batchScope: 'Tasks 3-4' },
      { agent: 'reviewer', teams: false, batchScope: 'Tasks 3-4' },
      { agent: 'builder', teams: false, batchScope: 'Task 5' },
      { agent: 'reviewer', teams: false, batchScope: 'Task 5' },
    ]);
  });

  test('preserves stages before expandFrom agent', () => {
    const stages: PipelineStage[] = [
      { agent: 'scout', teams: false },
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];

    const expanded = expandStagesWithBatches(stages, 4, 'builder');

    expect(expanded[0]).toEqual({ agent: 'scout', teams: false });
    expect(expanded[1]).toEqual({ agent: 'architect', teams: false });
    expect(expanded[2]!.agent).toBe('builder');
    expect(expanded[2]!.batchScope).toBe('Tasks 1-3');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/pipeline/orchestrator.test.ts`
Expected: FAIL with "expandStagesWithBatches is not a function" or similar

**Step 3: Write minimal implementation**

Add to `src/pipeline/orchestrator.ts`:

```typescript
import type { PipelineStage } from './router.js';

export function expandStagesWithBatches(
  stages: PipelineStage[],
  taskCount: number,
  expandFrom: string,
  batchSize: number = 3,
): PipelineStage[] {
  if (taskCount === 0) return stages;

  // Find the expandFrom agent and the reviewer that follows it
  const expandIdx = stages.findIndex(s => s.agent === expandFrom || s.agent.includes(expandFrom));
  if (expandIdx < 0) return stages;

  // Find the reviewer after the expandFrom agent
  const reviewerIdx = stages.findIndex((s, i) => i > expandIdx && (s.agent === 'reviewer' || s.agent.includes('review')));
  if (reviewerIdx < 0) return stages;

  const before = stages.slice(0, expandIdx);
  const builderTemplate = stages[expandIdx]!;
  const reviewerTemplate = stages[reviewerIdx]!;

  // Generate batches
  const batches: PipelineStage[] = [];
  for (let start = 1; start <= taskCount; start += batchSize) {
    const end = Math.min(start + batchSize - 1, taskCount);
    const scope = start === end ? `Task ${start}` : `Tasks ${start}-${end}`;

    batches.push({ ...builderTemplate, batchScope: scope });
    batches.push({ ...reviewerTemplate, batchScope: scope });
  }

  return [...before, ...batches];
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/pipeline/orchestrator.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/pipeline/orchestrator.ts src/pipeline/orchestrator.test.ts
git commit -m "feat(pipeline): add expandStagesWithBatches for batch orchestration"
```

---

### Task 4: Integrate orchestrator into engine.ts

**Files:**
- Modify: `src/pipeline/engine.ts`

**Step 1: Import orchestrator functions**

Add import at top of `src/pipeline/engine.ts`:

```typescript
import { parsePlanTasks, expandStagesWithBatches } from './orchestrator.js';
```

**Step 2: Add orchestration after architect stage completes**

In the `run()` method, after the line that logs `"passed validation"` (around line 140), add orchestration logic inside the `while` loop. Find this block:

```typescript
this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: ${stage.agent} passed validation`);
```

After that line, add:

```typescript
// Orchestrate: after architect completes, read PLAN.md and expand batches
if (stage.agent === 'architect' || stage.agent.includes('architect')) {
  try {
    const planPath = join(project, '.brain', 'PLAN.md');
    const planContent = await readFile(planPath, 'utf-8');
    const tasks = parsePlanTasks(planContent);

    if (tasks.length > 0) {
      this.config.log(`[pipeline] Orchestrator: found ${tasks.length} tasks in PLAN.md, expanding into batches`);
      const expanded = expandStagesWithBatches(stages, tasks.length, 'builder');
      stages = expanded;

      // Rebuild pipeline state for new stages
      pipelineState.pipeline = stages.map(s => s.agent);
      pipelineState.stages = stages.map((s, idx) => {
        if (idx <= i) {
          // Keep completed stages
          return pipelineState.stages[idx] ?? { agent: s.agent, status: 'completed' as const };
        }
        return { agent: s.agent, status: 'pending' as const, batchScope: s.batchScope };
      });
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);
    }
  } catch {
    // No PLAN.md or read error — continue without orchestration
    this.config.log(`[pipeline] Orchestrator: no PLAN.md found, skipping batch expansion`);
  }
}
```

**Step 3: Change `stages` from `const` to `let` in the destructuring**

At the top of the `run()` method, change:

```typescript
const { stages, project, task } = options;
```

To:

```typescript
const { project, task } = options;
let stages = [...options.stages];
```

**Step 4: Update `buildStageTask` to use batchScope**

In the `buildStageTask` method, update the builder and reviewer branches to include batch scope when present. Find the builder section:

```typescript
if (agent === 'builder' || agent.includes('build')) {
```

Replace the entire builder return statement with:

```typescript
if (agent === 'builder' || agent.includes('build')) {
  const scope = stages[index]?.batchScope;
  const scopeInstruction = scope
    ? `\n\nIMPORTANT: You are working on ${scope} only. Read PLAN.md and implement ONLY those tasks. Do not implement tasks outside your batch scope.`
    : '';
  return `Implement the following task. Start by reading .brain/PLAN.md — this is your implementation spec from Architect. It contains the architecture, directory structure, ordered tasks, and acceptance criteria. Also read .brain/DECISIONS.md for architectural decisions. Follow the plan step by step. Set up the project from scratch if needed (git init, bun init, bun install, create directories), write all source code, and ensure it builds and runs. Always use bun, not npm.${scopeInstruction}\n\nTask: ${originalTask}`;
}
```

And for the reviewer, find:

```typescript
if (agent === 'reviewer' || agent.includes('review')) {
```

Replace with:

```typescript
if (agent === 'reviewer' || agent.includes('review')) {
  const scope = stages[index]?.batchScope;
  const scopeInstruction = scope
    ? `\n\nIMPORTANT: You are reviewing ${scope} only. Focus your review on the code implementing those specific tasks.`
    : '';
  return `Review the code written by ${prevAgent} for the following task. Follow the review-loop and review-code skills. Read .brain/PLAN.md to understand what was supposed to be built, then review the actual code. Read .brain/PATTERNS.md and verify the code follows established patterns. Run tests/build. Your final response will be captured as structured JSON. As a backup, also write your verdict to .brain/REVIEW.md with a "Verdict: APPROVE", "Verdict: REVISE", or "Verdict: REDESIGN" line.${scopeInstruction}\n\nTask: ${originalTask}`;
}
```

**Step 5: Update state initialization to include batchScope**

In the `run()` method, update the stages mapping in pipeline state initialization (around line 79):

```typescript
stages: stages.map(s => ({ agent: s.agent, status: 'pending' as const, batchScope: s.batchScope })),
```

**Step 6: Run existing tests to verify nothing breaks**

Run: `bun test src/pipeline/engine.test.ts`
Expected: All existing tests PASS

**Step 7: Commit**

```bash
git add src/pipeline/engine.ts
git commit -m "feat(pipeline): integrate orchestrator into engine for batch expansion"
```

---

### Task 5: Add orchestration tests to engine.test.ts

**Files:**
- Modify: `src/pipeline/engine.test.ts`

**Step 1: Write test for batch expansion after architect**

Add a new `describe` block to `src/pipeline/engine.test.ts`:

```typescript
describe('PipelineEngine orchestration', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('expands builder+reviewer into batches after architect writes PLAN.md', async () => {
    // Write a PLAN.md with 5 tasks that the architect "created"
    const planContent = `# Plan

### Task 1: Set up project
Details...

### Task 2: Create models
Details...

### Task 3: Add API routes
Details...

### Task 4: Add auth
Details...

### Task 5: Add tests
Details...
`;

    const callLog: string[] = [];
    const runner: PipelineRunnerFn = vi.fn(async (role: string, _project: string, task: string) => {
      callLog.push(role);
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), planContent);
      }
      if (role === 'reviewer') {
        return {
          agentName: role,
          sandboxed: false,
          mode: 'standalone' as const,
          structuredOutput: {
            verdict: 'APPROVE',
            score: 9,
            summary: 'Good',
            issues: [],
            patternsCompliance: true,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build a web app',
    });

    expect(result.completed).toBe(true);

    // Should have expanded: architect, builder(1-3), reviewer, builder(4-5), reviewer
    // = 5 total agent calls: architect + 2 builders + 2 reviewers
    expect(callLog).toEqual(['architect', 'builder', 'reviewer', 'builder', 'reviewer']);
    expect(logs.some(l => l.includes('Orchestrator: found 5 tasks'))).toBe(true);
  });

  test('passes batch scope in builder/reviewer task prompts', async () => {
    const planContent = `# Plan
### Task 1: Do thing A
### Task 2: Do thing B
### Task 3: Do thing C
### Task 4: Do thing D
`;

    const taskArgs: string[] = [];
    const runner: PipelineRunnerFn = vi.fn(async (role: string, _project: string, task: string) => {
      taskArgs.push(task);
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), planContent);
      }
      if (role === 'reviewer') {
        return {
          agentName: role,
          sandboxed: false,
          mode: 'standalone' as const,
          structuredOutput: {
            verdict: 'APPROVE',
            score: 9,
            summary: 'Good',
            issues: [],
            patternsCompliance: true,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build app',
    });

    // taskArgs[1] = first builder call, should mention Tasks 1-3
    expect(taskArgs[1]).toContain('Tasks 1-3');
    // taskArgs[2] = first reviewer call, should mention Tasks 1-3
    expect(taskArgs[2]).toContain('Tasks 1-3');
    // taskArgs[3] = second builder call, should mention Task 4
    expect(taskArgs[3]).toContain('Task 4');
  });

  test('skips orchestration when PLAN.md has no tasks', async () => {
    const callLog: string[] = [];
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      callLog.push(role);
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), '# Plan\n\nJust architecture notes, no task headings.');
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    // No expansion — original 3 stages run as-is
    expect(callLog).toEqual(['architect', 'builder', 'reviewer']);
  });
});
```

**Step 2: Run orchestration tests**

Run: `bun test src/pipeline/orchestrator.test.ts src/pipeline/engine.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/pipeline/engine.test.ts
git commit -m "test(pipeline): add orchestration integration tests"
```

---

### Task 6: Update pipeline state to track batch scope

**Files:**
- Modify: `src/pipeline/engine.test.ts`

**Step 1: Write test for batchScope in pipeline state**

Add to the `PipelineEngine orchestration` describe block:

```typescript
test('pipeline-state.json includes batchScope for expanded stages', async () => {
  const planContent = `# Plan
### Task 1: First
### Task 2: Second
### Task 3: Third
### Task 4: Fourth
`;

  const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
    if (role === 'architect') {
      await writeFile(join(BRAIN_DIR, 'PLAN.md'), planContent);
    }
    if (role === 'reviewer') {
      return {
        agentName: role,
        sandboxed: false,
        mode: 'standalone' as const,
        structuredOutput: {
          verdict: 'APPROVE',
          score: 9,
          summary: 'Good',
          issues: [],
          patternsCompliance: true,
        },
      };
    }
    return { agentName: role, sandboxed: false, mode: 'standalone' as const };
  });

  const engine = new PipelineEngine({ runner, log: () => {} });

  await engine.run({
    stages: [
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ],
    project: TEST_PROJECT,
    task: 'build app',
  });

  const state = await readPipelineState(TEST_PROJECT);
  expect(state).not.toBeNull();

  // After expansion: architect, builder(1-3), reviewer(1-3), builder(4), reviewer(4)
  const builderStages = state!.stages.filter(s => s.agent === 'builder');
  expect(builderStages).toHaveLength(2);
  expect(builderStages[0]!.batchScope).toBe('Tasks 1-3');
  expect(builderStages[1]!.batchScope).toBe('Task 4');
});
```

**Step 2: Run test to verify it passes**

Run: `bun test src/pipeline/engine.test.ts`
Expected: All tests PASS (batchScope was already wired in Task 4)

**Step 3: Commit**

```bash
git add src/pipeline/engine.test.ts
git commit -m "test(pipeline): verify batchScope tracked in pipeline-state.json"
```

---

### Task 7: Final verification

**Files:**
- None (verification only)

**Step 1: Run full test suite**

Run: `bun test`
Expected: All pipeline tests PASS. Any pre-existing failures in other modules are unrelated.

**Step 2: Verify no TypeScript errors**

Run: `bun run tsc --noEmit`
Expected: No new errors

**Step 3: Verify all new code is committed**

Run: `git status`
Expected: Clean working tree on feature branch

**Step 4: Review git log**

Run: `git log --oneline -10`
Expected: See 6 commits from this implementation
