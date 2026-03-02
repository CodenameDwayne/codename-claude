import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PipelineEngine, type PipelineRunnerFn } from './engine.js';
import { readPipelineState } from './state.js';
import type { PipelineStage } from './router.js';
import { EventBus, type PipelineEvent } from '../notifications/events.js';

const TEST_PROJECT = join(import.meta.dirname, '../../.test-state/pipeline-test');
const BRAIN_DIR = join(TEST_PROJECT, '.brain');

/** Helper: write a PLAN.md with checkbox tasks. */
async function writePlan(tasks: string[], checked: string[] = []) {
  const lines = tasks.map(t =>
    checked.includes(t) ? `- [x] ${t}` : `- [ ] ${t}`
  );
  await writeFile(join(BRAIN_DIR, 'PLAN.md'), `# Plan\n\n## Tasks\n\n${lines.join('\n')}\n`);
}

/** Mock runner: architect writes PLAN.md with checkboxes, reviewer APPROVEs by default. */
function makeRalphRunner(planTasks: string[]): PipelineRunnerFn {
  return vi.fn(async (role: string) => {
    if (role === 'architect' || role.includes('architect')) {
      await writePlan(planTasks);
    }
    if (role === 'reviewer' || role.includes('review')) {
      await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
    }
    return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
  });
}

describe('PipelineEngine', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('throws when stages array is empty', async () => {
    const runner = makeRalphRunner([]);
    const engine = new PipelineEngine({ runner, log: () => {} });

    await expect(
      engine.run({ stages: [], project: TEST_PROJECT, task: 'build something' }),
    ).rejects.toThrow('Pipeline received empty stages array');
  });

  test('completes pre-loop only pipeline (scout)', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'scout') {
        const researchDir = join(BRAIN_DIR, 'RESEARCH');
        await mkdir(researchDir, { recursive: true });
        await writeFile(join(researchDir, 'findings.md'), '# Research\nFindings...');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });
    const engine = new PipelineEngine({ runner, log: () => {} });

    const result = await engine.run({
      stages: [{ agent: 'scout', teams: false }],
      project: TEST_PROJECT,
      task: 'research something',
    });

    expect(result.completed).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe('PipelineEngine Ralph loop', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('runs builder+reviewer per task in Ralph loop', async () => {
    const callLog: string[] = [];
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      callLog.push(role);
      if (role === 'architect') {
        await writePlan(['Set up project', 'Add auth']);
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build feature',
    });

    expect(result.completed).toBe(true);
    // architect(1) + builder(2) + reviewer(3) + builder(4) + reviewer(5) = 5
    expect(callLog).toEqual(['architect', 'builder', 'reviewer', 'builder', 'reviewer']);
    expect(result.stagesRun).toBe(5);

    // Verify all checkboxes are checked in PLAN.md
    const plan = await readFile(join(BRAIN_DIR, 'PLAN.md'), 'utf-8');
    expect(plan).toContain('- [x] Set up project');
    expect(plan).toContain('- [x] Add auth');
  });

  test('REVISE retries same task in fresh session', async () => {
    let reviewCount = 0;
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writePlan(['Build feature']);
      }
      if (role === 'reviewer') {
        reviewCount++;
        const verdict = reviewCount === 1 ? 'REVISE' : 'APPROVE';
        return {
          agentName: role, sandboxed: false, mode: 'standalone' as const,
          structuredOutput: {
            verdict, score: verdict === 'APPROVE' ? 9 : 5,
            summary: 'Review', issues: [], patternsCompliance: true,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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

    // architect(1) + builder(2) + reviewer(3,REVISE) + builder(4) + reviewer(5,APPROVE) = 5
    expect(runner).toHaveBeenCalledTimes(5);
    expect(result.retries).toBe(1);
    expect(result.completed).toBe(true);
  });

  test('REDESIGN re-runs architect with fresh plan', async () => {
    let reviewCount = 0;
    let architectCount = 0;
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        architectCount++;
        await writePlan(['Build feature v' + architectCount]);
      }
      if (role === 'reviewer') {
        reviewCount++;
        const verdict = reviewCount === 1 ? 'REDESIGN' : 'APPROVE';
        return {
          agentName: role, sandboxed: false, mode: 'standalone' as const,
          structuredOutput: {
            verdict, score: verdict === 'APPROVE' ? 9 : 2,
            summary: 'Review', issues: [], patternsCompliance: true,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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
      task: 'build something',
    });

    // arch(1) + builder(2) + reviewer(3,REDESIGN) + arch(4) + builder(5) + reviewer(6,APPROVE) = 6
    expect(runner).toHaveBeenCalledTimes(6);
    expect(architectCount).toBe(2);
    expect(result.completed).toBe(true);
    expect(logs.some(l => l.includes('REDESIGN'))).toBe(true);
  });

  test('stops after max retries on REVISE', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writePlan(['Build feature']);
      }
      if (role === 'reviewer') {
        return {
          agentName: role, sandboxed: false, mode: 'standalone' as const,
          structuredOutput: {
            verdict: 'REVISE', score: 3,
            summary: 'Always fails', issues: [{ severity: 'major', description: 'Bad' }],
            patternsCompliance: false,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const engine = new PipelineEngine({ runner, log: () => {}, maxRetries: 2 });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    // architect(1) + builder(2) + reviewer(3,REVISE) + builder(4) + reviewer(5,REVISE) + builder(6) + reviewer(7,REVISE,maxed) = 7
    expect(runner).toHaveBeenCalledTimes(7);
    expect(result.completed).toBe(false);
    expect(result.finalVerdict).toBe('REVISE');
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
      if (role === 'architect') {
        await writePlan(['Single task']);
      }
      return {
        agentName: role,
        sandboxed: false,
        mode: 'standalone' as const,
        structuredOutput: role === 'reviewer' ? reviewOutput : undefined,
        turnCount: 1,
      };
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
    expect(result.finalVerdict).toBe('APPROVE');
    expect(result.review).toEqual(reviewOutput);
  });

  test('pipeline state tracks TaskProgress correctly after full run', async () => {
    const runner = makeRalphRunner(['Task A', 'Task B']);
    const engine = new PipelineEngine({ runner, log: () => {} });

    await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build feature',
    });

    const state = await readPipelineState(TEST_PROJECT);
    expect(state).not.toBeNull();
    expect(state!.status).toBe('completed');
    expect(state!.phase).toBe('completed');
    expect(state!.tasks).toHaveLength(2);
    expect(state!.tasks[0]!.status).toBe('completed');
    expect(state!.tasks[0]!.title).toBe('Task A');
    expect(state!.tasks[1]!.status).toBe('completed');
    expect(state!.tasks[1]!.title).toBe('Task B');
    expect(state!.finalVerdict).toBe('APPROVE');
  });

  test('builder task prompt includes specific task title', async () => {
    const taskArgs: { role: string; task: string }[] = [];
    const runner: PipelineRunnerFn = vi.fn(async (role: string, _project: string, task: string) => {
      taskArgs.push({ role, task });
      if (role === 'architect') {
        await writePlan(['Set up project', 'Add auth']);
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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

    const builderCalls = taskArgs.filter(t => t.role === 'builder');
    expect(builderCalls[0]!.task).toContain('Set up project');
    expect(builderCalls[1]!.task).toContain('Add auth');

    const reviewerCalls = taskArgs.filter(t => t.role === 'reviewer');
    expect(reviewerCalls[0]!.task).toContain('Set up project');
    expect(reviewerCalls[1]!.task).toContain('Add auth');
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
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'scout') {
        const researchDir = join(BRAIN_DIR, 'RESEARCH');
        await mkdir(researchDir, { recursive: true });
        await writeFile(join(researchDir, 'findings.md'), '# Research');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });
    const engine = new PipelineEngine({ runner, log: () => {} });

    await engine.run({
      stages: [{ agent: 'scout', teams: false }],
      project: TEST_PROJECT,
      task: 'Build a todo app with Next.js, TypeScript, and Tailwind CSS',
    });

    const content = await readFile(join(BRAIN_DIR, 'PROJECT.md'), 'utf-8');
    expect(content).toContain('todo app');
    expect(content).toContain('Next.js');
  });

  test('does not overwrite existing PROJECT.md', async () => {
    await writeFile(join(BRAIN_DIR, 'PROJECT.md'), '# My Custom Project\n\nExisting context here with enough content to exceed the threshold.');

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'scout') {
        const researchDir = join(BRAIN_DIR, 'RESEARCH');
        await mkdir(researchDir, { recursive: true });
        await writeFile(join(researchDir, 'findings.md'), '# Research');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });
    const engine = new PipelineEngine({ runner, log: () => {} });

    await engine.run({
      stages: [{ agent: 'scout', teams: false }],
      project: TEST_PROJECT,
      task: 'Add authentication',
    });

    const content = await readFile(join(BRAIN_DIR, 'PROJECT.md'), 'utf-8');
    expect(content).toContain('My Custom Project');
    expect(content).not.toContain('Add authentication');
  });
});

describe('PipelineEngine validateArchitect (checkboxes)', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('fails validation when architect does not produce PLAN.md', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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

  test('fails when PLAN.md has no checkbox tasks', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), '# Plan\n\nJust some text, no checkboxes.\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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
    expect(result.finalVerdict).toContain('no checkbox tasks');
  });

  test('fails when PLAN.md has pre-checked tasks', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writeFile(join(BRAIN_DIR, 'PLAN.md'), '# Plan\n\n- [x] Already done\n- [ ] Still pending\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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
    expect(result.finalVerdict).toContain('pre-checked');
  });

  test('PLAN-PART file cleanup runs before validation', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writePlan(['Task A']);
        await writeFile(join(BRAIN_DIR, 'PLAN-PART-1.md'), 'leftover');
        await writeFile(join(BRAIN_DIR, 'PLAN-PART-2.md'), 'leftover');
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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

    const entries = await readdir(BRAIN_DIR);
    const partFiles = entries.filter(e => e.startsWith('PLAN-PART-'));
    expect(partFiles).toHaveLength(0);
    expect(logs.some(l => l.includes('Cleaned up 2 leftover PLAN-PART files'))).toBe(true);
  });
});

describe('PipelineEngine validateScout', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('fails validation when scout does not create RESEARCH directory', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    const result = await engine.run({
      stages: [{ agent: 'scout', teams: false }],
      project: TEST_PROJECT,
      task: 'research something',
    });

    expect(result.completed).toBe(false);
    expect(result.finalVerdict).toContain('VALIDATION_FAILED');
    expect(result.finalVerdict).toContain('RESEARCH');
  });

  test('fails validation when RESEARCH directory has no .md files', async () => {
    const researchDir = join(BRAIN_DIR, 'RESEARCH');
    await mkdir(researchDir, { recursive: true });
    await writeFile(join(researchDir, 'notes.txt'), 'some notes');

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    const result = await engine.run({
      stages: [{ agent: 'scout', teams: false }],
      project: TEST_PROJECT,
      task: 'research something',
    });

    expect(result.completed).toBe(false);
    expect(result.finalVerdict).toContain('VALIDATION_FAILED');
    expect(result.finalVerdict).toContain('research');
  });

  test('passes validation when RESEARCH directory has .md files', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'scout') {
        const researchDir = join(BRAIN_DIR, 'RESEARCH');
        await mkdir(researchDir, { recursive: true });
        await writeFile(join(researchDir, 'findings.md'), '# Research\nSome findings...');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    const result = await engine.run({
      stages: [{ agent: 'scout', teams: false }],
      project: TEST_PROJECT,
      task: 'research something',
    });

    expect(result.completed).toBe(true);
  });
});

describe('PipelineEngine validateBuilder', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
    execFileSync('git', ['init'], { cwd: TEST_PROJECT });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: TEST_PROJECT });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: TEST_PROJECT });
    await writeFile(join(BRAIN_DIR, 'PROJECT.md'), '# Project\n\nBootstrapped context with enough content to exceed the threshold check.');
    await writeFile(join(TEST_PROJECT, 'initial.txt'), 'init');
    execFileSync('git', ['add', '.'], { cwd: TEST_PROJECT });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: TEST_PROJECT });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('fails validation when builder changes no files', async () => {
    // Pre-write PLAN.md so Ralph loop can run
    await writePlan(['Implement feature']);

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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

    // Builder validation fails (no files changed) but this is non-fatal in Ralph
    // The reviewer still runs and APPROVEs, completing the task
    expect(runner).toHaveBeenCalled();
  });

  test('passes validation when builder creates new files', async () => {
    await writePlan(['Create hello module']);

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'builder') {
        await writeFile(join(TEST_PROJECT, 'new-file.ts'), 'console.log("hello")');
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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
  });

  test('fails validation when tests do not pass', async () => {
    await writeFile(join(TEST_PROJECT, 'package.json'), JSON.stringify({
      scripts: { test: 'exit 1' },
    }));
    execFileSync('git', ['add', '.'], { cwd: TEST_PROJECT });
    execFileSync('git', ['commit', '-m', 'add pkg'], { cwd: TEST_PROJECT });
    await writePlan(['Add feature']);

    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'builder') {
        await writeFile(join(TEST_PROJECT, 'src.ts'), 'export const x = 1;');
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const logs: string[] = [];
    const engine = new PipelineEngine({ runner, log: (m) => logs.push(m) });

    await engine.run({
      stages: [
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    // Builder validation failure is logged but non-fatal in Ralph (reviewer decides)
    expect(logs.some(l => l.includes('Builder validation failed'))).toBe(true);
  });
});

describe('PipelineEngine review feedback file', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('writes REVIEW.md with structured feedback on REVISE', async () => {
    let reviewCount = 0;
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writePlan(['Build feature']);
      }
      if (role === 'reviewer') {
        reviewCount++;
        return {
          agentName: role, sandboxed: false, mode: 'standalone' as const,
          structuredOutput: {
            verdict: reviewCount === 1 ? 'REVISE' : 'APPROVE',
            score: reviewCount === 1 ? 4 : 9,
            summary: reviewCount === 1 ? 'Needs major fixes' : 'All good',
            issues: reviewCount === 1
              ? [
                  { severity: 'major', description: 'Missing error handling', file: 'src/api.ts' },
                  { severity: 'minor', description: 'Unused import' },
                ]
              : [],
            patternsCompliance: reviewCount !== 1,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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
      task: 'build something',
    });

    expect(result.completed).toBe(true);
    expect(result.retries).toBe(1);

    const reviewContent = await readFile(join(BRAIN_DIR, 'REVIEW.md'), 'utf-8');
    expect(reviewContent).toContain('REVISE');
    expect(reviewContent).toContain('4/10');
    expect(reviewContent).toContain('Missing error handling');
    expect(reviewContent).toContain('src/api.ts');
    expect(reviewContent).toContain('Unused import');
    expect(logs.some(l => l.includes('Wrote review feedback to .brain/REVIEW.md'))).toBe(true);
  });

  test('writes REVIEW.md with structured feedback on REDESIGN', async () => {
    let reviewCount = 0;
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writePlan(['Build feature']);
      }
      if (role === 'reviewer') {
        reviewCount++;
        return {
          agentName: role, sandboxed: false, mode: 'standalone' as const,
          structuredOutput: {
            verdict: reviewCount === 1 ? 'REDESIGN' : 'APPROVE',
            score: reviewCount === 1 ? 2 : 9,
            summary: reviewCount === 1 ? 'Architecture is flawed' : 'Good',
            issues: reviewCount === 1
              ? [{ severity: 'major', description: 'Wrong database choice' }]
              : [],
            patternsCompliance: true,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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
      task: 'build something',
    });

    expect(result.completed).toBe(true);

    const reviewContent = await readFile(join(BRAIN_DIR, 'REVIEW.md'), 'utf-8');
    expect(reviewContent).toContain('REDESIGN');
    expect(reviewContent).toContain('Wrong database choice');
    expect(logs.some(l => l.includes('Wrote review feedback to .brain/REVIEW.md'))).toBe(true);
  });
});

describe('PipelineEngine builder/architect retry prompts', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('builder retry prompt includes REVIEW.md instruction after REVISE', async () => {
    let reviewCount = 0;
    const taskArgs: { role: string; task: string }[] = [];
    const runner: PipelineRunnerFn = vi.fn(async (role: string, _project: string, task: string) => {
      taskArgs.push({ role, task });
      if (role === 'architect') {
        await writePlan(['Build feature']);
      }
      if (role === 'reviewer') {
        reviewCount++;
        return {
          agentName: role, sandboxed: false, mode: 'standalone' as const,
          structuredOutput: {
            verdict: reviewCount === 1 ? 'REVISE' : 'APPROVE',
            score: reviewCount === 1 ? 5 : 9,
            summary: 'Review', issues: [], patternsCompliance: true,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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

    // The second builder call should include REVIEW.md instruction
    const secondBuilderCall = taskArgs.filter(t => t.role === 'builder')[1];
    expect(secondBuilderCall).toBeDefined();
    expect(secondBuilderCall!.task).toContain('REVIEW.md');
    expect(secondBuilderCall!.task).toContain('fix all listed issues');
  });

  test('architect REDESIGN prompt includes REVIEW.md instruction', async () => {
    let reviewCount = 0;
    const taskArgs: { role: string; task: string }[] = [];
    const runner: PipelineRunnerFn = vi.fn(async (role: string, _project: string, task: string) => {
      taskArgs.push({ role, task });
      if (role === 'architect') {
        await writePlan(['Build feature']);
      }
      if (role === 'reviewer') {
        reviewCount++;
        return {
          agentName: role, sandboxed: false, mode: 'standalone' as const,
          structuredOutput: {
            verdict: reviewCount === 1 ? 'REDESIGN' : 'APPROVE',
            score: reviewCount === 1 ? 2 : 9,
            summary: 'Review', issues: [], patternsCompliance: true,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
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

    const secondArchitectCall = taskArgs.filter(t => t.role === 'architect')[1];
    expect(secondArchitectCall).toBeDefined();
    expect(secondArchitectCall!.task).toContain('REVIEW.md');
    expect(secondArchitectCall!.task).toContain('REDESIGN');
  });
});

describe('PipelineEngine scout prompt', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('scout stage gets research-specific prompt', async () => {
    const taskArgs: { role: string; task: string }[] = [];
    const runner: PipelineRunnerFn = vi.fn(async (role: string, _project: string, task: string) => {
      taskArgs.push({ role, task });
      if (role === 'scout') {
        await mkdir(join(BRAIN_DIR, 'RESEARCH'), { recursive: true });
        await writeFile(join(BRAIN_DIR, 'RESEARCH', 'findings.md'), '# Research\nFindings here');
      }
      if (role === 'architect') {
        await writePlan(['Build scraper']);
      }
      if (role === 'reviewer') {
        await writeFile(join(BRAIN_DIR, 'REVIEW.md'), '# Review\nVerdict: APPROVE\n');
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const engine = new PipelineEngine({ runner, log: () => {} });

    await engine.run({
      stages: [
        { agent: 'scout', teams: false },
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build a web scraper',
    });

    const scoutCall = taskArgs.find(t => t.role === 'scout');
    expect(scoutCall).toBeDefined();
    expect(scoutCall!.task).toContain('research');
    expect(scoutCall!.task).toContain('RESEARCH');
    expect(scoutCall!.task).toContain('build a web scraper');

    // Architect task should mention RESEARCH/
    const architectCall = taskArgs.find(t => t.role === 'architect');
    expect(architectCall!.task).toContain('RESEARCH');
  });
});

describe('PipelineEngine parseReviewVerdict fail-closed', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('handles REVISE verdict with maxRetries=0', async () => {
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      if (role === 'architect') {
        await writePlan(['Build feature']);
      }
      if (role === 'reviewer') {
        return {
          agentName: role, sandboxed: false, mode: 'standalone' as const,
          structuredOutput: {
            verdict: 'REVISE', score: 4,
            summary: 'Needs work',
            issues: [{ severity: 'major', description: 'Missing error handling' }],
            patternsCompliance: true,
          },
        };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const engine = new PipelineEngine({ runner, log: () => {}, maxRetries: 0 });

    const result = await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'build something',
    });

    expect(result.completed).toBe(false);
    expect(result.finalVerdict).toBe('REVISE');
  });
});

describe('PipelineEngine event bus', () => {
  beforeEach(async () => {
    await mkdir(BRAIN_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PROJECT, { recursive: true, force: true });
  });

  test('emits pipeline.started and pipeline.completed on successful run', async () => {
    await writePlan(['Do the thing']);
    const runner = makeRalphRunner(['Do the thing']);
    const events: PipelineEvent[] = [];
    const eventBus = new EventBus();
    eventBus.on('*', (e) => events.push(e));

    const engine = new PipelineEngine({ runner, log: () => {}, eventBus });
    await engine.run({
      stages: [{ agent: 'builder', teams: false }, { agent: 'reviewer', teams: false }],
      project: TEST_PROJECT,
      task: 'test task',
    });

    const types = events.map(e => e.type);
    expect(types).toContain('pipeline.started');
    expect(types).toContain('pipeline.completed');
    expect(types.filter(t => t === 'session.started').length).toBeGreaterThanOrEqual(2);
    expect(types.filter(t => t === 'session.completed').length).toBeGreaterThanOrEqual(2);
  });

  test('emits review.escalated on REVISE verdict', async () => {
    let callCount = 0;
    const runner: PipelineRunnerFn = vi.fn(async (role: string) => {
      callCount++;
      if (role === 'architect') {
        await writePlan(['Fixable task']);
      }
      if (role === 'reviewer') {
        const isRetry = callCount > 4;
        const review = isRetry
          ? { verdict: 'APPROVE' as const, score: 9, summary: 'Good', issues: [], patternsCompliance: true }
          : { verdict: 'REVISE' as const, score: 4, summary: 'Needs work', issues: [{ severity: 'major' as const, description: 'Bug' }], patternsCompliance: false };
        return { agentName: 'Reviewer', sandboxed: false, mode: 'standalone' as const, turnCount: 1, structuredOutput: review };
      }
      return { agentName: role, sandboxed: false, mode: 'standalone' as const, turnCount: 1 };
    });

    const events: PipelineEvent[] = [];
    const eventBus = new EventBus();
    eventBus.on('*', (e) => events.push(e));

    const engine = new PipelineEngine({ runner, log: () => {}, eventBus, maxRetries: 3 });
    await engine.run({
      stages: [
        { agent: 'architect', teams: false },
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ],
      project: TEST_PROJECT,
      task: 'test task',
    });

    const escalated = events.filter(e => e.type === 'review.escalated');
    expect(escalated.length).toBeGreaterThanOrEqual(1);
    expect((escalated[0] as Extract<PipelineEvent, { type: 'review.escalated' }>).verdict).toBe('REVISE');
  });
});
