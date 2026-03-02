import { describe, it, expect, vi } from 'vitest';
import { formatNotification, createNotificationHandler, type NotificationSender } from './macos.js';
import type { PipelineEvent } from './events.js';

describe('formatNotification', () => {
  it('formats session.started events', () => {
    const event: PipelineEvent = {
      type: 'session.started',
      project: '/home/user/my-project',
      agent: 'scout',
      task: 'Research CLI frameworks for Node.js',
      timestamp: 1000,
    };
    const result = formatNotification(event);
    expect(result).toEqual({
      title: 'Codename Claude',
      message: 'scout started on my-project',
      subtitle: 'Research CLI frameworks for Node.js',
    });
  });

  it('formats session.completed events with verdict', () => {
    const result = formatNotification({
      type: 'session.completed',
      project: '/home/user/my-project',
      agent: 'reviewer',
      sessionId: 'abc-123',
      verdict: 'APPROVE',
      score: 8,
      timestamp: 1000,
    });
    expect(result?.message).toContain('APPROVE');
  });

  it('formats review.escalated events', () => {
    const result = formatNotification({
      type: 'review.escalated',
      project: '/home/user/my-project',
      taskTitle: 'Add auth middleware',
      verdict: 'REVISE',
      score: 4,
      issueCount: 3,
      timestamp: 1000,
    });
    expect(result?.title).toContain('Escalated');
    expect(result?.message).toContain('REVISE');
  });

  it('formats budget.low events', () => {
    const result = formatNotification({
      type: 'budget.low',
      remaining: 90,
      max: 600,
      percent: 15,
      timestamp: 1000,
    });
    expect(result?.title).toContain('Budget');
    expect(result?.message).toContain('15%');
  });

  it('formats pipeline.stalled events', () => {
    const result = formatNotification({
      type: 'pipeline.stalled',
      project: '/home/user/my-project',
      task: 'Build feature X',
      stalledMinutes: 35,
      timestamp: 1000,
    });
    expect(result?.title).toContain('Stalled');
  });

  it('returns null for pipeline.started (not user-facing)', () => {
    const result = formatNotification({
      type: 'pipeline.started',
      project: '/tmp',
      task: 'x',
      stages: ['scout'],
      timestamp: 1000,
    });
    expect(result).toBeNull();
  });
});

describe('createNotificationHandler', () => {
  it('sends notifications for configured event types', () => {
    const sender: NotificationSender = vi.fn();
    const handler = createNotificationHandler({ enabled: true, events: ['session.started'] }, sender);

    handler({
      type: 'session.started',
      project: '/tmp/proj',
      agent: 'scout',
      task: 'research',
      timestamp: 1000,
    });

    expect(sender).toHaveBeenCalledOnce();
  });

  it('skips events not in the configured list', () => {
    const sender: NotificationSender = vi.fn();
    const handler = createNotificationHandler({ enabled: true, events: ['budget.low'] }, sender);

    handler({
      type: 'session.started',
      project: '/tmp',
      agent: 'scout',
      task: 'x',
      timestamp: 1000,
    });

    expect(sender).not.toHaveBeenCalled();
  });

  it('skips all events when disabled', () => {
    const sender: NotificationSender = vi.fn();
    const handler = createNotificationHandler({ enabled: false, events: ['session.started'] }, sender);

    handler({
      type: 'session.started',
      project: '/tmp',
      agent: 'scout',
      task: 'x',
      timestamp: 1000,
    });

    expect(sender).not.toHaveBeenCalled();
  });
});
