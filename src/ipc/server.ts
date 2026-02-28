import { createServer, type Server, type Socket } from 'node:net';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { IpcCommand, IpcResponse } from './protocol.js';

export type CommandHandler = (command: IpcCommand) => Promise<IpcResponse>;

export class IpcServer {
  private server: Server | null = null;
  private socketPath: string;
  private handler: CommandHandler;
  private log: (message: string) => void;

  constructor(
    socketPath: string,
    handler: CommandHandler,
    log: (message: string) => void = console.log,
  ) {
    this.socketPath = socketPath;
    this.handler = handler;
    this.log = log;
  }

  async start(): Promise<void> {
    // Clean up stale socket file
    if (existsSync(this.socketPath)) {
      await unlink(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        this.log(`[ipc] server error: ${err.message}`);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        this.log(`[ipc] listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.log('[ipc] server stopped');
          // Clean up socket file
          if (existsSync(this.socketPath)) {
            unlink(this.socketPath).catch(() => {});
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleConnection(socket: Socket): void {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      // Process complete lines (newline-delimited JSON)
      const lines = buffer.split('\n');
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.processMessage(line.trim(), socket);
      }
    });

    socket.on('error', (err) => {
      this.log(`[ipc] client error: ${err.message}`);
    });
  }

  private processMessage(raw: string, socket: Socket): void {
    let command: IpcCommand;
    try {
      command = JSON.parse(raw) as IpcCommand;
    } catch {
      const response: IpcResponse = { ok: false, error: 'Invalid JSON' };
      socket.write(JSON.stringify(response) + '\n');
      return;
    }

    this.handler(command)
      .then((response) => {
        socket.write(JSON.stringify(response) + '\n');
      })
      .catch((err) => {
        const response: IpcResponse = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        socket.write(JSON.stringify(response) + '\n');
      });
  }
}
