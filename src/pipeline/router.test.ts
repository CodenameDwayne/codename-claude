import { describe, test, expect } from 'vitest';
import { loadAgentSummaries, routeTask, type AgentSummary } from './router.js';

const mockAgents: AgentSummary[] = [
  { name: 'scout', description: 'researches topics', model: 'sonnet', skills: [] },
  { name: 'architect', description: 'designs systems', model: 'sonnet', skills: [] },
  { name: 'builder', description: 'writes code', model: 'sonnet', skills: [] },
  { name: 'reviewer', description: 'reviews code', model: 'sonnet', skills: [] },
];

describe('loadAgentSummaries', () => {
  test('returns empty array when agents dir does not exist', async () => {
    const result = await loadAgentSummaries('/nonexistent/path');
    expect(result).toEqual([]);
  });
});

describe('routeTask', () => {
  test('returns single-stage pipeline for manual override', async () => {
    const result = await routeTask({
      task: 'fix the bug',
      agents: [],
      projectContext: '',
      manualAgent: 'builder',
    });

    expect(result).toEqual([{ agent: 'builder', teams: false }]);
  });

  test('returns single-stage with teams when manual + teams', async () => {
    const result = await routeTask({
      task: 'fix the bug',
      agents: [],
      projectContext: '',
      manualAgent: 'builder',
      manualTeams: true,
    });

    expect(result).toEqual([{ agent: 'builder', teams: true }]);
  });

  test('routes simple fix to [builder, reviewer]', async () => {
    const result = await routeTask({
      task: 'fix the typo in header component',
      agents: mockAgents,
      projectContext: '',
    });
    expect(result.map(s => s.agent)).toEqual(['builder', 'reviewer']);
  });

  test('routes research task to [scout, architect, builder, reviewer]', async () => {
    const result = await routeTask({
      task: 'research the best auth library and build login',
      agents: mockAgents,
      projectContext: '',
    });
    expect(result.map(s => s.agent)).toEqual(['scout', 'architect', 'builder', 'reviewer']);
  });

  test('routes feature to [architect, builder, reviewer]', async () => {
    const result = await routeTask({
      task: 'add user authentication with JWT',
      agents: mockAgents,
      projectContext: '',
    });
    expect(result.map(s => s.agent)).toEqual(['architect', 'builder', 'reviewer']);
  });

  test('routes complex feature with teams on architect', async () => {
    const result = await routeTask({
      task: 'build a web app with auth, dashboard, API, database, notifications, and payment',
      agents: mockAgents,
      projectContext: '',
    });
    expect(result.map(s => s.agent)).toEqual(['architect', 'builder', 'reviewer']);
    expect(result[0]!.teams).toBe(true);
  });
});
