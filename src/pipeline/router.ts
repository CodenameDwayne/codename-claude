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
