import { useRef, useState } from 'react';
import { useWebSocket } from './ws/useWebSocket';
import { useGameScene } from './hooks/useGameScene';
import { cyberpunkTheme } from './themes/cyberpunk';
import type { AgentRole } from './ws/types';
import './App.css';

const GLOW_COLORS: Record<AgentRole, string> = {
  scout: '#00ffff',
  architect: '#ffd700',
  builder: '#00ff41',
  reviewer: '#ff00ff',
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(3);
  const { status, events, latestEvent } = useWebSocket();

  useGameScene(canvasRef, cyberpunkTheme, events, zoom);

  // Extract current agent states from events
  const agentStates = useAgentStates(events);

  return (
    <div className="app">
      <header className="header">
        <h1>Codename Claude — Pixel Agents</h1>
        <div className="header-controls">
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
          <span className={`status-dot ${status}`} title={status} />
        </div>
      </header>

      <main className="canvas-container">
        <canvas ref={canvasRef} id="game-canvas" />
      </main>

      <footer className="status-bar">
        {(['scout', 'architect', 'builder', 'reviewer'] as const).map((role) => (
          <span key={role} className="agent-status" style={{ color: GLOW_COLORS[role] }}>
            {role}: {agentStates[role]}
          </span>
        ))}
      </footer>
    </div>
  );
}

function useAgentStates(events: Array<{ type: string; agent?: string; activity?: string; agents?: Record<string, string> }>) {
  const states: Record<AgentRole, string> = {
    scout: 'idle',
    architect: 'idle',
    builder: 'idle',
    reviewer: 'idle',
  };

  for (const event of events) {
    if (event.type === 'state:snapshot' && event.agents) {
      Object.assign(states, event.agents);
    } else if (event.type === 'agent:active' && event.agent) {
      states[event.agent as AgentRole] = event.activity ?? 'active';
    } else if (event.type === 'agent:idle' && event.agent) {
      states[event.agent as AgentRole] = 'idle';
    }
  }

  return states;
}

export default App;
