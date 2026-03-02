import 'dotenv/config';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CronTrigger, type TriggerConfig } from './triggers/cron.js';
import { WebhookServer, type WebhookConfig } from './triggers/webhook.js';
import { FileWatcher } from './triggers/watcher.js';
import { WorkQueue } from './heartbeat/queue.js';
import { HeartbeatLoop } from './heartbeat/loop.js';
import { recordUsage, canRunAgent, getRemainingBudget, type BudgetConfig } from './state/budget.js';
import {
  listProjects,
  registerProject,
  unregisterProject,
  updateLastSession,
} from './state/projects.js';
import { runAgent } from './agents/runner.js';
import { PipelineEngine } from './pipeline/engine.js';
import { routeTask, loadAgentSummaries } from './pipeline/router.js';
import {
  createPostToolUseHook,
  createSessionEndHook,
  createTeammateIdleHook,
  createTaskCompletedHook,
} from './hooks/hooks.js';
import { IpcServer } from './ipc/server.js';
import type { IpcCommand, IpcResponse } from './ipc/protocol.js';
import { SOCKET_PATH_DEFAULT, PID_FILE_DEFAULT } from './ipc/protocol.js';
import { EventBus } from './notifications/events.js';
import { createNotificationHandler } from './notifications/macos.js';
import { SessionTracker } from './notifications/sessions.js';

// --- Paths ---

const CODENAME_HOME = join(process.env['HOME'] ?? '~', '.codename-claude');
const CONFIG_FILE = join(CODENAME_HOME, 'config.json');
const STATE_DIR = join(CODENAME_HOME, 'state');
const BUDGET_FILE = join(STATE_DIR, 'budget.json');
const PROJECTS_FILE = join(STATE_DIR, 'projects.json');
const QUEUE_FILE = join(STATE_DIR, 'queue.json');
const SESSIONS_FILE = join(STATE_DIR, 'sessions.json');
const AGENTS_DIR = join(CODENAME_HOME, 'agents');

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
  notifications?: {
    enabled: boolean;
    events: string[];
  };
}

const DEFAULT_CONFIG: DaemonConfig = {
  projects: [],
  triggers: [],
  budget: {
    maxPromptsPerWindow: 600,
    reserveForInteractive: 0.3,
    windowHours: 5,
  },
  notifications: {
    enabled: true,
    events: ['session.started', 'session.completed', 'review.escalated', 'budget.low', 'pipeline.stalled', 'pipeline.completed'],
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
      webhook: parsed.webhook,
      notifications: parsed.notifications ?? DEFAULT_CONFIG.notifications,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function buildTriggers(config: DaemonConfig, stateDir?: string): CronTrigger[] {
  return config.triggers
    .filter((t) => t.type === 'cron')
    .map((t) => {
      const trigger = new CronTrigger(t, stateDir ? { stateDir } : undefined);
      trigger.loadState();
      return trigger;
    });
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

  // Event bus — central messaging for notifications and session tracking
  const eventBus = new EventBus();

  // macOS notifications
  const notifyConfig = config.notifications ?? DEFAULT_CONFIG.notifications!;
  const notificationHandler = createNotificationHandler(notifyConfig);
  eventBus.on('*', notificationHandler);

  // Session tracker
  const sessionTracker = new SessionTracker(SESSIONS_FILE);
  await sessionTracker.load();

  eventBus.on('session.started', (event) => {
    if (event.type === 'session.started' && event.sessionId) {
      sessionTracker.startSession(event.sessionId, event.project, event.agent, event.task);
    }
  });
  eventBus.on('session.completed', (event) => {
    if (event.type === 'session.completed' && event.sessionId) {
      sessionTracker.completeSession(event.sessionId, event.verdict, undefined);
    }
  });

  // Log all events
  eventBus.on('*', (event) => {
    log(`[event] ${event.type}${('agent' in event && event.agent) ? ` (${event.agent})` : ''}`);
  });

  const triggers = buildTriggers(config, STATE_DIR);
  const queue = new WorkQueue(QUEUE_FILE);

  // Build project name → path lookup from config AND persisted registry
  // Trigger configs reference projects by name, but runAgent needs the full path
  const projectPathsByName = new Map<string, string>();
  for (const p of config.projects) {
    projectPathsByName.set(p.name, p.path);
  }
  // Also load registered projects (added via `projects add`) from persisted state
  const registeredProjects = await listProjects(PROJECTS_FILE);
  for (const p of registeredProjects) {
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

  // Create pipeline engine
  const pipelineEngine = new PipelineEngine({
    runner: (role, project, task, options) => runAgent(role, project, task, {
      ...options,
      hooks,
    }),
    log,
    eventBus,
  });

  async function readTextFileSafe(path: string): Promise<string> {
    try { return await readFile(path, 'utf-8'); } catch { return ''; }
  }

  async function runPipeline(
    project: string,
    task: string,
    mode: 'standalone' | 'team',
    agent?: string,
  ) {
    const resolvedProject = resolveProjectPath(project);

    if (agent && agent !== 'pipeline') {
      // Manual agent run — skip router
      const stages = [{ agent, teams: mode === 'team' }];
      return pipelineEngine.run({ stages, project: resolvedProject, task });
    }

    // Full pipeline — use LLM router
    const agents = await loadAgentSummaries(AGENTS_DIR);
    const projectContext = await readTextFileSafe(join(resolvedProject, '.brain', 'PROJECT.md'));
    const stages = await routeTask({ task, agents, projectContext });

    // When user explicitly requests team mode, force teams on the architect stage
    if (mode === 'team') {
      for (const stage of stages) {
        if (stage.agent === 'architect') {
          stage.teams = true;
        }
      }
    }

    log(`[pipeline] Router selected: ${stages.map(s => s.agent).join(' → ')}`);
    return pipelineEngine.run({ stages, project: resolvedProject, task });
  }

  // Build heartbeat
  const heartbeat = new HeartbeatLoop(
    {
      triggers,
      queue,
      canRunAgent: () => canRunAgent(budgetConfig),
      recordUsage: (count) => recordUsage(count, budgetConfig),
      runPipeline,
      log,
      projectPaths: [...projectPathsByName.values()],
      eventBus,
    },
    { intervalMs: config.heartbeatIntervalMs ?? 60_000 },
  );

  // Periodic budget check with accurate numbers
  const budgetCheckInterval = setInterval(async () => {
    try {
      const remaining = await getRemainingBudget(budgetConfig);
      const percent = Math.round((remaining / config.budget.maxPromptsPerWindow) * 100);
      if (percent <= 20) {
        eventBus.emit({
          type: 'budget.low',
          remaining,
          max: config.budget.maxPromptsPerWindow,
          percent,
          timestamp: Date.now(),
        });
      }
    } catch { /* non-fatal */ }
  }, 5 * 60_000);

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

  // Start file watcher for BACKLOG.md changes
  const projectPaths = config.projects.map((p) => p.path);
  const fileWatcher = new FileWatcher(
    { projectPaths },
    (result) => {
      log(`[watcher] triggered: ${result.triggerName} → ${result.agent}`);
      queue.enqueue({
        triggerName: result.triggerName,
        project: result.project,
        agent: result.agent,
        task: result.task,
        mode: result.mode,
        enqueuedAt: Date.now(),
      }).catch((err) => {
        log(`[watcher] failed to enqueue: ${err}`);
      });
    },
    log,
  );
  fileWatcher.start();

  // Start heartbeat
  heartbeat.start();

  // --- IPC Server for CLI communication ---

  async function handleIpcCommand(command: IpcCommand): Promise<IpcResponse> {
    switch (command.type) {
      case 'status': {
        const projectList = await listProjects(PROJECTS_FILE);
        const budgetRemaining = await getRemainingBudget(budgetConfig);
        const queueLen = await queue.size();
        return {
          ok: true,
          data: {
            running: true,
            pid: process.pid,
            uptime: process.uptime(),
            tickCount: heartbeat.getTickCount(),
            heartbeatRunning: heartbeat.isRunning(),
            projects: projectList.length,
            triggers: triggers.length,
            budgetRemaining,
            budgetMax: config.budget.maxPromptsPerWindow,
            queueSize: queueLen,
            activeSessions: sessionTracker.getActive().length,
          },
        };
      }

      case 'run': {
        const projectPath = resolveProjectPath(command.project);
        // Enqueue via the work queue so the heartbeat picks it up (respects concurrency lock)
        await queue.enqueue({
          triggerName: `cli:${command.agent}`,
          project: projectPath,
          agent: command.agent,
          task: command.task,
          mode: command.mode,
          enqueuedAt: Date.now(),
        });
        return { ok: true, data: { queued: true, agent: command.agent, project: command.project } };
      }

      case 'projects-list': {
        const projectList = await listProjects(PROJECTS_FILE);
        return { ok: true, data: { projects: projectList } };
      }

      case 'projects-add': {
        const name = command.name ?? command.path.split('/').pop() ?? 'unnamed';
        const entry = await registerProject(command.path, name, PROJECTS_FILE);
        // Also add to the in-memory lookup
        projectPathsByName.set(name, command.path);
        return { ok: true, data: { registered: entry } };
      }

      case 'projects-remove': {
        await unregisterProject(command.pathOrName, PROJECTS_FILE);
        // Remove from in-memory lookup
        projectPathsByName.delete(command.pathOrName);
        return { ok: true, data: { removed: command.pathOrName } };
      }

      case 'queue-list': {
        // Read the queue state directly for display
        const items: unknown[] = [];
        const queueLen = await queue.size();
        // Peek doesn't give all items, so read the state file directly
        try {
          const raw = await readFile(QUEUE_FILE, 'utf-8');
          const state = JSON.parse(raw) as { items: unknown[] };
          items.push(...state.items);
        } catch {
          // empty queue
        }
        return { ok: true, data: { size: queueLen, items } };
      }

      case 'sessions-list': {
        const recent = sessionTracker.getRecent(20);
        return { ok: true, data: { sessions: recent } };
      }

      case 'sessions-active': {
        const active = sessionTracker.getActive();
        return { ok: true, data: { sessions: active } };
      }

      case 'shutdown': {
        log('[ipc] shutdown requested via CLI');
        // Respond first, then shut down
        setTimeout(() => { shutdown('IPC'); }, 100);
        return { ok: true, data: { shutting_down: true } };
      }

      default: {
        return { ok: false, error: `Unknown command type: ${(command as { type: string }).type}` };
      }
    }
  }

  const ipcServer = new IpcServer(SOCKET_PATH_DEFAULT, handleIpcCommand, log);
  await ipcServer.start();
  log(`  IPC:       ${SOCKET_PATH_DEFAULT}`);

  // Write PID file
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(PID_FILE_DEFAULT, String(process.pid));
  log(`  PID:       ${process.pid} (${PID_FILE_DEFAULT})`);

  // Abort controller for signaling in-flight agents to stop
  const shutdownController = new AbortController();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log(`Received ${signal} — shutting down...`);

    // Signal in-flight agents to stop
    shutdownController.abort();

    // Give in-flight work 10 seconds to complete
    const gracePeriod = new Promise(resolve => setTimeout(resolve, 10_000));
    await Promise.race([gracePeriod]);

    heartbeat.stop();
    clearInterval(budgetCheckInterval);
    eventBus.removeAllListeners();
    await fileWatcher.stop();
    await ipcServer.stop();
    if (webhookServer) {
      await webhookServer.stop();
    }
    // Clean up PID file
    await unlink(PID_FILE_DEFAULT).catch(() => {});
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
