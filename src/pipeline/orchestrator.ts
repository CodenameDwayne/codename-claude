import type { PipelineStage } from './router.js';

export interface PlanTask {
  number: number;
  title: string;
}

export function parsePlanTasks(planContent: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  const regex = /^###\s+Task\s+(\d+):\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(planContent)) !== null) {
    tasks.push({
      number: parseInt(match[1]!, 10),
      title: match[2]!.trim(),
    });
  }

  return tasks;
}

export function expandStagesWithBatches(
  stages: PipelineStage[],
  taskCount: number,
  expandFrom: string,
  batchSize: number = 3,
): PipelineStage[] {
  if (taskCount === 0) return stages;

  const expandIdx = stages.findIndex(s => s.agent === expandFrom || s.agent.includes(expandFrom));
  if (expandIdx < 0) return stages;

  const reviewerIdx = stages.findIndex((s, i) => i > expandIdx && (s.agent === 'reviewer' || s.agent.includes('review')));
  if (reviewerIdx < 0) return stages;

  const before = stages.slice(0, expandIdx);
  const builderTemplate = stages[expandIdx]!;
  const reviewerTemplate = stages[reviewerIdx]!;

  const batches: PipelineStage[] = [];
  for (let start = 1; start <= taskCount; start += batchSize) {
    const end = Math.min(start + batchSize - 1, taskCount);
    const scope = start === end ? `Task ${start}` : `Tasks ${start}-${end}`;

    batches.push({ ...builderTemplate, batchScope: scope });
    batches.push({ ...reviewerTemplate, batchScope: scope });
  }

  return [...before, ...batches];
}
