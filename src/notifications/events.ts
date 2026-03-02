import { EventEmitter } from 'node:events';

export type PipelineEvent =
  | { type: 'session.started'; project: string; agent: string; sessionId?: string; task: string; timestamp: number }
  | { type: 'session.completed'; project: string; agent: string; sessionId?: string; verdict?: string; score?: number; timestamp: number }
  | { type: 'pipeline.started'; project: string; task: string; stages: string[]; timestamp: number }
  | { type: 'pipeline.completed'; project: string; task: string; success: boolean; timestamp: number }
  | { type: 'review.escalated'; project: string; taskTitle: string; verdict: string; score?: number; issueCount?: number; timestamp: number }
  | { type: 'budget.low'; remaining: number; max: number; percent: number; timestamp: number }
  | { type: 'pipeline.stalled'; project: string; task: string; stalledMinutes: number; timestamp: number };

export class EventBus {
  private emitter = new EventEmitter();

  emit(event: PipelineEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }

  on(type: PipelineEvent['type'] | '*', handler: (event: PipelineEvent) => void): void {
    this.emitter.on(type, handler);
  }

  off(type: PipelineEvent['type'] | '*', handler: (event: PipelineEvent) => void): void {
    this.emitter.off(type, handler);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
