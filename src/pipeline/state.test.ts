import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type PipelineState,
  readPipelineState,
  writePipelineState,
  REVIEW_JSON_SCHEMA,
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
      agentPipeline: ['scout', 'architect'],
      status: 'running',
      phase: 'planning',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      tasks: [
        { title: 'Set up project', status: 'pending', attempts: 0 },
      ],
      currentTaskIndex: 0,
      totalIterations: 0,
      retries: 0,
    };

    await writePipelineState(TEST_DIR, state);
    const read = await readPipelineState(TEST_DIR);

    expect(read).not.toBeNull();
    expect(read!.project).toBe(TEST_DIR);
    expect(read!.agentPipeline).toEqual(['scout', 'architect']);
    expect(read!.tasks).toHaveLength(1);
  });

  test('roundtrips Ralph-style pipeline state with TaskProgress', async () => {
    const state: PipelineState = {
      project: TEST_DIR,
      task: 'build feature',
      agentPipeline: ['scout', 'architect'],
      status: 'running',
      phase: 'building',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      tasks: [
        { title: 'Set up project', status: 'completed', attempts: 1, completedAt: Date.now() },
        { title: 'Add auth module', status: 'in_progress', attempts: 1 },
        { title: 'Add tests', status: 'pending', attempts: 0 },
      ],
      currentTaskIndex: 1,
      totalIterations: 3,
      retries: 0,
    };

    await writePipelineState(TEST_DIR, state);
    const loaded = await readPipelineState(TEST_DIR);
    expect(loaded).toEqual(state);
  });

  test('REVIEW_JSON_SCHEMA includes critical severity', () => {
    const severityEnum = (REVIEW_JSON_SCHEMA.properties.issues.items.properties.severity as any).enum;
    expect(severityEnum).toContain('critical');
  });

});
