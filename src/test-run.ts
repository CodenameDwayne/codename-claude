/**
 * Manual test script for the agent runner.
 *
 * Usage:
 *   npx tsx src/test-run.ts <role> <project-name> "<task>"
 *   npx tsx src/test-run.ts --team <project-name> "<task>"
 *
 * Examples:
 *   npx tsx src/test-run.ts scout cc-test "Research CLI frameworks for Node.js"
 *   npx tsx src/test-run.ts --team cc-test "Build a hello world CLI command"
 */
import 'dotenv/config';
import { resolve } from 'node:path';
import { runAgent } from './agents/runner.js';
import {
  createPostToolUseHook,
  createSessionEndHook,
  createTeammateIdleHook,
  createTaskCompletedHook,
} from './hooks/hooks.js';

const args = process.argv.slice(2);

// Parse --team flag
const isTeamMode = args[0] === '--team';
const [role, projectName, task] = isTeamMode
  ? ['team-lead', args[1], args[2]]
  : args;

if (!projectName || !task) {
  console.error('Usage:');
  console.error('  npx tsx src/test-run.ts <role> <project-name> "<task>"');
  console.error('  npx tsx src/test-run.ts --team <project-name> "<task>"');
  console.error('');
  console.error('Examples:');
  console.error('  npx tsx src/test-run.ts scout cc-test "Research CLI frameworks"');
  console.error('  npx tsx src/test-run.ts --team cc-test "Build a hello world CLI"');
  process.exit(1);
}

const projectPath = resolve(process.env['HOME'] ?? '~', 'Projects', projectName);
const mode = isTeamMode ? 'team' : 'standalone';

function log(message: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

// Build hooks for observability
const postToolUseHook = createPostToolUseHook(log);
const sessionEndHook = createSessionEndHook(async ({ sessionId, reason }) => {
  log(`[session-end] Session ${sessionId} ended: ${reason}`);
});
const teammateIdleHook = createTeammateIdleHook(log);
const taskCompletedHook = createTaskCompletedHook(log);

const hooks = {
  PostToolUse: [{ hooks: [postToolUseHook] }],
  SessionEnd: [{ hooks: [sessionEndHook] }],
  TeammateIdle: [{ hooks: [teammateIdleHook] }],
  TaskCompleted: [{ hooks: [taskCompletedHook] }],
};

console.log(`\n=== Codename Claude Test Run ===`);
console.log(`Role:    ${role}`);
console.log(`Mode:    ${mode}`);
console.log(`Project: ${projectPath}`);
console.log(`Task:    ${task}`);
console.log(`================================\n`);

try {
  const result = await runAgent(role!, projectPath, task, { hooks, log, mode });
  console.log(`\n=== Run Complete ===`);
  console.log(`Agent:     ${result.agentName}`);
  console.log(`Mode:      ${result.mode}`);
  console.log(`Sandboxed: ${result.sandboxed}`);
  if (result.syncedFiles) {
    console.log(`Synced:    ${result.syncedFiles.join(', ')}`);
  }
} catch (error) {
  console.error('Run failed:', error);
  process.exit(1);
}
