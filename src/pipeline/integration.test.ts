import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
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

  test('router + engine: full Ralph pipeline with APPROVE', async () => {
    const agents: AgentSummary[] = [
      { name: 'architect', description: 'designs systems', model: 'sonnet', skills: [] },
      { name: 'builder', description: 'writes code', model: 'sonnet', skills: [] },
      { name: 'reviewer', description: 'reviews code', model: 'sonnet', skills: [] },
    ];

    // "build a login page" routes to architect → builder → reviewer
    const stages = await routeTask({
      task: 'build a login page',
      agents,
      projectContext: 'A web app',
    });

    // Mock runner — architect writes PLAN.md with checkboxes, reviewer APPROVEs
    const runner: PipelineRunnerFn = vi.fn(async (role) => {
      if (role === 'architect') {
        await writeFile(
          join(BRAIN_DIR, 'PLAN.md'),
          '# Plan\n\n## Tasks\n\n- [ ] Build login form\n- [ ] Add authentication logic\n',
        );
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nScore: 9/10\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });
    const result = await engine.run({ stages, project: TEST_DIR, task: 'build a login page' });

    expect(result.completed).toBe(true);
    // architect (1) + 2 tasks × (builder + reviewer) = 5 stages
    expect(result.stagesRun).toBe(5);
    expect(result.retries).toBe(0);
    expect(logs.some(l => l.includes('architect → builder → reviewer'))).toBe(true);
    expect(logs.some(l => l.includes('Pipeline complete'))).toBe(true);

    // Verify checkboxes were marked in PLAN.md
    const finalPlan = await readFile(join(BRAIN_DIR, 'PLAN.md'), 'utf-8');
    expect(finalPlan).toContain('- [x] Build login form');
    expect(finalPlan).toContain('- [x] Add authentication logic');
  });

  test('manual agent bypass skips router', async () => {
    const stages = await routeTask({
      task: 'fix a bug',
      agents: [],
      projectContext: '',
      manualAgent: 'builder',
    });

    expect(stages).toEqual([{ agent: 'builder', teams: false }]);

    // Mock runner — reviewer writes APPROVE so the Ralph loop completes
    const runner: PipelineRunnerFn = vi.fn(async (role) => {
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    // Pre-write PLAN.md so the Ralph loop has a task to execute
    await writeFile(
      join(BRAIN_DIR, 'PLAN.md'),
      '# Plan\n\n## Tasks\n\n- [ ] Fix the bug\n',
    );

    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });
    const result = await engine.run({ stages, project: TEST_DIR, task: 'fix a bug' });

    // Ralph loop runs builder + reviewer for the single task
    expect(result.completed).toBe(true);
    expect(runner).toHaveBeenCalledTimes(2); // builder + reviewer
  });

  test('builder-only without PLAN.md fails gracefully', async () => {
    const stages = await routeTask({
      task: 'fix a bug',
      agents: [],
      projectContext: '',
      manualAgent: 'builder',
    });

    const runner: PipelineRunnerFn = vi.fn(async () => ({
      agentName: 'builder', sandboxed: false, mode: 'standalone' as const, turnCount: 1,
    }));

    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });
    const result = await engine.run({ stages, project: TEST_DIR, task: 'fix a bug' });

    // No architect produced PLAN.md → Phase 2 fails
    expect(result.completed).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });
});
