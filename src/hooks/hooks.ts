import type {
  HookCallback,
  HookInput,
  HookJSONOutput,
  PostToolUseHookInput,
  SessionEndHookInput,
  TeammateIdleHookInput,
  TaskCompletedHookInput,
  ExitReason,
} from '@anthropic-ai/claude-agent-sdk';

export type HookLogger = (message: string) => void;

export type SessionEndCallback = (info: {
  sessionId: string;
  reason: ExitReason;
  cwd: string;
}) => void | Promise<void>;

export type TeammateIdleCallback = (info: {
  teammateName: string;
  teamName: string;
}) => void | Promise<void>;

export type TaskCompletedCallback = (info: {
  taskId: string;
  taskSubject: string;
  teammateName?: string;
  teamName?: string;
}) => void | Promise<void>;

/**
 * Create a PostToolUse hook that logs tool activity.
 * Flags non-zero Bash exit codes for the learning loop.
 */
export function createPostToolUseHook(logger: HookLogger): HookCallback {
  return async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'PostToolUse') return { continue: true };
    const ptInput = input as PostToolUseHookInput;

    const { tool_name, tool_input } = ptInput;
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
      const response = ptInput.tool_response as Record<string, unknown> | undefined;
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
export function createSessionEndHook(onSessionEnd: SessionEndCallback): HookCallback {
  return async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'SessionEnd') return { continue: true };
    const seInput = input as SessionEndHookInput;

    await onSessionEnd({
      sessionId: seInput.session_id,
      reason: seInput.reason,
      cwd: seInput.cwd,
    });

    return { continue: true };
  };
}

/**
 * Create a TeammateIdle hook that logs when a teammate becomes idle.
 * Only fires in team mode sessions.
 */
export function createTeammateIdleHook(
  logger: HookLogger,
  onTeammateIdle?: TeammateIdleCallback,
): HookCallback {
  return async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'TeammateIdle') return { continue: true };
    const tiInput = input as TeammateIdleHookInput;

    logger(`[hook:teammate-idle] ${tiInput.teammate_name} in team ${tiInput.team_name} is idle`);

    if (onTeammateIdle) {
      await onTeammateIdle({
        teammateName: tiInput.teammate_name,
        teamName: tiInput.team_name,
      });
    }

    return { continue: true };
  };
}

/**
 * Create a TaskCompleted hook that logs when a task is completed.
 * Only fires in team mode sessions.
 */
export function createTaskCompletedHook(
  logger: HookLogger,
  onTaskCompleted?: TaskCompletedCallback,
): HookCallback {
  return async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== 'TaskCompleted') return { continue: true };
    const tcInput = input as TaskCompletedHookInput;

    const by = tcInput.teammate_name ? ` by ${tcInput.teammate_name}` : '';
    logger(`[hook:task-completed] "${tcInput.task_subject}"${by} (task ${tcInput.task_id})`);

    if (onTaskCompleted) {
      await onTaskCompleted({
        taskId: tcInput.task_id,
        taskSubject: tcInput.task_subject,
        teammateName: tcInput.teammate_name,
        teamName: tcInput.team_name,
      });
    }

    return { continue: true };
  };
}
