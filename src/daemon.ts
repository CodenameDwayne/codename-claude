import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CronTrigger, type TriggerConfig } from './triggers/cron.js';
import { WebhookServer, type WebhookConfig } from './triggers/webhook.js';
import { WorkQueue } from './heartbeat/queue.js';
import { HeartbeatLoop } from './heartbeat/loop.js';
import { recordUsage, canRunAgent, getRemainingBudget, type BudgetConfig } from './state/budget.js';
import { listProjects, updateLastSession } from './state/projects.js';
import { runAgent } from './agents/runner.js';
import {
  createPostToolUseHook,
  createSessionEndHook,
  createTeammateIdleHook,
  createTaskCompletedHook,
} from './hooks/hooks.js';

// --- Paths ---

const CODENAME_HOME = join(process.env['HOME'] ?? '~', '.codename-claude');
const CONFIG_FILE = join(CODENAME_HOME, 'config.json');
const STATE_DIR = join(CODENAME_HOME, 'state');
const BUDGET_FILE = join(STATE_DIR, 'budget.json');
const PROJECTS_FILE = join(STATE_DIR, 'projects.json');
const QUEUE_FILE = join(STATE_DIR, 'queue.json');

// --- Config ---

export interface DaemonConfig {
  projects: Array<{ path: string; name: string }>;
  triggers: TriggerConfig[];
  budget: {
    maxPromptsPerWindow: number;
    reserveForInteractive: number;
    windowHours: number;
  };
  heartbeatIntervalMs?: number;
  webhook?: WebhookConfig;
}

const DEFAULT_CONFIG: DaemonConfig = {
  projects: [],
  triggers: [],
  budget: {
    maxPromptsPerWindow: 600,
    reserveForInteractive: 0.3,
    windowHours: 5,
  },
};

export async function loadConfig(configPath: string = CONFIG_FILE): Promise<DaemonConfig> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DaemonConfig>;
    return {
      projects: parsed.projects ?? DEFAULT_CONFIG.projects,
      triggers: parsed.triggers ?? DEFAULT_CONFIG.triggers,
      budget: {
        ...DEFAULT_CONFIG.budget,
        ...parsed.budget,
      },
      heartbeatIntervalMs: parsed.heartbeatIntervalMs,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function buildTriggers(config: DaemonConfig): CronTrigger[] {
  return config.triggers
    .filter((t) => t.type === 'cron')
    .map((t) => new CronTrigger(t));
}

// --- Logging ---

function log(message: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

// --- Main ---

async function main(): Promise<void> {
  const config = await loadConfig();

  const budgetConfig: BudgetConfig = {
    maxPromptsPerWindow: config.budget.maxPromptsPerWindow,
    reserveForInteractive: config.budget.reserveForInteractive,
    windowHours: config.budget.windowHours,
    stateFile: BUDGET_FILE,
  };

  const triggers = buildTriggers(config);
  const queue = new WorkQueue(QUEUE_FILE);

  // Build project name → path lookup from config
  // Trigger configs reference projects by name, but runAgent needs the full path
  const projectPathsByName = new Map<string, string>();
  for (const p of config.projects) {
    projectPathsByName.set(p.name, p.path);
  }

  function resolveProjectPath(nameOrPath: string): string {
    return projectPathsByName.get(nameOrPath) ?? nameOrPath;
  }

  // Build SDK hooks
  const postToolUseHook = createPostToolUseHook(log);
  const sessionEndHook = createSessionEndHook(async ({ cwd }) => {
    await updateLastSession(cwd, Date.now(), PROJECTS_FILE).catch(() => {
      // Project may not be registered — that's OK during manual runs
    });
  });
  const teammateIdleHook = createTeammateIdleHook(log);
  const taskCompletedHook = createTaskCompletedHook(log);

  const hooks = {
    PostToolUse: [{ hooks: [postToolUseHook] }],
    SessionEnd: [{ hooks: [sessionEndHook] }],
    // Team-specific hooks — only fire during team mode sessions
    TeammateIdle: [{ hooks: [teammateIdleHook] }],
    TaskCompleted: [{ hooks: [taskCompletedHook] }],
  };

  // Build heartbeat
  const heartbeat = new HeartbeatLoop(
    {
      triggers,
      queue,
      canRunAgent: () => canRunAgent(budgetConfig),
      recordUsage: (count) => recordUsage(count, budgetConfig),
      runAgent: (role, project, task, mode) =>
        runAgent(role, resolveProjectPath(project), task, { hooks, log, mode }),
      log,
    },
    { intervalMs: config.heartbeatIntervalMs ?? 60_000 },
  );

  // Startup banner
  const projects = await listProjects(PROJECTS_FILE);
  const remaining = await getRemainingBudget(budgetConfig);
  const queueSize = await queue.size();

  log('=== Codename Claude daemon started ===');
  log(`  Projects:  ${projects.length} registered`);
  log(`  Triggers:  ${triggers.length} registered`);
  log(`  Budget:    ${remaining}/${config.budget.maxPromptsPerWindow} prompts remaining`);
  log(`  Queue:     ${queueSize} items pending`);
  log(`  Interval:  ${(config.heartbeatIntervalMs ?? 60_000) / 1000}s`);
  log('=======================================');

  // Start webhook server if configured
  let webhookServer: WebhookServer | null = null;
  if (config.webhook) {
    webhookServer = new WebhookServer(
      config.webhook,
      (result) => {
        // Webhook events are enqueued as work items for the heartbeat to process
        log(`[webhook] received: ${result.triggerName} → ${result.agent} (${result.mode})`);
        queue.enqueue({
          triggerName: result.triggerName,
          project: result.project,
          agent: result.agent,
          task: result.task,
          mode: result.mode,
          enqueuedAt: Date.now(),
        }).catch((err) => {
          log(`[webhook] failed to enqueue: ${err}`);
        });
      },
      log,
    );
    await webhookServer.start();
    log(`  Webhook:   listening on port ${config.webhook.port}`);
  }

  // Start heartbeat
  heartbeat.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log(`Received ${signal} — shutting down...`);
    heartbeat.stop();
    if (webhookServer) {
      await webhookServer.stop();
    }
    log(`Heartbeat stopped after ${heartbeat.getTickCount()} ticks. Goodbye.`);
    process.exit(0);
  };

  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
}

// Only run main when executed directly (not when imported for testing)
const isDirectRun = !process.env['VITEST'];
if (isDirectRun) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
