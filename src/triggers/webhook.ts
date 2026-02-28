import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

// --- Types ---

export interface WebhookEventMapping {
  event: string;
  label?: string;       // for issues.labeled events
  agent?: string;       // agent role for standalone mode
  mode: 'standalone' | 'team';
  task?: string;        // override task description
}

export interface WebhookConfig {
  port: number;
  github: {
    secret: string;
    events: WebhookEventMapping[];
  };
}

export interface WebhookTriggerResult {
  triggerName: string;
  project: string;
  agent: string;
  task: string;
  mode: 'standalone' | 'team';
}

type WebhookHandler = (result: WebhookTriggerResult) => void;

// --- Signature Verification ---

function verifyGitHubSignature(
  secret: string,
  payload: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') return false;

  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const received = parts[1] ?? '';

  if (expected.length !== received.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

// --- Payload Parsing ---

function extractProjectFromRepo(repoFullName: string): string {
  // "owner/repo-name" → "repo-name"
  const parts = repoFullName.split('/');
  return parts[parts.length - 1] ?? repoFullName;
}

function buildTriggerResult(
  event: string,
  payload: Record<string, unknown>,
  mapping: WebhookEventMapping,
): WebhookTriggerResult | null {
  const repo = payload['repository'] as Record<string, unknown> | undefined;
  const repoFullName = (repo?.['full_name'] as string) ?? 'unknown';
  const project = extractProjectFromRepo(repoFullName);

  if (event === 'issues' && mapping.event === 'issues.labeled') {
    const action = payload['action'] as string | undefined;
    if (action !== 'labeled') return null;

    const label = payload['label'] as Record<string, unknown> | undefined;
    const labelName = label?.['name'] as string | undefined;
    if (mapping.label && labelName !== mapping.label) return null;

    const issue = payload['issue'] as Record<string, unknown> | undefined;
    const issueTitle = (issue?.['title'] as string) ?? 'untitled';
    const issueBody = (issue?.['body'] as string) ?? '';
    const issueNumber = issue?.['number'] as number | undefined;

    return {
      triggerName: `webhook:issue-${issueNumber ?? 'unknown'}`,
      project,
      agent: mapping.agent ?? 'team-lead',
      task: mapping.task ?? `Build feature from issue #${issueNumber}: ${issueTitle}\n\n${issueBody}`,
      mode: mapping.mode,
    };
  }

  if (event === 'pull_request' && mapping.event === 'pull_request.opened') {
    const action = payload['action'] as string | undefined;
    if (action !== 'opened') return null;

    const pr = payload['pull_request'] as Record<string, unknown> | undefined;
    const prTitle = (pr?.['title'] as string) ?? 'untitled';
    const prNumber = pr?.['number'] as number | undefined;
    const prBody = (pr?.['body'] as string) ?? '';
    const headRef = (pr?.['head'] as Record<string, unknown>)?.['ref'] as string | undefined;

    return {
      triggerName: `webhook:pr-${prNumber ?? 'unknown'}`,
      project,
      agent: mapping.agent ?? 'reviewer',
      task: mapping.task ?? `Review pull request #${prNumber}: ${prTitle}\nBranch: ${headRef ?? 'unknown'}\n\n${prBody}`,
      mode: mapping.mode,
    };
  }

  return null;
}

// --- Webhook Server ---

export class WebhookServer {
  private config: WebhookConfig;
  private server: ReturnType<typeof createServer> | null = null;
  private handler: WebhookHandler;
  private log: (message: string) => void;

  constructor(
    config: WebhookConfig,
    handler: WebhookHandler,
    log: (message: string) => void = console.log,
  ) {
    this.config = config;
    this.handler = handler;
    this.log = log;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.config.port, () => {
        this.log(`[webhook] listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.log('[webhook] server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only accept POST to /webhook
    if (req.method !== 'POST' || req.url !== '/webhook') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');

      // Verify signature
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      if (!verifyGitHubSignature(this.config.github.secret, body, signature)) {
        this.log('[webhook] signature verification failed');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid signature' }));
        return;
      }

      // Parse event
      const event = req.headers['x-github-event'] as string | undefined;
      if (!event) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing x-github-event header' }));
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }

      // Match against configured event mappings
      let matched = false;
      for (const mapping of this.config.github.events) {
        const result = buildTriggerResult(event, payload, mapping);
        if (result) {
          this.log(`[webhook] matched ${event} → ${result.triggerName} (${result.mode})`);
          this.handler(result);
          matched = true;
          break;
        }
      }

      if (!matched) {
        this.log(`[webhook] no mapping for event: ${event}`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, matched }));
    });
  }
}

// --- Exports for testing ---

export { verifyGitHubSignature, buildTriggerResult, extractProjectFromRepo };
