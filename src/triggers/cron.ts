import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CronExpressionParser } from 'cron-parser';

export interface TriggerConfig {
  name: string;
  type: 'cron';
  schedule: string; // cron expression
  project: string;
  agent: string;
  task: string;
  mode: 'standalone' | 'team';
}

export interface CronTriggerOptions {
  stateDir?: string;
}

export class CronTrigger {
  private config: TriggerConfig;
  private lastFiredAt: number | null = null;
  private stateDir: string | null;

  constructor(config: TriggerConfig, options?: CronTriggerOptions) {
    this.config = config;
    this.stateDir = options?.stateDir ?? null;
  }

  /**
   * Check if this trigger is due to fire.
   * Returns true if a cron interval has elapsed since lastFiredAt.
   */
  isDue(): boolean {
    const now = Date.now();

    if (this.lastFiredAt === null) {
      // Never fired — check if a cron time has passed recently
      // (i.e., is "now" at or past a scheduled time?)
      return this.hasCronTimeSince(now - 60 * 1000, now);
    }

    return this.hasCronTimeSince(this.lastFiredAt, now);
  }

  /**
   * Check if a cron schedule time falls between `since` and `now`.
   */
  private hasCronTimeSince(since: number, now: number): boolean {
    try {
      const expr = CronExpressionParser.parse(this.config.schedule, {
        currentDate: new Date(since),
      });
      const next = expr.next().toDate().getTime();
      return next <= now;
    } catch {
      return false;
    }
  }

  markFired(): void {
    this.lastFiredAt = Date.now();
    this.persistState();
  }

  /**
   * Load persisted lastFiredAt from state file.
   */
  loadState(): void {
    if (!this.stateDir) return;
    try {
      const raw = readFileSync(this.stateFilePath(), 'utf-8');
      const state = JSON.parse(raw) as { lastFiredAt: number | null };
      if (typeof state.lastFiredAt === 'number') {
        this.lastFiredAt = state.lastFiredAt;
      }
    } catch {
      // No state file yet — that's fine
    }
  }

  private persistState(): void {
    if (!this.stateDir) return;
    try {
      mkdirSync(this.stateDir, { recursive: true });
      writeFileSync(this.stateFilePath(), JSON.stringify({ lastFiredAt: this.lastFiredAt }));
    } catch {
      // Best-effort persistence
    }
  }

  private stateFilePath(): string {
    // Sanitize trigger name for use as filename
    const safeName = this.config.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.stateDir!, `cron-${safeName}.json`);
  }

  setLastFiredAt(timestamp: number): void {
    this.lastFiredAt = timestamp;
  }

  getLastFiredAt(): number | null {
    return this.lastFiredAt;
  }

  getConfig(): TriggerConfig {
    return this.config;
  }
}
