import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PipelineEngine, type PipelineRunnerFn } from './engine.js';
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

const TEST_PROJECT = join(import.meta.dirname, '../../.test-state/pipeline-test');
const BRAIN_DIR = join(TEST_PROJECT, '.brain');

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
