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

});
