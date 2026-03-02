import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [connected, setConnected] = useState(false);

  return (
    <div className="app">
      <header className="header">
        <h1>Codename Claude — Pixel Agents</h1>
        <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
      </header>
      <main className="canvas-container">
        <canvas id="game-canvas" />
      </main>
      <footer className="status-bar">
        <span>Pipeline: idle</span>
      </footer>
    </div>
  );
}

export default App;
