import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventBus, type PipelineEvent } from './events.js';
import { createNotificationHandler, type NotificationSender } from './macos.js';
import { SessionTracker } from './sessions.js';
import { PipelineEngine, type PipelineRunnerFn } from '../pipeline/engine.js';

const TEST_DIR = join(import.meta.dirname, '..', '..', '.test-integration');

async function makeTempProject(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = join(TEST_DIR, `proj-${Date.now()}`);
  await mkdir(join(dir, '.brain'), { recursive: true });
  await writeFile(join(dir, '.brain', 'PROJECT.md'), '# Test Project\n\nA test project for integration.');
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe('Notifications integration', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('full pipeline emits events that trigger notifications and track sessions', async () => {
    const { dir, cleanup } = await makeTempProject();

    try {
      await writeFile(join(dir, '.brain', 'PLAN.md'), '# Plan\n\n- [ ] Build the widget\n');

      const runner: PipelineRunnerFn = vi.fn(async (role: string, _proj: string, _task: string) => {
        if (role === 'builder' || role.includes('build')) {
          await writeFile(join(dir, 'widget.ts'), 'export const widget = true;');
          const plan = '# Plan\n\n- [x] Build the widget\n';
          await writeFile(join(dir, '.brain', 'PLAN.md'), plan);
          return { agentName: 'Builder', sandboxed: false, mode: 'standalone' as const, turnCount: 5, sessionId: 'sess-builder-1' };
        }
        return {
          agentName: 'Reviewer', sandboxed: false, mode: 'standalone' as const, turnCount: 3,
          sessionId: 'sess-reviewer-1',
          structuredOutput: { verdict: 'APPROVE', score: 9, summary: 'Great', issues: [], patternsCompliance: true },
        };
      });

      // Wire everything like the daemon does
      const eventBus = new EventBus();
      const allEvents: PipelineEvent[] = [];
      eventBus.on('*', (e) => allEvents.push(e));

      const sender: NotificationSender = vi.fn();
      const notifyHandler = createNotificationHandler(
        { enabled: true, events: ['session.started', 'session.completed', 'pipeline.completed'] },
        sender,
      );
      eventBus.on('*', notifyHandler);

      const sessionTracker = new SessionTracker(join(TEST_DIR, 'sessions.json'));
      eventBus.on('session.completed', (event) => {
        if (event.type === 'session.completed' && event.sessionId) {
          sessionTracker.startSession(event.sessionId, event.project, event.agent, 'test');
          sessionTracker.completeSession(event.sessionId, event.verdict);
        }
      });

      const engine = new PipelineEngine({ runner, log: () => {}, eventBus });
      const result = await engine.run({
        stages: [{ agent: 'builder', teams: false }, { agent: 'reviewer', teams: false }],
        project: dir,
        task: 'Build the widget',
      });

      // Pipeline completed
      expect(result.completed).toBe(true);

      // Events were emitted
      const eventTypes = allEvents.map(e => e.type);
      expect(eventTypes).toContain('pipeline.started');
      expect(eventTypes).toContain('session.started');
      expect(eventTypes).toContain('session.completed');
      expect(eventTypes).toContain('pipeline.completed');

      // Notifications were sent
      expect(sender).toHaveBeenCalled();
      const calls = (sender as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(3);

      // Sessions were tracked
      const recent = sessionTracker.getRecent();
      expect(recent.length).toBeGreaterThanOrEqual(1);
      const builderSession = recent.find(s => s.sessionId === 'sess-builder-1');
      expect(builderSession).toBeDefined();
      expect(builderSession?.status).toBe('completed');
    } finally {
      await cleanup();
    }
  });
});
