import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type PipelineState,
  readPipelineState,
  writePipelineState,
  updateStageStatus,
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
      pipeline: ['architect', 'builder', 'reviewer'],
      status: 'running',
      currentStage: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      stages: [
        { agent: 'architect', status: 'running' },
        { agent: 'builder', status: 'pending' },
        { agent: 'reviewer', status: 'pending' },
      ],
      retries: 0,
    };

    await writePipelineState(TEST_DIR, state);
    const read = await readPipelineState(TEST_DIR);

    expect(read).not.toBeNull();
    expect(read!.project).toBe(TEST_DIR);
    expect(read!.pipeline).toEqual(['architect', 'builder', 'reviewer']);
    expect(read!.stages).toHaveLength(3);
  });

  test('REVIEW_JSON_SCHEMA includes critical severity', () => {
    const severityEnum = (REVIEW_JSON_SCHEMA.properties.issues.items.properties.severity as any).enum;
    expect(severityEnum).toContain('critical');
  });

  test('updateStageStatus updates a specific stage and bumps updatedAt', async () => {
    const now = Date.now();
    const state: PipelineState = {
      project: TEST_DIR,
      task: 'build something',
      pipeline: ['builder', 'reviewer'],
      status: 'running',
      currentStage: 0,
      startedAt: now,
      updatedAt: now,
      stages: [
        { agent: 'builder', status: 'running', startedAt: now },
        { agent: 'reviewer', status: 'pending' },
      ],
      retries: 0,
    };

    await writePipelineState(TEST_DIR, state);

    await updateStageStatus(TEST_DIR, 0, {
      status: 'completed',
      completedAt: now + 5000,
      sessionId: 'session-abc',
      validation: 'passed',
    });

    const updated = await readPipelineState(TEST_DIR);
    expect(updated!.stages[0]!.status).toBe('completed');
    expect(updated!.stages[0]!.sessionId).toBe('session-abc');
    expect(updated!.stages[0]!.validation).toBe('passed');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(now);
  });
});
