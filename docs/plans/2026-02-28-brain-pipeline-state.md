# .brain/ Pipeline State Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate `.brain/` into persistent project knowledge (agent-written files) and ephemeral pipeline state (engine-managed), eliminating dead files and fixing broken agent handoffs.

**Architecture:** The engine manages pipeline state via a `pipeline-state.json` file and captures session IDs from the SDK. `SESSIONS/` directory and `ACTIVE.md` are replaced with engine-written state. `RESEARCH/` handoff is fixed by wiring it into `buildStageTask` and `buildSystemPrompt`. The runner returns session IDs so the engine can use `getSessionMessages()` for cross-session context.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Vitest

---

## Summary of Changes

| What | Before | After |
|---|---|---|
| `ACTIVE.md` | Agent-written free-form markdown | Engine-managed `pipeline-state.json` |
| `SESSIONS/` | Agent-written summaries, only `latest.md` read | Replaced by SDK `getSessionMessages()` via captured session IDs |
| `RESEARCH/` | Written by Scout, never read by anyone | Wired into Architect's `buildStageTask` + `buildSystemPrompt` |
| `REVIEW.md` | Regex-parsed markdown file | Structured JSON output primary, REVIEW.md fallback for max-turns edge case |
| `PATTERNS.md` | Loaded into system prompt, never validated | Reviewer validates compliance, engine checks report |
| `MISTAKES.md` | Loaded into system prompt, grows unbounded | Loaded with size cap, pruned by engine |
| `PROJECT.md` | Empty on first run, no bootstrap | Engine generates scaffold from task on first run |
| `RunResult` | No session ID | Returns `sessionId` and optional `structuredOutput` from SDK |
| `PipelineResult` | Minimal | Includes per-stage session IDs and structured review |
| Heartbeat | No stall detection | Reads `pipeline-state.json`, detects stalled pipelines |

---

### Task 1: Add `PipelineState` type and read/write helpers

**Files:**
- Create: `src/pipeline/state.ts`
- Test: `src/pipeline/state.test.ts`

**Step 1: Write the failing test**

```typescript
// src/pipeline/state.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type PipelineState,
  readPipelineState,
  writePipelineState,
  updateStageStatus,
} from './state.js';

const TEST_DIR = join(import.meta.dirname, '../../.test-state/pipeline-state-test');
const STATE_FILE = join(TEST_DIR, '.brain', 'pipeline-state.json');

describe('PipelineState', () => {
  beforeEach(async () => {
    await mkdir(join(TEST_DIR, '.brain'), { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test('readPipelineState returns null when no state file exists', async () => {
    const state = await readPipelineState(TEST_DIR);
    expect(state).toBeNull();
  });

  test('writePipelineState creates state file and readPipelineState reads it back', async () => {
    const state: PipelineState = {
      project: TEST_DIR,
      task: 'build something',
      pipeline: ['architect', 'builder', 'reviewer'],
      status: 'running',
      currentStage: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      stages: [
        { agent: 'architect', status: 'running' },
        { agent: 'builder', status: 'pending' },
        { agent: 'reviewer', status: 'pending' },
      ],
      retries: 0,
    };

    await writePipelineState(TEST_DIR, state);
    const read = await readPipelineState(TEST_DIR);

    expect(read).not.toBeNull();
    expect(read!.project).toBe(TEST_DIR);
    expect(read!.pipeline).toEqual(['architect', 'builder', 'reviewer']);
    expect(read!.stages).toHaveLength(3);
  });

  test('updateStageStatus updates a specific stage and bumps updatedAt', async () => {
    const now = Date.now();
    const state: PipelineState = {
      project: TEST_DIR,
      task: 'build something',
      pipeline: ['builder', 'reviewer'],
      status: 'running',
      currentStage: 0,
      startedAt: now,
      updatedAt: now,
      stages: [
        { agent: 'builder', status: 'running', startedAt: now },
        { agent: 'reviewer', status: 'pending' },
      ],
      retries: 0,
    };

    await writePipelineState(TEST_DIR, state);

    await updateStageStatus(TEST_DIR, 0, {
      status: 'completed',
      completedAt: now + 5000,
      sessionId: 'session-abc',
      validation: 'passed',
    });

    const updated = await readPipelineState(TEST_DIR);
    expect(updated!.stages[0]!.status).toBe('completed');
    expect(updated!.stages[0]!.sessionId).toBe('session-abc');
    expect(updated!.stages[0]!.validation).toBe('passed');
    expect(updated!.updatedAt).toBeGreaterThan(now);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/pipeline/state.test.ts`
Expected: FAIL — module `./state.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/pipeline/state.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface StageState {
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  sessionId?: string;
  validation?: 'passed' | string;
}

export interface PipelineState {
  project: string;
  task: string;
  pipeline: string[];
  status: 'running' | 'completed' | 'failed' | 'stalled';
  currentStage: number;
  startedAt: number;
  updatedAt: number;
  stages: StageState[];
  retries: number;
  finalVerdict?: string;
  error?: string;
}

function statePath(projectDir: string): string {
  return join(projectDir, '.brain', 'pipeline-state.json');
}

export async function readPipelineState(projectDir: string): Promise<PipelineState | null> {
  try {
    const raw = await readFile(statePath(projectDir), 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

export async function writePipelineState(projectDir: string, state: PipelineState): Promise<void> {
  const path = statePath(projectDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2));
}

export async function updateStageStatus(
  projectDir: string,
  stageIndex: number,
  update: Partial<StageState>,
): Promise<void> {
  const state = await readPipelineState(projectDir);
  if (!state) throw new Error('No pipeline state to update');

  const stage = state.stages[stageIndex];
  if (!stage) throw new Error(`Stage ${stageIndex} not found`);

  Object.assign(stage, update);
  state.updatedAt = Date.now();
  await writePipelineState(projectDir, state);
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/pipeline/state.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/pipeline/state.ts src/pipeline/state.test.ts
git commit -m "feat(pipeline): add PipelineState type and read/write helpers"
```

---

### Task 2: Capture session ID from SDK in runner

**Files:**
- Modify: `src/agents/runner.ts:73-78` (RunResult interface)
- Modify: `src/agents/runner.ts:258-304` (query loop + return)

**Step 1: Write the failing test**

There is no unit test for the runner (it spawns real Claude processes). Instead, verify the type change compiles.

Create a type-level assertion in the existing integration test:

```typescript
// Append to src/pipeline/integration.test.ts — add after existing imports
// This test verifies RunResult includes sessionId at the type level.
// The actual sessionId capture is tested via the engine integration.
```

No new test file needed — the type change is verified by the compiler and existing tests. Skip to Step 3.

**Step 2: (skipped — type-level change)**

**Step 3: Modify RunResult and capture session_id**

In `src/agents/runner.ts`, update `RunResult` interface (line 73):

```typescript
export interface RunResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
  syncedFiles?: string[];
  sessionId?: string;
}
```

In the `runAgent` function, capture session_id from the first message that has one (line ~258-304):

```typescript
  // 7. Run agent via SDK
  const claudePath = findClaudeExecutable();
  log(`[runner] Using claude at: ${claudePath}`);

  let sessionId: string | undefined;

  for await (const message of query({
    prompt: task,
    options: {
      systemPrompt,
      model,
      maxTurns,
      pathToClaudeCodeExecutable: claudePath,
      allowedTools: agent.frontmatter.tools,
      cwd: projectPath,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env,
      hooks: runOptions.hooks,
      ...(sandboxed && {
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
        },
      }),
      stderr: (data: string) => process.stderr.write(`[stderr] ${data}`),
    },
  })) {
    const msg = message as Record<string, unknown>;

    // Capture session_id from the first message that has one
    if (!sessionId && typeof msg['session_id'] === 'string') {
      sessionId = msg['session_id'];
    }

    if (msg['type'] === 'assistant' && msg['message']) {
      const assistantMsg = msg['message'] as Record<string, unknown>;
      const content = assistantMsg['content'];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block) {
            if (block.type === 'text' && 'text' in block) {
              log(`[${agent.frontmatter.name}] ${block.text}`);
            } else if (block.type === 'tool_use' && 'name' in block) {
              log(`[${agent.frontmatter.name}] tool: ${block.name}`);
            }
          }
        }
      }
    } else if ('result' in msg && typeof msg.result === 'string') {
      log(`[${agent.frontmatter.name}] Result: ${msg.result}`);
    }
  }

  return {
    agentName: agent.frontmatter.name,
    sandboxed,
    mode,
    sessionId,
  };
```

**Step 4: Run all tests to verify nothing broke**

Run: `bun run test`
Expected: All existing tests PASS (RunResult is compatible — `sessionId` is optional)

**Step 5: Commit**

```bash
git add src/agents/runner.ts
git commit -m "feat(runner): capture session_id from SDK messages in RunResult"
```

---

### Task 3: Update PipelineEngine to manage state and propagate session IDs

**Files:**
- Modify: `src/pipeline/engine.ts:13-17` (RunnerResult to include sessionId)
- Modify: `src/pipeline/engine.ts:45-50` (PipelineResult to include stageResults)
- Modify: `src/pipeline/engine.ts:61-135` (run method — write state at each transition)
- Test: `src/pipeline/engine.test.ts` (add state file assertions)

**Step 1: Write the failing test**

Add a new test to `src/pipeline/engine.test.ts`:

```typescript
import { readPipelineState } from './state.js';

// Add to the 'PipelineEngine review loop' describe block:
test('writes pipeline-state.json at each stage transition', async () => {
  const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
    if (role === 'reviewer') {
      await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
    }
    return { agentName: role, sandboxed: false, mode: 'standalone' as const, sessionId: `session-${role}` };
  });

  const engine = new PipelineEngine({ runner, log: () => {} });

  const result = await engine.run({
    stages: [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ],
    project: TEST_PROJECT,
    task: 'build something',
  });

  expect(result.completed).toBe(true);

  const state = await readPipelineState(TEST_PROJECT);
  expect(state).not.toBeNull();
  expect(state!.status).toBe('completed');
  expect(state!.stages[0]!.status).toBe('completed');
  expect(state!.stages[0]!.sessionId).toBe('session-builder');
  expect(state!.stages[1]!.status).toBe('completed');
  expect(state!.stages[1]!.sessionId).toBe('session-reviewer');
  expect(state!.finalVerdict).toBe('APPROVE');
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: FAIL — `readPipelineState` returns null (engine doesn't write state yet)

**Step 3: Update engine types and run() method**

In `src/pipeline/engine.ts`:

Add import at top:
```typescript
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { PipelineStage } from './router.js';
import { writePipelineState, readPipelineState, type PipelineState } from './state.js';
```

Update `RunnerResult` to include sessionId:
```typescript
export interface RunnerResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
  sessionId?: string;
}
```

Update `PipelineResult` to include stage session IDs:
```typescript
export interface PipelineResult {
  completed: boolean;
  stagesRun: number;
  retries: number;
  finalVerdict?: string;
  sessionIds?: Record<string, string>;
}
```

Update the `run()` method to write state at each transition. The key changes inside the `while (i < stages.length)` loop:

```typescript
async run(options: PipelineRunOptions): Promise<PipelineResult> {
  const { stages, project, task } = options;
  let retries = 0;

  this.config.log(`[pipeline] Starting pipeline: ${stages.map(s => s.agent).join(' → ')}`);
  this.config.log(`[pipeline] Task: "${task}"`);

  // Initialize pipeline state
  const now = Date.now();
  const pipelineState: PipelineState = {
    project,
    task,
    pipeline: stages.map(s => s.agent),
    status: 'running',
    currentStage: 0,
    startedAt: now,
    updatedAt: now,
    stages: stages.map(s => ({ agent: s.agent, status: 'pending' as const })),
    retries: 0,
  };
  await writePipelineState(project, pipelineState);

  const sessionIds: Record<string, string> = {};
  let i = 0;
  let stagesRun = 0;

  while (i < stages.length) {
    const stage = stages[i]!;
    const mode = stage.teams ? 'team' : 'standalone';

    this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: Running ${stage.agent} (${mode})`);

    // Update state: stage starting
    pipelineState.currentStage = i;
    pipelineState.stages[i]!.status = 'running';
    pipelineState.stages[i]!.startedAt = Date.now();
    pipelineState.updatedAt = Date.now();
    await writePipelineState(project, pipelineState);

    const stageTask = this.buildStageTask(stage.agent, task, i, stages);

    const result = await this.config.runner(stage.agent, project, stageTask, {
      mode,
      hooks: this.config.hooks,
      log: this.config.log,
    });

    stagesRun++;

    // Capture session ID
    if (result.sessionId) {
      sessionIds[stage.agent] = result.sessionId;
      pipelineState.stages[i]!.sessionId = result.sessionId;
    }

    this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: ${stage.agent} completed`);

    // Post-stage validation
    const validationError = await this.validateStage(stage.agent, project);
    if (validationError) {
      this.config.log(`[pipeline] VALIDATION FAILED for ${stage.agent}: ${validationError}`);
      pipelineState.stages[i]!.status = 'failed';
      pipelineState.stages[i]!.validation = validationError;
      pipelineState.stages[i]!.completedAt = Date.now();
      pipelineState.status = 'failed';
      pipelineState.error = validationError;
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);
      return { completed: false, stagesRun, retries, finalVerdict: `VALIDATION_FAILED: ${validationError}`, sessionIds };
    }

    pipelineState.stages[i]!.status = 'completed';
    pipelineState.stages[i]!.validation = 'passed';
    pipelineState.stages[i]!.completedAt = Date.now();
    pipelineState.updatedAt = Date.now();
    await writePipelineState(project, pipelineState);

    this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: ${stage.agent} passed validation`);

    // Check review verdict after reviewer stages
    if (stage.agent === 'reviewer' || stage.agent.includes('review')) {
      const verdict = await this.parseReviewVerdict(project);

      if (verdict === 'APPROVE') {
        this.config.log(`[pipeline] Reviewer verdict: APPROVE`);
        i++;
        continue;
      }

      if (retries >= this.maxRetries) {
        this.config.log(`[pipeline] Max retries (${this.maxRetries}) reached. Stopping.`);
        pipelineState.status = 'failed';
        pipelineState.finalVerdict = verdict;
        pipelineState.retries = retries;
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        return { completed: false, stagesRun, retries, finalVerdict: verdict, sessionIds };
      }

      retries++;
      pipelineState.retries = retries;

      if (verdict === 'REDESIGN') {
        const architectIdx = stages.findIndex(s => s.agent === 'architect' || s.agent.includes('architect'));
        const restartIdx = architectIdx >= 0 ? architectIdx : 0;
        this.config.log(`[pipeline] Reviewer verdict: REDESIGN — restarting from ${stages[restartIdx]!.agent} (retry ${retries})`);
        // Reset stage statuses for re-run
        for (let j = restartIdx; j < stages.length; j++) {
          pipelineState.stages[j]!.status = 'pending';
          pipelineState.stages[j]!.startedAt = undefined;
          pipelineState.stages[j]!.completedAt = undefined;
          pipelineState.stages[j]!.validation = undefined;
        }
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        i = restartIdx;
        continue;
      }

      // REVISE
      const builderIdx = stages.slice(0, i).reverse().findIndex(s => s.agent === 'builder' || s.agent.includes('build'));
      const restartIdx = builderIdx >= 0 ? i - 1 - builderIdx : Math.max(0, i - 1);
      this.config.log(`[pipeline] Reviewer verdict: REVISE — re-running ${stages[restartIdx]!.agent} (retry ${retries})`);
      for (let j = restartIdx; j < stages.length; j++) {
        pipelineState.stages[j]!.status = 'pending';
        pipelineState.stages[j]!.startedAt = undefined;
        pipelineState.stages[j]!.completedAt = undefined;
        pipelineState.stages[j]!.validation = undefined;
      }
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);
      i = restartIdx;
      continue;
    }

    i++;
  }

  this.config.log(`[pipeline] Pipeline complete (${stagesRun} stages, ${retries} retries)`);

  // Final state
  pipelineState.status = 'completed';
  pipelineState.finalVerdict = 'APPROVE';
  pipelineState.updatedAt = Date.now();
  await writePipelineState(project, pipelineState);

  return { completed: true, stagesRun, retries, finalVerdict: 'APPROVE', sessionIds };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: All tests PASS (existing tests still work — state file is written but old assertions still hold)

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): engine writes pipeline-state.json at each stage transition"
```

---

### Task 4: Wire RESEARCH/ into Architect's buildStageTask and buildSystemPrompt

**Files:**
- Modify: `src/pipeline/engine.ts:246-248` (Architect's buildStageTask)
- Modify: `src/agents/runner.ts:174-181` (brainFiles array)

**Step 1: Write the failing test**

Add to `src/pipeline/engine.test.ts`:

```typescript
test('buildStageTask tells architect to read RESEARCH/ when scout precedes it', async () => {
  const runner = makeRunner();
  const logs: string[] = [];
  const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

  const stages: PipelineStage[] = [
    { agent: 'scout', teams: false },
    { agent: 'architect', teams: false },
    { agent: 'builder', teams: false },
  ];

  await engine.run({ stages, project: '/tmp/test', task: 'build something' });

  // The task passed to architect (second call) should mention RESEARCH/
  const architectCall = (runner as ReturnType<typeof vi.fn>).mock.calls[1];
  const architectTask = architectCall![2] as string;
  expect(architectTask).toContain('RESEARCH');
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: FAIL — architect task doesn't contain 'RESEARCH'

**Step 3: Update buildStageTask for architect**

In `src/pipeline/engine.ts`, update the architect section of `buildStageTask` (line ~246):

```typescript
if (agent === 'architect' || agent.includes('architect')) {
  return `Design the architecture and create a detailed implementation plan for the following task. Start by reading .brain/RESEARCH/ if it exists — this contains research from the Scout agent. Then follow the plan-feature skill. Write the plan to .brain/PLAN.md and any architectural decisions to .brain/DECISIONS.md. Do NOT write any source code, config files, or install dependencies — you ONLY write to .brain/ files. The Builder agent will handle all implementation.\n\nTask: ${originalTask}`;
}
```

Also update the builder section to mention DECISIONS.md (line ~250):

```typescript
if (agent === 'builder' || agent.includes('build')) {
  return `Implement the following task. Start by reading .brain/PLAN.md — this is your implementation spec from Architect. It contains the architecture, directory structure, ordered tasks, and acceptance criteria. Also read .brain/DECISIONS.md for architectural decisions. Follow the plan step by step. Set up the project from scratch if needed (git init, bun init, bun install, create directories), write all source code, and ensure it builds and runs. Always use bun, not npm.\n\nTask: ${originalTask}`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: PASS

**Step 5: Add RESEARCH/ to brainFiles in runner.ts**

In `src/agents/runner.ts`, update the `buildSystemPrompt` function (line ~172-181). After the existing `brainFiles` loop, add RESEARCH/ directory loading:

```typescript
  // 5. Project context from .brain/
  const brainDir = join(projectPath, '.brain');
  const brainFiles = [
    'PROJECT.md',
    'DECISIONS.md',
    'PATTERNS.md',
    'MISTAKES.md',
  ];

  const brainSections: string[] = [];
  for (const file of brainFiles) {
    const content = await readTextFile(join(brainDir, file));
    if (content && content.trim()) {
      brainSections.push(`### ${file}\n\n${content}`);
    }
  }

  // Load RESEARCH/ directory contents if they exist
  const researchFiles = await readAllFilesInDir(join(brainDir, 'RESEARCH'));
  if (researchFiles.length > 0) {
    brainSections.push(`### RESEARCH/\n\n${researchFiles.join('\n\n---\n\n')}`);
  }

  if (brainSections.length > 0) {
    sections.push(
      `---\n\n# Project Context (.brain/)\n\n${brainSections.join('\n\n')}`,
    );
  }
```

Note: `ACTIVE.md` and `SESSIONS/latest.md` are removed from the `brainFiles` array — they're being replaced by engine-managed state (Task 5).

**Step 6: Run all tests**

Run: `bun run test`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts src/agents/runner.ts
git commit -m "fix(pipeline): wire RESEARCH/ into architect task and system prompt"
```

---

### Task 5: Replace ACTIVE.md and SESSIONS/ with engine-managed context in buildSystemPrompt

**Files:**
- Modify: `src/agents/runner.ts:143-198` (buildSystemPrompt — replace ACTIVE.md/SESSIONS with pipeline state)
- Modify: `src/agents/runner.ts:1-6` (add imports)

**Step 1: Verify the runner change from Task 4 removed ACTIVE.md and SESSIONS/latest.md**

Confirm that the `brainFiles` array in `runner.ts` no longer includes `'ACTIVE.md'` or `'SESSIONS/latest.md'`. (This was done in Task 4 Step 5.)

**Step 2: Add pipeline state context to buildSystemPrompt**

In `src/agents/runner.ts`, add import at top:

```typescript
import { readPipelineState } from '../pipeline/state.js';
```

After the `.brain/` files section in `buildSystemPrompt`, add pipeline state context:

```typescript
  // 6. Pipeline state (engine-managed)
  const pipelineState = await readPipelineState(projectPath);
  if (pipelineState) {
    const completedStages = pipelineState.stages
      .filter(s => s.status === 'completed')
      .map(s => `- ${s.agent}: completed, validation ${s.validation ?? 'n/a'}`)
      .join('\n');

    const stateSection = [
      `Pipeline: ${pipelineState.pipeline.join(' → ')}`,
      `Status: ${pipelineState.status}`,
      `Current Stage: ${pipelineState.currentStage + 1}/${pipelineState.pipeline.length}`,
      `Retries: ${pipelineState.retries}`,
      completedStages ? `\nCompleted stages:\n${completedStages}` : '',
    ].filter(Boolean).join('\n');

    sections.push(`---\n\n# Pipeline State\n\n${stateSection}`);
  }
```

**Step 3: Run all tests**

Run: `bun run test`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/agents/runner.ts
git commit -m "refactor(runner): replace ACTIVE.md/SESSIONS with engine-managed pipeline state"
```

---

### Task 6: Add stall detection to heartbeat

**Files:**
- Modify: `src/heartbeat/loop.ts:56-94` (tickInner — check for stalled pipelines)
- Modify: `src/heartbeat/loop.ts:5-6` (HeartbeatDeps — add project paths)
- Test: `src/heartbeat/loop.test.ts` (add stall detection test)

**Step 1: Write the failing test**

Add to `src/heartbeat/loop.test.ts`:

```typescript
test('detects stalled pipeline and enqueues continuation', async () => {
  // Write a pipeline-state.json with status 'running' and old updatedAt
  const projectDir = join(import.meta.dirname, '../../.test-state/heartbeat-stall-test');
  await mkdir(join(projectDir, '.brain'), { recursive: true });

  const staleState = {
    project: projectDir,
    task: 'build something',
    pipeline: ['builder', 'reviewer'],
    status: 'running',
    currentStage: 0,
    startedAt: Date.now() - 60 * 60 * 1000, // 1 hour ago
    updatedAt: Date.now() - 45 * 60 * 1000,  // 45 min ago (stale)
    stages: [
      { agent: 'builder', status: 'running', startedAt: Date.now() - 45 * 60 * 1000 },
      { agent: 'reviewer', status: 'pending' },
    ],
    retries: 0,
  };

  await writeFile(
    join(projectDir, '.brain', 'pipeline-state.json'),
    JSON.stringify(staleState),
  );

  const enqueuedItems: unknown[] = [];
  const deps: HeartbeatDeps = {
    triggers: [],
    queue: {
      isEmpty: vi.fn().mockResolvedValue(true),
      enqueue: vi.fn(async (item) => { enqueuedItems.push(item); }),
      dequeue: vi.fn(),
      size: vi.fn().mockResolvedValue(0),
    } as unknown as WorkQueue,
    canRunAgent: vi.fn().mockResolvedValue(true),
    recordUsage: vi.fn(),
    runPipeline: vi.fn(),
    log: vi.fn(),
    projectPaths: [projectDir],
  };

  const heartbeat = new HeartbeatLoop(deps);
  const result = await heartbeat.tick();

  expect(result.action).toBe('queued');
  expect(enqueuedItems).toHaveLength(1);

  // Clean up
  await rm(projectDir, { recursive: true, force: true });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/heartbeat/loop.test.ts`
Expected: FAIL — `projectPaths` not in HeartbeatDeps, no stall detection logic

**Step 3: Add projectPaths to HeartbeatDeps and stall detection to tickInner**

In `src/heartbeat/loop.ts`, add import and update HeartbeatDeps:

```typescript
import { readPipelineState, writePipelineState } from '../pipeline/state.js';
```

```typescript
export interface HeartbeatDeps {
  triggers: CronTrigger[];
  queue: WorkQueue;
  canRunAgent: () => Promise<boolean>;
  recordUsage: (promptCount: number) => Promise<void>;
  runPipeline: (project: string, task: string, mode: 'standalone' | 'team', agent?: string) => Promise<PipelineResult>;
  log: (message: string) => void;
  projectPaths?: string[];
}
```

In `tickInner()`, add stall detection before checking triggers:

```typescript
private async tickInner(): Promise<TickResult> {
  // 0. Check for stalled pipelines
  if (this.deps.projectPaths) {
    for (const projectPath of this.deps.projectPaths) {
      const state = await readPipelineState(projectPath);
      if (state && state.status === 'running') {
        const staleDuration = Date.now() - state.updatedAt;
        const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

        if (staleDuration > STALL_THRESHOLD_MS) {
          this.deps.log(`[heartbeat] tick #${this.tickCount} — stalled pipeline detected in ${projectPath} (${Math.round(staleDuration / 60000)}m since last update)`);

          state.status = 'stalled';
          state.updatedAt = Date.now();
          await writePipelineState(projectPath, state);

          const currentAgent = state.pipeline[state.currentStage] ?? 'builder';
          await this.deps.queue.enqueue({
            triggerName: 'stall-recovery',
            project: projectPath,
            agent: currentAgent,
            task: state.task,
            mode: 'standalone',
            enqueuedAt: Date.now(),
          });

          return { action: 'queued', triggerName: 'stall-recovery' };
        }
      }
    }
  }

  // 1. Check triggers
  // ... (rest unchanged)
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/heartbeat/loop.test.ts`
Expected: PASS

**Step 5: Wire projectPaths into HeartbeatLoop in daemon.ts**

In `src/daemon.ts`, update the HeartbeatLoop construction (line ~185-195):

```typescript
  const heartbeat = new HeartbeatLoop(
    {
      triggers,
      queue,
      canRunAgent: () => canRunAgent(budgetConfig),
      recordUsage: (count) => recordUsage(count, budgetConfig),
      runPipeline,
      log,
      projectPaths: [...projectPathsByName.values()],
    },
    { intervalMs: config.heartbeatIntervalMs ?? 60_000 },
  );
```

**Step 6: Run all tests**

Run: `bun run test`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/heartbeat/loop.ts src/heartbeat/loop.test.ts src/daemon.ts
git commit -m "feat(heartbeat): add stall detection for pipelines via pipeline-state.json"
```

---

### Task 7: Replace REVIEW.md with structured output via SDK outputFormat

**Context:** Currently the Reviewer writes `REVIEW.md` with a markdown `Verdict:` line that the engine parses with a regex. This already broke once (markdown bold `**Verdict:**` didn't match). The SDK supports `outputFormat: { type: 'json_schema', schema: {...} }` which forces a structured JSON final response. The Reviewer still uses tools (Read, Bash for tests/build) during its session — `outputFormat` only shapes the very last message.

**Files:**
- Modify: `src/agents/runner.ts:73-78` (RunResult — add structuredOutput field)
- Modify: `src/agents/runner.ts:215-305` (runAgent — pass outputFormat for reviewer, capture structured_output)
- Modify: `src/pipeline/engine.ts:184-196` (validateReviewer — validate structured output instead of regex)
- Modify: `src/pipeline/engine.ts:227-237` (parseReviewVerdict — read from RunnerResult instead of file)
- Modify: `src/pipeline/engine.ts:13-17` (RunnerResult — add structuredOutput)
- Modify: `src/pipeline/engine.ts:254-256` (reviewer buildStageTask — remove REVIEW.md instruction)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Define the ReviewOutput type**

Create a shared type in `src/pipeline/state.ts` (append to existing file):

```typescript
export interface ReviewOutput {
  verdict: 'APPROVE' | 'REVISE' | 'REDESIGN';
  score: number;
  summary: string;
  issues: Array<{
    severity: 'major' | 'minor' | 'nit';
    description: string;
    file?: string;
  }>;
  patternsCompliance: boolean;
}

export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REVISE', 'REDESIGN'] },
    score: { type: 'number', minimum: 1, maximum: 10 },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['major', 'minor', 'nit'] },
          description: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['severity', 'description'],
      },
    },
    patternsCompliance: { type: 'boolean' },
  },
  required: ['verdict', 'score', 'summary', 'issues', 'patternsCompliance'],
} as const;
```

**Step 2: Write the failing test**

Add to `src/pipeline/engine.test.ts`:

```typescript
test('accepts structured review output and extracts verdict', async () => {
  const reviewOutput = {
    verdict: 'APPROVE',
    score: 8,
    summary: 'Well implemented',
    issues: [{ severity: 'nit', description: 'unused variable' }],
    patternsCompliance: true,
  };

  const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
    return {
      agentName: role,
      sandboxed: false,
      mode: 'standalone' as const,
      structuredOutput: role === 'reviewer' ? reviewOutput : undefined,
    };
  });

  const engine = new PipelineEngine({ runner, log: () => {} });

  const result = await engine.run({
    stages: [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ],
    project: TEST_PROJECT,
    task: 'build something',
  });

  expect(result.completed).toBe(true);
  expect(result.finalVerdict).toBe('APPROVE');
  expect(result.review).toEqual(reviewOutput);
});

test('uses structured output REVISE verdict for retry routing', async () => {
  let reviewCount = 0;
  const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
    if (role === 'reviewer') {
      reviewCount++;
      return {
        agentName: role,
        sandboxed: false,
        mode: 'standalone' as const,
        structuredOutput: {
          verdict: reviewCount === 1 ? 'REVISE' : 'APPROVE',
          score: reviewCount === 1 ? 5 : 9,
          summary: 'Review',
          issues: [],
          patternsCompliance: true,
        },
      };
    }
    return { agentName: role, sandboxed: false, mode: 'standalone' as const };
  });

  const engine = new PipelineEngine({ runner, log: () => {} });

  const result = await engine.run({
    stages: [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ],
    project: TEST_PROJECT,
    task: 'build something',
  });

  // builder → reviewer(REVISE) → builder → reviewer(APPROVE)
  expect(runner).toHaveBeenCalledTimes(4);
  expect(result.retries).toBe(1);
  expect(result.completed).toBe(true);
});
```

**Step 3: Run test to verify it fails**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: FAIL — `structuredOutput` not in RunnerResult, `review` not in PipelineResult

**Step 4: Update RunnerResult and PipelineResult**

In `src/pipeline/engine.ts`, update the interfaces:

```typescript
export interface RunnerResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
  sessionId?: string;
  structuredOutput?: unknown;
}

export interface PipelineResult {
  completed: boolean;
  stagesRun: number;
  retries: number;
  finalVerdict?: string;
  sessionIds?: Record<string, string>;
  review?: ReviewOutput;
}
```

Add import:
```typescript
import { writePipelineState, readPipelineState, type PipelineState, type ReviewOutput, REVIEW_JSON_SCHEMA } from './state.js';
```

**Step 5: Update engine to use structured output for verdict**

**IMPORTANT — Merge strategy:** Task 3 wrote the reviewer verdict block (lines 497-550 in Task 3's `run()` code) using `parseReviewVerdict()`. This step REPLACES that entire block — from the `if (stage.agent === 'reviewer' ...)` through the `REVISE` handling and `continue;` — with the structured output path below. Do NOT keep both paths side-by-side in the `while` loop.

The structured output path includes its own REVIEW.md fallback via `parseReviewVerdict()`, so the old code path is preserved inside the `else` branch. The key difference: structured output is tried FIRST, and the retry logic (REDESIGN/REVISE with stage reset) is shared between both branches via a `verdict` variable extracted before the branch point.

Add `let lastReviewOutput: ReviewOutput | undefined;` BEFORE the `while` loop (next to `sessionIds`).

Then REPLACE the reviewer verdict block inside the while loop (everything from `// Check review verdict after reviewer stages` through the closing of the reviewer `if` block) with:

```typescript
    // Check review verdict after reviewer stages
    if (stage.agent === 'reviewer' || stage.agent.includes('review')) {
      let verdict: string;

      // Prefer structured output over file parsing
      if (result.structuredOutput && typeof result.structuredOutput === 'object') {
        const review = result.structuredOutput as ReviewOutput;
        lastReviewOutput = review;
        verdict = review.verdict;
        this.config.log(`[pipeline] Reviewer verdict: ${verdict} (${review.score}/10, ${review.issues.length} issues)`);

        // Log patterns compliance warning
        if (review.patternsCompliance === false) {
          this.config.log(`[pipeline] WARNING: Reviewer reports patterns non-compliance. Review .brain/PATTERNS.md adherence.`);
        }
      } else {
        // Fallback: parse from REVIEW.md (backwards compat)
        verdict = await this.parseReviewVerdict(project);
        this.config.log(`[pipeline] Reviewer verdict: ${verdict} (from REVIEW.md fallback)`);
      }

      if (verdict === 'APPROVE') {
        i++;
        continue;
      }

      if (retries >= this.maxRetries) {
        this.config.log(`[pipeline] Max retries (${this.maxRetries}) reached. Stopping.`);
        pipelineState.status = 'failed';
        pipelineState.finalVerdict = verdict;
        pipelineState.retries = retries;
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        return { completed: false, stagesRun, retries, finalVerdict: verdict, sessionIds, review: lastReviewOutput };
      }

      retries++;
      pipelineState.retries = retries;

      if (verdict === 'REDESIGN') {
        const architectIdx = stages.findIndex(s => s.agent === 'architect' || s.agent.includes('architect'));
        const restartIdx = architectIdx >= 0 ? architectIdx : 0;
        this.config.log(`[pipeline] Reviewer verdict: REDESIGN — restarting from ${stages[restartIdx]!.agent} (retry ${retries})`);
        for (let j = restartIdx; j < stages.length; j++) {
          pipelineState.stages[j]!.status = 'pending';
          pipelineState.stages[j]!.startedAt = undefined;
          pipelineState.stages[j]!.completedAt = undefined;
          pipelineState.stages[j]!.validation = undefined;
        }
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        i = restartIdx;
        continue;
      }

      // REVISE
      const builderIdx = stages.slice(0, i).reverse().findIndex(s => s.agent === 'builder' || s.agent.includes('build'));
      const restartIdx = builderIdx >= 0 ? i - 1 - builderIdx : Math.max(0, i - 1);
      this.config.log(`[pipeline] Reviewer verdict: REVISE — re-running ${stages[restartIdx]!.agent} (retry ${retries})`);
      for (let j = restartIdx; j < stages.length; j++) {
        pipelineState.stages[j]!.status = 'pending';
        pipelineState.stages[j]!.startedAt = undefined;
        pipelineState.stages[j]!.completedAt = undefined;
        pipelineState.stages[j]!.validation = undefined;
      }
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);
      i = restartIdx;
      continue;
    }
```

**What changed vs Task 3's version:**
- `verdict` is now extracted from either structured output or `parseReviewVerdict()` — ONE variable, TWO sources
- The retry logic (APPROVE/REDESIGN/REVISE branching + stage reset + state writes) is SHARED after the extraction — no duplication
- `lastReviewOutput` is captured for the final `PipelineResult`
- `patternsCompliance` warning is logged inside the structured output branch
- `review: lastReviewOutput` is added to ALL return statements (both early returns and final return)

In the final return, include the review:
```typescript
  return { completed: true, stagesRun, retries, finalVerdict: 'APPROVE', sessionIds, review: lastReviewOutput };
```

**Step 6: Update validateReviewer to accept structured output**

Replace the `validateReviewer` method:

```typescript
  private async validateReviewer(project: string, structuredOutput?: unknown): Promise<string | null> {
    // If structured output is available, validate its shape
    if (structuredOutput && typeof structuredOutput === 'object') {
      const review = structuredOutput as Record<string, unknown>;
      if (!review['verdict'] || !['APPROVE', 'REVISE', 'REDESIGN'].includes(String(review['verdict']))) {
        return 'Reviewer structured output missing valid verdict field';
      }
      if (typeof review['score'] !== 'number' || review['score'] < 1 || review['score'] > 10) {
        return 'Reviewer structured output has invalid score (must be 1-10)';
      }
      return null;
    }

    // Fallback: check REVIEW.md file (backwards compatibility)
    const reviewPath = join(project, '.brain', 'REVIEW.md');
    try {
      const content = await readFile(reviewPath, 'utf-8');
      if (!content.match(/\*{0,2}Verdict:?\*{0,2}\s*(APPROVE|REVISE|REDESIGN)/i)) {
        return 'Reviewer wrote REVIEW.md but missing a valid Verdict: line (APPROVE|REVISE|REDESIGN)';
      }
    } catch {
      return 'Reviewer did not produce a review (no structured output and no .brain/REVIEW.md)';
    }
    return null;
  }
```

Update `validateStage` to pass the structured output through:
```typescript
  private async validateStage(agent: string, project: string, structuredOutput?: unknown): Promise<string | null> {
    if (agent === 'architect' || agent.includes('architect')) {
      return this.validateArchitect(project);
    }
    if (agent === 'builder' || agent.includes('build')) {
      return this.validateBuilder(project);
    }
    if (agent === 'reviewer' || agent.includes('review')) {
      return this.validateReviewer(project, structuredOutput);
    }
    return null;
  }
```

And update the call site in `run()`:
```typescript
    const validationError = await this.validateStage(stage.agent, project, result.structuredOutput);
```

**Step 7: Update reviewer buildStageTask to prefer structured output with REVIEW.md fallback**

The reviewer's `buildStageTask` must NOT tell the reviewer to skip `REVIEW.md`. If structured output fails (e.g., reviewer hits max turns before producing the final result message), REVIEW.md is the only fallback. Both paths must be available.

```typescript
    if (agent === 'reviewer' || agent.includes('review')) {
      return `Review the code written by ${prevAgent ?? 'Builder'} for the following task. Follow the review-loop and review-code skills. Read .brain/PLAN.md to understand what was supposed to be built, then review the actual code. Read .brain/PATTERNS.md and verify the code follows established patterns. Run tests/build. Your final response will be captured as structured JSON. As a backup, also write your verdict to .brain/REVIEW.md with a "Verdict: APPROVE", "Verdict: REVISE", or "Verdict: REDESIGN" line.\n\nTask: ${originalTask}`;
    }
```

**Why both:** The SDK's `outputFormat` constrains the final message, but it doesn't guarantee the agent reaches that final message. If the reviewer hits max turns, the last message is a tool use — `structured_output` is undefined, and without REVIEW.md, there's no verdict at all. The engine tries structured output first, falls back to REVIEW.md parsing.

**Step 8: Update runner to pass outputFormat for reviewer**

In `src/agents/runner.ts`, update `RunResult`:
```typescript
export interface RunResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
  syncedFiles?: string[];
  sessionId?: string;
  structuredOutput?: unknown;
}
```

Add import:
```typescript
import { REVIEW_JSON_SCHEMA } from '../pipeline/state.js';
```

In the `runAgent` function, add `outputFormat` for reviewer agents and capture `structured_output`:

```typescript
  const isReviewer = role === 'reviewer' || role.includes('review');
  let structuredOutput: unknown | undefined;

  for await (const message of query({
    prompt: task,
    options: {
      systemPrompt,
      model,
      maxTurns,
      pathToClaudeCodeExecutable: claudePath,
      allowedTools: agent.frontmatter.tools,
      cwd: projectPath,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env,
      hooks: runOptions.hooks,
      ...(sandboxed && {
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
        },
      }),
      ...(isReviewer && {
        outputFormat: {
          type: 'json_schema' as const,
          schema: REVIEW_JSON_SCHEMA as Record<string, unknown>,
        },
      }),
      stderr: (data: string) => process.stderr.write(`[stderr] ${data}`),
    },
  })) {
    const msg = message as Record<string, unknown>;

    if (!sessionId && typeof msg['session_id'] === 'string') {
      sessionId = msg['session_id'];
    }

    // Capture structured_output from result message
    if (msg['type'] === 'result' && msg['subtype'] === 'success') {
      const resultMsg = msg as Record<string, unknown>;
      if (resultMsg['structured_output'] !== undefined) {
        structuredOutput = resultMsg['structured_output'];
      }
    }

    // ... (existing message logging)
  }

  return {
    agentName: agent.frontmatter.name,
    sandboxed,
    mode,
    sessionId,
    structuredOutput,
  };
```

**Step 9: Run tests to verify they pass**

Run: `bun run test`
Expected: All PASS

**Step 10: Commit**

```bash
git add src/pipeline/state.ts src/pipeline/engine.ts src/pipeline/engine.test.ts src/agents/runner.ts
git commit -m "feat(pipeline): replace REVIEW.md with structured output via SDK outputFormat"
```

---

### Task 8: Bootstrap PROJECT.md on first run

**Context:** On the first pipeline run for a new project, `PROJECT.md` is empty (the template has placeholder text). The router reads it for context (`daemon.ts:178`) and the system prompt loads it (`runner.ts`). Both get nothing useful on the first run. The fix: if `PROJECT.md` is empty or missing when the engine starts, generate a minimal scaffold from the task description.

**Files:**
- Modify: `src/pipeline/engine.ts` (add `ensureProjectContext` called at start of `run()`)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

Add to `src/pipeline/engine.test.ts`:

```typescript
import { readFile } from 'node:fs/promises';

test('bootstraps PROJECT.md from task when it does not exist', async () => {
  // BRAIN_DIR exists from beforeEach, but no PROJECT.md
  const runner = makeRunner();
  const engine = new PipelineEngine({ runner, log: () => {} });

  await engine.run({
    stages: [{ agent: 'builder', teams: false }],
    project: TEST_PROJECT,
    task: 'Build a todo app with Next.js, TypeScript, and Tailwind CSS',
  });

  const content = await readFile(join(BRAIN_DIR, 'PROJECT.md'), 'utf-8');
  expect(content).toContain('todo app');
  expect(content).toContain('Next.js');
});

test('does not overwrite existing PROJECT.md', async () => {
  await writeFile(join(BRAIN_DIR, 'PROJECT.md'), '# My Custom Project\n\nExisting context here.');

  const runner = makeRunner();
  const engine = new PipelineEngine({ runner, log: () => {} });

  await engine.run({
    stages: [{ agent: 'builder', teams: false }],
    project: TEST_PROJECT,
    task: 'Add authentication',
  });

  const content = await readFile(join(BRAIN_DIR, 'PROJECT.md'), 'utf-8');
  expect(content).toContain('My Custom Project');
  expect(content).not.toContain('Add authentication');
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: FAIL — first test fails because PROJECT.md doesn't exist after run

**Step 3: Add ensureProjectContext to engine**

In `src/pipeline/engine.ts`, add a private method and call it at the top of `run()`:

```typescript
  private async ensureProjectContext(project: string, task: string): Promise<void> {
    const projectMdPath = join(project, '.brain', 'PROJECT.md');
    try {
      const content = await readFile(projectMdPath, 'utf-8');
      if (content.trim().length > 50) return; // Already has meaningful content
    } catch {
      // File doesn't exist — that's fine, we'll create it
    }

    // Bootstrap from task description
    const scaffold = `# Project\n\n**Task:** ${task}\n\n**Status:** First pipeline run — architecture pending.\n`;
    await mkdir(join(project, '.brain'), { recursive: true });
    await writeFile(projectMdPath, scaffold);
    this.config.log(`[pipeline] Bootstrapped .brain/PROJECT.md from task description`);
  }
```

Add `mkdir` to the imports at the top of the file if not already present:
```typescript
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
```

Call it at the start of `run()`, before initializing pipeline state:
```typescript
  async run(options: PipelineRunOptions): Promise<PipelineResult> {
    const { stages, project, task } = options;

    // Ensure .brain/PROJECT.md exists for first-run bootstrap
    await this.ensureProjectContext(project, task);

    // ... rest of run()
  }
```

**Step 4: Run test to verify it passes**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): bootstrap PROJECT.md from task on first run"
```

---

### Task 9: Add patterns compliance validation and MISTAKES.md size cap

**Context:** `PATTERNS.md` and `MISTAKES.md` are loaded into the system prompt but never validated. The structured review output (Task 7) now includes a `patternsCompliance` boolean. The engine should check this and log a warning. `MISTAKES.md` can grow unbounded — the engine should cap what it loads to prevent token bloat.

**Files:**
- Modify: `src/pipeline/engine.ts` (check `patternsCompliance` from structured review, log warning if false)
- Modify: `src/agents/runner.ts:172-195` (cap MISTAKES.md content loaded into system prompt)
- Test: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test for patterns compliance warning**

Add to `src/pipeline/engine.test.ts`:

```typescript
test('logs warning when reviewer reports patterns non-compliance', async () => {
  const logs: string[] = [];
  const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
    return {
      agentName: role,
      sandboxed: false,
      mode: 'standalone' as const,
      structuredOutput: role === 'reviewer' ? {
        verdict: 'APPROVE',
        score: 7,
        summary: 'Works but breaks patterns',
        issues: [{ severity: 'minor', description: 'Violates naming convention in PATTERNS.md' }],
        patternsCompliance: false,
      } : undefined,
    };
  });

  const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

  await engine.run({
    stages: [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ],
    project: TEST_PROJECT,
    task: 'build something',
  });

  expect(logs.some(l => l.includes('patterns') && l.includes('non-compliance'))).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: FAIL — no log message about patterns

**Step 3: Patterns compliance check is already in Task 7**

The patterns compliance warning (`review.patternsCompliance === false`) is already integrated into Task 7 Step 5's replacement block inside the structured output branch. No additional code needed here — just run the test to verify it passes with Task 7's code in place.

**Step 4: Run test to verify it passes**

Run: `bun run test src/pipeline/engine.test.ts`
Expected: PASS (the patterns compliance log is emitted by Task 7's structured output branch)

**Step 5: Cap MISTAKES.md in runner.ts**

In `src/agents/runner.ts`, update the `buildSystemPrompt` function where MISTAKES.md is loaded. After reading the file content, truncate if it exceeds a size limit:

```typescript
  const brainSections: string[] = [];
  for (const file of brainFiles) {
    let content = await readTextFile(join(brainDir, file));
    if (content && content.trim()) {
      // Cap MISTAKES.md to prevent unbounded token growth — keep NEWEST entries
      if (file === 'MISTAKES.md' && content.length > 3000) {
        const lines = content.split('\n');
        // Read from the END to keep the most recent mistakes (most relevant)
        const truncated: string[] = [];
        let charCount = 0;
        for (let j = lines.length - 1; j >= 0; j--) {
          charCount += lines[j]!.length + 1;
          if (charCount > 3000) break;
          truncated.unshift(lines[j]!);
        }
        content = '[...oldest entries truncated]\n\n' + truncated.join('\n');
      }
      brainSections.push(`### ${file}\n\n${content}`);
    }
  }
```

**Why reverse:** Mistakes are learned chronologically — the newest entries reflect the most recent lessons and are the most relevant to the current codebase state. The original loop iterated top-to-bottom and stopped at 3000 chars, which would keep the oldest (least relevant) entries and drop the newest.

**Step 6: Run all tests**

Run: `bun run test`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts src/agents/runner.ts
git commit -m "feat(pipeline): validate patterns compliance, cap MISTAKES.md size"
```

---

### Task 10: Update brain-structure.md and clean up

**Files:**
- Modify: `docs/brain-structure.md`

**Step 1: Update brain-structure.md to reflect the full new architecture**

Update the document to reflect all changes:

- `ACTIVE.md` → replaced by `pipeline-state.json` (engine-managed)
- `SESSIONS/` → replaced by SDK `getSessionMessages()` (session IDs stored in `pipeline-state.json`)
- `RESEARCH/` → now wired into architect's `buildStageTask` and `buildSystemPrompt`
- `REVIEW.md` → structured JSON output primary via SDK `outputFormat`, REVIEW.md retained as fallback
- `PATTERNS.md` → loaded into system prompt AND validated via Reviewer's `patternsCompliance` field
- `MISTAKES.md` → loaded into system prompt with 3000-char cap to prevent token bloat
- `PROJECT.md` → bootstrapped by engine from task description on first run
- New engine-managed file: `pipeline-state.json`
- Final `.brain/` file list (agent-written): `PROJECT.md`, `PLAN.md`, `DECISIONS.md`, `PATTERNS.md`, `MISTAKES.md`, `BACKLOG.md`
- Removed: `ACTIVE.md`, `SESSIONS/` (replaced by engine-managed equivalents)
- Demoted: `REVIEW.md` (kept as fallback, structured output is primary path)

**Step 2: Run full test suite**

Run: `bun run test`
Expected: All PASS

**Step 3: Commit**

```bash
git add docs/brain-structure.md
git commit -m "docs: update brain-structure.md with full pipeline state refactor"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `bun run test` — all tests pass
- [ ] `pipeline-state.json` is written to `.brain/` during pipeline runs
- [ ] `runner.ts` no longer loads `ACTIVE.md` or `SESSIONS/latest.md` into system prompt
- [ ] `runner.ts` loads `RESEARCH/` directory contents into system prompt
- [ ] `runner.ts` caps `MISTAKES.md` at 3000 chars in system prompt
- [ ] Architect's task prompt mentions reading `.brain/RESEARCH/`
- [ ] Builder's task prompt mentions reading `.brain/DECISIONS.md`
- [ ] Reviewer uses `outputFormat` for structured JSON verdict — REVIEW.md written as fallback
- [ ] Engine validates structured review output (verdict enum, score range)
- [ ] Engine logs warning when `patternsCompliance` is false
- [ ] Engine bootstraps `PROJECT.md` from task on first run (empty or missing)
- [ ] Engine does NOT overwrite existing `PROJECT.md` with meaningful content
- [ ] `RunResult` includes optional `sessionId` and `structuredOutput`
- [ ] `PipelineResult` includes `sessionIds` map and `review` field
- [ ] Heartbeat detects stalled pipelines (>30min since last update)
- [ ] No references to `ACTIVE.md` remain in `runner.ts` or `engine.ts`
- [ ] `brain-structure.md` is updated with all changes
