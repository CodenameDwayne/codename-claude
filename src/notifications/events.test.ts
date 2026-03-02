import { describe, it, expect, vi } from 'vitest';
import { EventBus, type PipelineEvent } from './events.js';

describe('EventBus', () => {
  it('delivers events to type-specific listeners', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('session.started', handler);

    const event: PipelineEvent = {
      type: 'session.started',
      project: '/tmp/test',
      agent: 'scout',
      task: 'research',
      timestamp: 1000,
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('delivers events to wildcard listeners', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('*', handler);

    bus.emit({ type: 'budget.low', remaining: 50, max: 600, percent: 8, timestamp: 1000 });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not deliver events to unrelated listeners', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('budget.low', handler);

    bus.emit({ type: 'session.started', project: '/tmp', agent: 'scout', task: 'x', timestamp: 1000 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('supports removing listeners', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('session.started', handler);
    bus.off('session.started', handler);

    bus.emit({ type: 'session.started', project: '/tmp', agent: 'scout', task: 'x', timestamp: 1000 });

    expect(handler).not.toHaveBeenCalled();
  });

  it('removeAllListeners clears everything', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('session.started', h1);
    bus.on('*', h2);
    bus.removeAllListeners();

    bus.emit({ type: 'session.started', project: '/tmp', agent: 'scout', task: 'x', timestamp: 1000 });

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });
});
