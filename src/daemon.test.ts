import { describe, test, expect } from 'vitest';
import { loadConfig, buildTriggers, type DaemonConfig } from './daemon.js';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';

const TEST_DIR = join(import.meta.dirname, '../.test-state/daemon');
const TEST_CONFIG = join(TEST_DIR, 'config.json');

describe('loadConfig', () => {
  test('loads valid config from file', async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(
      TEST_CONFIG,
      JSON.stringify({
        projects: [{ path: '/tmp/test', name: 'test' }],
        triggers: [
          {
            name: 'daily-scout',
            type: 'cron',
            schedule: '0 9 * * *',
            project: 'test',
            agent: 'scout',
            task: 'Run research',
            mode: 'standalone',
          },
        ],
        budget: {
          maxPromptsPerWindow: 600,
          reserveForInteractive: 0.3,
          windowHours: 5,
        },
      }),
    );

    const config = await loadConfig(TEST_CONFIG);
    expect(config.projects).toHaveLength(1);
    expect(config.triggers).toHaveLength(1);
    expect(config.budget.maxPromptsPerWindow).toBe(600);

    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test('returns defaults when config file missing', async () => {
    const config = await loadConfig('/nonexistent/config.json');
    expect(config.projects).toEqual([]);
    expect(config.triggers).toEqual([]);
    expect(config.budget.maxPromptsPerWindow).toBe(600);
  });
});

describe('buildTriggers', () => {
  test('creates CronTrigger instances from config', () => {
    const config: DaemonConfig = {
      projects: [],
      triggers: [
        {
          name: 'daily-scout',
          type: 'cron',
          schedule: '0 9 * * *',
          project: 'test',
          agent: 'scout',
          task: 'Run research',
          mode: 'standalone',
        },
        {
          name: 'hourly-check',
          type: 'cron',
          schedule: '0 * * * *',
          project: 'test',
          agent: 'scout',
          task: 'Check status',
          mode: 'standalone',
        },
      ],
      budget: {
        maxPromptsPerWindow: 600,
        reserveForInteractive: 0.3,
        windowHours: 5,
      },
    };

    const triggers = buildTriggers(config);
    expect(triggers).toHaveLength(2);
    expect(triggers[0]!.getConfig().name).toBe('daily-scout');
    expect(triggers[1]!.getConfig().name).toBe('hourly-check');
  });

  test('returns empty array for no triggers', () => {
    const config: DaemonConfig = {
      projects: [],
      triggers: [],
      budget: {
        maxPromptsPerWindow: 600,
        reserveForInteractive: 0.3,
        windowHours: 5,
      },
    };

    const triggers = buildTriggers(config);
    expect(triggers).toHaveLength(0);
  });
});
