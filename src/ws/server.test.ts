import { describe, it, expect, afterEach, vi } from 'vitest';
import { WSBridgeServer } from './server.js';
import { EventBus } from '../notifications/events.js';
import WebSocket from 'ws';

describe('WSBridgeServer', () => {
  let server: WSBridgeServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('starts and stops cleanly', async () => {
    const bus = new EventBus();
    server = new WSBridgeServer(bus, { port: 0 }, () => {});
    const port = await server.start();
    expect(port).toBeGreaterThan(0);
    await server.stop();
    server = null;
  });

  it('broadcasts EventBus events to connected clients', async () => {
    const bus = new EventBus();
    server = new WSBridgeServer(bus, { port: 0 }, () => {});
    const port = await server.start();

    // Connect a client
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => client.on('open', resolve));

    // Collect messages
    const messages: string[] = [];
    client.on('message', (data) => messages.push(data.toString()));

    // Emit a pipeline event — server should translate and broadcast
    bus.emit({
      type: 'session.started',
      project: '/test',
      agent: 'scout',
      task: 'research X',
      timestamp: Date.now(),
    });

    // Wait for message delivery
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(messages[0]!);
    expect(parsed.type).toBe('agent:active');
    expect(parsed.agent).toBe('scout');

    client.close();
  });

  it('sends state snapshot on client connect', async () => {
    const bus = new EventBus();
    server = new WSBridgeServer(bus, { port: 0 }, () => {});
    const port = await server.start();

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    const firstMessage = await new Promise<string>((resolve) => {
      client.on('message', (data) => resolve(data.toString()));
    });

    const parsed = JSON.parse(firstMessage);
    expect(parsed.type).toBe('state:snapshot');
    expect(parsed.agents).toBeDefined();

    client.close();
  });

  it('handles multiple clients', async () => {
    const bus = new EventBus();
    server = new WSBridgeServer(bus, { port: 0 }, () => {});
    const port = await server.start();

    const client1 = new WebSocket(`ws://127.0.0.1:${port}`);
    const client2 = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([
      new Promise<void>((r) => client1.on('open', r)),
      new Promise<void>((r) => client2.on('open', r)),
    ]);

    // Skip initial snapshot messages
    await new Promise((r) => setTimeout(r, 50));

    const msgs1: string[] = [];
    const msgs2: string[] = [];
    client1.on('message', (d) => msgs1.push(d.toString()));
    client2.on('message', (d) => msgs2.push(d.toString()));

    bus.emit({
      type: 'pipeline.started',
      project: '/test',
      task: 'build feature',
      stages: ['scout', 'architect', 'builder', 'reviewer'],
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(msgs1.length).toBeGreaterThanOrEqual(1);
    expect(msgs2.length).toBeGreaterThanOrEqual(1);

    client1.close();
    client2.close();
  });

  it('translates session.completed with verdict to verdict event', async () => {
    const bus = new EventBus();
    server = new WSBridgeServer(bus, { port: 0 }, () => {});
    const port = await server.start();

    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((r) => client.on('open', r));
    // Skip snapshot
    await new Promise((r) => setTimeout(r, 50));

    const messages: string[] = [];
    client.on('message', (d) => messages.push(d.toString()));

    bus.emit({
      type: 'session.completed',
      project: '/test',
      agent: 'reviewer',
      verdict: 'APPROVE',
      score: 9,
      timestamp: Date.now(),
    });

    await new Promise((r) => setTimeout(r, 50));

    // Should receive both agent:idle and verdict events
    const types = messages.map((m) => JSON.parse(m).type);
    expect(types).toContain('verdict');

    client.close();
  });

  it('cleans up EventBus listener on stop', async () => {
    const bus = new EventBus();
    server = new WSBridgeServer(bus, { port: 0 }, () => {});
    await server.start();
    await server.stop();
    server = null;

    // Emitting after stop should not throw
    bus.emit({
      type: 'session.started',
      project: '/test',
      agent: 'scout',
      task: 'test',
      timestamp: Date.now(),
    });
  });
});
