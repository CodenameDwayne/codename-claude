import { describe, test, expect, vi } from 'vitest';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import {
  createPostToolUseHook,
  createSessionEndHook,
  createTeammateIdleHook,
  createTaskCompletedHook,
  type HookLogger,
  type SessionEndCallback,
  type TeammateIdleCallback,
  type TaskCompletedCallback,
} from './hooks.js';

const baseInput = {
  session_id: 'test-session-123',
  transcript_path: '/tmp/transcript',
  cwd: '/Users/test/project',
};

const hookOpts = { signal: new AbortController().signal };

describe('createPostToolUseHook', () => {
  test('logs tool name and input summary for Write tool', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createPostToolUseHook(logger);

    const input = {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/project/.brain/RESEARCH/2026-02-27.md', content: '...' },
      tool_response: 'File written',
      tool_use_id: 'tu-1',
    } as HookInput;

    const result = await hook(input, 'tu-1', hookOpts);

    expect(logs[0]).toContain('Write');
    expect(logs[0]).toContain('.brain/RESEARCH/2026-02-27.md');
    expect(result).toHaveProperty('continue', true);
  });

  test('logs Bash tool with command summary', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createPostToolUseHook(logger);

    const input = {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'PASS', stderr: '', exitCode: 0 },
      tool_use_id: 'tu-2',
    } as HookInput;

    await hook(input, 'tu-2', hookOpts);

    expect(logs[0]).toContain('Bash');
    expect(logs[0]).toContain('npm test');
  });

  test('flags non-zero Bash exit codes', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createPostToolUseHook(logger);

    const input = {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: '', stderr: 'Error', exitCode: 1 },
      tool_use_id: 'tu-3',
    } as HookInput;

    await hook(input, 'tu-3', hookOpts);

    expect(logs.some((l) => l.includes('non-zero') || l.includes('exit'))).toBe(true);
  });

  test('ignores non-PostToolUse events', async () => {
    const logs: string[] = [];
    const hook = createPostToolUseHook((msg) => logs.push(msg));

    const input = {
      ...baseInput,
      hook_event_name: 'SessionEnd',
      reason: 'other',
    } as HookInput;

    const result = await hook(input, undefined, hookOpts);
    expect(result).toHaveProperty('continue', true);
    expect(logs).toHaveLength(0);
  });
});

describe('createSessionEndHook', () => {
  test('calls the onSessionEnd callback with session info', async () => {
    const callback = vi.fn<SessionEndCallback>();
    const hook = createSessionEndHook(callback);

    const input = {
      ...baseInput,
      hook_event_name: 'SessionEnd',
      reason: 'other',
    } as HookInput;

    await hook(input, undefined, hookOpts);

    expect(callback).toHaveBeenCalledWith({
      sessionId: 'test-session-123',
      reason: 'other',
      cwd: '/Users/test/project',
    });
  });

  test('returns continue: true', async () => {
    const callback = vi.fn<SessionEndCallback>();
    const hook = createSessionEndHook(callback);

    const input = {
      ...baseInput,
      hook_event_name: 'SessionEnd',
      reason: 'other',
    } as HookInput;

    const result = await hook(input, undefined, hookOpts);
    expect(result).toHaveProperty('continue', true);
  });
});

describe('createTeammateIdleHook', () => {
  test('logs teammate idle event', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createTeammateIdleHook(logger);

    const input = {
      ...baseInput,
      hook_event_name: 'TeammateIdle',
      teammate_name: 'builder-1',
      team_name: 'feature-team',
    } as HookInput;

    const result = await hook(input, undefined, hookOpts);

    expect(logs[0]).toContain('builder-1');
    expect(logs[0]).toContain('feature-team');
    expect(result).toHaveProperty('continue', true);
  });

  test('calls optional callback with teammate info', async () => {
    const callback = vi.fn<TeammateIdleCallback>();
    const hook = createTeammateIdleHook(() => {}, callback);

    const input = {
      ...baseInput,
      hook_event_name: 'TeammateIdle',
      teammate_name: 'reviewer-1',
      team_name: 'review-team',
    } as HookInput;

    await hook(input, undefined, hookOpts);

    expect(callback).toHaveBeenCalledWith({
      teammateName: 'reviewer-1',
      teamName: 'review-team',
    });
  });

  test('ignores non-TeammateIdle events', async () => {
    const logs: string[] = [];
    const hook = createTeammateIdleHook((msg) => logs.push(msg));

    const input = {
      ...baseInput,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: {},
      tool_response: '',
      tool_use_id: 'tu-1',
    } as HookInput;

    await hook(input, undefined, hookOpts);
    expect(logs).toHaveLength(0);
  });
});

describe('createTaskCompletedHook', () => {
  test('logs task completed event', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createTaskCompletedHook(logger);

    const input = {
      ...baseInput,
      hook_event_name: 'TaskCompleted',
      task_id: 'task-42',
      task_subject: 'Implement OAuth flow',
      teammate_name: 'builder-1',
      team_name: 'feature-team',
    } as HookInput;

    const result = await hook(input, undefined, hookOpts);

    expect(logs[0]).toContain('Implement OAuth flow');
    expect(logs[0]).toContain('builder-1');
    expect(logs[0]).toContain('task-42');
    expect(result).toHaveProperty('continue', true);
  });

  test('handles task completed without teammate name', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createTaskCompletedHook(logger);

    const input = {
      ...baseInput,
      hook_event_name: 'TaskCompleted',
      task_id: 'task-1',
      task_subject: 'Setup project',
    } as HookInput;

    await hook(input, undefined, hookOpts);

    expect(logs[0]).toContain('Setup project');
    expect(logs[0]).not.toContain(' by ');
  });

  test('calls optional callback with task info', async () => {
    const callback = vi.fn<TaskCompletedCallback>();
    const hook = createTaskCompletedHook(() => {}, callback);

    const input = {
      ...baseInput,
      hook_event_name: 'TaskCompleted',
      task_id: 'task-99',
      task_subject: 'Write tests',
      teammate_name: 'builder-1',
      team_name: 'test-team',
    } as HookInput;

    await hook(input, undefined, hookOpts);

    expect(callback).toHaveBeenCalledWith({
      taskId: 'task-99',
      taskSubject: 'Write tests',
      teammateName: 'builder-1',
      teamName: 'test-team',
    });
  });

  test('ignores non-TaskCompleted events', async () => {
    const logs: string[] = [];
    const hook = createTaskCompletedHook((msg) => logs.push(msg));

    const input = {
      ...baseInput,
      hook_event_name: 'SessionEnd',
      reason: 'other',
    } as HookInput;

    await hook(input, undefined, hookOpts);
    expect(logs).toHaveLength(0);
  });
});
