// IPC Protocol — shared types for daemon <-> CLI communication over Unix socket.
// Messages are newline-delimited JSON.

export type IpcCommand =
  | { type: 'status' }
  | { type: 'run'; agent: string; project: string; task: string; mode: 'standalone' | 'team' }
  | { type: 'projects-list' }
  | { type: 'projects-add'; path: string; name?: string }
  | { type: 'projects-remove'; pathOrName: string }
  | { type: 'queue-list' }
  | { type: 'sessions-list' }
  | { type: 'sessions-active' }
  | { type: 'shutdown' };

export type IpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const SOCKET_PATH_DEFAULT = (() => {
  const home = process.env['HOME'] ?? '~';
  return `${home}/.codename-claude/daemon.sock`;
})();

export const PID_FILE_DEFAULT = (() => {
  const home = process.env['HOME'] ?? '~';
  return `${home}/.codename-claude/daemon.pid`;
})();

export const LOG_FILE_DEFAULT = (() => {
  const home = process.env['HOME'] ?? '~';
  return `${home}/.codename-claude/daemon.log`;
})();
