// pixel-agents/src/hooks/useMissionControl.ts
import { useRef, useMemo } from 'react';
import type { WSEvent, AgentRole, AgentActivity } from '../ws/types';

export type StageStatus = 'idle' | 'active' | 'done' | 'waiting' | 'failed';

export interface PipelineStage {
  role: AgentRole;
  status: StageStatus;
  activity: AgentActivity;
  taskProgress?: { current: number; total: number };
}

export interface VerdictInfo {
  verdict: 'approve' | 'revise' | 'redesign';
  score: number;
}

export interface TaskItem {
  index: number;
  label: string;
  status: 'pending' | 'current' | 'done';
}

export interface MissionControlState {
  phase: string;
  stages: PipelineStage[];
  tasks: TaskItem[];
  currentTaskIndex: number;
  totalTasks: number;
  lastVerdict: VerdictInfo | null;
  budget: { used: number; limit: number };
  uptime: number;
  taskDescription: string;
}

const ROLES: AgentRole[] = ['scout', 'architect', 'builder', 'reviewer'];

function createInitialState(): MissionControlState {
  return {
    phase: 'idle',
    stages: ROLES.map((role) => ({
      role,
      status: 'idle' as StageStatus,
      activity: 'idle' as AgentActivity,
    })),
    tasks: [],
    currentTaskIndex: -1,
    totalTasks: 0,
    lastVerdict: null,
    budget: { used: 0, limit: 600 },
    uptime: 0,
    taskDescription: '',
  };
}

export function useMissionControl(events: WSEvent[]): MissionControlState {
  const stateRef = useRef<MissionControlState>(createInitialState());
  const processedCount = useRef(0);

  // Process only new events since last render
  const newEvents = events.slice(processedCount.current);
  if (newEvents.length > 0) {
    const s = stateRef.current;
    for (const event of newEvents) {
      switch (event.type) {
        case 'agent:active': {
          const stage = s.stages.find((st) => st.role === event.agent);
          if (stage) {
            stage.status = 'active';
            stage.activity = event.activity;
          }
          break;
        }
        case 'agent:idle': {
          const stage = s.stages.find((st) => st.role === event.agent);
          if (stage) {
            // Mark as done if it was active, otherwise idle
            stage.status = stage.status === 'active' ? 'done' : 'idle';
            stage.activity = 'idle';
          }
          break;
        }
        case 'handoff': {
          const toStage = s.stages.find((st) => st.role === event.to);
          if (toStage) toStage.status = 'waiting';
          break;
        }
        case 'verdict':
          s.lastVerdict = { verdict: event.verdict, score: event.score };
          break;
        case 'task:progress': {
          s.currentTaskIndex = event.taskIndex;
          s.totalTasks = event.total;
          // Build task list
          const tasks: TaskItem[] = [];
          for (let i = 0; i < event.total; i++) {
            tasks.push({
              index: i,
              label: i === event.taskIndex ? event.label : s.tasks[i]?.label ?? `Task ${i + 1}`,
              status: i < event.taskIndex ? 'done' : i === event.taskIndex ? 'current' : 'pending',
            });
          }
          s.tasks = tasks;
          // Update builder stage progress
          const builderStage = s.stages.find((st) => st.role === 'builder');
          if (builderStage) {
            builderStage.taskProgress = { current: event.taskIndex + 1, total: event.total };
          }
          break;
        }
        case 'heartbeat':
          s.budget = event.budget;
          s.uptime = event.uptime;
          break;
        case 'pipeline:start':
          // Reset state for new pipeline run
          Object.assign(s, createInitialState());
          s.phase = 'running';
          s.taskDescription = event.taskDescription;
          break;
        case 'pipeline:end':
          s.phase = event.result === 'success' ? 'completed' : 'failed';
          if (event.result === 'failure') {
            for (const stage of s.stages) {
              if (stage.status === 'active') stage.status = 'failed';
            }
          }
          break;
        case 'state:snapshot':
          for (const [role, activity] of Object.entries(event.agents)) {
            const stage = s.stages.find((st) => st.role === role);
            if (stage) {
              stage.activity = activity;
              stage.status = activity === 'idle' ? 'idle' : 'active';
            }
          }
          if (event.pipeline) {
            s.taskDescription = event.pipeline.task;
            s.phase = event.pipeline.phase;
            s.currentTaskIndex = event.pipeline.taskIndex;
            s.totalTasks = event.pipeline.totalTasks;
          }
          break;
      }
    }
    processedCount.current = events.length;
  }

  // Return a shallow copy so React detects changes
  return useMemo(() => ({ ...stateRef.current }), [events.length]);
}
