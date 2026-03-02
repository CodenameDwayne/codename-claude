import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { PipelineStage } from './router.js';
import { writePipelineState, type PipelineState, type TaskProgress, type ReviewOutput } from './state.js';
import { findNextTask, markTaskComplete, parseCheckboxTasks } from './orchestrator.js';
import type { RunResult } from '../agents/runner.js';

/** Tracks agent activity — touched on every SDK message to signal liveness. */
export interface ActivityTracker {
  touch(): void;
  lastActivityMs: number;
}

export interface RunnerOptions {
  mode: 'standalone' | 'team';
  hooks?: unknown;
  log?: (message: string) => void;
  /** If provided, the runner touches this on every SDK message to signal liveness. */
  activityTracker?: ActivityTracker;
}

export type PipelineRunnerFn = (
  role: string,
  projectPath: string,
  task: string,
  options: RunnerOptions,
) => Promise<RunResult>;

export interface PipelineEngineConfig {
  runner: PipelineRunnerFn;
  log: (message: string) => void;
  hooks?: unknown;
  maxRetries?: number;
  /** Idle timeout in ms — stage fails if no SDK activity for this long. Default: 5 minutes. */
  idleTimeoutMs?: number;
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
  totalTurnCount: number;
  finalVerdict?: string;
  sessionIds?: string[];
  review?: ReviewOutput;
}

export class PipelineEngine {
  private config: PipelineEngineConfig;
  private maxRetries: number;
  private idleTimeoutMs: number;

  constructor(config: PipelineEngineConfig) {
    this.config = config;
    this.maxRetries = config.maxRetries ?? 2;
    this.idleTimeoutMs = config.idleTimeoutMs ?? 5 * 60_000;
  }

  async run(options: PipelineRunOptions): Promise<PipelineResult> {
    const { project, task } = options;
    const stages = [...options.stages];

    if (stages.length === 0) {
      throw new Error('Pipeline received empty stages array — router returned no stages');
    }

    // Ensure .brain/PROJECT.md exists for first-run bootstrap
    await this.ensureProjectContext(project, task);

    this.config.log(`[pipeline] Starting pipeline: ${stages.map(s => s.agent).join(' → ')}`);
    this.config.log(`[pipeline] Task: "${task}"`);

    // Initialize pipeline state
    const now = Date.now();
    const pipelineState: PipelineState = {
      project,
      task,
      agentPipeline: stages.map(s => s.agent),
      status: 'running',
      phase: 'scouting',
      startedAt: now,
      updatedAt: now,
      tasks: [],
      currentTaskIndex: -1,
      totalIterations: 0,
      retries: 0,
    };
    await writePipelineState(project, pipelineState);

    const sessionIds: string[] = [];
    let lastReviewOutput: ReviewOutput | undefined;
    let stagesRun = 0;
    let totalTurnCount = 0;

    // ── Phase 1: Run pre-loop agents (scout, architect) sequentially ──
    for (const stage of stages) {
      const isBuilder = stage.agent === 'builder' || stage.agent.includes('build');
      const isReviewer = stage.agent === 'reviewer' || stage.agent.includes('review');
      if (isBuilder || isReviewer) break; // Enter Ralph loop for builder/reviewer

      const mode = stage.teams ? 'team' : 'standalone';
      const phaseLabel = (stage.agent === 'scout' || stage.agent.includes('scout')) ? 'scouting' : 'planning';
      pipelineState.phase = phaseLabel;
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);

      this.config.log(`[pipeline] Phase 1: Running ${stage.agent} (${mode})`);

      const stageTask = this.buildStageTask(stage.agent, task, { retries: 0 });
      const result = await this.runWithIdleTimeout(stage.agent, project, stageTask, mode);
      stagesRun++;
      totalTurnCount += result.turnCount ?? 0;
      if (result.sessionId) sessionIds.push(result.sessionId);

      // Pre-validation cleanup for architect
      if (stage.agent === 'architect' || stage.agent.includes('architect')) {
        await this.cleanupPlanPartFiles(project);
      }

      // Validate
      const validationError = await this.validateStage(stage.agent, project, result.structuredOutput);
      if (validationError) {
        this.config.log(`[pipeline] VALIDATION FAILED for ${stage.agent}: ${validationError}`);
        pipelineState.status = 'failed';
        pipelineState.phase = 'failed';
        pipelineState.error = validationError;
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        return { completed: false, stagesRun, retries: 0, totalTurnCount, finalVerdict: `VALIDATION_FAILED: ${validationError}`, sessionIds };
      }

      this.config.log(`[pipeline] ${stage.agent} passed validation`);
    }

    // ── Phase 2: Ralph loop — one task at a time ──
    // Only enter if pipeline includes builder/reviewer stages
    const hasBuilderReviewer = stages.some(s =>
      s.agent === 'builder' || s.agent.includes('build') ||
      s.agent === 'reviewer' || s.agent.includes('review')
    );

    if (!hasBuilderReviewer) {
      // Pure pre-loop pipeline (e.g. scout-only, architect-only)
      pipelineState.status = 'completed';
      pipelineState.phase = 'completed';
      pipelineState.finalVerdict = 'APPROVE';
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);
      return { completed: true, stagesRun, retries: 0, totalTurnCount, finalVerdict: 'APPROVE', sessionIds };
    }

    pipelineState.phase = 'building';
    let redesignCount = 0;
    const MAX_REDESIGNS = this.maxRetries;

    // Read initial task list from PLAN.md
    const planPath = join(project, '.brain', 'PLAN.md');
    let planContent: string;
    try {
      planContent = await readFile(planPath, 'utf-8');
    } catch {
      pipelineState.status = 'failed';
      pipelineState.phase = 'failed';
      pipelineState.error = 'PLAN.md not found — architect must produce .brain/PLAN.md before Ralph loop';
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);
      return { completed: false, stagesRun, retries: 0, totalTurnCount, finalVerdict: 'VALIDATION_FAILED: PLAN.md not found', sessionIds };
    }

    // Initialize task progress from checkboxes
    const checkboxTasks = parseCheckboxTasks(planContent);
    pipelineState.tasks = checkboxTasks.map(t => ({
      title: t.title,
      status: t.checked ? 'completed' as const : 'pending' as const,
      attempts: 0,
      completedAt: t.checked ? Date.now() : undefined,
    }));
    pipelineState.updatedAt = Date.now();
    await writePipelineState(project, pipelineState);

    this.config.log(`[pipeline] Ralph loop: ${checkboxTasks.length} tasks found in PLAN.md`);

    // Main Ralph loop
    while (true) {
      // Re-read PLAN.md to get current checkbox state
      try {
        planContent = await readFile(planPath, 'utf-8');
      } catch {
        pipelineState.status = 'failed';
        pipelineState.phase = 'failed';
        pipelineState.error = 'PLAN.md disappeared during Ralph loop';
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        return { completed: false, stagesRun, retries: pipelineState.retries, totalTurnCount, finalVerdict: 'PLAN_LOST', sessionIds };
      }

      const nextTaskTitle = findNextTask(planContent);
      if (!nextTaskTitle) {
        // All checkboxes checked — pipeline complete
        break;
      }

      // Find the corresponding TaskProgress entry
      const taskIdx = pipelineState.tasks.findIndex(t => t.title === nextTaskTitle);
      if (taskIdx >= 0) {
        pipelineState.currentTaskIndex = taskIdx;
        pipelineState.tasks[taskIdx]!.status = 'in_progress';
        pipelineState.tasks[taskIdx]!.attempts++;
      }
      pipelineState.totalIterations++;
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);

      this.config.log(`[pipeline] Ralph: Building task "${nextTaskTitle}" (attempt ${pipelineState.tasks[taskIdx]?.attempts ?? 1})`);

      // ── Run Builder ──
      const builderTask = this.buildStageTask('builder', task, {
        retries: (pipelineState.tasks[taskIdx]?.attempts ?? 1) - 1,
        currentTaskTitle: nextTaskTitle,
      });
      const builderResult = await this.runWithIdleTimeout('builder', project, builderTask, 'standalone');
      stagesRun++;
      totalTurnCount += builderResult.turnCount ?? 0;
      if (builderResult.sessionId) {
        sessionIds.push(builderResult.sessionId);
        if (taskIdx >= 0) pipelineState.tasks[taskIdx]!.lastSessionId = builderResult.sessionId;
      }

      // Validate builder
      const builderError = await this.validateStage('builder', project, builderResult.structuredOutput);
      if (builderError) {
        this.config.log(`[pipeline] Builder validation failed: ${builderError}`);
        // Non-fatal for individual task — reviewer will catch it
      }

      // ── Run Reviewer ──
      const reviewerTask = this.buildStageTask('reviewer', task, {
        currentTaskTitle: nextTaskTitle,
      });
      const reviewerResult = await this.runWithIdleTimeout('reviewer', project, reviewerTask, 'standalone');
      stagesRun++;
      totalTurnCount += reviewerResult.turnCount ?? 0;
      if (reviewerResult.sessionId) sessionIds.push(reviewerResult.sessionId);

      // Validate reviewer
      const reviewerError = await this.validateStage('reviewer', project, reviewerResult.structuredOutput);
      if (reviewerError) {
        this.config.log(`[pipeline] Reviewer validation failed: ${reviewerError}`);
        pipelineState.status = 'failed';
        pipelineState.phase = 'failed';
        pipelineState.error = reviewerError;
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        return { completed: false, stagesRun, retries: pipelineState.retries, totalTurnCount, finalVerdict: `VALIDATION_FAILED: ${reviewerError}`, sessionIds };
      }

      // ── Parse verdict ──
      let verdict: string;
      if (reviewerResult.structuredOutput && typeof reviewerResult.structuredOutput === 'object') {
        const review = reviewerResult.structuredOutput as ReviewOutput;
        lastReviewOutput = review;
        verdict = review.verdict;
        this.config.log(`[pipeline] Reviewer verdict: ${verdict} (${review.score}/10, ${review.issues.length} issues)`);
      } else {
        verdict = await this.parseReviewVerdict(project);
        this.config.log(`[pipeline] Reviewer verdict: ${verdict} (from REVIEW.md fallback)`);
      }

      if (taskIdx >= 0) {
        pipelineState.tasks[taskIdx]!.lastVerdict = verdict;
      }

      // ── Handle verdict ──
      if (verdict === 'APPROVE') {
        // Mark checkbox in PLAN.md
        const updatedPlan = markTaskComplete(planContent, nextTaskTitle);
        await writeFile(planPath, updatedPlan);

        if (taskIdx >= 0) {
          pipelineState.tasks[taskIdx]!.status = 'completed';
          pipelineState.tasks[taskIdx]!.completedAt = Date.now();
        }
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        this.config.log(`[pipeline] Ralph: Task "${nextTaskTitle}" APPROVED — checkbox marked`);
        continue;
      }

      // Write review feedback for retry
      if (lastReviewOutput) {
        const reviewMd = [
          `# Review Feedback`,
          '',
          `**Verdict:** ${lastReviewOutput.verdict}`,
          `**Score:** ${lastReviewOutput.score}/10`,
          `**Summary:** ${lastReviewOutput.summary}`,
          '',
          '## Issues to Fix',
          '',
          ...lastReviewOutput.issues.map(
            (issue, idx) => `${idx + 1}. **[${issue.severity}]** ${issue.description}${issue.file ? ` (${issue.file})` : ''}`
          ),
        ].join('\n');
        await mkdir(join(project, '.brain'), { recursive: true });
        await writeFile(join(project, '.brain', 'REVIEW.md'), reviewMd);
        this.config.log(`[pipeline] Wrote review feedback to .brain/REVIEW.md for retry`);
      }

      if (verdict === 'REVISE') {
        // Check per-task retry limit
        const attempts = pipelineState.tasks[taskIdx]?.attempts ?? 1;
        if (attempts >= this.maxRetries + 1) {
          this.config.log(`[pipeline] Max retries (${this.maxRetries}) reached for "${nextTaskTitle}". Stopping.`);
          if (taskIdx >= 0) pipelineState.tasks[taskIdx]!.status = 'failed';
          pipelineState.status = 'failed';
          pipelineState.phase = 'failed';
          pipelineState.finalVerdict = 'REVISE';
          pipelineState.retries++;
          pipelineState.updatedAt = Date.now();
          await writePipelineState(project, pipelineState);
          return { completed: false, stagesRun, retries: pipelineState.retries, totalTurnCount, finalVerdict: 'REVISE', sessionIds, review: lastReviewOutput };
        }

        pipelineState.retries++;
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);
        this.config.log(`[pipeline] Ralph: REVISE — retrying "${nextTaskTitle}" (attempt ${attempts + 1})`);
        continue; // Loop picks up the same unchecked task
      }

      if (verdict === 'REDESIGN') {
        redesignCount++;
        if (redesignCount > MAX_REDESIGNS) {
          this.config.log(`[pipeline] Max redesigns (${MAX_REDESIGNS}) reached. Stopping.`);
          pipelineState.status = 'failed';
          pipelineState.phase = 'failed';
          pipelineState.finalVerdict = 'REDESIGN';
          pipelineState.retries++;
          pipelineState.updatedAt = Date.now();
          await writePipelineState(project, pipelineState);
          return { completed: false, stagesRun, retries: pipelineState.retries, totalTurnCount, finalVerdict: 'REDESIGN', sessionIds, review: lastReviewOutput };
        }

        this.config.log(`[pipeline] Ralph: REDESIGN — re-running architect (redesign ${redesignCount})`);
        pipelineState.phase = 'planning';
        pipelineState.retries++;
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);

        // Re-run architect
        const architectTask = this.buildStageTask('architect', task, { retries: redesignCount });
        const architectResult = await this.runWithIdleTimeout('architect', project, architectTask, 'standalone');
        stagesRun++;
        totalTurnCount += architectResult.turnCount ?? 0;
        if (architectResult.sessionId) sessionIds.push(architectResult.sessionId);

        await this.cleanupPlanPartFiles(project);

        const archError = await this.validateStage('architect', project, architectResult.structuredOutput);
        if (archError) {
          pipelineState.status = 'failed';
          pipelineState.phase = 'failed';
          pipelineState.error = archError;
          pipelineState.updatedAt = Date.now();
          await writePipelineState(project, pipelineState);
          return { completed: false, stagesRun, retries: pipelineState.retries, totalTurnCount, finalVerdict: `VALIDATION_FAILED: ${archError}`, sessionIds };
        }

        // Re-parse fresh plan
        planContent = await readFile(planPath, 'utf-8');
        const freshTasks = parseCheckboxTasks(planContent);
        pipelineState.tasks = freshTasks.map(t => ({
          title: t.title,
          status: 'pending' as const,
          attempts: 0,
        }));
        pipelineState.currentTaskIndex = -1;
        pipelineState.phase = 'building';
        pipelineState.updatedAt = Date.now();
        await writePipelineState(project, pipelineState);

        this.config.log(`[pipeline] Ralph: Architect produced ${freshTasks.length} fresh tasks after REDESIGN`);
        continue;
      }

      // Unknown verdict — treat as REVISE
      this.config.log(`[pipeline] Unknown verdict "${verdict}" — treating as REVISE`);
      pipelineState.retries++;
      pipelineState.updatedAt = Date.now();
      await writePipelineState(project, pipelineState);
    }

    // All tasks complete
    this.config.log(`[pipeline] Pipeline complete (${stagesRun} stages, ${pipelineState.retries} retries)`);
    pipelineState.status = 'completed';
    pipelineState.phase = 'completed';
    pipelineState.finalVerdict = 'APPROVE';
    pipelineState.updatedAt = Date.now();
    await writePipelineState(project, pipelineState);

    return { completed: true, stagesRun, retries: pipelineState.retries, totalTurnCount, finalVerdict: 'APPROVE', sessionIds, review: lastReviewOutput };
  }

  private async ensureProjectContext(project: string, task: string): Promise<void> {
    const projectMdPath = join(project, '.brain', 'PROJECT.md');
    try {
      const content = await readFile(projectMdPath, 'utf-8');
      if (content.trim().length > 50) return; // Already has meaningful content
    } catch {
      // File doesn't exist — that's fine, we'll create it
    }

    // Bootstrap from task description
    const scaffold = `# Project\n\n**Task:** ${task}\n\n**Status:** First pipeline run — architecture pending.\n`;
    await mkdir(join(project, '.brain'), { recursive: true });
    await writeFile(projectMdPath, scaffold);
    this.config.log(`[pipeline] Bootstrapped .brain/PROJECT.md from task description`);
  }

  private async parseReviewVerdict(project: string): Promise<string> {
    try {
      const reviewPath = join(project, '.brain', 'REVIEW.md');
      const content = await readFile(reviewPath, 'utf-8');
      const match = content.match(/\*{0,2}Verdict:?\*{0,2}\s*(APPROVE|REVISE|REDESIGN)/i);
      return match ? match[1]!.toUpperCase() : 'REVISE';
    } catch {
      // No REVIEW.md — fail-closed, default to REVISE
      return 'REVISE';
    }
  }

  private async validateStage(agent: string, project: string, structuredOutput?: unknown): Promise<string | null> {
    if (agent === 'scout' || agent.includes('scout')) return this.validateScout(project);
    if (agent === 'architect' || agent.includes('architect')) return this.validateArchitect(project);
    if (agent === 'builder' || agent.includes('build')) return this.validateBuilder(project);
    if (agent === 'reviewer' || agent.includes('review')) return this.validateReviewer(project, structuredOutput);
    return null;
  }

  private async validateScout(project: string): Promise<string | null> {
    const researchDir = join(project, '.brain', 'RESEARCH');
    try {
      const entries = await readdir(researchDir);
      const mdFiles = entries.filter(e => e.endsWith('.md'));
      if (mdFiles.length === 0) {
        return 'Scout did not produce any research files in .brain/RESEARCH/';
      }
    } catch {
      return 'Scout did not create .brain/RESEARCH/ directory';
    }
    return null;
  }

  private async validateArchitect(project: string): Promise<string | null> {
    const planPath = join(project, '.brain', 'PLAN.md');
    let content: string;
    try {
      content = await readFile(planPath, 'utf-8');
    } catch {
      return 'Architect did not produce .brain/PLAN.md';
    }
    if (!content.trim()) return 'Architect wrote empty .brain/PLAN.md';

    const tasks = parseCheckboxTasks(content);
    if (tasks.length === 0) {
      return 'PLAN.md has no checkbox tasks (expected "- [ ] Task description" format)';
    }

    const checkedCount = tasks.filter(t => t.checked).length;
    if (checkedCount > 0) {
      return `PLAN.md has ${checkedCount} pre-checked tasks — fresh plan should be all unchecked`;
    }

    return null;
  }

  private async validateBuilder(project: string): Promise<string | null> {
    // 1. Check for file changes via git (exclude .brain/ pipeline metadata)
    try {
      // Only run git checks if the project is a git repo root
      await readdir(join(project, '.git'));
      const { execFileSync } = await import('node:child_process');
      const diff = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', '.', ':!.brain'], {
        cwd: project, encoding: 'utf-8', timeout: 10_000,
      }).trim();
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: project, encoding: 'utf-8', timeout: 10_000,
      }).trim();
      // Filter out .brain/ from untracked files
      const untrackedNonBrain = untracked
        .split('\n')
        .filter(f => f && !f.startsWith('.brain/'))
        .join('\n');
      if (!diff && !untrackedNonBrain) {
        return 'Builder did not modify any files (no git diff, no new files)';
      }
    } catch {
      // Not a git repo or git not available — skip diff check
    }

    // 2. Run test suite if available
    try {
      const pkgRaw = await readFile(join(project, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      if (pkg.scripts?.['test']) {
        const { execFileSync } = await import('node:child_process');
        execFileSync('bun', ['run', 'test'], {
          cwd: project, encoding: 'utf-8', timeout: 120_000, stdio: 'pipe',
        });
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && err.status !== null) {
        return 'Builder validation failed: tests did not pass';
      }
      // No package.json or no test script — skip test check
    }

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

  private async cleanupPlanPartFiles(project: string): Promise<void> {
    try {
      const brainDir = join(project, '.brain');
      const entries = await readdir(brainDir);
      const partFiles = entries.filter(e => /^PLAN-PART-\d+\.md$/.test(e));
      for (const partFile of partFiles) {
        await unlink(join(brainDir, partFile));
      }
      if (partFiles.length > 0) {
        this.config.log(`[pipeline] Cleaned up ${partFiles.length} leftover PLAN-PART files`);
      }
    } catch {
      // .brain dir might not exist — that's fine
    }
  }

  private buildStageTask(
    agent: string,
    originalTask: string,
    options: { retries?: number; currentTaskTitle?: string },
  ): string {
    const { retries = 0, currentTaskTitle } = options;

    if (agent === 'scout' || agent.includes('scout')) {
      return `Research the following task thoroughly. Follow the research-scan skill. Write your findings to .brain/RESEARCH/ directory — create one markdown file per research topic. Include technology evaluations, API comparisons, best practices, and any other findings relevant to planning. Do NOT write code or make architectural decisions — you ONLY research and document findings. The Architect agent will use your research to create the implementation plan.\n\nTask: ${originalTask}`;
    }

    if (agent === 'architect' || agent.includes('architect')) {
      const redesignInstruction = retries > 0
        ? `\n\nCRITICAL — REDESIGN: A reviewer rejected the previous architecture. Read .brain/REVIEW.md FIRST for their feedback. Your new plan must address all the reviewer's concerns.`
        : '';
      return `Design the architecture and create a detailed implementation plan for the following task. Start by reading .brain/RESEARCH/ if it exists — this contains research from the Scout agent. Then follow the plan-feature skill. Write the plan to .brain/PLAN.md using checkbox format:\n\n- [ ] Task description\n- [ ] Another task\n\nEach task should be completable in a single agent session (10-20 minutes). Order tasks by dependency — earlier tasks should not depend on later ones. Write architectural decisions to .brain/DECISIONS.md. Do NOT write any source code, config files, or install dependencies — you ONLY write to .brain/ files.${redesignInstruction}\n\nTask: ${originalTask}`;
    }

    if (agent === 'builder' || agent.includes('build')) {
      const retryInstruction = retries > 0
        ? `\n\nCRITICAL — RETRY: A previous review found issues. Read .brain/REVIEW.md FIRST and fix all listed issues before doing anything else.`
        : '';
      const taskInstruction = currentTaskTitle
        ? `\n\nYOU ARE WORKING ON THIS SPECIFIC TASK: "${currentTaskTitle}"\nImplement ONLY this task. Do not implement other tasks from the plan.`
        : '';
      return `Implement a single task from the implementation plan. Start by reading .brain/PLAN.md — this is your spec from Architect. Also read .brain/DECISIONS.md for architectural decisions. Follow the plan step by step. Write source code, write a unit test to verify your work, and ensure it builds. Always use bun, not npm.${taskInstruction}${retryInstruction}\n\nProject task: ${originalTask}`;
    }

    if (agent === 'reviewer' || agent.includes('review')) {
      const taskInstruction = currentTaskTitle
        ? `\n\nYou are reviewing the implementation of: "${currentTaskTitle}". Focus your review on the code implementing this specific task.`
        : '';
      return `Review the code written by Builder for the following task. Follow the review-loop and review-code skills. Read .brain/PLAN.md to understand what was supposed to be built, then review the actual code. Read .brain/PATTERNS.md and verify the code follows established patterns. Run tests/build. Your final response will be captured as structured JSON. As a backup, also write your verdict to .brain/REVIEW.md with a "Verdict: APPROVE", "Verdict: REVISE", or "Verdict: REDESIGN" line.${taskInstruction}\n\nProject task: ${originalTask}`;
    }

    return originalTask;
  }

  /**
   * Runs an agent with an activity-based idle timeout. If no SDK messages
   * arrive for idleTimeoutMs, the stage is considered stuck.
   */
  private async runWithIdleTimeout(
    agent: string,
    project: string,
    stageTask: string,
    mode: 'standalone' | 'team',
  ): Promise<RunResult> {
    const tracker: ActivityTracker = {
      lastActivityMs: Date.now(),
      touch() { this.lastActivityMs = Date.now(); },
    };

    const result = await Promise.race([
      this.config.runner(agent, project, stageTask, {
        mode,
        hooks: this.config.hooks,
        log: this.config.log,
        activityTracker: tracker,
      }),
      this.waitForIdle(tracker, agent),
    ]);

    return result;
  }

  /**
   * Returns a promise that rejects when the activity tracker shows no SDK
   * messages for idleTimeoutMs. Polls every 30 seconds.
   */
  private waitForIdle(tracker: ActivityTracker, agentName: string): Promise<never> {
    return new Promise<never>((_, reject) => {
      const interval = setInterval(() => {
        const idleMs = Date.now() - tracker.lastActivityMs;
        if (idleMs >= this.idleTimeoutMs) {
          clearInterval(interval);
          const idleMin = Math.round(idleMs / 60_000);
          reject(new Error(`STAGE_IDLE: ${agentName} had no activity for ${idleMin}m`));
        }
      }, 30_000);
    });
  }
}
