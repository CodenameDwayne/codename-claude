import { watch, type FSWatcher } from 'chokidar';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface WatcherConfig {
  /** Registered project paths to watch */
  projectPaths: string[];
  /** Debounce interval in milliseconds */
  debounceMs?: number;
}

export interface WatcherTriggerResult {
  triggerName: string;
  project: string;
  agent: string;
  task: string;
  mode: 'standalone' | 'team';
}

type WatcherHandler = (result: WatcherTriggerResult) => void;

/**
 * Watches .brain/BACKLOG.md in registered projects.
 * When the file changes, debounces and triggers the Architect agent.
 */
export class FileWatcher {
  private config: WatcherConfig;
  private handler: WatcherHandler;
  private log: (message: string) => void;
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceMs: number;

  constructor(
    config: WatcherConfig,
    handler: WatcherHandler,
    log: (message: string) => void = console.log,
  ) {
    this.config = config;
    this.handler = handler;
    this.log = log;
    this.debounceMs = config.debounceMs ?? 5000;
  }

  start(): void {
    if (this.watcher) return;

    const watchPaths = this.config.projectPaths.map((p) =>
      join(p, '.brain', 'BACKLOG.md'),
    );

    if (watchPaths.length === 0) {
      this.log('[watcher] no projects to watch');
      return;
    }

    this.watcher = watch(watchPaths, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (filePath) => {
      this.onFileChange(filePath);
    });

    this.watcher.on('error', (err: unknown) => {
      this.log(`[watcher] error: ${err instanceof Error ? err.message : String(err)}`);
    });

    this.log(`[watcher] watching ${watchPaths.length} BACKLOG.md files`);
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.log('[watcher] stopped');
    }
  }

  private onFileChange(filePath: string): void {
    // Extract project path: /path/to/project/.brain/BACKLOG.md → /path/to/project
    const projectPath = filePath.replace(/[/\\]\.brain[/\\]BACKLOG\.md$/, '');

    // Debounce per project
    const existing = this.debounceTimers.get(projectPath);
    if (existing) {
      clearTimeout(existing);
    }

    this.log(`[watcher] BACKLOG.md changed in ${projectPath} — debouncing (${this.debounceMs}ms)`);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(projectPath);
      this.fireForProject(projectPath);
    }, this.debounceMs);

    this.debounceTimers.set(projectPath, timer);
  }

  private async fireForProject(projectPath: string): Promise<void> {
    // Read the backlog to include context in the task
    let backlogContent = '';
    try {
      backlogContent = await readFile(join(projectPath, '.brain', 'BACKLOG.md'), 'utf-8');
    } catch {
      // file may have been deleted
    }

    const projectName = projectPath.split('/').pop() ?? 'unknown';
    this.log(`[watcher] firing architect for ${projectName}`);

    this.handler({
      triggerName: `watcher:backlog-${projectName}`,
      project: projectPath,
      agent: 'architect',
      task: `The BACKLOG.md has been updated. Review the backlog, pick the highest priority unplanned task, and create a plan for it.\n\nCurrent BACKLOG.md:\n${backlogContent.slice(0, 2000)}`,
      mode: 'standalone',
    });
  }
}
