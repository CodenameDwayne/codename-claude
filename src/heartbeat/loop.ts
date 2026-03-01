import type { CronTrigger } from '../triggers/cron.js';
import type { WorkQueue } from './queue.js';
import type { PipelineResult } from '../pipeline/engine.js';
import { readPipelineState, writePipelineState } from '../pipeline/state.js';

export interface HeartbeatDeps {
  triggers: CronTrigger[];
  queue: WorkQueue;
  canRunAgent: () => Promise<boolean>;
  recordUsage: (promptCount: number) => Promise<void>;
  runPipeline: (project: string, task: string, mode: 'standalone' | 'team', agent?: string) => Promise<PipelineResult>;
  log: (message: string) => void;
  projectPaths?: string[];
}

export interface TickResult {
  action: 'idle' | 'ran_agent' | 'queued' | 'busy' | 'error';
  triggerName?: string;
  source?: 'trigger' | 'queue';
  error?: string;
}

interface HeartbeatOptions {
  intervalMs?: number;
}

const STANDALONE_PROMPT_ESTIMATE = 10;
const TEAM_PROMPT_ESTIMATE = 50;

export class HeartbeatLoop {
  private deps: HeartbeatDeps;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickCount = 0;

  constructor(deps: HeartbeatDeps, options: HeartbeatOptions = {}) {
    this.deps = deps;
    this.intervalMs = options.intervalMs ?? 60_000;
  }

  async tick(): Promise<TickResult> {
    this.tickCount++;

    // Synchronous lock — must be checked and set before any await
    if (this.running) {
      this.deps.log(`[heartbeat] tick #${this.tickCount} — busy (agent running)`);
      return { action: 'busy' };
    }
    this.running = true;

    try {
      return await this.tickInner();
    } finally {
      this.running = false;
    }
  }

  private async tickInner(): Promise<TickResult> {
    // 0. Check for stalled pipelines
    if (this.deps.projectPaths) {
      for (const projectPath of this.deps.projectPaths) {
        const state = await readPipelineState(projectPath);
        if (state && state.status === 'running') {
          const staleDuration = Date.now() - state.updatedAt;
          const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

          if (staleDuration > STALL_THRESHOLD_MS) {
            this.deps.log(`[heartbeat] tick #${this.tickCount} — stalled pipeline detected in ${projectPath} (${Math.round(staleDuration / 60000)}m since last update)`);

            state.status = 'stalled';
            state.updatedAt = Date.now();
            await writePipelineState(projectPath, state);

            const currentAgent = state.pipeline[state.currentStage] ?? 'builder';
            await this.deps.queue.enqueue({
              triggerName: 'stall-recovery',
              project: projectPath,
              agent: currentAgent,
              task: state.task,
              mode: 'standalone',
              enqueuedAt: Date.now(),
            });

            return { action: 'queued', triggerName: 'stall-recovery' };
          }
        }
      }
    }

    // 1. Check triggers
    for (const trigger of this.deps.triggers) {
      if (trigger.isDue()) {
        const config = trigger.getConfig();
        const budgetOk = await this.deps.canRunAgent();

        if (budgetOk) {
          return await this.executeAgent(config.agent, config.project, config.task, config.name, config.mode, 'trigger', trigger);
        } else {
          await this.deps.queue.enqueue({
            triggerName: config.name,
            project: config.project,
            agent: config.agent,
            task: config.task,
            mode: config.mode,
            enqueuedAt: Date.now(),
          });
          trigger.markFired();
          this.deps.log(`[heartbeat] tick #${this.tickCount} — queued ${config.name} (budget low)`);
          return { action: 'queued', triggerName: config.name };
        }
      }
    }

    // 2. Check work queue
    if (!(await this.deps.queue.isEmpty())) {
      const budgetOk = await this.deps.canRunAgent();
      if (budgetOk) {
        const item = await this.deps.queue.dequeue();
        if (item) {
          return await this.executeAgent(item.agent, item.project, item.task, item.triggerName, item.mode, 'queue');
        }
      }
    }

    // 3. Nothing to do
    this.deps.log(`[heartbeat] tick #${this.tickCount} — idle`);
    return { action: 'idle' };
  }

  private async executeAgent(
    agent: string,
    project: string,
    task: string,
    triggerName: string,
    mode: 'standalone' | 'team',
    source: 'trigger' | 'queue',
    trigger?: CronTrigger,
  ): Promise<TickResult> {
    this.deps.log(`[heartbeat] tick #${this.tickCount} — firing ${triggerName} (${agent} on ${project}, mode: ${mode})`);

    try {
      const result = await this.deps.runPipeline(project, task, mode, agent);
      trigger?.markFired();
      const standaloneStages = result.stagesRun - (result.teamStagesRun ?? 0);
      const teamStages = result.teamStagesRun ?? 0;
      const promptEstimate = (standaloneStages * STANDALONE_PROMPT_ESTIMATE) + (teamStages * TEAM_PROMPT_ESTIMATE);
      await this.deps.recordUsage(promptEstimate);
      return { action: 'ran_agent', triggerName, source };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.log(`[heartbeat] error running ${triggerName}: ${message}`);
      trigger?.markFired();
      return { action: 'error', triggerName, error: message };
    }
  }

  start(): void {
    if (this.timer) return;
    this.deps.log(`[heartbeat] starting (interval: ${this.intervalMs}ms)`);
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.deps.log(`[heartbeat] tick error: ${err}`);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.deps.log(`[heartbeat] stopped`);
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  getTickCount(): number {
    return this.tickCount;
  }
}
