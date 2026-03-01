import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface AgentSummary {
  name: string;
  description: string;
  model: string;
  skills: string[];
}

export interface PipelineStage {
  agent: string;
  teams: boolean;
  batchScope?: string;
}

export interface RouteOptions {
  task: string;
  agents: AgentSummary[];
  projectContext: string;
  manualAgent?: string;
  manualTeams?: boolean;
}

const RESEARCH_KEYWORDS = ['research', 'evaluate', 'compare', 'investigate', 'explore options', 'which library', 'what framework'];
const SIMPLE_KEYWORDS = ['fix', 'typo', 'bug', 'update', 'change', 'rename', 'remove', 'delete', 'tweak', 'adjust'];
const COMPLEX_INDICATORS = /,|\b(and|with|plus)\b/g;

export async function routeTask(options: RouteOptions): Promise<PipelineStage[]> {
  const { task, manualAgent, manualTeams } = options;

  if (manualAgent) {
    return [{ agent: manualAgent, teams: manualTeams ?? false }];
  }

  const taskLower = task.toLowerCase();

  // Pattern 1: Research tasks
  if (RESEARCH_KEYWORDS.some(kw => taskLower.includes(kw))) {
    return [
      { agent: 'scout', teams: false },
      { agent: 'architect', teams: false },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];
  }

  // Pattern 2: Simple fix/bug
  const isSimple = SIMPLE_KEYWORDS.some(kw => taskLower.startsWith(kw) || taskLower.includes(`${kw} `));
  const hasNoPlanning = !taskLower.includes('implement') && !taskLower.includes('build') && !taskLower.includes('create') && !taskLower.includes('add') && !taskLower.includes('design') && !taskLower.includes('update') && !taskLower.includes('change');
  if (isSimple && hasNoPlanning) {
    return [
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];
  }

  // Pattern 3: Complex (5+ components heuristic)
  const componentMatches = taskLower.match(COMPLEX_INDICATORS) ?? [];
  if (componentMatches.length >= 4) {
    return [
      { agent: 'architect', teams: true },
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ];
  }

  // Pattern 4: Default — feature needing planning
  return [
    { agent: 'architect', teams: false },
    { agent: 'builder', teams: false },
    { agent: 'reviewer', teams: false },
  ];
}

export async function loadAgentSummaries(agentsDir: string): Promise<AgentSummary[]> {
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    const summaries: AgentSummary[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const raw = await readFile(join(agentsDir, entry.name), 'utf-8');
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) continue;

      const frontmatter = parseYaml(match[1] ?? '') as Record<string, unknown>;
      const body = match[2]?.trim() ?? '';
      const firstLine = body.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').trim() ?? '';

      summaries.push({
        name: String(frontmatter['name'] ?? entry.name.replace('.md', '')).toLowerCase(),
        description: String(frontmatter['whenToUse'] ?? firstLine),
        model: String(frontmatter['model'] ?? 'claude-sonnet-4-6'),
        skills: Array.isArray(frontmatter['skills']) ? frontmatter['skills'] : [],
      });
    }

    return summaries;
  } catch {
    return [];
  }
}
