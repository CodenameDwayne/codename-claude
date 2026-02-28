import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { FileWatcher, type WatcherTriggerResult } from './watcher.js';

describe('FileWatcher', () => {
  let tempDir: string;
  let watcher: FileWatcher | null = null;

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createProject(name: string): Promise<string> {
    const projectPath = join(tempDir, name);
    await mkdir(join(projectPath, '.brain'), { recursive: true });
    await writeFile(join(projectPath, '.brain', 'BACKLOG.md'), '# Backlog\n\nNo tasks yet.');
    return projectPath;
  }

  it('triggers architect when BACKLOG.md changes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cc-watcher-'));
    const projectPath = await createProject('test-project');

    const results: WatcherTriggerResult[] = [];

    watcher = new FileWatcher(
      { projectPaths: [projectPath], debounceMs: 200 },
      (result) => results.push(result),
      () => {},
    );
    watcher.start();

    // Wait for watcher to initialize
    await new Promise((r) => setTimeout(r, 300));

    // Modify the backlog
    await writeFile(
      join(projectPath, '.brain', 'BACKLOG.md'),
      '# Backlog\n\n- [ ] Add authentication\n',
    );

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 1500));

    expect(results.length).toBe(1);
    expect(results[0]!.agent).toBe('architect');
    expect(results[0]!.project).toBe(projectPath);
    expect(results[0]!.mode).toBe('standalone');
    expect(results[0]!.triggerName).toContain('watcher:backlog-');
    expect(results[0]!.task).toContain('BACKLOG.md has been updated');
  });

  it('debounces rapid changes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cc-watcher-'));
    const projectPath = await createProject('debounce-test');

    const results: WatcherTriggerResult[] = [];

    watcher = new FileWatcher(
      { projectPaths: [projectPath], debounceMs: 500 },
      (result) => results.push(result),
      () => {},
    );
    watcher.start();

    await new Promise((r) => setTimeout(r, 300));

    // Rapid-fire changes
    await writeFile(join(projectPath, '.brain', 'BACKLOG.md'), '# Backlog\n\n- change 1');
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(join(projectPath, '.brain', 'BACKLOG.md'), '# Backlog\n\n- change 2');
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(join(projectPath, '.brain', 'BACKLOG.md'), '# Backlog\n\n- change 3');

    // Wait for debounce to fire
    await new Promise((r) => setTimeout(r, 2000));

    // Should only fire once despite 3 changes
    expect(results.length).toBe(1);
    expect(results[0]!.task).toContain('change 3');
  });

  it('watches multiple projects independently', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cc-watcher-'));
    const project1 = await createProject('proj-a');
    const project2 = await createProject('proj-b');

    const results: WatcherTriggerResult[] = [];

    watcher = new FileWatcher(
      { projectPaths: [project1, project2], debounceMs: 200 },
      (result) => results.push(result),
      () => {},
    );
    watcher.start();

    await new Promise((r) => setTimeout(r, 300));

    // Modify both projects
    await writeFile(join(project1, '.brain', 'BACKLOG.md'), '# Backlog\n\n- task for A');
    await writeFile(join(project2, '.brain', 'BACKLOG.md'), '# Backlog\n\n- task for B');

    await new Promise((r) => setTimeout(r, 1500));

    expect(results.length).toBe(2);
    const projects = results.map((r) => r.project).sort();
    expect(projects).toEqual([project1, project2].sort());
  });

  it('handles no project paths gracefully', () => {
    watcher = new FileWatcher(
      { projectPaths: [] },
      () => {},
      () => {},
    );
    // Should not throw
    watcher.start();
  });

  it('stops cleanly and cancels pending debounces', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cc-watcher-'));
    const projectPath = await createProject('stop-test');

    const results: WatcherTriggerResult[] = [];

    watcher = new FileWatcher(
      { projectPaths: [projectPath], debounceMs: 1000 },
      (result) => results.push(result),
      () => {},
    );
    watcher.start();

    await new Promise((r) => setTimeout(r, 300));

    // Trigger a change
    await writeFile(join(projectPath, '.brain', 'BACKLOG.md'), '# Backlog\n\n- pending task');

    // Stop before debounce fires
    await new Promise((r) => setTimeout(r, 200));
    await watcher.stop();
    watcher = null;

    // Wait to ensure the debounce would have fired
    await new Promise((r) => setTimeout(r, 1500));

    // Should NOT have fired
    expect(results.length).toBe(0);
  });
});
