import type {
  PostToolUseHookInput,
  SessionEndHookInput,
  HookJSONOutput,
  ExitReason,
} from '@anthropic-ai/claude-agent-sdk';

export type HookLogger = (message: string) => void;

export type SessionEndCallback = (info: {
  sessionId: string;
  reason: ExitReason;
  cwd: string;
}) => void | Promise<void>;

type HookOptions = { abortSignal: AbortSignal };

/**
 * Create a PostToolUse hook that logs tool activity.
 * Flags non-zero Bash exit codes for the learning loop.
 */
export function createPostToolUseHook(
  logger: HookLogger,
): (input: PostToolUseHookInput, toolUseId: string | undefined, options: HookOptions) => Promise<HookJSONOutput> {
  return async (input) => {
    const { tool_name, tool_input } = input;
    const inputObj = tool_input as Record<string, unknown>;

    // Build a human-readable summary
    let summary: string;
    if (tool_name === 'Write' || tool_name === 'Edit' || tool_name === 'Read') {
      const filePath = inputObj['file_path'] ?? inputObj['path'] ?? 'unknown';
      summary = `${tool_name}: ${filePath}`;
    } else if (tool_name === 'Bash') {
      const cmd = String(inputObj['command'] ?? '').slice(0, 80);
      summary = `Bash: ${cmd}`;
    } else if (tool_name === 'Glob') {
      summary = `Glob: ${inputObj['pattern'] ?? 'unknown'}`;
    } else if (tool_name === 'Grep') {
      summary = `Grep: ${inputObj['pattern'] ?? 'unknown'}`;
    } else {
      summary = tool_name;
    }

    logger(`[hook:post-tool] ${summary}`);

    // Flag non-zero Bash exit codes
    if (tool_name === 'Bash') {
      const response = input.tool_response as Record<string, unknown> | undefined;
      if (response && typeof response['exitCode'] === 'number' && response['exitCode'] !== 0) {
        logger(`[hook:post-tool] WARNING: Bash non-zero exit code ${response['exitCode']}`);
      }
    }

    return { continue: true };
  };
}

/**
 * Create a SessionEnd hook that fires a callback with session metadata.
 * Used to update project registry, check for session summaries, etc.
 */
export function createSessionEndHook(
  onSessionEnd: SessionEndCallback,
): (input: SessionEndHookInput, toolUseId: string | undefined, options: HookOptions) => Promise<HookJSONOutput> {
  return async (input) => {
    await onSessionEnd({
      sessionId: input.session_id,
      reason: input.reason,
      cwd: input.cwd,
    });

    return { continue: true };
  };
}
