import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import Anthropic from '@anthropic-ai/sdk';

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

// Type for the Anthropic messages.create function (allows DI for testing)
export type CreateMessageFn = (params: {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
}) => Promise<{ content: Array<{ type: string; text?: string }> }>;

export interface RouteOptions {
  task: string;
  agents: AgentSummary[];
  projectContext: string;
  createMessage?: CreateMessageFn;
  manualAgent?: string;
  manualTeams?: boolean;
}

export async function routeTask(options: RouteOptions): Promise<PipelineStage[]> {
  const { task, agents, projectContext, manualAgent, manualTeams } = options;

  // Manual override — skip LLM call
  if (manualAgent) {
    return [{ agent: manualAgent, teams: manualTeams ?? false }];
  }

  // Build prompt for Haiku
  const agentList = agents
    .map(a => `- ${a.name}: ${a.description}`)
    .join('\n');

  const prompt = `You are a task router for an AI coding agent system. Given a task and available agents, decide which agents should run and in what order.

Available agents:
${agentList}

Project context:
${projectContext || 'No additional context.'}

Task: ${task}

Return a JSON array of pipeline stages. Each stage has:
- "agent": the agent name (must match one from the list above)
- "teams": boolean — true only if the task is complex enough that this agent needs to spawn sub-agents for parallel work. Most tasks should be false.

Common patterns:
- Simple coding task: [{"agent":"builder","teams":false},{"agent":"reviewer","teams":false}]
- Complex feature: [{"agent":"architect","teams":false},{"agent":"builder","teams":false},{"agent":"reviewer","teams":false}]
- Research needed: [{"agent":"scout","teams":false},{"agent":"architect","teams":false},{"agent":"builder","teams":false},{"agent":"reviewer","teams":false}]

Return ONLY the JSON array, no explanation.`;

  const createMessage = options.createMessage ?? createDefaultClient();

  const response = await createMessage({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text ?? '[]';
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Router returned invalid response: ${text}`);
  }

  const stages = JSON.parse(jsonMatch[0]) as PipelineStage[];

  // Validate agent names exist
  const validNames = new Set(agents.map(a => a.name));
  for (const stage of stages) {
    if (!validNames.has(stage.agent)) {
      throw new Error(`Router selected unknown agent: ${stage.agent}`);
    }
  }

  return stages;
}

function createDefaultClient(): CreateMessageFn {
  const client = new Anthropic();
  return async (params) => {
    const response = await client.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages as Anthropic.MessageParam[],
    });
    return {
      content: response.content.map(block => ({
        type: block.type,
        text: block.type === 'text' ? block.text : undefined,
      })),
    };
  };
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
