import { connect } from 'node:net';
import type { IpcCommand, IpcResponse } from './protocol.js';

/**
 * Send a command to the daemon via Unix socket and return the response.
 * Throws if the daemon is not running or the connection fails.
 */
export async function sendCommand(
  socketPath: string,
  command: IpcCommand,
  timeoutMs: number = 30_000,
): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error('IPC request timed out'));
      }
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(JSON.stringify(command) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        if (line && !settled) {
          settled = true;
          clearTimeout(timer);
          socket.end();
          try {
            resolve(JSON.parse(line) as IpcResponse);
          } catch {
            reject(new Error('Invalid response from daemon'));
          }
        }
      }
    });

    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
            (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('Daemon is not running. Start it with: codename start'));
        } else {
          reject(err);
        }
      }
    });
  });
}
