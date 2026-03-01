import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
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
