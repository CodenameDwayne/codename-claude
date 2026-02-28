#!/usr/bin/env node

import 'dotenv/config';
import { existsSync, readFileSync, openSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { sendCommand } from './ipc/client.js';
import { SOCKET_PATH_DEFAULT, PID_FILE_DEFAULT, LOG_FILE_DEFAULT } from './ipc/protocol.js';
import type { IpcResponse } from './ipc/protocol.js';
import type { ProjectEntry } from './state/projects.js';

const CODENAME_HOME = join(process.env['HOME'] ?? '~', '.codename-claude');
const BRAIN_TEMPLATE = join(CODENAME_HOME, 'templates', 'brain');

// --- Helpers ---

function die(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function isDaemonRunning(): boolean {
  if (!existsSync(PID_FILE_DEFAULT)) return false;
  try {
    const pid = parseInt(readFileSync(PID_FILE_DEFAULT, 'utf-8').trim(), 10);
    // Check if process exists (signal 0 just checks, doesn't send a signal)
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getDaemonPid(): number | null {
  if (!existsSync(PID_FILE_DEFAULT)) return null;
  try {
    return parseInt(readFileSync(PID_FILE_DEFAULT, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

async function send(command: Parameters<typeof sendCommand>[1]): Promise<IpcResponse> {
  try {
    return await sendCommand(SOCKET_PATH_DEFAULT, command);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

// --- Commands ---

async function cmdStart(): Promise<void> {
  if (isDaemonRunning()) {
    console.log('Daemon is already running (PID: %d)', getDaemonPid());
    return;
  }

  console.log('Starting Codename Claude daemon...');

  // Spawn daemon as detached background process
  const logFile = LOG_FILE_DEFAULT;
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');

  const daemonPath = join(import.meta.dirname, 'daemon.js');
  // Prefer the compiled JS; fall back to tsx for development
  const useCompiled = existsSync(daemonPath);

  const child = useCompiled
    ? spawn('node', [daemonPath], {
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env },
      })
    : spawn('npx', ['tsx', join(import.meta.dirname, 'daemon.ts')], {
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env },
      });

  child.unref();

  // Wait briefly for the daemon to start and write its PID file
  await new Promise((r) => setTimeout(r, 1500));

  if (isDaemonRunning()) {
    console.log('Daemon started (PID: %d)', getDaemonPid());
    console.log('Logs: %s', logFile);
  } else {
    console.error('Daemon failed to start. Check logs: %s', logFile);
    process.exit(1);
  }
}

async function cmdStop(): Promise<void> {
  if (!isDaemonRunning()) {
    console.log('Daemon is not running.');
    return;
  }

  const response = await send({ type: 'shutdown' });
  if (response.ok) {
    console.log('Shutdown signal sent. Daemon is stopping...');
    // Wait for PID file to disappear
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!isDaemonRunning()) {
        console.log('Daemon stopped.');
        return;
      }
    }
    console.log('Daemon may still be shutting down.');
  } else {
    die(`Shutdown failed: ${response.error}`);
  }
}

async function cmdStatus(): Promise<void> {
  if (!isDaemonRunning()) {
    console.log('Daemon is not running.');
    return;
  }

  const response = await send({ type: 'status' });
  if (!response.ok) {
    die(response.error);
  }

  const d = response.data as {
    pid: number;
    uptime: number;
    tickCount: number;
    heartbeatRunning: boolean;
    projects: number;
    triggers: number;
    budgetRemaining: number;
    budgetMax: number;
    queueSize: number;
  };

  console.log('=== Codename Claude Status ===');
  console.log(`  Status:    running`);
  console.log(`  PID:       ${d.pid}`);
  console.log(`  Uptime:    ${formatUptime(d.uptime)}`);
  console.log(`  Heartbeat: ${d.heartbeatRunning ? 'active' : 'stopped'} (${d.tickCount} ticks)`);
  console.log(`  Projects:  ${d.projects} registered`);
  console.log(`  Triggers:  ${d.triggers} registered`);
  console.log(`  Budget:    ${d.budgetRemaining}/${d.budgetMax} prompts remaining`);
  console.log(`  Queue:     ${d.queueSize} items pending`);
  console.log('==============================');
}

async function cmdRun(args: string[]): Promise<void> {
  // codename run scout [project] or codename run team [project] "task"
  const subCmd = args[0];
  if (!subCmd) {
    die('Usage: codename run <agent|team> [project] ["task"]');
  }

  if (subCmd === 'team') {
    const project = args[1];
    const task = args[2];
    if (!project || !task) {
      die('Usage: codename run team <project> "task description"');
    }
    const response = await send({
      type: 'run',
      agent: 'team-lead',
      project,
      task,
      mode: 'team',
    });
    if (response.ok) {
      const data = response.data as { agent: string; project: string };
      console.log(`Queued team pipeline for ${data.project}. The heartbeat will pick it up.`);
    } else {
      die(response.error);
    }
    return;
  }

  // Standalone agent run
  const agent = subCmd;
  const project = args[1];
  const task = args[2] ?? `Run ${agent} agent session`;
  if (!project) {
    die(`Usage: codename run ${agent} <project> ["task"]`);
  }

  const response = await send({
    type: 'run',
    agent,
    project,
    task,
    mode: 'standalone',
  });
  if (response.ok) {
    const data = response.data as { agent: string; project: string };
    console.log(`Queued ${data.agent} for ${data.project}. The heartbeat will pick it up.`);
  } else {
    die(response.error);
  }
}

async function cmdProjectsList(): Promise<void> {
  const response = await send({ type: 'projects-list' });
  if (!response.ok) die(response.error);

  const data = response.data as { projects: ProjectEntry[] };
  if (data.projects.length === 0) {
    console.log('No projects registered.');
    return;
  }

  console.log('Registered projects:\n');
  for (const p of data.projects) {
    console.log(`  ${p.name}`);
    console.log(`    Path:         ${p.path}`);
    console.log(`    Registered:   ${formatTimestamp(p.registered)}`);
    console.log(`    Last session: ${formatTimestamp(p.lastSession)}`);
    console.log('');
  }
}

async function cmdProjectsAdd(args: string[]): Promise<void> {
  const rawPath = args[0];
  if (!rawPath) {
    die('Usage: codename projects add <path> [name]');
  }
  const fullPath = resolve(rawPath);
  const name = args[1];

  // If template exists, copy .brain/ to the project
  if (existsSync(BRAIN_TEMPLATE) && !existsSync(join(fullPath, '.brain'))) {
    await cp(BRAIN_TEMPLATE, join(fullPath, '.brain'), { recursive: true });
    console.log(`Copied .brain/ template to ${fullPath}`);
  }

  const response = await send({ type: 'projects-add', path: fullPath, name });
  if (response.ok) {
    const data = response.data as { registered: ProjectEntry };
    console.log(`Registered: ${data.registered.name} (${data.registered.path})`);
  } else {
    die(response.error);
  }
}

async function cmdProjectsRemove(args: string[]): Promise<void> {
  const pathOrName = args[0];
  if (!pathOrName) {
    die('Usage: codename projects remove <path|name>');
  }

  const response = await send({ type: 'projects-remove', pathOrName });
  if (response.ok) {
    console.log(`Removed: ${pathOrName}`);
  } else {
    die(response.error);
  }
}

async function cmdLogs(): Promise<void> {
  const logFile = LOG_FILE_DEFAULT;
  if (!existsSync(logFile)) {
    console.log('No log file found at %s', logFile);
    return;
  }

  // Tail the last 50 lines, then follow
  console.log(`Tailing ${logFile} (Ctrl+C to stop)\n`);

  // Read last N lines first
  const lines: string[] = [];
  const rl = createInterface({ input: createReadStream(logFile) });
  for await (const line of rl) {
    lines.push(line);
    if (lines.length > 50) lines.shift();
  }
  for (const line of lines) {
    console.log(line);
  }

  // Then follow with tail -f
  const tail = spawn('tail', ['-f', logFile], { stdio: ['ignore', 'inherit', 'inherit'] });
  process.on('SIGINT', () => {
    tail.kill();
    process.exit(0);
  });
  // Keep alive
  await new Promise(() => {});
}

async function cmdQueue(): Promise<void> {
  const response = await send({ type: 'queue-list' });
  if (!response.ok) die(response.error);

  const data = response.data as { size: number; items: Array<{ triggerName: string; agent: string; project: string; enqueuedAt: number }> };
  if (data.size === 0) {
    console.log('Work queue is empty.');
    return;
  }

  console.log(`Work queue (${data.size} items):\n`);
  for (const item of data.items) {
    console.log(`  ${item.triggerName}`);
    console.log(`    Agent:    ${item.agent}`);
    console.log(`    Project:  ${item.project}`);
    console.log(`    Enqueued: ${formatTimestamp(item.enqueuedAt)}`);
    console.log('');
  }
}

async function cmdInteractive(args: string[]): Promise<void> {
  const project = args[0];
  if (!project) {
    die('Usage: codename interactive <project>');
  }

  // Resolve project path — check if daemon knows it, or use as-is
  let projectPath = resolve(project);
  if (isDaemonRunning()) {
    const response = await send({ type: 'projects-list' });
    if (response.ok) {
      const data = response.data as { projects: ProjectEntry[] };
      const found = data.projects.find((p) => p.name === project || p.path === project);
      if (found) projectPath = found.path;
    }
  }

  console.log(`Starting interactive Codename Claude session for: ${projectPath}`);
  console.log('(This runs in your terminal — you interact directly)\n');

  // Spawn claude directly in interactive mode with Codename Claude's identity
  const identityPrompt = join(CODENAME_HOME, 'identity', 'system-prompt.md');
  const claudeArgs = ['--system-prompt', identityPrompt, '-p', projectPath];

  const claude = spawn('claude', claudeArgs, {
    stdio: 'inherit',
    env: { ...process.env },
  });

  claude.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

// --- CLI Router ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`
Codename Claude CLI

Usage: codename <command> [options]

Commands:
  start                        Start the daemon
  stop                         Stop the daemon
  status                       Show daemon status
  run <agent> <project> [task] Run an agent on a project
  run team <project> "task"    Run a full team pipeline
  projects list                List registered projects
  projects add <path> [name]   Register a new project
  projects remove <path|name>  Unregister a project
  logs                         Tail daemon logs
  queue                        Show work queue
  interactive <project>        Start interactive session
`);
    return;
  }

  switch (command) {
    case 'start':
      await cmdStart();
      break;
    case 'stop':
      await cmdStop();
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'run':
      await cmdRun(args.slice(1));
      break;
    case 'projects': {
      const sub = args[1];
      if (sub === 'list' || !sub) {
        await cmdProjectsList();
      } else if (sub === 'add') {
        await cmdProjectsAdd(args.slice(2));
      } else if (sub === 'remove') {
        await cmdProjectsRemove(args.slice(2));
      } else {
        die(`Unknown projects subcommand: ${sub}`);
      }
      break;
    }
    case 'logs':
      await cmdLogs();
      break;
    case 'queue':
      await cmdQueue();
      break;
    case 'interactive':
      await cmdInteractive(args.slice(1));
      break;
    default:
      die(`Unknown command: ${command}. Run 'codename --help' for usage.`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
