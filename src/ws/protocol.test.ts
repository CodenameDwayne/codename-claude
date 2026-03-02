import { describe, it, expect } from 'vitest';
import { isValidWSEvent, type WSEvent, type AgentRole } from './protocol.js';

describe('WebSocket Protocol', () => {
  it('validates agent:active events', () => {
    const event: WSEvent = {
      type: 'agent:active',
      agent: 'scout',
      activity: 'researching',
    };
    expect(isValidWSEvent(event)).toBe(true);
  });

  it('validates handoff events', () => {
    const event: WSEvent = {
      type: 'handoff',
      from: 'scout',
      to: 'architect',
      artifact: 'research-doc',
    };
    expect(isValidWSEvent(event)).toBe(true);
  });

  it('validates verdict events', () => {
    const event: WSEvent = {
      type: 'verdict',
      verdict: 'approve',
      score: 9,
    };
    expect(isValidWSEvent(event)).toBe(true);
  });

  it('rejects unknown event types', () => {
    const event = { type: 'unknown' };
    expect(isValidWSEvent(event as WSEvent)).toBe(false);
  });

  it('exports all AgentRole values', () => {
    const roles: AgentRole[] = ['scout', 'architect', 'builder', 'reviewer'];
    expect(roles).toHaveLength(4);
  });
});
