import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PipelineStage } from './router.js';

export interface RunnerResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
}

export interface RunnerOptions {
  mode: 'standalone' | 'team';
  hooks?: unknown;
  log?: (message: string) => void;
}

export type PipelineRunnerFn = (
  role: string,
  projectPath: string,
  task: string,
  options: RunnerOptions,
) => Promise<RunnerResult>;

export interface PipelineEngineConfig {
  runner: PipelineRunnerFn;
  log: (message: string) => void;
  hooks?: unknown;
  maxRetries?: number;
}

export interface PipelineRunOptions {
  stages: PipelineStage[];
  project: string;
  task: string;
}

export interface PipelineResult {
  completed: boolean;
  stagesRun: number;
  retries: number;
  finalVerdict?: string;
}

export class PipelineEngine {
  private config: PipelineEngineConfig;
  private maxRetries: number;

  constructor(config: PipelineEngineConfig) {
    this.config = config;
    this.maxRetries = config.maxRetries ?? 3;
  }

  async run(options: PipelineRunOptions): Promise<PipelineResult> {
    const { stages, project, task } = options;
    let retries = 0;

    this.config.log(`[pipeline] Starting pipeline: ${stages.map(s => s.agent).join(' → ')}`);
    this.config.log(`[pipeline] Task: "${task}"`);

    let i = 0;
    let stagesRun = 0;

    while (i < stages.length) {
      const stage = stages[i]!;
      const mode = stage.teams ? 'team' : 'standalone';

      this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: Running ${stage.agent} (${mode})`);

      const stageTask = this.buildStageTask(stage.agent, task, i, stages);

      await this.config.runner(stage.agent, project, stageTask, {
        mode,
        hooks: this.config.hooks,
        log: this.config.log,
      });

      stagesRun++;
      this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: ${stage.agent} completed`);

      // Check review verdict after reviewer stages
      if (stage.agent === 'reviewer' || stage.agent.includes('review')) {
        const verdict = await this.parseReviewVerdict(project);

        if (verdict === 'APPROVE') {
          this.config.log(`[pipeline] Reviewer verdict: APPROVE`);
          i++;
          continue;
        }

        if (retries >= this.maxRetries) {
          this.config.log(`[pipeline] Max retries (${this.maxRetries}) reached. Stopping.`);
          return { completed: false, stagesRun, retries, finalVerdict: verdict };
        }

        retries++;

        if (verdict === 'REDESIGN') {
          // Find the architect stage (or earliest non-reviewer stage)
          const architectIdx = stages.findIndex(s => s.agent === 'architect' || s.agent.includes('architect'));
          const restartIdx = architectIdx >= 0 ? architectIdx : 0;
          this.config.log(`[pipeline] Reviewer verdict: REDESIGN — restarting from ${stages[restartIdx]!.agent} (retry ${retries})`);
          i = restartIdx;
          continue;
        }

        // REVISE — find the builder stage before this reviewer
        const builderIdx = stages.slice(0, i).reverse().findIndex(s => s.agent === 'builder' || s.agent.includes('build'));
        const restartIdx = builderIdx >= 0 ? i - 1 - builderIdx : Math.max(0, i - 1);
        this.config.log(`[pipeline] Reviewer verdict: REVISE — re-running ${stages[restartIdx]!.agent} (retry ${retries})`);
        i = restartIdx;
        continue;
      }

      i++;
    }

    this.config.log(`[pipeline] Pipeline complete (${stagesRun} stages, ${retries} retries)`);
    return { completed: true, stagesRun, retries, finalVerdict: 'APPROVE' };
  }

  private async parseReviewVerdict(project: string): Promise<string> {
    try {
      const reviewPath = join(project, '.brain', 'REVIEW.md');
      const content = await readFile(reviewPath, 'utf-8');
      const match = content.match(/Verdict:\s*(APPROVE|REVISE|REDESIGN)/i);
      return match ? match[1]!.toUpperCase() : 'APPROVE';
    } catch {
      // No REVIEW.md — assume approved
      return 'APPROVE';
    }
  }

  private buildStageTask(agent: string, originalTask: string, index: number, stages: PipelineStage[]): string {
    if (index === 0) {
      return originalTask;
    }

    const prevAgent = stages[index - 1]?.agent ?? 'previous agent';

    if (agent === 'reviewer' || agent.includes('review')) {
      return `Review the code changes made by ${prevAgent} for the following task: ${originalTask}\n\nRun the tests, check code quality, and write your review to .brain/REVIEW.md with a score (1-10) and verdict (APPROVE, REVISE, or REDESIGN).`;
    }

    if (agent === 'builder' || agent.includes('build')) {
      return `Implement the following task based on the plan in .brain/PLAN.md: ${originalTask}`;
    }

    if (agent === 'architect' || agent.includes('architect')) {
      return `Design the architecture for the following task and write the plan to .brain/PLAN.md: ${originalTask}`;
    }

    return originalTask;
  }
}
