import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionTracker } from './sessions.js';

const TEST_DIR = join(import.meta.dirname, '..', '..', '.test-sessions');
const STATE_FILE = join(TEST_DIR, 'sessions.json');

describe('SessionTracker', () => {
  let tracker: SessionTracker;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    tracker = new SessionTracker(STATE_FILE);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('starts and retrieves a session', () => {
    const record = tracker.startSession('sess-1', '/tmp/proj', 'scout', 'research task');

    expect(record.sessionId).toBe('sess-1');
    expect(record.status).toBe('active');
    expect(record.agent).toBe('scout');

    const retrieved = tracker.get('sess-1');
    expect(retrieved).toEqual(record);
  });

  it('completes a session with verdict', () => {
    tracker.startSession('sess-1', '/tmp/proj', 'reviewer', 'review code');
    const completed = tracker.completeSession('sess-1', 'APPROVE', 12);

    expect(completed?.status).toBe('completed');
    expect(completed?.verdict).toBe('APPROVE');
    expect(completed?.turnCount).toBe(12);
    expect(completed?.completedAt).toBeGreaterThan(0);
  });

  it('fails a session', () => {
    tracker.startSession('sess-1', '/tmp/proj', 'builder', 'build feature');
    const failed = tracker.failSession('sess-1');

    expect(failed?.status).toBe('failed');
    expect(failed?.completedAt).toBeGreaterThan(0);
  });

  it('returns undefined for unknown session IDs', () => {
    expect(tracker.completeSession('nonexistent')).toBeUndefined();
    expect(tracker.failSession('nonexistent')).toBeUndefined();
    expect(tracker.get('nonexistent')).toBeUndefined();
  });

  it('lists active sessions only', () => {
    tracker.startSession('s1', '/tmp', 'scout', 'a');
    tracker.startSession('s2', '/tmp', 'builder', 'b');
    tracker.startSession('s3', '/tmp', 'reviewer', 'c');
    tracker.completeSession('s2');

    const active = tracker.getActive();
    expect(active).toHaveLength(2);
    expect(active.map(s => s.sessionId).sort()).toEqual(['s1', 's3']);
  });

  it('lists recent sessions sorted by start time', () => {
    const r1 = tracker.startSession('s1', '/tmp', 'scout', 'a');
    const r2 = tracker.startSession('s2', '/tmp', 'builder', 'b');
    const r3 = tracker.startSession('s3', '/tmp', 'reviewer', 'c');
    // Ensure distinct timestamps for deterministic sort
    r1.startedAt = 1000;
    r2.startedAt = 2000;
    r3.startedAt = 3000;

    const recent = tracker.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.sessionId).toBe('s3');
    expect(recent[1]!.sessionId).toBe('s2');
  });

  it('persists and loads across instances', async () => {
    tracker.startSession('s1', '/tmp/proj', 'scout', 'task');
    await tracker.save();

    const tracker2 = new SessionTracker(STATE_FILE);
    await tracker2.load();

    const loaded = tracker2.get('s1');
    expect(loaded?.sessionId).toBe('s1');
    expect(loaded?.agent).toBe('scout');
  });

  it('prunes old completed sessions', () => {
    const record = tracker.startSession('old', '/tmp', 'scout', 'old task');
    record.startedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    record.status = 'completed';
    record.completedAt = record.startedAt + 1000;

    tracker.startSession('new', '/tmp', 'scout', 'new task');
    tracker.completeSession('new');

    const pruned = tracker.prune(7 * 24 * 60 * 60 * 1000);
    expect(pruned).toBe(1);
    expect(tracker.get('old')).toBeUndefined();
    expect(tracker.get('new')).toBeDefined();
  });
});
