import { describe, test, expect, vi } from 'vitest';
import { loadAgentSummaries, routeTask, type AgentSummary, type PipelineStage } from './router.js';

describe('loadAgentSummaries', () => {
  test('returns empty array when agents dir does not exist', async () => {
    const result = await loadAgentSummaries('/nonexistent/path');
    expect(result).toEqual([]);
  });
});

describe('routeTask', () => {
  test('calls Anthropic API and returns parsed stages', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { agent: 'builder', teams: false },
        { agent: 'reviewer', teams: false },
      ])}],
    });

    const agents: AgentSummary[] = [
      { name: 'builder', description: 'writes code', model: 'sonnet', skills: [] },
      { name: 'reviewer', description: 'reviews code', model: 'sonnet', skills: [] },
    ];

    const result = await routeTask({
      task: 'add a login page',
      agents,
      projectContext: 'A web app',
      createMessage: mockCreate,
    });

    expect(result).toEqual([
      { agent: 'builder', teams: false },
      { agent: 'reviewer', teams: false },
    ]);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

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
});
