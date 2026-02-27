import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkQueue, type QueueItem } from './queue.js';

const TEST_STATE_DIR = join(import.meta.dirname, '../../.test-state/queue');
const TEST_STATE_FILE = join(TEST_STATE_DIR, 'queue.json');

beforeEach(async () => {
  await mkdir(TEST_STATE_DIR, { recursive: true });
  await rm(TEST_STATE_FILE, { force: true });
});

afterEach(async () => {
  await rm(TEST_STATE_DIR, { recursive: true, force: true });
});

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    triggerName: 'daily-scout',
    project: 'my-project',
    agent: 'scout',
    task: 'Run research scan',
    mode: 'standalone',
    enqueuedAt: Date.now(),
    ...overrides,
  };
}

describe('WorkQueue', () => {
  test('isEmpty returns true for fresh queue', async () => {
    const queue = new WorkQueue(TEST_STATE_FILE);
    expect(await queue.isEmpty()).toBe(true);
  });

  test('enqueue adds an item', async () => {
    const queue = new WorkQueue(TEST_STATE_FILE);
    await queue.enqueue(makeItem());
    expect(await queue.isEmpty()).toBe(false);
  });

  test('dequeue returns items in FIFO order', async () => {
    const queue = new WorkQueue(TEST_STATE_FILE);
    await queue.enqueue(makeItem({ triggerName: 'first' }));
    await queue.enqueue(makeItem({ triggerName: 'second' }));

    const first = await queue.dequeue();
    expect(first!.triggerName).toBe('first');

    const second = await queue.dequeue();
    expect(second!.triggerName).toBe('second');
  });

  test('dequeue returns null when queue is empty', async () => {
    const queue = new WorkQueue(TEST_STATE_FILE);
    const item = await queue.dequeue();
    expect(item).toBeNull();
  });

  test('peek returns next item without removing it', async () => {
    const queue = new WorkQueue(TEST_STATE_FILE);
    await queue.enqueue(makeItem({ triggerName: 'peeked' }));

    const peeked = await queue.peek();
    expect(peeked!.triggerName).toBe('peeked');

    // Still in queue
    expect(await queue.isEmpty()).toBe(false);

    // Dequeue returns same item
    const dequeued = await queue.dequeue();
    expect(dequeued!.triggerName).toBe('peeked');
  });

  test('peek returns null when queue is empty', async () => {
    const queue = new WorkQueue(TEST_STATE_FILE);
    const item = await queue.peek();
    expect(item).toBeNull();
  });

  test('state persists to disk', async () => {
    const queue = new WorkQueue(TEST_STATE_FILE);
    await queue.enqueue(makeItem({ triggerName: 'persisted' }));

    // Read raw file
    const raw = await readFile(TEST_STATE_FILE, 'utf-8');
    const state = JSON.parse(raw);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].triggerName).toBe('persisted');
  });

  test('state survives across instances (simulating restart)', async () => {
    const queue1 = new WorkQueue(TEST_STATE_FILE);
    await queue1.enqueue(makeItem({ triggerName: 'survivor' }));

    // New instance reads from same file
    const queue2 = new WorkQueue(TEST_STATE_FILE);
    const item = await queue2.dequeue();
    expect(item!.triggerName).toBe('survivor');
  });

  test('size returns number of items', async () => {
    const queue = new WorkQueue(TEST_STATE_FILE);
    expect(await queue.size()).toBe(0);

    await queue.enqueue(makeItem());
    await queue.enqueue(makeItem());
    expect(await queue.size()).toBe(2);

    await queue.dequeue();
    expect(await queue.size()).toBe(1);
  });
});
