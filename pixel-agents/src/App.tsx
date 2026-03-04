import { useRef, useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './ws/useWebSocket';
import { useGameScene } from './hooks/useGameScene';
import { useAssets } from './hooks/useAssets';
import { useMissionControl } from './hooks/useMissionControl';
import { officeTheme } from './themes/office';
import { DemoRunner } from './demo/demoMode';
import { PipelinePanel } from './components/PipelinePanel';
import { TasksPanel } from './components/TasksPanel';
import { FooterBar } from './components/FooterBar';
import { CommandPalette } from './components/CommandPalette';
import type { WSEvent } from './ws/types';
import './App.css';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(3);
  const [demoActive, setDemoActive] = useState(false);
  const [demoEvents, setDemoEvents] = useState<WSEvent[]>([]);
  const [cmdOpen, setCmdOpen] = useState(false);
  const demoRef = useRef<DemoRunner | null>(null);

  const { assets, error: assetError } = useAssets();
  const { status, events: wsEvents } = useWebSocket();

  const events = status === 'connected' ? wsEvents : demoEvents;
  const mc = useMissionControl(events);

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

  // ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const commands = [
    { key: 'demo', label: demoActive ? 'Stop demo' : 'Run demo', action: toggleDemo },
    { key: 'zoom-in', label: 'Zoom in', action: () => setZoom((z) => Math.min(z + 1, 5)) },
    { key: 'zoom-out', label: 'Zoom out', action: () => setZoom((z) => Math.max(z - 1, 1)) },
  ];

  if (assetError) {
    return <div className="loading">Failed to load assets: {assetError}</div>;
  }

  if (!assets) {
    return <div className="loading">Loading assets...</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span className="title-accent">codename claude</span> ─── mission control
        </h1>
        <div className="controls">
          <button className="demo-btn" onClick={toggleDemo}>
            {demoActive ? 'STOP' : 'DEMO'}
          </button>
          <label className="zoom-control">
            <input
              type="range"
              min={1}
              max={5}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            {zoom}x
          </label>
          <button
            className="demo-btn"
            onClick={() => setCmdOpen(true)}
            style={{ fontSize: 10, padding: '3px 8px' }}
          >
            ⌘K
          </button>
        </div>
      </header>

      <PipelinePanel
        stages={mc.stages}
        phase={mc.phase}
        taskDescription={mc.taskDescription}
      />

      <div className="canvas-area">
        <canvas ref={canvasRef} />
        <div className="vignette" />
      </div>

      <TasksPanel
        tasks={mc.tasks}
        lastVerdict={mc.lastVerdict}
      />

      <FooterBar
        budget={mc.budget}
        uptime={mc.uptime}
        status={status}
        demoActive={demoActive}
      />

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        commands={commands}
      />
    </div>
  );
}
