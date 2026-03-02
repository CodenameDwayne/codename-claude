import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SessionRecord {
  sessionId: string;
  project: string;
  agent: string;
  task: string;
  startedAt: number;
  completedAt?: number;
  status: 'active' | 'completed' | 'failed';
  verdict?: string;
  turnCount?: number;
}

export class SessionTracker {
  private sessions: Map<string, SessionRecord> = new Map();
  private stateFile: string;

  constructor(stateFile: string) {
    this.stateFile = stateFile;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.stateFile, 'utf-8');
      const records = JSON.parse(raw) as SessionRecord[];
      this.sessions = new Map(records.map(r => [r.sessionId, r]));
    } catch {
      this.sessions = new Map();
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true });
    const records = [...this.sessions.values()];
    await writeFile(this.stateFile, JSON.stringify(records, null, 2));
  }

  startSession(sessionId: string, project: string, agent: string, task: string): SessionRecord {
    const record: SessionRecord = {
      sessionId,
      project,
      agent,
      task,
      startedAt: Date.now(),
      status: 'active',
    };
    this.sessions.set(sessionId, record);
    this.save().catch(() => {});
    return record;
  }

  completeSession(sessionId: string, verdict?: string, turnCount?: number): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    if (!record) return undefined;
    record.completedAt = Date.now();
    record.status = 'completed';
    if (verdict !== undefined) record.verdict = verdict;
    if (turnCount !== undefined) record.turnCount = turnCount;
    this.save().catch(() => {});
    return record;
  }

  failSession(sessionId: string): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    if (!record) return undefined;
    record.completedAt = Date.now();
    record.status = 'failed';
    this.save().catch(() => {});
    return record;
  }

  getActive(): SessionRecord[] {
    return [...this.sessions.values()].filter(r => r.status === 'active');
  }

  getRecent(limit = 10): SessionRecord[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  prune(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;
    for (const [id, record] of this.sessions) {
      if (record.status !== 'active' && record.startedAt < cutoff) {
        this.sessions.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) this.save().catch(() => {});
    return pruned;
  }
}
