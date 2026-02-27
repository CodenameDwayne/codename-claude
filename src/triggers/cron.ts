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

export class CronTrigger {
  private config: TriggerConfig;
  private lastFiredAt: number | null = null;

  constructor(config: TriggerConfig) {
    this.config = config;
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
