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
