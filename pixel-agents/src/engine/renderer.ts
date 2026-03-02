import type { Character } from '../agents/characterState';
import type { TileMap } from './tileMap';
import { TILE_SIZE } from './tileMap';
import type { SpriteData } from '../sprites/types';

export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  zoom: number;
  camera: { x: number; y: number };
}

export function createRenderContext(canvas: HTMLCanvasElement, zoom: number = 3): RenderContext {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false; // Crisp pixel art
  return {
    canvas,
    ctx,
    zoom,
    camera: { x: 0, y: 0 },
  };
}

export function resizeCanvas(rc: RenderContext, map: TileMap): void {
  const mapWidth = map.width * TILE_SIZE * rc.zoom;
  const mapHeight = map.height * TILE_SIZE * rc.zoom;
  rc.canvas.width = mapWidth;
  rc.canvas.height = mapHeight;
  rc.ctx.imageSmoothingEnabled = false;
}

export function clearCanvas(rc: RenderContext, bgColor: string): void {
  rc.ctx.fillStyle = bgColor;
  rc.ctx.fillRect(0, 0, rc.canvas.width, rc.canvas.height);
}

export function renderSprite(rc: RenderContext, sprite: SpriteData, x: number, y: number): void {
  const z = rc.zoom;
  for (let row = 0; row < sprite.length; row++) {
    const rowData = sprite[row]!;
    for (let col = 0; col < rowData.length; col++) {
      const color = rowData[col];
      if (!color) continue; // transparent
      rc.ctx.fillStyle = color;
      rc.ctx.fillRect(
        (x + col) * z - rc.camera.x,
        (y + row) * z - rc.camera.y,
        z,
        z,
      );
    }
  }
}

export function renderGlow(rc: RenderContext, x: number, y: number, w: number, h: number, color: string, alpha: number = 0.3): void {
  const z = rc.zoom;
  rc.ctx.fillStyle = color;
  rc.ctx.globalAlpha = alpha;
  // Glow slightly larger than sprite
  rc.ctx.fillRect(
    (x - 1) * z - rc.camera.x,
    (y - 1) * z - rc.camera.y,
    (w + 2) * z,
    (h + 2) * z,
  );
  rc.ctx.globalAlpha = 1;
}

export function renderText(rc: RenderContext, text: string, x: number, y: number, color: string = '#ffffff'): void {
  const z = rc.zoom;
  rc.ctx.fillStyle = color;
  rc.ctx.font = `${8 * z}px 'Courier New', monospace`;
  rc.ctx.textAlign = 'center';
  rc.ctx.fillText(text, x * z - rc.camera.x, y * z - rc.camera.y);
}

/**
 * Render characters Z-sorted by Y position for correct depth.
 */
export function renderCharacters(
  rc: RenderContext,
  characters: Character[],
  getSprite: (char: Character) => SpriteData | null,
  getGlowColor: (role: string) => string,
): void {
  // Sort by Y for depth ordering
  const sorted = [...characters].sort((a, b) => a.pos.y - b.pos.y);

  for (const char of sorted) {
    const sprite = getSprite(char);
    if (!sprite) continue;

    const glowColor = getGlowColor(char.role);

    // Render glow underlayer
    renderGlow(rc, char.pos.x, char.pos.y, sprite[0]?.length ?? 16, sprite.length, glowColor, 0.15);

    // Render sprite
    renderSprite(rc, sprite, char.pos.x, char.pos.y);

    // Render name label
    const labelX = char.pos.x + (sprite[0]?.length ?? 16) / 2;
    const labelY = char.pos.y - 4;
    renderText(rc, char.role, labelX, labelY, glowColor);
  }
}
