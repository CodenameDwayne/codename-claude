import { describe, test, expect, vi } from 'vitest';
import {
  createPostToolUseHook,
  createSessionEndHook,
  type HookLogger,
  type SessionEndCallback,
} from './hooks.js';

function fakeBaseInput(overrides = {}) {
  return {
    session_id: 'test-session-123',
    transcript_path: '/tmp/transcript',
    cwd: '/Users/test/project',
    ...overrides,
  };
}

describe('createPostToolUseHook', () => {
  test('logs tool name and input summary for Write tool', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createPostToolUseHook(logger);

    const result = await hook(
      {
        ...fakeBaseInput(),
        hook_event_name: 'PostToolUse' as const,
        tool_name: 'Write',
        tool_input: { file_path: '/project/.brain/RESEARCH/2026-02-27.md', content: '...' },
        tool_response: 'File written',
        tool_use_id: 'tu-1',
      },
      'tu-1',
      { abortSignal: new AbortController().signal },
    );

    expect(logs[0]).toContain('Write');
    expect(logs[0]).toContain('.brain/RESEARCH/2026-02-27.md');
    expect(result).toHaveProperty('continue', true);
  });

  test('logs Bash tool with exit code info when present', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createPostToolUseHook(logger);

    await hook(
      {
        ...fakeBaseInput(),
        hook_event_name: 'PostToolUse' as const,
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_response: { stdout: 'PASS', stderr: '', exitCode: 0 },
        tool_use_id: 'tu-2',
      },
      'tu-2',
      { abortSignal: new AbortController().signal },
    );

    expect(logs[0]).toContain('Bash');
    expect(logs[0]).toContain('npm test');
  });

  test('flags non-zero Bash exit codes', async () => {
    const logs: string[] = [];
    const logger: HookLogger = (msg) => logs.push(msg);
    const hook = createPostToolUseHook(logger);

    await hook(
      {
        ...fakeBaseInput(),
        hook_event_name: 'PostToolUse' as const,
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_response: { stdout: '', stderr: 'Error', exitCode: 1 },
        tool_use_id: 'tu-3',
      },
      'tu-3',
      { abortSignal: new AbortController().signal },
    );

    expect(logs.some((l) => l.includes('non-zero') || l.includes('exit'))).toBe(true);
  });
});

describe('createSessionEndHook', () => {
  test('calls the onSessionEnd callback with session info', async () => {
    const callback = vi.fn<SessionEndCallback>();
    const hook = createSessionEndHook(callback);

    await hook(
      {
        ...fakeBaseInput(),
        hook_event_name: 'SessionEnd' as const,
        reason: 'end_turn' as const,
      },
      undefined,
      { abortSignal: new AbortController().signal },
    );

    expect(callback).toHaveBeenCalledWith({
      sessionId: 'test-session-123',
      reason: 'end_turn',
      cwd: '/Users/test/project',
    });
  });

  test('returns continue: true', async () => {
    const callback = vi.fn<SessionEndCallback>();
    const hook = createSessionEndHook(callback);

    const result = await hook(
      {
        ...fakeBaseInput(),
        hook_event_name: 'SessionEnd' as const,
        reason: 'end_turn' as const,
      },
      undefined,
      { abortSignal: new AbortController().signal },
    );

    expect(result).toHaveProperty('continue', true);
  });
});
