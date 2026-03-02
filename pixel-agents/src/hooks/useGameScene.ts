// pixel-agents/src/hooks/useGameScene.ts
import { useEffect, useRef } from 'react';
import { GameScene } from '../engine/scene';
import type { Theme } from '../themes/types';
import type { WSEvent } from '../ws/types';
import type { LoadedAssets } from './useAssets';

export function useGameScene(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  theme: Theme,
  events: WSEvent[],
  zoom: number,
  assets: LoadedAssets | null,
) {
  const sceneRef = useRef<GameScene | null>(null);
  const lastEventCount = useRef(0);

  // Create scene when canvas and assets are ready
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !assets) return;

    const scene = new GameScene(theme, assets.tileset, assets.characters);
    scene.attach(canvas, zoom);
    scene.start();
    sceneRef.current = scene;

    return () => {
      scene.stop();
      sceneRef.current = null;
    };
  }, [canvasRef, theme, assets]);

  // Push new events
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const newEvents = events.slice(lastEventCount.current);
    for (const e of newEvents) {
      scene.pushEvent(e);
    }
    lastEventCount.current = events.length;
  }, [events]);

  // Update zoom
  useEffect(() => {
    sceneRef.current?.setZoom(zoom);
  }, [zoom]);

  return sceneRef;
}
