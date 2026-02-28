import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HeartbeatLoop,
  type HeartbeatDeps,
  type TickResult,
} from './loop.js';
import { CronTrigger, type TriggerConfig } from '../triggers/cron.js';
import { WorkQueue, type QueueItem } from './queue.js';

const TEST_STATE_DIR = join(import.meta.dirname, '../../.test-state/heartbeat');
const QUEUE_FILE = join(TEST_STATE_DIR, 'queue.json');

beforeEach(async () => {
  vi.useFakeTimers();
  await mkdir(TEST_STATE_DIR, { recursive: true });
  await rm(QUEUE_FILE, { force: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(TEST_STATE_DIR, { recursive: true, force: true });
});

function makeDeps(overrides: Partial<HeartbeatDeps> = {}): HeartbeatDeps {
  return {
    triggers: [],
    queue: new WorkQueue(QUEUE_FILE),
    canRunAgent: async () => true,
    recordUsage: async () => {},
    runAgent: async () => ({ agentName: 'scout', sandboxed: false, mode: 'standalone' as const }),
    log: () => {},
    ...overrides,
  };
}

function makeTrigger(schedule = '*/1 * * * *'): CronTrigger {
  return new CronTrigger({
    name: 'test-trigger',
    type: 'cron',
    schedule,
    project: 'test-project',
    agent: 'scout',
    task: 'Research something',
    mode: 'standalone',
  });
}

describe('HeartbeatLoop', () => {
  test('tick with no triggers and empty queue returns idle', async () => {
    const deps = makeDeps();
    const loop = new HeartbeatLoop(deps);

    const result = await loop.tick();
    expect(result.action).toBe('idle');
  });

  test('tick fires a due trigger and runs the agent', async () => {
    const runAgent = vi.fn(async () => ({ agentName: 'scout', sandboxed: false, mode: 'standalone' as const }));
    const trigger = makeTrigger();

    // Set time to a minute boundary so the trigger is due
    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    const deps = makeDeps({ triggers: [trigger], runAgent });
    const loop = new HeartbeatLoop(deps);

    const result = await loop.tick();
    expect(result.action).toBe('ran_agent');
    expect(result.triggerName).toBe('test-trigger');
    expect(runAgent).toHaveBeenCalledOnce();
  });

  test('tick queues work when budget is low', async () => {
    const trigger = makeTrigger();
    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    const queue = new WorkQueue(QUEUE_FILE);
    const deps = makeDeps({
      triggers: [trigger],
      queue,
      canRunAgent: async () => false,
    });
    const loop = new HeartbeatLoop(deps);

    const result = await loop.tick();
    expect(result.action).toBe('queued');
    expect(await queue.size()).toBe(1);
  });

  test('tick processes queued work when budget available', async () => {
    const runAgent = vi.fn(async () => ({ agentName: 'scout', sandboxed: false, mode: 'standalone' as const }));
    const queue = new WorkQueue(QUEUE_FILE);
    await queue.enqueue({
      triggerName: 'queued-trigger',
      project: 'test-project',
      agent: 'scout',
      task: 'Queued task',
      mode: 'standalone',
      enqueuedAt: Date.now(),
    });

    const deps = makeDeps({ queue, runAgent });
    const loop = new HeartbeatLoop(deps);

    const result = await loop.tick();
    expect(result.action).toBe('ran_agent');
    expect(result.source).toBe('queue');
    expect(runAgent).toHaveBeenCalledOnce();
    expect(await queue.isEmpty()).toBe(true);
  });

  test('tick does not run concurrent agents', async () => {
    let resolveAgent: () => void;
    const agentPromise = new Promise<void>((resolve) => {
      resolveAgent = resolve;
    });

    const runAgent = vi.fn(async () => {
      await agentPromise;
      return { agentName: 'scout', sandboxed: false, mode: 'standalone' as const };
    });

    const trigger = makeTrigger();
    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    const deps = makeDeps({ triggers: [trigger], runAgent });
    const loop = new HeartbeatLoop(deps);

    // First tick starts agent (don't await)
    const tick1 = loop.tick();

    // Second tick while first is running
    const result2 = await loop.tick();
    expect(result2.action).toBe('busy');

    // Resolve the first agent
    resolveAgent!();
    await tick1;
  });

  test('tick records usage after agent run', async () => {
    const recordUsage = vi.fn(async () => {});
    const trigger = makeTrigger();
    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    const deps = makeDeps({ triggers: [trigger], recordUsage });
    const loop = new HeartbeatLoop(deps);

    await loop.tick();
    expect(recordUsage).toHaveBeenCalledOnce();
  });

  test('tick handles agent errors gracefully', async () => {
    const runAgent = vi.fn(async () => {
      throw new Error('Agent crashed');
    });
    const logs: string[] = [];
    const trigger = makeTrigger();
    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    const deps = makeDeps({
      triggers: [trigger],
      runAgent,
      log: (msg: string) => logs.push(msg),
    });
    const loop = new HeartbeatLoop(deps);

    const result = await loop.tick();
    expect(result.action).toBe('error');
    expect(logs.some((l) => l.includes('Agent crashed'))).toBe(true);

    // Should NOT be stuck in busy state after error
    const result2 = await loop.tick();
    expect(result2.action).not.toBe('busy');
  });

  test('start and stop control the interval', async () => {
    const deps = makeDeps();
    const loop = new HeartbeatLoop(deps, { intervalMs: 1000 });

    loop.start();
    expect(loop.isRunning()).toBe(true);

    loop.stop();
    expect(loop.isRunning()).toBe(false);
  });
});
