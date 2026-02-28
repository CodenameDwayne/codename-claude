import { describe, test, expect } from 'vitest';
import { loadAgentSummaries, type AgentSummary } from './router.js';

describe('loadAgentSummaries', () => {
  test('returns empty array when agents dir does not exist', async () => {
    const result = await loadAgentSummaries('/nonexistent/path');
    expect(result).toEqual([]);
  });
});
