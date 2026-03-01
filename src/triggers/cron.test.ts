import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CronTrigger, type TriggerConfig } from './cron.js';

const baseTrigger: TriggerConfig = {
  name: 'test-trigger',
  type: 'cron',
  schedule: '*/1 * * * *', // every minute
  project: 'test-project',
  agent: 'scout',
  task: 'Do research',
  mode: 'standalone',
};

describe('CronTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('isDue returns true when cron schedule has elapsed', () => {
    // Fix time to exactly on a minute boundary
    const onMinute = new Date('2026-02-27T10:01:00.000Z').getTime();
    vi.setSystemTime(onMinute);

    const trigger = new CronTrigger(baseTrigger);
    // Set lastFiredAt to before the previous interval
    trigger.setLastFiredAt(onMinute - 2 * 60 * 1000);

    expect(trigger.isDue()).toBe(true);
  });

  test('isDue returns false when cron schedule has not elapsed since last fire', () => {
    // Set time to 30 seconds AFTER a minute boundary — no new boundary crossed
    const onMinute = new Date('2026-02-27T10:01:00.000Z').getTime();
    vi.setSystemTime(onMinute + 30 * 1000); // 10:01:30

    const trigger = new CronTrigger(baseTrigger);
    // Last fired right at 10:01:00 — next minute (10:02) hasn't arrived
    trigger.setLastFiredAt(onMinute);

    expect(trigger.isDue()).toBe(false);
  });

  test('isDue returns true on first check (no previous fire)', () => {
    const onMinute = new Date('2026-02-27T10:01:00.000Z').getTime();
    vi.setSystemTime(onMinute);

    const trigger = new CronTrigger(baseTrigger);
    // Never fired before — should be due
    expect(trigger.isDue()).toBe(true);
  });

  test('markFired updates lastFiredAt and prevents immediate re-fire', () => {
    const onMinute = new Date('2026-02-27T10:01:00.000Z').getTime();
    vi.setSystemTime(onMinute);

    const trigger = new CronTrigger(baseTrigger);
    expect(trigger.isDue()).toBe(true);

    trigger.markFired();
    expect(trigger.isDue()).toBe(false);
  });

  test('hourly schedule fires only once per hour', () => {
    const hourlyConfig: TriggerConfig = {
      ...baseTrigger,
      name: 'hourly-trigger',
      schedule: '0 * * * *', // top of every hour
    };

    // At 10:00 exactly
    const tenAm = new Date('2026-02-27T10:00:00.000Z').getTime();
    vi.setSystemTime(tenAm);

    const trigger = new CronTrigger(hourlyConfig);
    expect(trigger.isDue()).toBe(true);
    trigger.markFired();

    // At 10:30 — not due yet
    vi.setSystemTime(tenAm + 30 * 60 * 1000);
    expect(trigger.isDue()).toBe(false);

    // At 11:00 — due again
    vi.setSystemTime(tenAm + 60 * 60 * 1000);
    expect(trigger.isDue()).toBe(true);
  });

  test('getConfig returns the trigger configuration', () => {
    const trigger = new CronTrigger(baseTrigger);
    expect(trigger.getConfig()).toEqual(baseTrigger);
  });

  test('daily 9am schedule works correctly', () => {
    const dailyConfig: TriggerConfig = {
      ...baseTrigger,
      name: 'daily-scout',
      schedule: '0 9 * * *', // 9am daily (local time)
    };

    // Construct 9:00am in LOCAL timezone (cron uses local time)
    const nineAm = new Date();
    nineAm.setFullYear(2026, 1, 27); // Feb 27, 2026
    nineAm.setHours(9, 0, 0, 0);
    vi.setSystemTime(nineAm);

    const trigger = new CronTrigger(dailyConfig);
    expect(trigger.isDue()).toBe(true);
    trigger.markFired();

    // At 10am same day — not due
    const tenAm = new Date(nineAm);
    tenAm.setHours(10, 0, 0, 0);
    vi.setSystemTime(tenAm);
    expect(trigger.isDue()).toBe(false);

    // At 9am next day — due
    const nextNineAm = new Date(nineAm);
    nextNineAm.setDate(nextNineAm.getDate() + 1);
    vi.setSystemTime(nextNineAm);
    expect(trigger.isDue()).toBe(true);
  });

  describe('state persistence', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'cron-test-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test('persists lastFiredAt to state file', () => {
      const onMinute = new Date('2026-02-27T10:01:00.000Z').getTime();
      vi.setSystemTime(onMinute);

      const trigger = new CronTrigger(baseTrigger, { stateDir: tmpDir });
      trigger.markFired();

      // Create new trigger instance — should restore lastFiredAt
      const trigger2 = new CronTrigger(baseTrigger, { stateDir: tmpDir });
      trigger2.loadState();
      expect(trigger2.getLastFiredAt()).toBeTruthy();
    });

    test('restored trigger does not re-fire immediately', () => {
      const onMinute = new Date('2026-02-27T10:01:00.000Z').getTime();
      vi.setSystemTime(onMinute);

      const trigger = new CronTrigger(baseTrigger, { stateDir: tmpDir });
      trigger.markFired();

      // 30 seconds later — new instance should not be due
      vi.setSystemTime(onMinute + 30 * 1000);
      const trigger2 = new CronTrigger(baseTrigger, { stateDir: tmpDir });
      trigger2.loadState();
      expect(trigger2.isDue()).toBe(false);
    });

    test('works without stateDir (no persistence)', () => {
      const onMinute = new Date('2026-02-27T10:01:00.000Z').getTime();
      vi.setSystemTime(onMinute);

      const trigger = new CronTrigger(baseTrigger);
      trigger.markFired();
      expect(trigger.getLastFiredAt()).toBeTruthy();
      // No error — just doesn't persist
    });
  });
});
