import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { IpcServer } from './server.js';
import { sendCommand } from './client.js';
import type { IpcCommand, IpcResponse } from './protocol.js';

describe('IPC Server + Client', () => {
  let tempDir: string;
  let server: IpcServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function setup(handler: (cmd: IpcCommand) => Promise<IpcResponse>) {
    tempDir = await mkdtemp(join(tmpdir(), 'cc-ipc-'));
    const socketPath = join(tempDir, 'test.sock');
    server = new IpcServer(socketPath, handler, () => {});
    await server.start();
    return socketPath;
  }

  it('sends a command and receives a response', async () => {
    const socketPath = await setup(async (cmd) => {
      return { ok: true, data: { received: cmd.type } };
    });

    const response = await sendCommand(socketPath, { type: 'status' });
    expect(response.ok).toBe(true);
    expect((response as { ok: true; data: { received: string } }).data.received).toBe('status');
  });

  it('handles error responses', async () => {
    const socketPath = await setup(async () => {
      return { ok: false, error: 'not implemented' };
    });

    const response = await sendCommand(socketPath, { type: 'shutdown' });
    expect(response.ok).toBe(false);
    expect((response as { ok: false; error: string }).error).toBe('not implemented');
  });

  it('handles handler errors gracefully', async () => {
    const socketPath = await setup(async () => {
      throw new Error('handler crashed');
    });

    const response = await sendCommand(socketPath, { type: 'status' });
    expect(response.ok).toBe(false);
    expect((response as { ok: false; error: string }).error).toBe('handler crashed');
  });

  it('handles multiple sequential commands on separate connections', async () => {
    let callCount = 0;
    const socketPath = await setup(async () => {
      callCount++;
      return { ok: true, data: { call: callCount } };
    });

    const r1 = await sendCommand(socketPath, { type: 'status' });
    const r2 = await sendCommand(socketPath, { type: 'queue-list' });

    expect((r1 as { ok: true; data: { call: number } }).data.call).toBe(1);
    expect((r2 as { ok: true; data: { call: number } }).data.call).toBe(2);
  });

  it('client rejects when daemon is not running', async () => {
    const badPath = join(tmpdir(), 'nonexistent-cc-test.sock');
    await expect(sendCommand(badPath, { type: 'status' })).rejects.toThrow(
      'Daemon is not running',
    );
  });

  it('routes different command types to the handler', async () => {
    const received: string[] = [];
    const socketPath = await setup(async (cmd) => {
      received.push(cmd.type);
      return { ok: true, data: null };
    });

    await sendCommand(socketPath, { type: 'status' });
    await sendCommand(socketPath, { type: 'projects-list' });
    await sendCommand(socketPath, { type: 'queue-list' });

    expect(received).toEqual(['status', 'projects-list', 'queue-list']);
  });

  it('passes command data to the handler', async () => {
    let lastCmd: IpcCommand | null = null;
    const socketPath = await setup(async (cmd) => {
      lastCmd = cmd;
      return { ok: true, data: null };
    });

    await sendCommand(socketPath, {
      type: 'run',
      agent: 'scout',
      project: 'test-project',
      task: 'research something',
      mode: 'standalone',
    });

    expect(lastCmd).not.toBeNull();
    const runCmd = lastCmd as unknown as { agent: string; project: string };
    expect(runCmd.agent).toBe('scout');
    expect(runCmd.project).toBe('test-project');
  });

  it('handles invalid JSON from client gracefully', async () => {
    const { connect } = await import('node:net');

    const socketPath = await setup(async () => {
      return { ok: true, data: null };
    });

    // Send garbage directly
    const response = await new Promise<string>((resolve) => {
      const socket = connect(socketPath);
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        if (buf.includes('\n')) {
          socket.end();
          resolve(buf.trim());
        }
      });
      socket.on('connect', () => {
        socket.write('not valid json\n');
      });
    });

    const parsed = JSON.parse(response) as IpcResponse;
    expect(parsed.ok).toBe(false);
    expect((parsed as { ok: false; error: string }).error).toBe('Invalid JSON');
  });

  it('cleans up socket file on stop', async () => {
    const { existsSync } = await import('node:fs');
    const socketPath = await setup(async () => ({ ok: true, data: null }));

    expect(existsSync(socketPath)).toBe(true);
    await server!.stop();
    server = null;
    expect(existsSync(socketPath)).toBe(false);
  });
});
