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
    const total = stages.length;
    let stagesRun = 0;

    this.config.log(`[pipeline] Starting pipeline: ${stages.map(s => s.agent).join(' → ')}`);
    this.config.log(`[pipeline] Task: "${task}"`);

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i]!;
      const stageNum = i + 1;
      const mode = stage.teams ? 'team' : 'standalone';

      this.config.log(`[pipeline] Stage ${stageNum}/${total}: Running ${stage.agent} (${mode})`);

      const stageTask = this.buildStageTask(stage.agent, task, i, stages);

      await this.config.runner(stage.agent, project, stageTask, {
        mode,
        hooks: this.config.hooks,
        log: this.config.log,
      });

      stagesRun++;
      this.config.log(`[pipeline] Stage ${stageNum}/${total}: ${stage.agent} completed`);
    }

    this.config.log(`[pipeline] Pipeline complete (${stagesRun} stages, 0 retries)`);

    return { completed: true, stagesRun, retries: 0 };
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
