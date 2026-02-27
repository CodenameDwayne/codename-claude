import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  recordUsage,
  canRunAgent,
  getRemainingBudget,
  loadBudgetState,
  type BudgetConfig,
} from './budget.js';

const TEST_STATE_DIR = join(import.meta.dirname, '../../.test-state/budget');
const TEST_STATE_FILE = join(TEST_STATE_DIR, 'budget.json');

const DEFAULT_CONFIG: BudgetConfig = {
  maxPromptsPerWindow: 600,
  reserveForInteractive: 0.3,
  windowHours: 5,
  stateFile: TEST_STATE_FILE,
};

beforeEach(async () => {
  await mkdir(TEST_STATE_DIR, { recursive: true });
  // Remove any leftover state file
  await rm(TEST_STATE_FILE, { force: true });
});

afterEach(async () => {
  await rm(TEST_STATE_DIR, { recursive: true, force: true });
});

describe('budget tracker', () => {
  test('starts with full budget when no state file exists', async () => {
    const remaining = await getRemainingBudget(DEFAULT_CONFIG);
    expect(remaining).toBe(600);
  });

  test('recordUsage reduces remaining budget', async () => {
    await recordUsage(100, DEFAULT_CONFIG);
    const remaining = await getRemainingBudget(DEFAULT_CONFIG);
    expect(remaining).toBe(500);
  });

  test('multiple recordUsage calls accumulate', async () => {
    await recordUsage(100, DEFAULT_CONFIG);
    await recordUsage(200, DEFAULT_CONFIG);
    const remaining = await getRemainingBudget(DEFAULT_CONFIG);
    expect(remaining).toBe(300);
  });

  test('canRunAgent returns true when budget is above reserve', async () => {
    // 600 * 0.3 = 180 reserved. So 420 available for agents.
    const result = await canRunAgent(DEFAULT_CONFIG);
    expect(result).toBe(true);
  });

  test('canRunAgent returns false when budget is at or below reserve', async () => {
    // Use 420 prompts → 180 remaining = exactly the reserve threshold
    await recordUsage(420, DEFAULT_CONFIG);
    const result = await canRunAgent(DEFAULT_CONFIG);
    expect(result).toBe(false);
  });

  test('canRunAgent returns false when budget is below reserve', async () => {
    await recordUsage(500, DEFAULT_CONFIG);
    const result = await canRunAgent(DEFAULT_CONFIG);
    expect(result).toBe(false);
  });

  test('old entries expire after window elapses', async () => {
    // Record usage "6 hours ago" — should be expired in a 5-hour window
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    vi.setSystemTime(sixHoursAgo);
    await recordUsage(500, DEFAULT_CONFIG);

    // Now jump to present — the old usage should have expired
    vi.useRealTimers();
    const remaining = await getRemainingBudget(DEFAULT_CONFIG);
    expect(remaining).toBe(600);
  });

  test('partially expired window only counts recent entries', async () => {
    const config = { ...DEFAULT_CONFIG, windowHours: 1 };

    // Record 200 prompts "90 minutes ago" (expired for 1-hour window)
    const ninetyMinAgo = Date.now() - 90 * 60 * 1000;
    vi.setSystemTime(ninetyMinAgo);
    await recordUsage(200, config);

    // Record 100 prompts "30 minutes ago" (still within window)
    const thirtyMinAgo = Date.now() + 60 * 60 * 1000; // relative to faked time
    vi.setSystemTime(thirtyMinAgo);
    await recordUsage(100, config);

    // Now check from present — only the 100 should count
    vi.useRealTimers();
    const remaining = await getRemainingBudget(config);
    expect(remaining).toBe(500);
  });

  test('persists state to disk', async () => {
    await recordUsage(50, DEFAULT_CONFIG);

    // Read raw file and verify it's valid JSON
    const raw = await readFile(TEST_STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].count).toBe(50);
  });

  test('loadBudgetState returns empty entries for missing file', async () => {
    const state = await loadBudgetState(TEST_STATE_FILE);
    expect(state.entries).toEqual([]);
  });
});
