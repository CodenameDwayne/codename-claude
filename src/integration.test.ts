/**
 * Integration tests for the pipeline orchestration.
 *
 * These tests validate the full wiring from triggers through to the pipeline engine,
 * using mocked runners to avoid real API consumption. They verify:
 *
 * 1. Webhook → queue → heartbeat → pipeline
 * 2. Team mode passes through correctly
 * 3. Heartbeat passes mode through to pipeline
 * 4. Webhook server enqueues work correctly
 * 5. Pipeline result totalTurnCount drives prompt usage recording
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { HeartbeatLoop, type HeartbeatDeps } from './heartbeat/loop.js';
import { WorkQueue } from './heartbeat/queue.js';
import { CronTrigger } from './triggers/cron.js';
import { WebhookServer, type WebhookConfig, type WebhookTriggerResult } from './triggers/webhook.js';
import type { PipelineResult } from './pipeline/engine.js';

const TEST_STATE_DIR = join(import.meta.dirname, '../.test-state/integration');
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

describe('Pipeline: webhook → queue → heartbeat → runner', () => {
  test('webhook enqueues work that heartbeat processes in team mode', async () => {
    vi.useRealTimers(); // Need real timers for HTTP server

    const queue = new WorkQueue(QUEUE_FILE);
    const pipelineCalls: Array<{ project: string; task: string; mode: string; agent?: string }> = [];

    const runPipeline = vi.fn(async (project: string, task: string, mode: 'standalone' | 'team', agent?: string): Promise<PipelineResult> => {
      pipelineCalls.push({ project, task, mode, agent });
      return { completed: true, stagesRun: 3, teamStagesRun: 0, retries: 0, totalTurnCount: 15 };
    });

    // 1. Start webhook server that enqueues to our queue
    const secret = 'integration-test-secret';
    const webhookConfig: WebhookConfig = {
      port: 0,
      github: {
        secret,
        events: [
          { event: 'issues.labeled', label: 'auto-build', mode: 'team' },
        ],
      },
    };

    const webhookResults: WebhookTriggerResult[] = [];
    let enqueueResolve: () => void;
    const enqueuePromise = new Promise<void>((resolve) => { enqueueResolve = resolve; });

    const webhookServer = new WebhookServer(
      webhookConfig,
      (result) => {
        webhookResults.push(result);
        queue.enqueue({
          triggerName: result.triggerName,
          project: result.project,
          agent: result.agent,
          task: result.task,
          mode: result.mode,
          enqueuedAt: Date.now(),
        }).then(() => enqueueResolve());
      },
      () => {},
    );
    await webhookServer.start();
    const serverPort = ((webhookServer as unknown as Record<string, unknown>)['server'] as { address(): { port: number } }).address().port;

    try {
      // 2. Send a GitHub webhook event
      const body = JSON.stringify({
        action: 'labeled',
        label: { name: 'auto-build' },
        issue: { title: 'Add greeting command', body: 'CLI should say hello', number: 7 },
        repository: { full_name: 'dwayne/cc-test' },
      });
      const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

      const res = await fetch(`http://localhost:${serverPort}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'issues',
          'x-hub-signature-256': sig,
        },
        body,
      });

      expect(res.status).toBe(200);
      expect(webhookResults).toHaveLength(1);
      expect(webhookResults[0]!.mode).toBe('team');

      // Wait for async enqueue to complete
      await enqueuePromise;

      // 3. Verify item is in queue
      expect(await queue.size()).toBe(1);
      const item = await queue.peek();
      expect(item!.mode).toBe('team');
      expect(item!.agent).toBe('team-lead');
      expect(item!.task).toContain('Add greeting command');

      // 4. Heartbeat processes the queued item
      const deps: HeartbeatDeps = {
        triggers: [],
        queue,
        canRunAgent: async () => true,
        recordUsage: async () => {},
        runPipeline,
        log: () => {},
      };
      const heartbeat = new HeartbeatLoop(deps);
      const tickResult = await heartbeat.tick();

      expect(tickResult.action).toBe('ran_agent');
      expect(tickResult.source).toBe('queue');

      // 5. Verify pipeline was called with correct args
      expect(pipelineCalls).toHaveLength(1);
      expect(pipelineCalls[0]!.agent).toBe('team-lead');
      expect(pipelineCalls[0]!.mode).toBe('team');
      expect(pipelineCalls[0]!.project).toBe('cc-test');

      // 6. Queue should be empty after processing
      expect(await queue.isEmpty()).toBe(true);
    } finally {
      await webhookServer.stop();
    }
  });
});

describe('Pipeline: cron trigger → heartbeat → runner with mode', () => {
  test('team cron trigger passes mode through to pipeline', async () => {
    const pipelineCalls: Array<{ agent?: string; mode: string }> = [];
    const runPipeline = vi.fn(async (_project: string, _task: string, mode: 'standalone' | 'team', agent?: string): Promise<PipelineResult> => {
      pipelineCalls.push({ agent, mode });
      return { completed: true, stagesRun: 3, teamStagesRun: 0, retries: 0, totalTurnCount: 15 };
    });

    const trigger = new CronTrigger({
      name: 'team-build',
      type: 'cron',
      schedule: '*/1 * * * *',
      project: 'cc-test',
      agent: 'team-lead',
      task: 'Build feature from backlog',
      mode: 'team',
    });

    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    const deps: HeartbeatDeps = {
      triggers: [trigger],
      queue: new WorkQueue(QUEUE_FILE),
      canRunAgent: async () => true,
      recordUsage: async () => {},
      runPipeline,
      log: () => {},
    };
    const heartbeat = new HeartbeatLoop(deps);
    const result = await heartbeat.tick();

    expect(result.action).toBe('ran_agent');
    expect(pipelineCalls[0]!.agent).toBe('team-lead');
    expect(pipelineCalls[0]!.mode).toBe('team');
  });

  test('standalone cron trigger passes standalone mode', async () => {
    const pipelineCalls: Array<{ mode: string }> = [];
    const runPipeline = vi.fn(async (_project: string, _task: string, mode: 'standalone' | 'team'): Promise<PipelineResult> => {
      pipelineCalls.push({ mode });
      return { completed: true, stagesRun: 1, teamStagesRun: 0, retries: 0, totalTurnCount: 5 };
    });

    const trigger = new CronTrigger({
      name: 'daily-scout',
      type: 'cron',
      schedule: '*/1 * * * *',
      project: 'cc-test',
      agent: 'scout',
      task: 'Research something',
      mode: 'standalone',
    });

    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    const deps: HeartbeatDeps = {
      triggers: [trigger],
      queue: new WorkQueue(QUEUE_FILE),
      canRunAgent: async () => true,
      recordUsage: async () => {},
      runPipeline,
      log: () => {},
    };
    const heartbeat = new HeartbeatLoop(deps);
    await heartbeat.tick();

    expect(pipelineCalls[0]!.mode).toBe('standalone');
  });

  test('multi-stage pipeline records higher prompt usage than single-stage', async () => {
    const usageRecords: number[] = [];
    const recordUsage = vi.fn(async (count: number) => { usageRecords.push(count); });

    // Multi-stage pipeline (team trigger — returns totalTurnCount: 30)
    const multiStagePipeline = vi.fn(async (): Promise<PipelineResult> => {
      return { completed: true, stagesRun: 3, teamStagesRun: 0, retries: 0, totalTurnCount: 30 };
    });

    const teamTrigger = new CronTrigger({
      name: 'team-build',
      type: 'cron',
      schedule: '*/1 * * * *',
      project: 'cc-test',
      agent: 'team-lead',
      task: 'Build feature',
      mode: 'team',
    });

    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    const teamDeps: HeartbeatDeps = {
      triggers: [teamTrigger],
      queue: new WorkQueue(QUEUE_FILE),
      canRunAgent: async () => true,
      recordUsage,
      runPipeline: multiStagePipeline,
      log: () => {},
    };
    const teamLoop = new HeartbeatLoop(teamDeps);
    await teamLoop.tick();

    // Single-stage pipeline (standalone — returns totalTurnCount: 5)
    const singleStagePipeline = vi.fn(async (): Promise<PipelineResult> => {
      return { completed: true, stagesRun: 1, teamStagesRun: 0, retries: 0, totalTurnCount: 5 };
    });

    const standaloneTrigger = new CronTrigger({
      name: 'scout-run',
      type: 'cron',
      schedule: '*/1 * * * *',
      project: 'cc-test',
      agent: 'scout',
      task: 'Research',
      mode: 'standalone',
    });

    vi.setSystemTime(new Date('2026-02-27T10:02:00.000'));

    const standaloneDeps: HeartbeatDeps = {
      triggers: [standaloneTrigger],
      queue: new WorkQueue(QUEUE_FILE),
      canRunAgent: async () => true,
      recordUsage,
      runPipeline: singleStagePipeline,
      log: () => {},
    };
    const standaloneLoop = new HeartbeatLoop(standaloneDeps);
    await standaloneLoop.tick();

    // Multi-stage should record more prompts (totalTurnCount: 30 vs 5)
    expect(usageRecords[0]).toBeGreaterThan(usageRecords[1]!);
  });
});

describe('Pipeline: budget-low queuing preserves mode', () => {
  test('team trigger queued and later dequeued retains team mode', async () => {
    const queue = new WorkQueue(QUEUE_FILE);
    const pipelineCalls: Array<{ mode: string }> = [];
    const runPipeline = vi.fn(async (_project: string, _task: string, mode: 'standalone' | 'team'): Promise<PipelineResult> => {
      pipelineCalls.push({ mode });
      return { completed: true, stagesRun: 1, teamStagesRun: 0, retries: 0, totalTurnCount: 5 };
    });

    const trigger = new CronTrigger({
      name: 'team-build',
      type: 'cron',
      schedule: '*/1 * * * *',
      project: 'cc-test',
      agent: 'team-lead',
      task: 'Build feature',
      mode: 'team',
    });

    vi.setSystemTime(new Date('2026-02-27T10:01:00.000'));

    // First: budget low → queued
    const lowBudgetDeps: HeartbeatDeps = {
      triggers: [trigger],
      queue,
      canRunAgent: async () => false,
      recordUsage: async () => {},
      runPipeline,
      log: () => {},
    };
    const loop1 = new HeartbeatLoop(lowBudgetDeps);
    const result1 = await loop1.tick();
    expect(result1.action).toBe('queued');

    // Second: budget OK → dequeued and run
    const okBudgetDeps: HeartbeatDeps = {
      triggers: [],
      queue,
      canRunAgent: async () => true,
      recordUsage: async () => {},
      runPipeline,
      log: () => {},
    };
    const loop2 = new HeartbeatLoop(okBudgetDeps);
    const result2 = await loop2.tick();
    expect(result2.action).toBe('ran_agent');
    expect(result2.source).toBe('queue');
    expect(pipelineCalls[0]!.mode).toBe('team');
  });
});
