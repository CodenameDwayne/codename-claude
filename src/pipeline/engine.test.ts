import { describe, test, expect, vi } from 'vitest';
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
