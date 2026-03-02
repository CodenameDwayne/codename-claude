// pixel-agents/src/App.tsx
import { useRef, useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './ws/useWebSocket';
import { useGameScene } from './hooks/useGameScene';
import { useAssets } from './hooks/useAssets';
import { officeTheme } from './themes/office';
import { AGENT_COLORS } from './sprites/characters';
import { DemoRunner } from './demo/demoMode';
import type { WSEvent, AgentRole, ConnectionStatus } from './ws/types';
import './App.css';

const ROLES: AgentRole[] = ['scout', 'architect', 'builder', 'reviewer'];

function useAgentStates(events: WSEvent[]) {
  const states = useRef<Record<AgentRole, string>>({
    scout: 'Idle', architect: 'Idle', builder: 'Idle', reviewer: 'Idle',
  });
  const latest = events[events.length - 1];
  if (latest) {
    if (latest.type === 'agent:active') states.current[latest.agent] = latest.activity;
    if (latest.type === 'agent:idle') states.current[latest.agent] = 'Idle';
  }
  return states.current;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(3);
  const [demoActive, setDemoActive] = useState(false);
  const [demoEvents, setDemoEvents] = useState<WSEvent[]>([]);
  const demoRef = useRef<DemoRunner | null>(null);

  const { assets, error: assetError } = useAssets();
  const { status, events: wsEvents } = useWebSocket();

  const events = status === 'connected' ? wsEvents : demoEvents;
  const agentStates = useAgentStates(events);

  useGameScene(canvasRef, officeTheme, events, zoom, assets);

  const pushDemoEvent = useCallback((event: WSEvent) => {
    setDemoEvents((prev) => [...prev.slice(-99), event]);
  }, []);

  const toggleDemo = useCallback(() => {
    if (demoActive) {
      demoRef.current?.stop();
      demoRef.current = null;
      setDemoActive(false);
      setDemoEvents([]);
    } else {
      const runner = new DemoRunner();
      demoRef.current = runner;
      setDemoActive(true);
      setDemoEvents([]);
      runner.start(pushDemoEvent);
    }
  }, [demoActive, pushDemoEvent]);

  useEffect(() => {
    if (status === 'connected' && demoActive) {
      demoRef.current?.stop();
      demoRef.current = null;
      setDemoActive(false);
    }
  }, [status, demoActive]);

  useEffect(() => {
    return () => { demoRef.current?.stop(); };
  }, []);

  if (assetError) {
    return <div className="app loading">Failed to load assets: {assetError}</div>;
  }

  if (!assets) {
    return <div className="app loading">Loading assets...</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Codename Claude — Pixel Agents</h1>
        <div className="controls">
          <button className="demo-btn" onClick={toggleDemo}>
            {demoActive ? 'STOP DEMO' : 'RUN DEMO'}
          </button>
          <label className="zoom-control">
            Zoom:
            <input
              type="range"
              min={1}
              max={5}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            {zoom}x
          </label>
          <StatusDot status={status} />
        </div>
      </header>
      <div className="canvas-container">
        <canvas ref={canvasRef} />
        <div className="vignette" />
      </div>
      <footer className="status-bar">
        {ROLES.map((role) => (
          <span key={role} className="agent-status" style={{ color: AGENT_COLORS[role] }}>
            {role}: {agentStates[role]}
          </span>
        ))}
        {demoActive && <span className="agent-status demo-label">DEMO</span>}
      </footer>
    </div>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  return <span className={`status-dot ${status}`} />;
}
