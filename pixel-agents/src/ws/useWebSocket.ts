import { useEffect, useRef, useState, useCallback } from 'react';
import type { WSEvent, ConnectionStatus } from './types';

const DEFAULT_URL = 'ws://127.0.0.1:9100';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function useWebSocket(url: string = DEFAULT_URL) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [events, setEvents] = useState<WSEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      reconnectAttempt.current = 0;
    };

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as WSEvent;
        setEvents((prev) => [...prev.slice(-99), event]); // Keep last 100
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      setStatus('reconnecting');
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** reconnectAttempt.current,
        RECONNECT_MAX_MS,
      );
      reconnectAttempt.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const latestEvent = events[events.length - 1] ?? null;

  return { status, events, latestEvent };
}
