import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lock } from 'proper-lockfile';

export interface ProjectEntry {
  path: string;
  name: string;
  registered: number;
  lastSession: number | null;
}

interface ProjectsState {
  projects: ProjectEntry[];
}

async function loadState(stateFile: string): Promise<ProjectsState> {
  try {
    const raw = await readFile(stateFile, 'utf-8');
    return JSON.parse(raw) as ProjectsState;
  } catch {
    return { projects: [] };
  }
}

async function saveState(state: ProjectsState, stateFile: string): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}

async function ensureFile(stateFile: string): Promise<void> {
  try {
    await readFile(stateFile);
  } catch {
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ projects: [] }));
  }
}

export async function registerProject(
  path: string,
  name: string,
  stateFile: string,
): Promise<ProjectEntry> {
  await ensureFile(stateFile);
  const release = await lock(stateFile, { retries: 3, realpath: false });
  try {
    const state = await loadState(stateFile);

    if (state.projects.some((p) => p.path === path || p.name === name)) {
      throw new Error(`Project already registered: ${name} (${path})`);
    }

    const entry: ProjectEntry = {
      path,
      name,
      registered: Date.now(),
      lastSession: null,
    };

    state.projects.push(entry);
    await saveState(state, stateFile);
    return entry;
  } finally {
    await release();
  }
}

export async function listProjects(stateFile: string): Promise<ProjectEntry[]> {
  const state = await loadState(stateFile);
  return state.projects;
}

export async function getProject(
  pathOrName: string,
  stateFile: string,
): Promise<ProjectEntry | null> {
  const state = await loadState(stateFile);
  return state.projects.find((p) => p.path === pathOrName || p.name === pathOrName) ?? null;
}

export async function unregisterProject(
  pathOrName: string,
  stateFile: string,
): Promise<void> {
  await ensureFile(stateFile);
  const release = await lock(stateFile, { retries: 3, realpath: false });
  try {
    const state = await loadState(stateFile);
    const idx = state.projects.findIndex(
      (p) => p.path === pathOrName || p.name === pathOrName,
    );

    if (idx === -1) {
      throw new Error(`Project not found: ${pathOrName}`);
    }

    state.projects.splice(idx, 1);
    await saveState(state, stateFile);
  } finally {
    await release();
  }
}

export async function updateLastSession(
  pathOrName: string,
  timestamp: number,
  stateFile: string,
): Promise<void> {
  await ensureFile(stateFile);
  const release = await lock(stateFile, { retries: 3, realpath: false });
  try {
    const state = await loadState(stateFile);
    const project = state.projects.find(
      (p) => p.path === pathOrName || p.name === pathOrName,
    );

    if (!project) {
      throw new Error(`Project not found: ${pathOrName}`);
    }

    project.lastSession = timestamp;
    await saveState(state, stateFile);
  } finally {
    await release();
  }
}
