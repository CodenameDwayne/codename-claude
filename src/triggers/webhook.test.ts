import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyGitHubSignature,
  buildTriggerResult,
  extractProjectFromRepo,
  WebhookServer,
  type WebhookConfig,
  type WebhookTriggerResult,
} from './webhook.js';

// --- Signature Verification ---

describe('verifyGitHubSignature', () => {
  const secret = 'test-secret-123';
  const payload = '{"action":"labeled"}';

  function makeSignature(body: string, key: string): string {
    const hmac = createHmac('sha256', key).update(body).digest('hex');
    return `sha256=${hmac}`;
  }

  it('accepts valid signature', () => {
    const sig = makeSignature(payload, secret);
    expect(verifyGitHubSignature(secret, payload, sig)).toBe(true);
  });

  it('rejects missing signature', () => {
    expect(verifyGitHubSignature(secret, payload, undefined)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const sig = makeSignature(payload, 'wrong-secret');
    expect(verifyGitHubSignature(secret, payload, sig)).toBe(false);
  });

  it('rejects tampered payload', () => {
    const sig = makeSignature(payload, secret);
    expect(verifyGitHubSignature(secret, 'tampered', sig)).toBe(false);
  });

  it('rejects non-sha256 algorithm', () => {
    const hmac = createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyGitHubSignature(secret, payload, `sha1=${hmac}`)).toBe(false);
  });
});

// --- Project Extraction ---

describe('extractProjectFromRepo', () => {
  it('extracts repo name from full name', () => {
    expect(extractProjectFromRepo('dwayne/my-project')).toBe('my-project');
  });

  it('handles single name (no slash)', () => {
    expect(extractProjectFromRepo('my-project')).toBe('my-project');
  });
});

// --- Event Matching ---

describe('buildTriggerResult', () => {
  describe('issues.labeled', () => {
    const mapping = {
      event: 'issues.labeled',
      label: 'auto-build',
      mode: 'team' as const,
    };

    it('matches labeled issue with correct label', () => {
      const payload = {
        action: 'labeled',
        label: { name: 'auto-build' },
        issue: { title: 'Add login', body: 'We need auth', number: 42 },
        repository: { full_name: 'dwayne/my-app' },
      };

      const result = buildTriggerResult('issues', payload, mapping);
      expect(result).not.toBeNull();
      expect(result!.triggerName).toBe('webhook:issue-42');
      expect(result!.project).toBe('my-app');
      expect(result!.agent).toBe('team-lead');
      expect(result!.mode).toBe('team');
      expect(result!.task).toContain('Add login');
      expect(result!.task).toContain('We need auth');
    });

    it('rejects wrong label', () => {
      const payload = {
        action: 'labeled',
        label: { name: 'bug' },
        issue: { title: 'Fix thing', body: '', number: 1 },
        repository: { full_name: 'dwayne/my-app' },
      };

      const result = buildTriggerResult('issues', payload, mapping);
      expect(result).toBeNull();
    });

    it('rejects non-labeled action', () => {
      const payload = {
        action: 'opened',
        label: { name: 'auto-build' },
        issue: { title: 'New', body: '', number: 2 },
        repository: { full_name: 'dwayne/my-app' },
      };

      const result = buildTriggerResult('issues', payload, mapping);
      expect(result).toBeNull();
    });

    it('uses custom agent and task when specified', () => {
      const customMapping = {
        event: 'issues.labeled',
        label: 'auto-build',
        agent: 'scout',
        mode: 'standalone' as const,
        task: 'Research this issue',
      };

      const payload = {
        action: 'labeled',
        label: { name: 'auto-build' },
        issue: { title: 'Research topic', body: '', number: 10 },
        repository: { full_name: 'dwayne/my-app' },
      };

      const result = buildTriggerResult('issues', payload, customMapping);
      expect(result!.agent).toBe('scout');
      expect(result!.task).toBe('Research this issue');
    });
  });

  describe('pull_request.opened', () => {
    const mapping = {
      event: 'pull_request.opened',
      agent: 'reviewer',
      mode: 'standalone' as const,
    };

    it('matches opened PR', () => {
      const payload = {
        action: 'opened',
        pull_request: {
          title: 'Add feature X',
          number: 99,
          body: 'Implements feature X',
          head: { ref: 'feature/x' },
        },
        repository: { full_name: 'dwayne/my-app' },
      };

      const result = buildTriggerResult('pull_request', payload, mapping);
      expect(result).not.toBeNull();
      expect(result!.triggerName).toBe('webhook:pr-99');
      expect(result!.project).toBe('my-app');
      expect(result!.agent).toBe('reviewer');
      expect(result!.mode).toBe('standalone');
      expect(result!.task).toContain('Add feature X');
      expect(result!.task).toContain('feature/x');
    });

    it('rejects non-opened action', () => {
      const payload = {
        action: 'closed',
        pull_request: { title: 'Done', number: 1, body: '', head: { ref: 'main' } },
        repository: { full_name: 'dwayne/my-app' },
      };

      const result = buildTriggerResult('pull_request', payload, mapping);
      expect(result).toBeNull();
    });
  });

  it('returns null for unknown event type', () => {
    const mapping = { event: 'push', mode: 'standalone' as const };
    const result = buildTriggerResult('push', {}, mapping);
    expect(result).toBeNull();
  });
});

// --- WebhookServer ---

describe('WebhookServer', () => {
  const secret = 'test-secret';
  const config: WebhookConfig = {
    port: 0, // random port
    github: {
      secret,
      events: [
        { event: 'issues.labeled', label: 'auto-build', mode: 'team' },
        { event: 'pull_request.opened', agent: 'reviewer', mode: 'standalone' },
      ],
    },
  };

  let server: WebhookServer | null = null;
  let serverPort: number;
  const results: WebhookTriggerResult[] = [];

  async function startServer(): Promise<number> {
    results.length = 0;
    server = new WebhookServer(config, (r) => results.push(r), () => {});

    // Use port 0 to get a random available port
    return new Promise((resolve) => {
      const httpServer = (server as unknown as { server: ReturnType<typeof import('node:http').createServer> }).server;
      // We need to start the server and get the actual port
      server!.start().then(() => {
        const inner = (server as unknown as Record<string, unknown>)['server'] as { address(): { port: number } };
        resolve(inner.address().port);
      });
    });
  }

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('starts and stops cleanly', async () => {
    server = new WebhookServer(config, () => {}, () => {});
    await server.start();
    await server.stop();
    server = null;
  });

  it('rejects invalid signature', async () => {
    server = new WebhookServer(config, (r) => results.push(r), () => {});
    await server.start();
    const inner = (server as unknown as Record<string, unknown>)['server'] as { address(): { port: number } };
    serverPort = inner.address().port;

    const body = JSON.stringify({ action: 'labeled' });
    const res = await fetch(`http://localhost:${serverPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'issues',
        'x-hub-signature-256': 'sha256=invalid',
      },
      body,
    });

    expect(res.status).toBe(401);
  });

  it('processes valid issue labeled webhook', async () => {
    server = new WebhookServer(config, (r) => results.push(r), () => {});
    await server.start();
    const inner = (server as unknown as Record<string, unknown>)['server'] as { address(): { port: number } };
    serverPort = inner.address().port;

    const body = JSON.stringify({
      action: 'labeled',
      label: { name: 'auto-build' },
      issue: { title: 'Build auth', body: 'We need it', number: 5 },
      repository: { full_name: 'dwayne/my-app' },
    });

    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    const res = await fetch(`http://localhost:${serverPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-github-event': 'issues',
        'x-hub-signature-256': sig,
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; matched: boolean };
    expect(json.ok).toBe(true);
    expect(json.matched).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]!.triggerName).toBe('webhook:issue-5');
    expect(results[0]!.mode).toBe('team');
  });

  it('returns 404 for non-webhook paths', async () => {
    server = new WebhookServer(config, () => {}, () => {});
    await server.start();
    const inner = (server as unknown as Record<string, unknown>)['server'] as { address(): { port: number } };
    serverPort = inner.address().port;

    const res = await fetch(`http://localhost:${serverPort}/other`);
    expect(res.status).toBe(404);
  });
});
