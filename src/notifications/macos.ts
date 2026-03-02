import { execFile } from 'node:child_process';
import type { PipelineEvent } from './events.js';

export interface NotificationConfig {
  enabled: boolean;
  events: string[];
}

export type NotificationSender = (title: string, message: string, subtitle?: string) => void;

export function formatNotification(
  event: PipelineEvent,
): { title: string; message: string; subtitle?: string } | null {
  switch (event.type) {
    case 'session.started':
      return {
        title: 'Codename Claude',
        message: `${event.agent} started on ${event.project.split('/').pop()}`,
        subtitle: event.task.slice(0, 60),
      };
    case 'session.completed':
      return {
        title: 'Codename Claude',
        message: `${event.agent} finished${event.verdict ? ` — ${event.verdict}` : ''}${event.score ? ` (${event.score}/10)` : ''}`,
        subtitle: event.project.split('/').pop(),
      };
    case 'review.escalated':
      return {
        title: 'Codename Claude — Review Escalated',
        message: `${event.verdict}: ${event.taskTitle}`,
        subtitle: event.score != null ? `Score: ${event.score}/10, ${event.issueCount ?? 0} issues` : undefined,
      };
    case 'budget.low':
      return {
        title: 'Codename Claude — Budget Low',
        message: `${event.percent}% remaining (${event.remaining}/${event.max})`,
      };
    case 'pipeline.stalled':
      return {
        title: 'Codename Claude — Stalled',
        message: `Pipeline stalled for ${event.stalledMinutes}m`,
        subtitle: event.project.split('/').pop(),
      };
    case 'pipeline.completed':
      return {
        title: 'Codename Claude',
        message: `Pipeline ${event.success ? 'completed' : 'failed'}: ${event.project.split('/').pop()}`,
      };
    default:
      return null;
  }
}

export function sendMacNotification(title: string, message: string, subtitle?: string): void {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = subtitle
    ? `display notification "${esc(message)}" with title "${esc(title)}" subtitle "${esc(subtitle)}"`
    : `display notification "${esc(message)}" with title "${esc(title)}"`;
  execFile('osascript', ['-e', script], () => {
    // Fire and forget — notification failure is non-fatal
  });
}

export function createNotificationHandler(
  config: NotificationConfig,
  sender: NotificationSender = sendMacNotification,
): (event: PipelineEvent) => void {
  return (event: PipelineEvent) => {
    if (!config.enabled) return;
    if (!config.events.includes(event.type)) return;

    const notification = formatNotification(event);
    if (notification) {
      sender(notification.title, notification.message, notification.subtitle);
    }
  };
}
