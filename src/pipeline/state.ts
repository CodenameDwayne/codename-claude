import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface StageState {
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  sessionId?: string;
  validation?: 'passed' | string;
  batchScope?: string;
}

export interface PipelineState {
  project: string;
  task: string;
  pipeline: string[];
  status: 'running' | 'completed' | 'failed' | 'stalled';
  currentStage: number;
  startedAt: number;
  updatedAt: number;
  stages: StageState[];
  retries: number;
  finalVerdict?: string;
  error?: string;
}

function statePath(projectDir: string): string {
  return join(projectDir, '.brain', 'pipeline-state.json');
}

export async function readPipelineState(projectDir: string): Promise<PipelineState | null> {
  try {
    const raw = await readFile(statePath(projectDir), 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch {
    return null;
  }
}

export async function writePipelineState(projectDir: string, state: PipelineState): Promise<void> {
  const path = statePath(projectDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2));
}

export interface ReviewOutput {
  verdict: 'APPROVE' | 'REVISE' | 'REDESIGN';
  score: number;
  summary: string;
  issues: Array<{
    severity: 'major' | 'minor' | 'nit';
    description: string;
    file?: string;
  }>;
  patternsCompliance: boolean;
}

export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'REVISE', 'REDESIGN'] },
    score: { type: 'number', minimum: 1, maximum: 10 },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['major', 'minor', 'nit'] },
          description: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['severity', 'description'],
      },
    },
    patternsCompliance: { type: 'boolean' },
  },
  required: ['verdict', 'score', 'summary', 'issues', 'patternsCompliance'],
} as const;

export async function updateStageStatus(
  projectDir: string,
  stageIndex: number,
  update: Partial<StageState>,
): Promise<void> {
  const state = await readPipelineState(projectDir);
  if (!state) throw new Error('No pipeline state to update');

  const stage = state.stages[stageIndex];
  if (!stage) throw new Error(`Stage ${stageIndex} not found`);

  Object.assign(stage, update);
  state.updatedAt = Date.now();
  await writePipelineState(projectDir, state);
}
