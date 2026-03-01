import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lock } from 'proper-lockfile';

export interface BudgetConfig {
  maxPromptsPerWindow: number;
  reserveForInteractive: number; // 0.0 – 1.0
  windowHours: number;
  stateFile: string;
}

interface UsageEntry {
  timestamp: number;
  count: number;
}

interface BudgetState {
  entries: UsageEntry[];
}

export async function loadBudgetState(stateFile: string): Promise<BudgetState> {
  try {
    const raw = await readFile(stateFile, 'utf-8');
    return JSON.parse(raw) as BudgetState;
  } catch {
    return { entries: [] };
  }
}

async function saveBudgetState(state: BudgetState, stateFile: string): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}

function pruneExpiredEntries(entries: UsageEntry[], windowHours: number): UsageEntry[] {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  return entries.filter((e) => e.timestamp > cutoff);
}

function sumUsage(entries: UsageEntry[]): number {
  return entries.reduce((sum, e) => sum + e.count, 0);
}

async function ensureFile(stateFile: string): Promise<void> {
  try {
    await readFile(stateFile);
  } catch {
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ entries: [] }));
  }
}

export async function recordUsage(promptCount: number, config: BudgetConfig): Promise<void> {
  await ensureFile(config.stateFile);
  const release = await lock(config.stateFile, { retries: 3, realpath: false });
  try {
    const state = await loadBudgetState(config.stateFile);
    state.entries = pruneExpiredEntries(state.entries, config.windowHours);
    state.entries.push({ timestamp: Date.now(), count: promptCount });
    await saveBudgetState(state, config.stateFile);
  } finally {
    await release();
  }
}

export async function getRemainingBudget(config: BudgetConfig): Promise<number> {
  const state = await loadBudgetState(config.stateFile);
  const active = pruneExpiredEntries(state.entries, config.windowHours);
  const used = sumUsage(active);
  return Math.max(0, config.maxPromptsPerWindow - used);
}

export async function canRunAgent(config: BudgetConfig): Promise<boolean> {
  const remaining = await getRemainingBudget(config);
  const reserve = config.maxPromptsPerWindow * config.reserveForInteractive;
  return remaining > reserve;
}
