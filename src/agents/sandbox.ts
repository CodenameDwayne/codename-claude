import { Sandbox } from '@vercel/sandbox';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface SandboxConfig {
  vcpus?: number;
  timeoutMs?: number;
  runtime?: 'node24' | 'node22' | 'python3.13';
}

const SANDBOX_WORKSPACE = '/vercel/sandbox/workspace';
const DEFAULT_VCPUS = 4;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Create a Vercel Sandbox microVM with configurable resources.
 */
export async function createSandbox(config: SandboxConfig = {}): Promise<Sandbox> {
  const sandbox = await Sandbox.create({
    runtime: config.runtime ?? 'node22',
    resources: { vcpus: config.vcpus ?? DEFAULT_VCPUS },
    timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  // Create workspace directory
  await sandbox.mkDir(SANDBOX_WORKSPACE);

  // Install Claude Code CLI and Agent SDK inside the sandbox
  await sandbox.runCommand({
    cmd: 'npm',
    args: ['install', '-g', '@anthropic-ai/claude-agent-sdk'],
    cwd: SANDBOX_WORKSPACE,
  });

  return sandbox;
}

/**
 * Recursively collect all file paths in a directory, excluding common
 * non-essential directories (node_modules, .git, dist).
 */
async function collectFiles(dir: string, base: string = dir): Promise<string[]> {
  const EXCLUDED = new Set(['node_modules', '.git', 'dist', '.DS_Store']);
  const results: string[] = [];

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath, base);
      results.push(...nested);
    } else if (entry.isFile()) {
      results.push(relative(base, fullPath));
    }
  }

  return results;
}

/**
 * Sync project source files and .brain/ directory into the sandbox workspace.
 */
export async function syncFilesIn(sandbox: Sandbox, projectPath: string): Promise<void> {
  const files = await collectFiles(projectPath);

  // Upload in batches to avoid oversized requests
  const BATCH_SIZE = 50;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const fileDescriptors = await Promise.all(
      batch.map(async (relativePath) => {
        const content = await readFile(join(projectPath, relativePath));
        return {
          path: join(SANDBOX_WORKSPACE, relativePath),
          content: Buffer.from(content),
        };
      }),
    );

    // Ensure parent directories exist for each file
    const dirs = new Set(
      fileDescriptors.map((f) => f.path.substring(0, f.path.lastIndexOf('/'))),
    );
    for (const dir of dirs) {
      await sandbox.mkDir(dir);
    }

    await sandbox.writeFiles(fileDescriptors);
  }
}

/**
 * Diff sandbox workspace against original project and copy changed files back to host.
 * Uses git to detect which files were modified inside the sandbox.
 */
export async function syncFilesOut(sandbox: Sandbox, projectPath: string): Promise<string[]> {
  // Initialize git inside sandbox workspace to track changes
  // (We committed the initial state on syncFilesIn, so diff shows changes)
  const diffResult = await sandbox.runCommand('bash', [
    '-c',
    `cd ${SANDBOX_WORKSPACE} && git init -q && git add -A && git diff --cached --name-only 2>/dev/null || find . -type f -newer /tmp/sandbox-sync-marker -not -path './.git/*'`,
  ]);

  const stdout = await diffResult.stdout();
  const changedFiles = stdout.trim().split('\n').filter(Boolean);

  const syncedFiles: string[] = [];

  for (const relativePath of changedFiles) {
    const cleanPath = relativePath.startsWith('./') ? relativePath.slice(2) : relativePath;
    const sandboxPath = join(SANDBOX_WORKSPACE, cleanPath);
    const hostPath = join(projectPath, cleanPath);

    const buffer = await sandbox.readFileToBuffer({ path: sandboxPath });
    if (buffer) {
      // Ensure parent directory exists on host
      const parentDir = hostPath.substring(0, hostPath.lastIndexOf('/'));
      await mkdir(parentDir, { recursive: true });

      await writeFile(hostPath, buffer);
      syncedFiles.push(cleanPath);
    }
  }

  return syncedFiles;
}

/**
 * Stop the sandbox and clean up. Always call this, even on error (use try/finally).
 */
export async function stopSandbox(sandbox: Sandbox): Promise<void> {
  await sandbox.stop({ blocking: true });
}

/**
 * Run a complete sandboxed session: create → sync in → execute callback → sync out → stop.
 * Guarantees the sandbox is stopped even if the callback throws.
 */
export async function withSandbox<T>(
  projectPath: string,
  config: SandboxConfig,
  callback: (sandbox: Sandbox, workspacePath: string) => Promise<T>,
): Promise<{ result: T; syncedFiles: string[] }> {
  const sandbox = await createSandbox(config);

  // Create a timestamp marker before syncing files in, so we can detect changes later
  await sandbox.runCommand('touch', ['/tmp/sandbox-sync-marker']);

  try {
    await syncFilesIn(sandbox, projectPath);
    const result = await callback(sandbox, SANDBOX_WORKSPACE);
    const syncedFiles = await syncFilesOut(sandbox, projectPath);
    return { result, syncedFiles };
  } finally {
    await stopSandbox(sandbox);
  }
}
