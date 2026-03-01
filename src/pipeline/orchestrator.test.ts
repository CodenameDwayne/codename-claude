import { describe, test, expect } from 'vitest';
import { parsePlanTasks, expandStagesWithBatches } from './orchestrator.js';
import type { PipelineStage } from './router.js';

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
