import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PipelineStage } from './router.js';
import { writePipelineState, type PipelineState, type ReviewOutput } from './state.js';

export interface RunnerResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
  sessionId?: string;
  structuredOutput?: unknown;
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
  sessionIds?: Record<string, string>;
  review?: ReviewOutput;
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

    // Initialize pipeline state
    const now = Date.now();
    const pipelineState: PipelineState = {
      project,
      task,
      pipeline: stages.map(s => s.agent),
      status: 'running',
      currentStage: 0,
      startedAt: now,
      updatedAt: now,
      stages: stages.map(s => ({ agent: s.agent, status: 'pending' as const })),
      retries: 0,
    };
    await writePipelineState(project, pipelineState);

    const sessionIds: Record<string, string> = {};
    let lastReviewOutput: ReviewOutput | undefined;
    let i = 0;
    let stagesRun = 0;

    while (i < stages.length) {
      const stage = stages[i]!;
      const mode = stage.teams ? 'team' : 'standalone';

      this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: Running ${stage.agent} (${mode})`);

      // Update state: stage starting
      pipelineState.currentStage = i;
      pipelineState.stages[i]!.status = 'running';
      pipelineState.stages[i]!.startedAt = Date.now();
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);

      const stageTask = this.buildStageTask(stage.agent, task, i, stages);

      const result = await this.config.runner(stage.agent, project, stageTask, {
        mode,
        hooks: this.config.hooks,
        log: this.config.log,
      });

      stagesRun++;

      // Capture session ID
      if (result.sessionId) {
        sessionIds[stage.agent] = result.sessionId;
        pipelineState.stages[i]!.sessionId = result.sessionId;
      }

      this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: ${stage.agent} completed`);

      // Post-stage validation
      const validationError = await this.validateStage(stage.agent, project, result.structuredOutput);
      if (validationError) {
        this.config.log(`[pipeline] VALIDATION FAILED for ${stage.agent}: ${validationError}`);
        pipelineState.stages[i]!.status = 'failed';
        pipelineState.stages[i]!.validation = validationError;
        pipelineState.stages[i]!.completedAt = Date.now();
        pipelineState.status = 'failed';
        pipelineState.error = validationError;
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        return { completed: false, stagesRun, retries, finalVerdict: `VALIDATION_FAILED: ${validationError}`, sessionIds, review: lastReviewOutput };
      }

      pipelineState.stages[i]!.status = 'completed';
      pipelineState.stages[i]!.validation = 'passed';
      pipelineState.stages[i]!.completedAt = Date.now();
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);

      this.config.log(`[pipeline] Stage ${i + 1}/${stages.length}: ${stage.agent} passed validation`);

      // Check review verdict after reviewer stages
      if (stage.agent === 'reviewer' || stage.agent.includes('review')) {
        let verdict: string;

        // Prefer structured output over file parsing
        if (result.structuredOutput && typeof result.structuredOutput === 'object') {
          const review = result.structuredOutput as ReviewOutput;
          lastReviewOutput = review;
          verdict = review.verdict;
          this.config.log(`[pipeline] Reviewer verdict: ${verdict} (${review.score}/10, ${review.issues.length} issues)`);

          // Log patterns compliance warning
          if (review.patternsCompliance === false) {
            this.config.log(`[pipeline] WARNING: Reviewer reports patterns non-compliance. Review .brain/PATTERNS.md adherence.`);
          }
        } else {
          // Fallback: parse from REVIEW.md (backwards compat)
          verdict = await this.parseReviewVerdict(project);
          this.config.log(`[pipeline] Reviewer verdict: ${verdict} (from REVIEW.md fallback)`);
        }

        if (verdict === 'APPROVE') {
          i++;
          continue;
        }

        if (retries >= this.maxRetries) {
          this.config.log(`[pipeline] Max retries (${this.maxRetries}) reached. Stopping.`);
          pipelineState.status = 'failed';
          pipelineState.finalVerdict = verdict;
          pipelineState.retries = retries;
          pipelineState.updatedAt = Date.now();
          await writePipelineState(project, pipelineState);
          return { completed: false, stagesRun, retries, finalVerdict: verdict, sessionIds, review: lastReviewOutput };
        }

        retries++;
        pipelineState.retries = retries;

        if (verdict === 'REDESIGN') {
          const architectIdx = stages.findIndex(s => s.agent === 'architect' || s.agent.includes('architect'));
          const restartIdx = architectIdx >= 0 ? architectIdx : 0;
          this.config.log(`[pipeline] Reviewer verdict: REDESIGN — restarting from ${stages[restartIdx]!.agent} (retry ${retries})`);
          for (let j = restartIdx; j < stages.length; j++) {
            pipelineState.stages[j]!.status = 'pending';
            pipelineState.stages[j]!.startedAt = undefined;
            pipelineState.stages[j]!.completedAt = undefined;
            pipelineState.stages[j]!.validation = undefined;
          }
          pipelineState.updatedAt = Date.now();
          await writePipelineState(project, pipelineState);
          i = restartIdx;
          continue;
        }

        // REVISE
        const builderIdx = stages.slice(0, i).reverse().findIndex(s => s.agent === 'builder' || s.agent.includes('build'));
        const restartIdx = builderIdx >= 0 ? i - 1 - builderIdx : Math.max(0, i - 1);
        this.config.log(`[pipeline] Reviewer verdict: REVISE — re-running ${stages[restartIdx]!.agent} (retry ${retries})`);
        for (let j = restartIdx; j < stages.length; j++) {
          pipelineState.stages[j]!.status = 'pending';
          pipelineState.stages[j]!.startedAt = undefined;
          pipelineState.stages[j]!.completedAt = undefined;
          pipelineState.stages[j]!.validation = undefined;
        }
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        i = restartIdx;
        continue;
      }

      i++;
    }

    this.config.log(`[pipeline] Pipeline complete (${stagesRun} stages, ${retries} retries)`);

    // Final state
    pipelineState.status = 'completed';
    pipelineState.finalVerdict = 'APPROVE';
    pipelineState.updatedAt = Date.now();
    await writePipelineState(project, pipelineState);

    return { completed: true, stagesRun, retries, finalVerdict: 'APPROVE', sessionIds, review: lastReviewOutput };
  }

  private async parseReviewVerdict(project: string): Promise<string> {
    try {
      const reviewPath = join(project, '.brain', 'REVIEW.md');
      const content = await readFile(reviewPath, 'utf-8');
      const match = content.match(/\*{0,2}Verdict:?\*{0,2}\s*(APPROVE|REVISE|REDESIGN)/i);
      return match ? match[1]!.toUpperCase() : 'APPROVE';
    } catch {
      // No REVIEW.md — assume approved
      return 'APPROVE';
    }
  }

  private async validateStage(agent: string, project: string, structuredOutput?: unknown): Promise<string | null> {
    if (agent === 'architect' || agent.includes('architect')) {
      return this.validateArchitect(project);
    }
    if (agent === 'builder' || agent.includes('build')) {
      return this.validateBuilder(project);
    }
    if (agent === 'reviewer' || agent.includes('review')) {
      return this.validateReviewer(project, structuredOutput);
    }
    return null;
  }

  private async validateArchitect(project: string): Promise<string | null> {
    try {
      const planPath = join(project, '.brain', 'PLAN.md');
      const content = await readFile(planPath, 'utf-8');
      if (!content.trim()) return 'Architect did not write .brain/PLAN.md';
    } catch {
      // PLAN.md not required for all architect runs — skip validation if missing
    }
    return null;
  }

  private async validateBuilder(_project: string): Promise<string | null> {
    // Builder validation is implicit — if the runner completed without error, the build succeeded
    return null;
  }

  private async validateReviewer(project: string, structuredOutput?: unknown): Promise<string | null> {
    // If structured output is available, validate its shape
    if (structuredOutput && typeof structuredOutput === 'object') {
      const review = structuredOutput as Record<string, unknown>;
      if (!review['verdict'] || !['APPROVE', 'REVISE', 'REDESIGN'].includes(String(review['verdict']))) {
        return 'Reviewer structured output missing valid verdict field';
      }
      if (typeof review['score'] !== 'number' || review['score'] < 1 || review['score'] > 10) {
        return 'Reviewer structured output has invalid score (must be 1-10)';
      }
      return null;
    }

    // Fallback: check REVIEW.md file (backwards compatibility)
    const reviewPath = join(project, '.brain', 'REVIEW.md');
    try {
      const content = await readFile(reviewPath, 'utf-8');
      if (!content.match(/\*{0,2}Verdict:?\*{0,2}\s*(APPROVE|REVISE|REDESIGN)/i)) {
        return 'Reviewer wrote REVIEW.md but missing a valid Verdict: line (APPROVE|REVISE|REDESIGN)';
      }
    } catch {
      return 'Reviewer did not produce a review (no structured output and no .brain/REVIEW.md)';
    }
    return null;
  }

  private buildStageTask(agent: string, originalTask: string, index: number, stages: PipelineStage[]): string {
    if (index === 0) {
      return originalTask;
    }

    const prevAgent = stages[index - 1]?.agent ?? 'previous agent';

    if (agent === 'reviewer' || agent.includes('review')) {
      return `Review the code written by ${prevAgent} for the following task. Follow the review-loop and review-code skills. Read .brain/PLAN.md to understand what was supposed to be built, then review the actual code. Read .brain/PATTERNS.md and verify the code follows established patterns. Run tests/build. Your final response will be captured as structured JSON. As a backup, also write your verdict to .brain/REVIEW.md with a "Verdict: APPROVE", "Verdict: REVISE", or "Verdict: REDESIGN" line.\n\nTask: ${originalTask}`;
    }

    if (agent === 'builder' || agent.includes('build')) {
      return `Implement the following task. Start by reading .brain/PLAN.md — this is your implementation spec from Architect. It contains the architecture, directory structure, ordered tasks, and acceptance criteria. Also read .brain/DECISIONS.md for architectural decisions. Follow the plan step by step. Set up the project from scratch if needed (git init, bun init, bun install, create directories), write all source code, and ensure it builds and runs. Always use bun, not npm.\n\nTask: ${originalTask}`;
    }

    if (agent === 'architect' || agent.includes('architect')) {
      return `Design the architecture and create a detailed implementation plan for the following task. Start by reading .brain/RESEARCH/ if it exists — this contains research from the Scout agent. Then follow the plan-feature skill. Write the plan to .brain/PLAN.md and any architectural decisions to .brain/DECISIONS.md. Do NOT write any source code, config files, or install dependencies — you ONLY write to .brain/ files. The Builder agent will handle all implementation.\n\nTask: ${originalTask}`;
    }

    return originalTask;
  }
}
