import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PipelineEngine, type PipelineRunnerFn } from './engine.js';
import { readPipelineState } from './state.js';
import type { PipelineStage } from './router.js';

const TEST_PROJECT = join(import.meta.dirname, '../../.test-state/pipeline-test');
const BRAIN_DIR = join(TEST_PROJECT, '.brain');

function makeRunner(): PipelineRunnerFn {
  return vi.fn(async (role: string) => {
    // Write REVIEW.md for reviewer stages so validation passes
    if (role === 'reviewer' || role.includes('review')) {
      await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
    }
    return { agentName: role, sandboxed: false, mode: 'standalone' as const };
  });
}

describe('PipelineEngine', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('runs stages sequentially', async () => {
    const runner = makeRunner();
    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

    const stages: PipelineStage[] = [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];

    await engine.run({ stages, project: TEST_PROJECT, task: 'build something' });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenNthCalledWith(1, 'builder', TEST_PROJECT, expect.any(String), expect.objectContaining({ mode: 'standalone' }));
    expect(runner).toHaveBeenNthCalledWith(2, 'reviewer', TEST_PROJECT, expect.any(String), expect.objectContaining({ mode: 'standalone' }));
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

    await engine.run({ stages, project: TEST_PROJECT, task: 'complex task' });

    expect(runner).toHaveBeenCalledWith('builder', TEST_PROJECT, expect.any(String), expect.objectContaining({ mode: 'team' }));
  });
});

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
    expect(runner).toHaveBeenCalledTimes(6);
    expect(result.completed).toBe(false);
    expect(result.retries).toBe(2);
  });

  test('re-runs from architect when reviewer says REDESIGN', async () => {
    let reviewCount = 0;
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), '# Plan\n\n### Task 1: Do something\nDetails...\n');
      }
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

  test('buildStageTask tells architect to read RESEARCH/ when scout precedes it', async () => {
    const runner = makeRunner();
    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

    const stages: PipelineStage[] = [
      { agent: 'scout', teams: false },
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
    ];

    await engine.run({ stages, project: TEST_PROJECT, task: 'build something' });

    // The task passed to architect (second call) should mention RESEARCH
    const architectCall = (runner as ReturnType<typeof vi.fn>).mock.calls[1];
    const architectTask = architectCall![2] as string;
    expect(architectTask).toContain('RESEARCH');
  });

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
});

describe('PipelineEngine patterns compliance', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

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
});

describe('PipelineEngine PROJECT.md bootstrap', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('bootstraps PROJECT.md from task when it does not exist', async () => {
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
    await writeFile(join(BRAIN_DIR, 'PROJECT.md'), '# My Custom Project\n\nExisting context here with enough content to exceed the threshold.');

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
});

describe('PipelineEngine orchestration', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('expands builder+reviewer into batches after architect writes PLAN.md', async () => {
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
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
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

    // Should have expanded: architect, builder(1-3), reviewer(1-3), builder(4-5), reviewer(4-5)
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
});

describe('PipelineEngine validateArchitect fail-closed', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('fails validation when architect does not produce PLAN.md', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      // Architect runs but does NOT write PLAN.md
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    expect(result.completed).toBe(false);
    expect(result.finalVerdict).toContain('VALIDATION_FAILED');
    expect(result.finalVerdict).toContain('PLAN.md');
  });
});

describe('PipelineEngine team architect validation', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('validation catches non-sequential task numbering in PLAN.md', async () => {
    const badPlan = `# Plan

### Task 1: First
Details...

### Task 3: Third (skipped 2!)
Details...

### Task 4: Fourth
Details...
`;

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), badPlan);
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    expect(result.completed).toBe(false);
    expect(result.finalVerdict).toContain('non-sequential');
    expect(result.finalVerdict).toContain('expected Task 2');
  });

  test('validation catches leftover PLAN-PART files', async () => {
    const validPlan = `# Plan

### Task 1: First
Details...

### Task 2: Second
Details...
`;

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), validPlan);
        // Simulate leftover PLAN-PART files from failed team merge
        await writeFile(join(BRAIN_DIR, 'PLAN-PART-1.md'), '### Task 1: Leftover');
        await writeFile(join(BRAIN_DIR, 'PLAN-PART-2.md'), '### Task 2: Leftover');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });

    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    // Cleanup runs BEFORE validation, so PLAN-PART files should be cleaned up
    // and validation should pass
    expect(result.completed).toBe(true);
    expect(logs.some(l => l.includes('Cleaned up 2 leftover PLAN-PART files'))).toBe(true);
  });

  test('partial file cleanup removes PLAN-PART files after architect completes', async () => {
    const validPlan = `# Plan

### Task 1: First
Details...

### Task 2: Second
Details...
`;

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), validPlan);
        await writeFile(join(BRAIN_DIR, 'PLAN-PART-1.md'), '### Task 1: Part one');
        await writeFile(join(BRAIN_DIR, 'PLAN-PART-2.md'), '### Task 2: Part two');
        await writeFile(join(BRAIN_DIR, 'PLAN-PART-3.md'), '### Task 3: Part three');
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

    await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    // Verify PLAN-PART files were cleaned up
    const entries = await readdir(BRAIN_DIR);
    const partFiles = entries.filter(e => e.startsWith('PLAN-PART-'));
    expect(partFiles).toHaveLength(0);
    expect(logs.some(l => l.includes('Cleaned up 3 leftover PLAN-PART files'))).toBe(true);
  });

  test('validation passes for correctly numbered sequential tasks', async () => {
    const goodPlan = `# Plan

### Task 1: First
Details...

### Task 2: Second
Details...

### Task 3: Third
Details...
`;

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), goodPlan);
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

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    expect(result.completed).toBe(true);
  });

  test('teamStagesRun tracks team mode stages separately', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), '# Plan\n\n### Task 1: Do something\nDetails...\n');
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const };
    });
    const engine = new PipelineEngine({ runner, log: () => {} });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: true },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    expect(result.completed).toBe(true);
    expect(result.stagesRun).toBe(3);
    expect(result.teamStagesRun).toBe(1);
  });

  test('teamStagesRun is zero when no team stages exist', async () => {
    const runner = makeRunner();
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
    expect(result.stagesRun).toBe(2);
    expect(result.teamStagesRun).toBe(0);
  });
});
