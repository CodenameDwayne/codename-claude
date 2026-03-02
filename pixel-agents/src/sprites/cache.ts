// pixel-agents/src/sprites/cache.ts
import type { SpriteData } from './types';

/**
 * Render a SpriteData to an off-screen canvas at the given zoom level.
 * Each non-transparent pixel becomes a zoom×zoom fillRect.
 */
function renderToCanvas(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  const h = sprite.length;
  const w = sprite[0]?.length ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = w * zoom;
  canvas.height = h * zoom;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let row = 0; row < h; row++) {
    const rowData = sprite[row]!;
    for (let col = 0; col < rowData.length; col++) {
      const color = rowData[col];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(col * zoom, row * zoom, zoom, zoom);
    }
  }
  return canvas;
}

/** Per-zoom-level cache using WeakMap for automatic garbage collection. */
const caches = new Map<number, WeakMap<SpriteData, HTMLCanvasElement>>();

/**
 * Get a cached off-screen canvas for a sprite at a given zoom.
 * Renders on first access, then returns cached canvas.
 */
export function getCachedCanvas(sprite: SpriteData, zoom: number): HTMLCanvasElement {
  let zoomCache = caches.get(zoom);
  if (!zoomCache) {
    zoomCache = new WeakMap();
    caches.set(zoom, zoomCache);
  }
  let canvas = zoomCache.get(sprite);
  if (!canvas) {
    canvas = renderToCanvas(sprite, zoom);
    zoomCache.set(sprite, canvas);
  }
  return canvas;
}

/** Clear all cached canvases (call on zoom change). */
export function clearSpriteCache(): void {
  caches.clear();
}
