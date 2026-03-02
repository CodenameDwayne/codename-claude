import type { WSEvent } from '../ws/types';

/**
 * Generates a sequence of simulated pipeline events for demo mode.
 * Returns events with relative delays in ms.
 */
export function* demoPipeline(): Generator<{ event: WSEvent; delayMs: number }> {
  // Pipeline starts
  yield { delayMs: 1000, event: { type: 'pipeline:start', taskDescription: 'Add user authentication' } };

  // Scout researches
  yield { delayMs: 500, event: { type: 'agent:active', agent: 'scout', activity: 'researching' } };
  yield { delayMs: 4000, event: { type: 'agent:idle', agent: 'scout' } };
  yield { delayMs: 200, event: { type: 'handoff', from: 'scout', to: 'architect', artifact: 'research-doc' } };

  // Architect plans
  yield { delayMs: 2000, event: { type: 'agent:active', agent: 'architect', activity: 'planning' } };
  yield { delayMs: 5000, event: { type: 'agent:idle', agent: 'architect' } };
  yield { delayMs: 200, event: { type: 'handoff', from: 'architect', to: 'builder', artifact: 'plan' } };

  // Builder codes
  yield { delayMs: 2000, event: { type: 'agent:active', agent: 'builder', activity: 'coding' } };
  yield { delayMs: 6000, event: { type: 'agent:idle', agent: 'builder' } };
  yield { delayMs: 200, event: { type: 'handoff', from: 'builder', to: 'reviewer', artifact: 'code' } };

  // Reviewer reviews — first pass: revise
  yield { delayMs: 2000, event: { type: 'agent:active', agent: 'reviewer', activity: 'reviewing' } };
  yield { delayMs: 3000, event: { type: 'verdict', verdict: 'revise', score: 6 } };
  yield { delayMs: 200, event: { type: 'agent:idle', agent: 'reviewer' } };
  yield { delayMs: 200, event: { type: 'handoff', from: 'reviewer', to: 'builder', artifact: 'feedback' } };

  // Builder fixes
  yield { delayMs: 2000, event: { type: 'agent:active', agent: 'builder', activity: 'coding' } };
  yield { delayMs: 4000, event: { type: 'agent:idle', agent: 'builder' } };
  yield { delayMs: 200, event: { type: 'handoff', from: 'builder', to: 'reviewer', artifact: 'code' } };

  // Reviewer approves
  yield { delayMs: 2000, event: { type: 'agent:active', agent: 'reviewer', activity: 'reviewing' } };
  yield { delayMs: 3000, event: { type: 'verdict', verdict: 'approve', score: 9 } };
  yield { delayMs: 200, event: { type: 'agent:idle', agent: 'reviewer' } };

  // Pipeline complete
  yield { delayMs: 1000, event: { type: 'pipeline:end', result: 'success' } };
}

export class DemoRunner {
  private timeoutIds: ReturnType<typeof setTimeout>[] = [];
  private running = false;

  start(pushEvent: (event: WSEvent) => void): void {
    this.stop();
    this.running = true;

    const runLoop = () => {
      if (!this.running) return;

      let totalDelay = 0;
      const gen = demoPipeline();

      for (const { event, delayMs } of gen) {
        totalDelay += delayMs;
        const id = setTimeout(() => {
          if (this.running) pushEvent(event);
        }, totalDelay);
        this.timeoutIds.push(id);
      }

      // Loop: restart after pipeline completes + pause
      const restartId = setTimeout(() => {
        if (this.running) runLoop();
      }, totalDelay + 5000);
      this.timeoutIds.push(restartId);
    };

    runLoop();
  }

  stop(): void {
    this.running = false;
    for (const id of this.timeoutIds) {
      clearTimeout(id);
    }
    this.timeoutIds = [];
  }
}
