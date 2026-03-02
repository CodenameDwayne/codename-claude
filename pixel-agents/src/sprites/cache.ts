import type { SpriteData } from './types';

/**
 * Pre-render a sprite to an ImageData at a given zoom level.
 * This avoids per-pixel fillRect calls during render — just drawImage instead.
 */
export function spriteToImageData(
  sprite: SpriteData,
  zoom: number,
  ctx: CanvasRenderingContext2D,
): ImageData {
  const h = sprite.length;
  const w = sprite[0]?.length ?? 0;
  const imgData = ctx.createImageData(w * zoom, h * zoom);
  const data = imgData.data;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const color = sprite[row]?.[col];
      if (!color) continue;

      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);

      // Fill the zoomed block
      for (let dy = 0; dy < zoom; dy++) {
        for (let dx = 0; dx < zoom; dx++) {
          const px = (col * zoom + dx);
          const py = (row * zoom + dy);
          const idx = (py * w * zoom + px) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }
    }
  }

  return imgData;
}

/**
 * Simple cache for pre-rendered sprites at different zoom levels.
 */
export class SpriteCache {
  private cache = new Map<string, ImageData>();

  get(key: string, zoom: number): ImageData | undefined {
    return this.cache.get(`${key}:${zoom}`);
  }

  set(key: string, zoom: number, data: ImageData): void {
    this.cache.set(`${key}:${zoom}`, data);
  }

  clear(): void {
    this.cache.clear();
  }
}
