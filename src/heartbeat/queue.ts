import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lock } from 'proper-lockfile';

export interface QueueItem {
  triggerName: string;
  project: string;
  agent: string;
  task: string;
  mode: 'standalone' | 'team';
  enqueuedAt: number;
}

interface QueueState {
  items: QueueItem[];
}

export class WorkQueue {
  private stateFile: string;

  constructor(stateFile: string) {
    this.stateFile = stateFile;
  }

  private async load(): Promise<QueueState> {
    try {
      const raw = await readFile(this.stateFile, 'utf-8');
      return JSON.parse(raw) as QueueState;
    } catch {
      return { items: [] };
    }
  }

  private async save(state: QueueState): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, JSON.stringify(state, null, 2));
  }

  private async ensureFile(): Promise<void> {
    try {
      await readFile(this.stateFile);
    } catch {
      await mkdir(dirname(this.stateFile), { recursive: true });
      await writeFile(this.stateFile, JSON.stringify({ items: [] }));
    }
  }

  async enqueue(item: QueueItem): Promise<void> {
    await this.ensureFile();
    const release = await lock(this.stateFile, { retries: 3, realpath: false });
    try {
      const state = await this.load();
      state.items.push(item);
      await this.save(state);
    } finally {
      await release();
    }
  }

  async dequeue(): Promise<QueueItem | null> {
    await this.ensureFile();
    const release = await lock(this.stateFile, { retries: 3, realpath: false });
    try {
      const state = await this.load();
      const item = state.items.shift() ?? null;
      await this.save(state);
      return item;
    } finally {
      await release();
    }
  }

  async peek(): Promise<QueueItem | null> {
    const state = await this.load();
    return state.items[0] ?? null;
  }

  async isEmpty(): Promise<boolean> {
    const state = await this.load();
    return state.items.length === 0;
  }

  async size(): Promise<number> {
    const state = await this.load();
    return state.items.length;
  }
}
