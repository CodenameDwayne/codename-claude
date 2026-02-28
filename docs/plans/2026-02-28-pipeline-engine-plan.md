# Pipeline Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Agent Teams as the default orchestration with a daemon-orchestrated pipeline engine that uses an LLM router to pick agents and runs them sequentially.

**Architecture:** A new `src/pipeline/` module containing a router (Haiku API call to select agents) and an engine (sequential executor with review-loop routing). The heartbeat calls the pipeline engine instead of the runner directly. Existing runner is unchanged.

**Tech Stack:** TypeScript, Anthropic SDK (Haiku for routing), vitest for tests.

---

## Batch 1: LLM Router

### Task 1: Router types and agent definition loader

**Files:**
- Create: `src/pipeline/router.ts`
- Reference: `src/agents/runner.ts:55-67` (AgentFrontmatter type)

**Step 1: Write the failing test**

Create `src/pipeline/router.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { loadAgentSummaries, type AgentSummary } from './router.js';

describe('loadAgentSummaries', () => {
  test('returns empty array when agents dir does not exist', async () => {
    const result = await loadAgentSummaries('/nonexistent/path');
    expect(result).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/router.test.ts`
Expected: FAIL — `loadAgentSummaries` not found

**Step 3: Write minimal implementation**

Create `src/pipeline/router.ts`:

```typescript
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface AgentSummary {
  name: string;
  description: string;  // from whenToUse or the system prompt first line
  model: string;
  skills: string[];
}

export interface PipelineStage {
  agent: string;
  teams: boolean;
}

export async function loadAgentSummaries(agentsDir: string): Promise<AgentSummary[]> {
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    const summaries: AgentSummary[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const raw = await readFile(join(agentsDir, entry.name), 'utf-8');
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) continue;

      const frontmatter = parseYaml(match[1] ?? '') as Record<string, unknown>;
      const body = match[2]?.trim() ?? '';
      // Use first non-empty line of body as description
      const firstLine = body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').trim() ?? '';

      summaries.push({
        name: String(frontmatter['name'] ?? entry.name.replace('.md', '')).toLowerCase(),
        description: String(frontmatter['whenToUse'] ?? firstLine),
        model: String(frontmatter['model'] ?? 'claude-sonnet-4-6'),
        skills: Array.isArray(frontmatter['skills']) ? frontmatter['skills'] : [],
      });
    }

    return summaries;
  } catch {
    return [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/router.ts src/pipeline/router.test.ts
git commit -m "feat(pipeline): add agent summary loader"
```

---

### Task 2: LLM Router — route function

**Files:**
- Modify: `src/pipeline/router.ts`
- Modify: `src/pipeline/router.test.ts`

**Step 1: Write the failing test**

Add to `src/pipeline/router.test.ts`:

```typescript
import { describe, test, expect, vi } from 'vitest';
import { routeTask, type AgentSummary, type PipelineStage } from './router.js';

describe('routeTask', () => {
  test('calls Anthropic API and returns parsed stages', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ])}],
    });

    const agents: AgentSummary[] = [
      { name: 'builder', description: 'writes code', model: 'sonnet', skills: [] },
      { name: 'reviewer', description: 'reviews code', model: 'sonnet', skills: [] },
    ];

    const result = await routeTask({
      task: 'add a login page',
      agents,
      projectContext: 'A web app',
      createMessage: mockCreate,
    });

    expect(result).toEqual([
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ]);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  test('returns single-stage pipeline for manual override', async () => {
    const result = await routeTask({
      task: 'fix the bug',
      agents: [],
      projectContext: '',
      manualAgent: 'builder',
    });

    expect(result).toEqual([{ agent: 'builder', teams: false }]);
  });

  test('returns single-stage with teams when manual + teams', async () => {
    const result = await routeTask({
      task: 'fix the bug',
      agents: [],
      projectContext: '',
      manualAgent: 'builder',
      manualTeams: true,
    });

    expect(result).toEqual([{ agent: 'builder', teams: true }]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/router.test.ts`
Expected: FAIL — `routeTask` not found

**Step 3: Write minimal implementation**

Add to `src/pipeline/router.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';

// Type for the Anthropic messages.create function (allows DI for testing)
export type CreateMessageFn = (params: {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
}) => Promise<{ content: Array<{ type: string; text?: string }> }>;

export interface RouteOptions {
  task: string;
  agents: AgentSummary[];
  projectContext: string;
  createMessage?: CreateMessageFn;
  manualAgent?: string;
  manualTeams?: boolean;
}

export async function routeTask(options: RouteOptions): Promise<PipelineStage[]> {
  const { task, agents, projectContext, manualAgent, manualTeams } = options;

  // Manual override — skip LLM call
  if (manualAgent) {
    return [{ agent: manualAgent, teams: manualTeams ?? false }];
  }

  // Build prompt for Haiku
  const agentList = agents
    .map(a => `- ${a.name}: ${a.description}`)
    .join('\n');

  const prompt = `You are a task router for an AI coding agent system. Given a task and available agents, decide which agents should run and in what order.

Available agents:
${agentList}

Project context:
${projectContext || 'No additional context.'}

Task: ${task}

Return a JSON array of pipeline stages. Each stage has:
- "agent": the agent name (must match one from the list above)
- "teams": boolean — true only if the task is complex enough that this agent needs to spawn sub-agents for parallel work. Most tasks should be false.

Common patterns:
- Simple coding task: [{"agent":"builder","teams":false},{"agent":"reviewer","teams":false}]
- Complex feature: [{"agent":"architect","teams":false},{"agent":"builder","teams":false},{"agent":"reviewer","teams":false}]
- Research needed: [{"agent":"scout","teams":false},{"agent":"architect","teams":false},{"agent":"builder","teams":false},{"agent":"reviewer","teams":false}]

Return ONLY the JSON array, no explanation.`;

  const createMessage = options.createMessage ?? createDefaultClient();

  const response = await createMessage({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text ?? '[]';
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Router returned invalid response: ${text}`);
  }

  const stages = JSON.parse(jsonMatch[0]) as PipelineStage[];

  // Validate agent names exist
  const validNames = new Set(agents.map(a => a.name));
  for (const stage of stages) {
    if (!validNames.has(stage.agent)) {
      throw new Error(`Router selected unknown agent: ${stage.agent}`);
    }
  }

  return stages;
}

function createDefaultClient(): CreateMessageFn {
  const client = new Anthropic();
  return (params) => client.messages.create(params as Parameters<typeof client.messages.create>[0]);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/router.ts src/pipeline/router.test.ts
git commit -m "feat(pipeline): add LLM router with Haiku for agent selection"
```

---

## Batch 2: Pipeline Engine

### Task 3: Pipeline engine — basic sequential execution

**Files:**
- Create: `src/pipeline/engine.ts`
- Create: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

Create `src/pipeline/engine.test.ts`:

```typescript
import { describe, test, expect, vi } from 'vitest';
import { PipelineEngine, type PipelineRunnerFn, type PipelineOptions } from './engine.js';
import type { PipelineStage } from './router.js';

function makeRunner(): PipelineRunnerFn {
  return vi.fn(async () => ({ agentName: 'builder', sandboxed: false, mode: 'standalone' as const }));
}

describe('PipelineEngine', () => {
  test('runs stages sequentially', async () => {
    const runner = makeRunner();
    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

    const stages: PipelineStage[] = [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];

    await engine.run({ stages, project: '/tmp/test', task: 'build something' });

    expect(runner).toHaveBeenCalledTimes(2);
    // First call is builder
    expect(runner).toHaveBeenNthCalledWith(1, 'builder', '/tmp/test', expect.any(String), expect.objectContaining({ mode: 'standalone' }));
    // Second call is reviewer
    expect(runner).toHaveBeenNthCalledWith(2, 'reviewer', '/tmp/test', expect.any(String), expect.objectContaining({ mode: 'standalone' }));
    // Logs show pipeline progress
    expect(logs.some(l => l.includes('Stage 1/2'))).toBe(true);
    expect(logs.some(l => l.includes('Stage 2/2'))).toBe(true);
    expect(logs.some(l => l.includes('Pipeline complete'))).toBe(true);
  });

  test('passes teams mode through to runner', async () => {
    const runner = makeRunner();
    const engine = new PipelineEngine({ runner, log: () => {} });

    const stages: PipelineStage[] = [
      { agent: 'builder', teams: true },
    ];

    await engine.run({ stages, project: '/tmp/test', task: 'complex task' });

    expect(runner).toHaveBeenCalledWith('builder', '/tmp/test', expect.any(String), expect.objectContaining({ mode: 'team' }));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/engine.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/pipeline/engine.ts`:

```typescript
import type { PipelineStage } from './router.js';
import type { RunResult, RunOptions } from '../agents/runner.js';

export type PipelineRunnerFn = (
  role: string,
  projectPath: string,
  task: string,
  options: RunOptions,
) => Promise<RunResult>;

export interface PipelineEngineConfig {
  runner: PipelineRunnerFn;
  log: (message: string) => void;
  hooks?: RunOptions['hooks'];
}

export interface PipelineRunOptions {
  stages: PipelineStage[];
  project: string;
  task: string;
}

export interface PipelineResult {
  completed: boolean;
  stagesRun: number;
  retries: number;
  finalVerdict?: string;
}

export class PipelineEngine {
  private config: PipelineEngineConfig;

  constructor(config: PipelineEngineConfig) {
    this.config = config;
  }

  async run(options: PipelineRunOptions): Promise<PipelineResult> {
    const { stages, project, task } = options;
    const total = stages.length;
    let stagesRun = 0;

    this.config.log(`[pipeline] Starting pipeline: ${stages.map(s => s.agent).join(' → ')}`);
    this.config.log(`[pipeline] Task: "${task}"`);

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]!;
      const stageNum = i + 1;
      const mode = stage.teams ? 'team' : 'standalone';

      this.config.log(`[pipeline] Stage ${stageNum}/${total}: Running ${stage.agent} (${mode})`);

      const stageTask = this.buildStageTask(stage.agent, task, i, stages);

      await this.config.runner(stage.agent, project, stageTask, {
        mode,
        hooks: this.config.hooks,
        log: this.config.log,
      });

      stagesRun++;
      this.config.log(`[pipeline] Stage ${stageNum}/${total}: ${stage.agent} completed`);
    }

    this.config.log(`[pipeline] Pipeline complete (${stagesRun} stages, 0 retries)`);

    return { completed: true, stagesRun, retries: 0 };
  }

  private buildStageTask(agent: string, originalTask: string, index: number, stages: PipelineStage[]): string {
    if (index === 0) {
      return originalTask;
    }

    const prevAgent = stages[index - 1]?.agent ?? 'previous agent';

    if (agent === 'reviewer' || agent.includes('review')) {
      return `Review the code changes made by ${prevAgent} for the following task: ${originalTask}\n\nRun the tests, check code quality, and write your review to .brain/REVIEW.md with a score (1-10) and verdict (APPROVE, REVISE, or REDESIGN).`;
    }

    if (agent === 'builder' || agent.includes('build')) {
      return `Implement the following task based on the plan in .brain/PLAN.md: ${originalTask}`;
    }

    if (agent === 'architect' || agent.includes('architect')) {
      return `Design the architecture for the following task and write the plan to .brain/PLAN.md: ${originalTask}`;
    }

    return originalTask;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): add pipeline engine with sequential stage execution"
```

---

### Task 4: Pipeline engine — review loop routing

**Files:**
- Modify: `src/pipeline/engine.ts`
- Modify: `src/pipeline/engine.test.ts`

**Step 1: Write the failing test**

Add to `src/pipeline/engine.test.ts`:

```typescript
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, afterEach } from 'vitest';

const TEST_PROJECT = join(import.meta.dirname, '../../.test-state/pipeline-test');
const BRAIN_DIR = join(TEST_PROJECT, '.brain');

// Add setup/teardown at the top of the describe block or as a new describe
describe('PipelineEngine review loop', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('re-runs builder when reviewer says REVISE', async () => {
    let callCount = 0;
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      callCount++;
      if (role === 'reviewer') {
        // First review: REVISE, second review: APPROVE
        const verdict = callCount <= 3 ? 'REVISE' : 'APPROVE';
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), `# Code Review\nScore: ${verdict === 'APPROVE' ? '9' : '5'}/10\nVerdict: ${verdict}\n\n## Issues\n- Needs work`);
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

    // builder(1) → reviewer(2,REVISE) → builder(3) → reviewer(4,APPROVE)
    expect(runner).toHaveBeenCalledTimes(4);
    expect(result.retries).toBe(1);
    expect(result.completed).toBe(true);
  });

  test('stops after max retries and reports failure', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Code Review\nScore: 3/10\nVerdict: REVISE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const engine = new PipelineEngine({ runner, log: () => {}, maxRetries: 2 });

    const result = await engine.run({
      stages: [
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    // builder → reviewer(REVISE) → builder → reviewer(REVISE) → builder → reviewer(REVISE) → STOP
    // That's 3 builder + 3 reviewer = 6 calls (initial + 2 retries)
    expect(runner).toHaveBeenCalledTimes(6);
    expect(result.completed).toBe(false);
    expect(result.retries).toBe(2);
  });

  test('re-runs from architect when reviewer says REDESIGN', async () => {
    let reviewCount = 0;
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'reviewer') {
        reviewCount++;
        const verdict = reviewCount === 1 ? 'REDESIGN' : 'APPROVE';
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), `# Code Review\nScore: ${verdict === 'APPROVE' ? '9' : '2'}/10\nVerdict: ${verdict}\n`);
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something complex',
    });

    // arch(1) → builder(2) → reviewer(3,REDESIGN) → arch(4) → builder(5) → reviewer(6,APPROVE)
    expect(runner).toHaveBeenCalledTimes(6);
    expect(result.retries).toBe(1);
    expect(result.completed).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/engine.test.ts`
Expected: FAIL — no review loop logic yet

**Step 3: Update implementation**

Update `src/pipeline/engine.ts` — replace the `run` method and add `parseReviewVerdict`:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Add to PipelineEngineConfig:
//   maxRetries?: number;

// Add to constructor:
//   this.maxRetries = config.maxRetries ?? 3;

// Replace the run method with:
async run(options: PipelineRunOptions): Promise<PipelineResult> {
  const { stages, project, task } = options;
  let retries = 0;

  this.config.log(`[pipeline] Starting pipeline: ${stages.map(s => s.agent).join(' → ')}`);
  this.config.log(`[pipeline] Task: "${task}"`);

  let i = 0;
  let stagesRun = 0;

  while (i < stages.length) {
    const stage = stages[i]!;
    const mode = stage.teams ? 'team' : 'standalone';

    this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: Running ${stage.agent} (${mode})`);

    const stageTask = this.buildStageTask(stage.agent, task, i, stages);

    await this.config.runner(stage.agent, project, stageTask, {
      mode,
      hooks: this.config.hooks,
      log: this.config.log,
    });

    stagesRun++;
    this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: ${stage.agent} completed`);

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
        return { completed: false, stagesRun, retries, finalVerdict: verdict };
      }

      retries++;

      if (verdict === 'REDESIGN') {
        // Find the architect stage (or earliest non-reviewer stage)
        const architectIdx = stages.findIndex(s => s.agent === 'architect' || s.agent.includes('architect'));
        const restartIdx = architectIdx >= 0 ? architectIdx : 0;
        this.config.log(`[pipeline] Reviewer verdict: REDESIGN — restarting from ${stages[restartIdx]!.agent} (retry ${retries})`);
        i = restartIdx;
        continue;
      }

      // REVISE — find the builder stage before this reviewer
      const builderIdx = stages.slice(0, i).reverse().findIndex(s => s.agent === 'builder' || s.agent.includes('build'));
      const restartIdx = builderIdx >= 0 ? i - 1 - builderIdx : Math.max(0, i - 1);
      this.config.log(`[pipeline] Reviewer verdict: REVISE — re-running ${stages[restartIdx]!.agent} (retry ${retries})`);
      i = restartIdx;
      continue;
    }

    i++;
  }

  this.config.log(`[pipeline] Pipeline complete (${stagesRun} stages, ${retries} retries)`);
  return { completed: true, stagesRun, retries, finalVerdict: 'APPROVE' };
}

private async parseReviewVerdict(project: string): Promise<string> {
  try {
    const reviewPath = join(project, '.brain', 'REVIEW.md');
    const content = await readFile(reviewPath, 'utf-8');
    const match = content.match(/Verdict:\s*(APPROVE|REVISE|REDESIGN)/i);
    return match ? match[1]!.toUpperCase() : 'APPROVE';
  } catch {
    // No REVIEW.md — assume approved
    return 'APPROVE';
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/engine.ts src/pipeline/engine.test.ts
git commit -m "feat(pipeline): add review loop routing (APPROVE/REVISE/REDESIGN)"
```

---

## Batch 3: Wire into daemon + clean up hooks

### Task 5: Update heartbeat to call pipeline engine

**Files:**
- Modify: `src/heartbeat/loop.ts`
- Modify: `src/heartbeat/loop.test.ts`

**Step 1: Write the failing test**

Update `src/heartbeat/loop.test.ts` — change the `HeartbeatDeps.runAgent` type to accept `runPipeline` instead:

```typescript
// Update the makeDeps function to use runPipeline:
function makeDeps(overrides: Partial<HeartbeatDeps> = {}): HeartbeatDeps {
  return {
    triggers: [],
    queue: new WorkQueue(QUEUE_FILE),
    canRunAgent: async () => true,
    recordUsage: async () => {},
    runPipeline: async () => ({ completed: true, stagesRun: 1, retries: 0 }),
    log: () => {},
    ...overrides,
  };
}

// Update all existing tests that reference runAgent to use runPipeline
// The test assertions should work the same — just the function name changes
```

Run: `npx vitest run src/heartbeat/loop.test.ts`
Expected: FAIL — `runPipeline` doesn't exist on HeartbeatDeps

**Step 2: Update heartbeat to use pipeline**

Modify `src/heartbeat/loop.ts`:

Change `HeartbeatDeps`:
```typescript
export interface HeartbeatDeps {
  triggers: CronTrigger[];
  queue: WorkQueue;
  canRunAgent: () => Promise<boolean>;
  recordUsage: (promptCount: number) => Promise<void>;
  runPipeline: (project: string, task: string, mode: 'standalone' | 'team', agent?: string) => Promise<PipelineResult>;
  log: (message: string) => void;
}
```

Change `executeAgent` to call `runPipeline`:
```typescript
private async executeAgent(
  agent: string,
  project: string,
  task: string,
  triggerName: string,
  mode: 'standalone' | 'team',
  source: 'trigger' | 'queue',
  trigger?: CronTrigger,
): Promise<TickResult> {
  this.deps.log(`[heartbeat] tick #${this.tickCount} — firing ${triggerName} (${agent} on ${project}, mode: ${mode})`);

  try {
    const result = await this.deps.runPipeline(project, task, mode, agent);
    trigger?.markFired();
    const promptEstimate = result.stagesRun * DEFAULT_PROMPT_ESTIMATE;
    await this.deps.recordUsage(promptEstimate);
    return { action: 'ran_agent', triggerName, source };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.deps.log(`[heartbeat] error running ${triggerName}: ${message}`);
    trigger?.markFired();
    return { action: 'error', triggerName, error: message };
  }
}
```

**Step 3: Run tests**

Run: `npx vitest run src/heartbeat/loop.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/heartbeat/loop.ts src/heartbeat/loop.test.ts
git commit -m "refactor(heartbeat): replace runAgent with runPipeline"
```

---

### Task 6: Update daemon to create and use pipeline engine

**Files:**
- Modify: `src/daemon.ts`

**Step 1: Update daemon**

In `src/daemon.ts`:

1. Add imports for `PipelineEngine` and `routeTask`, `loadAgentSummaries`
2. Remove imports for `createPreToolUseDenyHook`, `createUserPromptSubmitHook`
3. Remove `teamHooks` — use only `baseHooks`
4. Create pipeline engine instance
5. Change the heartbeat config to pass `runPipeline` instead of `runAgent`

Key changes:

```typescript
import { PipelineEngine } from './pipeline/engine.js';
import { routeTask, loadAgentSummaries } from './pipeline/router.js';

// Remove these lines:
// const preToolUseDenyHook = createPreToolUseDenyHook(log);
// const userPromptSubmitHook = createUserPromptSubmitHook(log);
// const teamHooks = { ... };

// Create pipeline engine:
const AGENTS_DIR = join(CODENAME_HOME, 'agents');

const pipelineEngine = new PipelineEngine({
  runner: (role, project, task, options) => runAgent(role, project, task, {
    ...options,
    hooks: baseHooks,
  }),
  log,
});

// Create the runPipeline function for heartbeat:
async function runPipeline(
  project: string,
  task: string,
  mode: 'standalone' | 'team',
  agent?: string,
) {
  if (agent && agent !== 'pipeline') {
    // Manual agent run — skip router
    const stages = [{ agent, teams: mode === 'team' }];
    return pipelineEngine.run({ stages, project, task });
  }

  // Full pipeline — use LLM router
  const agents = await loadAgentSummaries(AGENTS_DIR);
  const projectContext = await readTextFile(join(project, '.brain', 'PROJECT.md'));
  const stages = await routeTask({ task, agents, projectContext });
  log(`[pipeline] Router selected: ${stages.map(s => s.agent).join(' → ')}`);
  return pipelineEngine.run({ stages, project, task });
}

// Update heartbeat deps:
const heartbeat = new HeartbeatLoop(
  {
    triggers,
    queue,
    canRunAgent: () => canRunAgent(budgetConfig),
    recordUsage: (count) => recordUsage(count, budgetConfig),
    runPipeline: (project, task, mode, agent) =>
      runPipeline(resolveProjectPath(project), task, mode, agent),
    log,
  },
  { intervalMs: config.heartbeatIntervalMs ?? 60_000 },
);
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compile

**Step 3: Commit**

```bash
git add src/daemon.ts
git commit -m "refactor(daemon): wire pipeline engine, remove delegation hooks"
```

---

### Task 7: Update CLI for pipeline command

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/ipc/protocol.ts`

**Step 1: Update IPC protocol**

In `src/ipc/protocol.ts`, the existing `run` command already has `agent` and `mode`. For the pipeline command, we'll use `agent: 'pipeline'` as a sentinel value:

No changes needed to protocol — `agent: 'pipeline'` works within the existing type.

**Step 2: Update CLI**

In `src/cli.ts`, update `cmdRun`:

```typescript
async function cmdRun(args: string[]): Promise<void> {
  const subCmd = args[0];
  if (!subCmd) {
    die('Usage: codename run <agent|pipeline> <project> ["task"]');
  }

  // Pipeline mode — LLM router picks agents
  if (subCmd === 'pipeline') {
    const project = args[1];
    const task = args[2];
    if (!project || !task) {
      die('Usage: codename run pipeline <project> "task description"');
    }
    const response = await send({
      type: 'run',
      agent: 'pipeline',
      project,
      task,
      mode: 'standalone',
    });
    if (response.ok) {
      console.log(`Queued pipeline for ${project}. The heartbeat will pick it up.`);
    } else {
      die(response.error);
    }
    return;
  }

  // Legacy team mode — now runs as pipeline with teams flag
  if (subCmd === 'team') {
    const project = args[1];
    const task = args[2];
    if (!project || !task) {
      die('Usage: codename run team <project> "task description"');
    }
    const response = await send({
      type: 'run',
      agent: 'pipeline',
      project,
      task,
      mode: 'team',
    });
    if (response.ok) {
      console.log(`Queued team pipeline for ${project}. The heartbeat will pick it up.`);
    } else {
      die(response.error);
    }
    return;
  }

  // Single agent run — bypasses router
  const agent = subCmd;
  const project = args[1];
  const task = args[2] ?? `Run ${agent} agent session`;
  if (!project) {
    die(`Usage: codename run ${agent} <project> ["task"]`);
  }

  const response = await send({
    type: 'run',
    agent,
    project,
    task,
    mode: 'standalone',
  });
  if (response.ok) {
    const data = response.data as { agent: string; project: string };
    console.log(`Queued ${data.agent} for ${data.project}. The heartbeat will pick it up.`);
  } else {
    die(response.error);
  }
}
```

Also update the help text:
```
  run <agent> <project> [task] Run a single agent on a project
  run pipeline <project> "task" Run a full pipeline (LLM router picks agents)
  run team <project> "task"    Run a pipeline with teams enabled
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean compile

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add 'run pipeline' command, update 'run team' to use pipeline"
```

---

### Task 8: Remove delegation hooks from hooks.ts

**Files:**
- Modify: `src/hooks/hooks.ts`
- Modify: `src/hooks/hooks.test.ts` (if delegation hook tests exist)

**Step 1: Remove unused code**

In `src/hooks/hooks.ts`:
- Remove the `BLOCKED_TOOLS` constant
- Remove `createPreToolUseDenyHook` function (lines 160-214)
- Remove `createUserPromptSubmitHook` function (lines 221-250)
- Remove unused imports: `PreToolUseHookInput`, `UserPromptSubmitHookInput`
- Remove the `// --- Team Lead delegation enforcement hooks ---` comment section

**Step 2: Remove from daemon imports**

In `src/daemon.ts`, remove the imports for `createPreToolUseDenyHook` and `createUserPromptSubmitHook` (should already be done in Task 6, but verify).

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean compile

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add src/hooks/hooks.ts src/daemon.ts
git commit -m "refactor(hooks): remove delegation enforcement hooks (replaced by pipeline engine)"
```

---

### Task 9: Remove delegate-mode prompt from runner

**Files:**
- Modify: `src/agents/runner.ts`

**Step 1: Remove delegate-mode prompt injection**

In `src/agents/runner.ts`, remove lines 294-297 that prepend the `[DELEGATE MODE ACTIVE]` prompt:

```typescript
// REMOVE this block:
if (mode === 'team') {
  finalPrompt = `[DELEGATE MODE ACTIVE] You are in coordinator-only mode...`;
}
```

Just keep `let finalPrompt = task;` — the prompt is now the task, regardless of mode.

**Step 2: Also remove `readTeammateDefinitions` function and teammate context injection**

Remove lines 220-239 (`readTeammateDefinitions`) and lines 266-271 (the teammate context injection in `runAgent`).

The runner no longer needs to know about teammates — each agent runs with its own definition and the pipeline engine handles sequencing.

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean compile

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add src/agents/runner.ts
git commit -m "refactor(runner): remove delegate-mode prompt and teammate definitions (pipeline handles this)"
```

---

## Batch 4: Integration test

### Task 10: End-to-end pipeline test

**Files:**
- Create: `src/pipeline/integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PipelineEngine } from './engine.js';
import { routeTask, type AgentSummary } from './router.js';
import type { PipelineRunnerFn } from './engine.js';

const TEST_DIR = join(import.meta.dirname, '../../.test-state/pipeline-integration');
const BRAIN_DIR = join(TEST_DIR, '.brain');

describe('Pipeline integration', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
    await writeFile(join(BRAIN_DIR, 'PROJECT.md'), '# Test Project\nA simple test app.');
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test('router + engine: full pipeline with APPROVE', async () => {
    // Mock router to return builder → reviewer
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '[{"agent":"builder","teams":false},{"agent":"reviewer","teams":false}]' }],
    });

    const agents: AgentSummary[] = [
      { name: 'builder', description: 'writes code', model: 'sonnet', skills: [] },
      { name: 'reviewer', description: 'reviews code', model: 'sonnet', skills: [] },
    ];

    const stages = await routeTask({
      task: 'build a login page',
      agents,
      projectContext: 'A web app',
      createMessage: mockCreate,
    });

    // Mock runner — reviewer writes APPROVE
    const runner: PipelineRunnerFn = vi.fn(async (role) => {
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nScore: 9/10\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });
    const result = await engine.run({ stages, project: TEST_DIR, task: 'build a login page' });

    expect(result.completed).toBe(true);
    expect(result.stagesRun).toBe(2);
    expect(result.retries).toBe(0);
    expect(logs.some(l => l.includes('builder → reviewer'))).toBe(true);
    expect(logs.some(l => l.includes('Pipeline complete'))).toBe(true);
  });

  test('manual agent bypass skips router', async () => {
    const stages = await routeTask({
      task: 'fix a bug',
      agents: [],
      projectContext: '',
      manualAgent: 'builder',
    });

    expect(stages).toEqual([{ agent: 'builder', teams: false }]);

    const runner: PipelineRunnerFn = vi.fn(async () => ({
      agentName: 'builder', sandboxed: false, mode: 'standalone' as const,
    }));

    const engine = new PipelineEngine({ runner, log: () => {} });
    const result = await engine.run({ stages, project: TEST_DIR, task: 'fix a bug' });

    expect(result.completed).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/pipeline/integration.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add src/pipeline/integration.test.ts
git commit -m "test(pipeline): add integration tests for router + engine"
```

---

## Summary

| Batch | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | Tasks 1-2 | LLM Router — loads agents, calls Haiku, returns pipeline stages |
| 2 | Tasks 3-4 | Pipeline Engine — sequential execution with review loop routing |
| 3 | Tasks 5-9 | Wire into daemon, update CLI, remove old delegation hooks |
| 4 | Task 10 | Integration test proving the full flow works |
