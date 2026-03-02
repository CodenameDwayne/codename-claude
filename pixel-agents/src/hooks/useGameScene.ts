import { useEffect, useRef } from 'react';
import { GameScene } from '../engine/scene';
import type { Theme } from '../themes/types';
import type { WSEvent } from '../ws/types';

export function useGameScene(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  theme: Theme,
  events: WSEvent[],
  zoom: number,
) {
  const sceneRef = useRef<GameScene | null>(null);
  const lastEventCount = useRef(0);

  // Initialize scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new GameScene(theme);
    scene.attach(canvas, zoom);
    scene.start();
    sceneRef.current = scene;

    return () => {
      scene.stop();
      sceneRef.current = null;
    };
  }, [canvasRef, theme]);

  // Push new events to scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const newEvents = events.slice(lastEventCount.current);
    for (const event of newEvents) {
      scene.pushEvent(event);
    }
    lastEventCount.current = events.length;
  }, [events]);

  // Update zoom
  useEffect(() => {
    sceneRef.current?.setZoom(zoom);
  }, [zoom]);

  return sceneRef;
}
