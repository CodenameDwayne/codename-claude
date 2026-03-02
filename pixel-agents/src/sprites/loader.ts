// pixel-agents/src/sprites/loader.ts
import type { SpriteData } from './types';

/**
 * Load a PNG from a URL and return an HTMLImageElement.
 */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Extract all pixel data from an image into a flat ImageData.
 */
export function imageToPixels(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

/**
 * Extract a rectangular region from ImageData as SpriteData.
 * Transparent pixels (alpha < 10) become '' (empty string).
 */
export function extractSprite(
  imageData: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): SpriteData {
  const sprite: SpriteData = [];
  for (let row = 0; row < h; row++) {
    const rowData: string[] = [];
    for (let col = 0; col < w; col++) {
      const idx = ((y + row) * imageData.width + (x + col)) * 4;
      const r = imageData.data[idx]!;
      const g = imageData.data[idx + 1]!;
      const b = imageData.data[idx + 2]!;
      const a = imageData.data[idx + 3]!;
      if (a < 10) {
        rowData.push('');
      } else {
        rowData.push(
          `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
        );
      }
    }
    sprite.push(rowData);
  }
  return sprite;
}

/**
 * Horizontally flip a sprite (for generating left-facing from right-facing).
 */
export function flipSpriteH(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse());
}

/**
 * Slice a tileset image into a grid of sprites.
 */
export function sliceTileset(
  imageData: ImageData,
  tileW: number,
  tileH: number,
): SpriteData[][] {
  const cols = Math.floor(imageData.width / tileW);
  const rows = Math.floor(imageData.height / tileH);
  const grid: SpriteData[][] = [];
  for (let row = 0; row < rows; row++) {
    const rowSprites: SpriteData[] = [];
    for (let col = 0; col < cols; col++) {
      rowSprites.push(extractSprite(imageData, col * tileW, row * tileH, tileW, tileH));
    }
    grid.push(rowSprites);
  }
  return grid;
}
