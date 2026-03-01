import { query, type HookEvent, type HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readPipelineState, REVIEW_JSON_SCHEMA } from '../pipeline/state.js';

// Resolve the native claude binary path once at module load time.
// Important: `npx tsx` prepends node_modules/.bin to PATH, which may contain
// a JS shim (`#!/usr/bin/env node` script) that fails when spawned from a
// background process where `node` isn't resolvable. We prioritize the native
// Mach-O binary over any JS shim by checking known install locations first.
let _claudePath: string | undefined;
export function findClaudeExecutable(): string {
  if (_claudePath) return _claudePath;

  const home = process.env['HOME'] ?? '~';

  // 1. Check known native binary locations first (these are standalone executables)
  const nativeLocations = [
    join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    join(home, '.claude', 'bin', 'claude'),
  ];

  for (const loc of nativeLocations) {
    try {
      if (existsSync(loc) && statSync(loc).isFile()) {
        // Resolve symlinks — the SDK's existsSync check may fail on symlinks
        _claudePath = realpathSync(loc);
        return _claudePath;
      }
    } catch {
      // skip
    }
  }

  // 2. Fall back to which (may find JS shim, but better than nothing)
  try {
    _claudePath = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim();
    return _claudePath;
  } catch {
    // not found
  }

  // 3. Last resort
  _claudePath = nativeLocations[0]!;
  return _claudePath;
}

// Paths
const CODENAME_HOME = join(process.env['HOME'] ?? '~', '.codename-claude');
const AGENTS_DIR = join(CODENAME_HOME, 'agents');
const IDENTITY_DIR = join(CODENAME_HOME, 'identity');
const SKILLS_DIR = join(IDENTITY_DIR, 'skills');
const RULES_DIR = join(IDENTITY_DIR, 'rules');

// --- Types ---

interface AgentFrontmatter {
  name: string;
  model: string;
  sandboxed: boolean;
  tools: string[];
  skills: string[];
}

interface AgentDefinition {
  frontmatter: AgentFrontmatter;
  systemPromptSection: string;
}

export interface RunResult {
  agentName: string;
  sandboxed: boolean;
  mode: 'standalone' | 'team';
  syncedFiles?: string[];
  sessionId?: string;
  structuredOutput?: unknown;
}

export interface RunOptions {
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  log?: (message: string) => void;
  mode?: 'standalone' | 'team';
  maxTurns?: number;
}

// --- File Readers ---

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

async function readAllFilesInDir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const contents: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = await readFile(join(dir, entry.name), 'utf-8');
        contents.push(content);
      }
    }
    return contents;
  } catch {
    return [];
  }
}

// --- Parsing ---

function parseAgentDefinition(raw: string): AgentDefinition {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    throw new Error('Agent definition must have YAML frontmatter between --- delimiters');
  }

  const yamlBlock = frontmatterMatch[1] ?? '';
  const frontmatter = parseYaml(yamlBlock) as AgentFrontmatter;
  const systemPromptSection = frontmatterMatch[2]?.trim() ?? '';

  if (!frontmatter.name || !frontmatter.model) {
    throw new Error('Agent frontmatter must include name and model');
  }

  return {
    frontmatter: {
      name: frontmatter.name,
      model: frontmatter.model,
      sandboxed: frontmatter.sandboxed ?? false,
      tools: frontmatter.tools ?? [],
      skills: frontmatter.skills ?? [],
    },
    systemPromptSection,
  };
}

// --- System Prompt Construction ---

async function buildSystemPrompt(
  agent: AgentDefinition,
  projectPath: string,
  mode: 'standalone' | 'team' = 'standalone',
): Promise<string> {
  const sections: string[] = [];

  // 1. Identity
  const identity = await readTextFile(join(IDENTITY_DIR, 'system-prompt.md'));
  if (identity) sections.push(identity);

  // 2. Rules
  const rules = await readAllFilesInDir(RULES_DIR);
  if (rules.length > 0) {
    sections.push('---\n\n# Rules\n\n' + rules.join('\n\n---\n\n'));
  }

  // 3. Skills referenced by this agent
  for (const skillName of agent.frontmatter.skills) {
    const skill = await readTextFile(join(SKILLS_DIR, `${skillName}.md`));
    if (skill) {
      sections.push(`---\n\n# Skill: ${skillName}\n\n${skill}`);
    }
  }

  // 4. Agent role-specific prompt
  if (agent.systemPromptSection) {
    sections.push(`---\n\n# Your Role\n\n${agent.systemPromptSection}`);
  }

  // 4b. Team mode override — injected into system prompt so it takes priority
  const isArchitect = agent.frontmatter.name.toLowerCase().includes('architect');
  if (mode === 'team' && isArchitect) {
    sections.push(`---\n\n# MANDATORY: Team Mode Active\n\nYou are running in TEAM MODE. This is a non-negotiable hard constraint that overrides all other planning instructions.\n\n**You MUST use Agent Teams.** After reading context and writing DECISIONS.md + PLAN.md preamble, your VERY NEXT action MUST be calling TeamCreate to create the "architect-planning" team. Then spawn planning teammates via the Task tool. Follow the plan-feature-team skill EXACTLY.\n\n**You are FORBIDDEN from writing task sections (### Task N:) to PLAN.md directly.** Only teammates write tasks to PLAN-PART files. You merge them.\n\nIf you write PLAN.md task content without first calling TeamCreate, you have failed your mission. No exceptions, no rationalizations about plan size.`);
  }

  // 5. Project context from .brain/
  const brainDir = join(projectPath, '.brain');
  const brainFiles = [
    'PROJECT.md',
    'DECISIONS.md',
    'PATTERNS.md',
    'MISTAKES.md',
    'REVIEW.md',
  ];

  const brainSections: string[] = [];
  for (const file of brainFiles) {
    let content = await readTextFile(join(brainDir, file));
    if (content && content.trim()) {
      // Cap MISTAKES.md to prevent unbounded token growth — keep NEWEST entries
      if (file === 'MISTAKES.md' && content.length > 3000) {
        const lines = content.split('\n');
        const truncated: string[] = [];
        let charCount = 0;
        for (let j = lines.length - 1; j >= 0; j--) {
          charCount += lines[j]!.length + 1;
          if (charCount > 3000) break;
          truncated.unshift(lines[j]!);
        }
        content = '[...oldest entries truncated]\n\n' + truncated.join('\n');
      }
      brainSections.push(`### ${file}\n\n${content}`);
    }
  }

  // Load RESEARCH/ directory contents if they exist
  const researchFiles = await readAllFilesInDir(join(brainDir, 'RESEARCH'));
  if (researchFiles.length > 0) {
    brainSections.push(`### RESEARCH/\n\n${researchFiles.join('\n\n---\n\n')}`);
  }

  if (brainSections.length > 0) {
    sections.push(
      `---\n\n# Project Context (.brain/)\n\n${brainSections.join('\n\n')}`,
    );
  }

  // 6. Pipeline state (engine-managed)
  const pipelineState = await readPipelineState(projectPath);
  if (pipelineState) {
    const completedStages = pipelineState.stages
      .filter(s => s.status === 'completed')
      .map(s => `- ${s.agent}: completed, validation ${s.validation ?? 'n/a'}`)
      .join('\n');

    const stateSection = [
      `Pipeline: ${pipelineState.pipeline.join(' → ')}`,
      `Status: ${pipelineState.status}`,
      `Current Stage: ${pipelineState.currentStage + 1}/${pipelineState.pipeline.length}`,
      `Retries: ${pipelineState.retries}`,
      completedStages ? `\nCompleted stages:\n${completedStages}` : '',
    ].filter(Boolean).join('\n');

    sections.push(`---\n\n# Pipeline State\n\n${stateSection}`);
  }

  return sections.join('\n\n');
}

// --- Map model string to SDK model name ---

function mapModel(model: string): 'sonnet' | 'opus' | 'haiku' {
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet';
}

// --- Runner ---

/**
 * Spawn an agent session. Reads the agent definition, builds the system prompt,
 * and calls the Agent SDK. If the agent is sandboxed, uses the SDK's built-in sandbox.
 * If mode is 'team', enables Agent Teams for parallel sub-agent work.
 */
export async function runAgent(
  role: string,
  projectPath: string,
  task: string,
  runOptions: RunOptions = {},
): Promise<RunResult> {
  const log = runOptions.log ?? console.log;
  const mode = runOptions.mode ?? 'standalone';

  // 1. Read agent definition
  const agentRaw = await readTextFile(join(AGENTS_DIR, `${role}.md`));
  if (!agentRaw) {
    throw new Error(`Agent definition not found: ${role}`);
  }
  const agent = parseAgentDefinition(agentRaw);

  // 2. Build system prompt
  const systemPrompt = await buildSystemPrompt(agent, projectPath, mode);

  // 3. Prepare query options
  const model = mapModel(agent.frontmatter.model);
  const sandboxed = agent.frontmatter.sandboxed;

  log(`[runner] Spawning ${agent.frontmatter.name} (${model}, sandboxed: ${sandboxed}, mode: ${mode})`);
  log(`[runner] Task: ${task}`);

  // 5. Prepare environment for SDK child process
  const env: Record<string, string | undefined> = { ...process.env };
  delete env['CLAUDECODE'];

  // Enable Agent Teams when running in team mode
  const AGENT_TEAMS_TOOLS = ['TeamCreate', 'TeamDelete', 'SendMessage', 'Task', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'];
  if (mode === 'team') {
    env['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'] = '1';
    log('[runner] Agent Teams enabled via CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1');
  }

  // 6. Determine maxTurns — team sessions run longer
  const maxTurns = runOptions.maxTurns ?? (mode === 'team' ? 200 : 50);

  // 7. Build allowed tools list — add Agent Teams tools when in team mode
  const allowedTools = mode === 'team'
    ? [...new Set([...agent.frontmatter.tools, ...AGENT_TEAMS_TOOLS])]
    : agent.frontmatter.tools;

  // 8. Run agent via SDK
  const claudePath = findClaudeExecutable();
  log(`[runner] Using claude at: ${claudePath}`);

  const isReviewer = role === 'reviewer' || role.includes('review');
  let sessionId: string | undefined;
  let structuredOutput: unknown | undefined;

  for await (const message of query({
    prompt: task,
    options: {
      systemPrompt,
      model,
      maxTurns,
      pathToClaudeCodeExecutable: claudePath,
      allowedTools,
      cwd: projectPath,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      env,
      hooks: runOptions.hooks,
      ...(sandboxed && {
        sandbox: {
          enabled: true,
          autoAllowBashIfSandboxed: true,
        },
      }),
      ...(isReviewer && {
        outputFormat: {
          type: 'json_schema' as const,
          schema: REVIEW_JSON_SCHEMA as Record<string, unknown>,
        },
      }),
      stderr: (data: string) => process.stderr.write(`[stderr] ${data}`),
    },
  })) {
    const msg = message as Record<string, unknown>;

    // Capture session_id from the first message that has one
    if (!sessionId && typeof msg['session_id'] === 'string') {
      sessionId = msg['session_id'];
    }

    // Capture structured_output from result message
    if (msg['type'] === 'result' && msg['subtype'] === 'success') {
      const resultMsg = msg as Record<string, unknown>;
      if (resultMsg['structured_output'] !== undefined) {
        structuredOutput = resultMsg['structured_output'];
      }
    }

    if (msg['type'] === 'assistant' && msg['message']) {
      const assistantMsg = msg['message'] as Record<string, unknown>;
      const content = assistantMsg['content'];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === 'object' && 'type' in block) {
            if (block.type === 'text' && 'text' in block) {
              log(`[${agent.frontmatter.name}] ${block.text}`);
            } else if (block.type === 'tool_use' && 'name' in block) {
              log(`[${agent.frontmatter.name}] tool: ${block.name}`);
            }
          }
        }
      }
    } else if ('result' in msg && typeof msg.result === 'string') {
      log(`[${agent.frontmatter.name}] Result: ${msg.result}`);
    }
  }

  return {
    agentName: agent.frontmatter.name,
    sandboxed,
    mode,
    sessionId,
    structuredOutput,
  };
}
