import { WebSocketServer, type WebSocket } from 'ws';
import type { EventBus, PipelineEvent } from '../notifications/events.js';
import type { WSEvent, AgentRole, AgentActivity } from './protocol.js';

interface WSBridgeConfig {
  port: number;
}

export class WSBridgeServer {
  private wss: WebSocketServer | null = null;
  private eventHandler: ((event: PipelineEvent) => void) | null = null;
  private agentStates: Record<AgentRole, AgentActivity> = {
    scout: 'idle',
    architect: 'idle',
    builder: 'idle',
    reviewer: 'idle',
  };
  private currentPipeline: { task: string; phase: string; taskIndex: number; totalTasks: number } | null = null;

  constructor(
    private eventBus: EventBus,
    private config: WSBridgeConfig,
    private log: (msg: string) => void,
  ) {}

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.config.port });

      this.wss.on('listening', () => {
        const addr = this.wss!.address();
        const port = typeof addr === 'object' ? addr.port : this.config.port;
        this.log(`[ws] listening on port ${port}`);
        resolve(port);
      });

      this.wss.on('error', reject);

      this.wss.on('connection', (ws) => {
        this.log('[ws] client connected');
        // Send current state snapshot
        const snapshot: WSEvent = {
          type: 'state:snapshot',
          agents: { ...this.agentStates },
          pipeline: this.currentPipeline,
        };
        ws.send(JSON.stringify(snapshot));
      });

      // Subscribe to EventBus and translate events
      this.eventHandler = (event: PipelineEvent) => {
        const wsEvents = this.translateEvent(event);
        for (const wsEvent of wsEvents) {
          this.broadcast(wsEvent);
        }
      };
      this.eventBus.on('*', this.eventHandler);
    });
  }

  async stop(): Promise<void> {
    if (this.eventHandler) {
      this.eventBus.off('*', this.eventHandler);
      this.eventHandler = null;
    }
    if (this.wss) {
      // Close all clients
      for (const client of this.wss.clients) {
        client.close();
      }
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }
  }

  private broadcast(event: WSEvent): void {
    if (!this.wss) return;
    const data = JSON.stringify(event);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    }
  }

  private translateEvent(event: PipelineEvent): WSEvent[] {
    const events: WSEvent[] = [];

    switch (event.type) {
      case 'session.started': {
        const agent = this.toAgentRole(event.agent);
        if (agent) {
          const activity = this.agentToActivity(agent);
          this.agentStates[agent] = activity;
          events.push({ type: 'agent:active', agent, activity });
        }
        break;
      }

      case 'session.completed': {
        const agent = this.toAgentRole(event.agent);
        if (agent) {
          this.agentStates[agent] = 'idle';
          events.push({ type: 'agent:idle', agent });

          // If reviewer completed with verdict, emit verdict + handoff
          if (event.verdict) {
            const verdict = event.verdict.toLowerCase() as 'approve' | 'revise' | 'redesign';
            events.push({ type: 'verdict', verdict, score: event.score ?? 0 });

            if (verdict === 'revise') {
              events.push({ type: 'handoff', from: 'reviewer', to: 'builder', artifact: 'feedback' });
            } else if (verdict === 'redesign') {
              events.push({ type: 'handoff', from: 'reviewer', to: 'architect', artifact: 'redesign-request' });
            }
          }

          // Generate handoff for normal pipeline flow
          if (agent === 'scout') {
            events.push({ type: 'handoff', from: 'scout', to: 'architect', artifact: 'research-doc' });
          } else if (agent === 'architect') {
            events.push({ type: 'handoff', from: 'architect', to: 'builder', artifact: 'plan' });
          } else if (agent === 'builder' && !event.verdict) {
            events.push({ type: 'handoff', from: 'builder', to: 'reviewer', artifact: 'code' });
          }
        }
        break;
      }

      case 'pipeline.started':
        this.currentPipeline = {
          task: event.task,
          phase: event.stages[0] ?? 'unknown',
          taskIndex: 0,
          totalTasks: 0,
        };
        events.push({ type: 'pipeline:start', taskDescription: event.task });
        break;

      case 'pipeline.completed':
        this.currentPipeline = null;
        events.push({ type: 'pipeline:end', result: event.success ? 'success' : 'failure' });
        // Reset all agents to idle
        for (const role of ['scout', 'architect', 'builder', 'reviewer'] as const) {
          this.agentStates[role] = 'idle';
        }
        break;

      case 'review.escalated':
        // Escalation events are already covered by session.completed translation
        break;

      case 'budget.low':
        events.push({
          type: 'heartbeat',
          uptime: 0,
          budget: { used: event.max - event.remaining, limit: event.max },
        });
        break;

      case 'pipeline.stalled':
        // Could add a stalled event in the future
        break;
    }

    return events;
  }

  private toAgentRole(agent: string): AgentRole | null {
    const roles: AgentRole[] = ['scout', 'architect', 'builder', 'reviewer'];
    return roles.includes(agent as AgentRole) ? (agent as AgentRole) : null;
  }

  private agentToActivity(agent: AgentRole): AgentActivity {
    switch (agent) {
      case 'scout': return 'researching';
      case 'architect': return 'planning';
      case 'builder': return 'coding';
      case 'reviewer': return 'reviewing';
    }
  }
}
