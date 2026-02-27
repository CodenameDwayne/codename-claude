import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  registerProject,
  listProjects,
  getProject,
  unregisterProject,
  updateLastSession,
  type ProjectEntry,
} from './projects.js';

const TEST_STATE_DIR = join(import.meta.dirname, '../../.test-state/projects');
const TEST_STATE_FILE = join(TEST_STATE_DIR, 'projects.json');

beforeEach(async () => {
  await mkdir(TEST_STATE_DIR, { recursive: true });
  await rm(TEST_STATE_FILE, { force: true });
});

afterEach(async () => {
  await rm(TEST_STATE_DIR, { recursive: true, force: true });
});

describe('project registry', () => {
  test('listProjects returns empty array when no projects registered', async () => {
    const projects = await listProjects(TEST_STATE_FILE);
    expect(projects).toEqual([]);
  });

  test('registerProject adds a project and persists it', async () => {
    await registerProject('/Users/me/Projects/foo', 'foo', TEST_STATE_FILE);
    const projects = await listProjects(TEST_STATE_FILE);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.name).toBe('foo');
    expect(projects[0]!.path).toBe('/Users/me/Projects/foo');
    expect(projects[0]!.registered).toBeTypeOf('number');
    expect(projects[0]!.lastSession).toBeNull();
  });

  test('registerProject rejects duplicate paths', async () => {
    await registerProject('/Users/me/Projects/foo', 'foo', TEST_STATE_FILE);
    await expect(
      registerProject('/Users/me/Projects/foo', 'foo-2', TEST_STATE_FILE),
    ).rejects.toThrow('already registered');
  });

  test('registerProject rejects duplicate names', async () => {
    await registerProject('/Users/me/Projects/foo', 'foo', TEST_STATE_FILE);
    await expect(
      registerProject('/Users/me/Projects/bar', 'foo', TEST_STATE_FILE),
    ).rejects.toThrow('already registered');
  });

  test('getProject finds by path', async () => {
    await registerProject('/Users/me/Projects/foo', 'foo', TEST_STATE_FILE);
    const project = await getProject('/Users/me/Projects/foo', TEST_STATE_FILE);
    expect(project).not.toBeNull();
    expect(project!.name).toBe('foo');
  });

  test('getProject finds by name', async () => {
    await registerProject('/Users/me/Projects/foo', 'foo', TEST_STATE_FILE);
    const project = await getProject('foo', TEST_STATE_FILE);
    expect(project).not.toBeNull();
    expect(project!.path).toBe('/Users/me/Projects/foo');
  });

  test('getProject returns null for unknown project', async () => {
    const project = await getProject('nonexistent', TEST_STATE_FILE);
    expect(project).toBeNull();
  });

  test('unregisterProject removes by path', async () => {
    await registerProject('/Users/me/Projects/foo', 'foo', TEST_STATE_FILE);
    await unregisterProject('/Users/me/Projects/foo', TEST_STATE_FILE);
    const projects = await listProjects(TEST_STATE_FILE);
    expect(projects).toHaveLength(0);
  });

  test('unregisterProject removes by name', async () => {
    await registerProject('/Users/me/Projects/foo', 'foo', TEST_STATE_FILE);
    await unregisterProject('foo', TEST_STATE_FILE);
    const projects = await listProjects(TEST_STATE_FILE);
    expect(projects).toHaveLength(0);
  });

  test('unregisterProject throws for unknown project', async () => {
    await expect(
      unregisterProject('nonexistent', TEST_STATE_FILE),
    ).rejects.toThrow('not found');
  });

  test('updateLastSession sets timestamp', async () => {
    await registerProject('/Users/me/Projects/foo', 'foo', TEST_STATE_FILE);
    const now = Date.now();
    await updateLastSession('/Users/me/Projects/foo', now, TEST_STATE_FILE);

    const project = await getProject('foo', TEST_STATE_FILE);
    expect(project!.lastSession).toBe(now);
  });

  test('state persists across loads', async () => {
    await registerProject('/Users/me/Projects/a', 'a', TEST_STATE_FILE);
    await registerProject('/Users/me/Projects/b', 'b', TEST_STATE_FILE);

    // Fresh load
    const projects = await listProjects(TEST_STATE_FILE);
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.name).sort()).toEqual(['a', 'b']);
  });
});
