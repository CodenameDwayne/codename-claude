export type AgentRole = 'scout' | 'architect' | 'builder' | 'reviewer';
export type AgentActivity = 'idle' | 'researching' | 'planning' | 'coding' | 'reviewing';

export type WSEvent =
  | { type: 'agent:active'; agent: AgentRole; activity: AgentActivity }
  | { type: 'agent:idle'; agent: AgentRole }
  | { type: 'handoff'; from: AgentRole; to: AgentRole; artifact: string }
  | { type: 'verdict'; verdict: 'approve' | 'revise' | 'redesign'; score: number }
  | { type: 'task:progress'; taskIndex: number; total: number; label: string }
  | { type: 'pipeline:start'; taskDescription: string }
  | { type: 'pipeline:end'; result: 'success' | 'failure' }
  | { type: 'heartbeat'; uptime: number; budget: { used: number; limit: number } }
  | { type: 'state:snapshot'; agents: Record<AgentRole, AgentActivity>; pipeline: PipelineSnapshot | null };

export interface PipelineSnapshot {
  task: string;
  phase: string;
  taskIndex: number;
  totalTasks: number;
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
