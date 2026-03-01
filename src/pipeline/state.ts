import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface TaskProgress {
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  attempts: number;
  lastVerdict?: string;
  lastSessionId?: string;
  completedAt?: number;
}

export interface PipelineState {
  project: string;
  task: string;
  /** Agents that ran before the Ralph loop (e.g. ['scout', 'architect']). */
  agentPipeline: string[];
  status: 'running' | 'completed' | 'failed' | 'stalled';
  /** Current phase: 'scouting' | 'planning' | 'building' | 'completed' | 'failed'. */
  phase: string;
  startedAt: number;
  updatedAt: number;
  tasks: TaskProgress[];
  currentTaskIndex: number;
  totalIterations: number;
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
    severity: 'critical' | 'major' | 'minor' | 'nit';
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
          severity: { type: 'string', enum: ['critical', 'major', 'minor', 'nit'] },
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
