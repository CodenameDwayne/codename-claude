/**
 * Manual test script for the agent runner.
 *
 * Usage: npx tsx src/test-run.ts <role> <project-name> "<task>"
 * Example: npx tsx src/test-run.ts scout cc-test "Do a research scan on CLI frameworks for Node.js"
 */
import 'dotenv/config';
import { resolve } from 'node:path';
import { runAgent } from './agents/runner.js';

const [role, projectName, task] = process.argv.slice(2);

if (!role || !projectName || !task) {
  console.error('Usage: npx tsx src/test-run.ts <role> <project-name> "<task>"');
  console.error('Example: npx tsx src/test-run.ts scout cc-test "Research CLI frameworks for Node.js"');
  process.exit(1);
}

const projectPath = resolve(process.env['HOME'] ?? '~', 'Projects', projectName);

console.log(`\n=== Codename Claude Test Run ===`);
console.log(`Role:    ${role}`);
console.log(`Project: ${projectPath}`);
console.log(`Task:    ${task}`);
console.log(`================================\n`);

try {
  const result = await runAgent(role, projectPath, task);
  console.log(`\n=== Run Complete ===`);
  console.log(`Agent:     ${result.agentName}`);
  console.log(`Sandboxed: ${result.sandboxed}`);
  if (result.syncedFiles) {
    console.log(`Synced:    ${result.syncedFiles.join(', ')}`);
  }
} catch (error) {
  console.error('Run failed:', error);
  process.exit(1);
}
