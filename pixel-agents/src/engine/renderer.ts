// pixel-agents/src/engine/renderer.ts
import type { Character } from '../agents/characterState';
import type { TileMap } from './tileMap';
import { TileType, TILE_SIZE } from './tileMap';
import type { SpriteData, TilesetGrid, CharacterSprites } from '../sprites/types';
import type { Theme } from '../themes/types';
import type { AgentRole } from '../ws/types';
import { getCachedCanvas } from '../sprites/cache';
import { getTileSprite } from '../sprites/tileset';
import { BUBBLE_WORKING, BUBBLE_WAITING } from '../sprites/bubbles';

export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  zoom: number;
  camera: { x: number; y: number };
}

export function createRenderContext(canvas: HTMLCanvasElement, zoom: number): RenderContext {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx, zoom, camera: { x: 0, y: 0 } };
}

export function resizeCanvas(rc: RenderContext): void {
  const parent = rc.canvas.parentElement;
  if (!parent) return;
  const dpr = window.devicePixelRatio || 1;
  rc.canvas.width = parent.clientWidth * dpr;
  rc.canvas.height = parent.clientHeight * dpr;
  rc.ctx.imageSmoothingEnabled = false;
}

export function clearCanvas(rc: RenderContext, bg: string): void {
  rc.ctx.fillStyle = bg;
  rc.ctx.fillRect(0, 0, rc.canvas.width, rc.canvas.height);
}

/** Render floor and wall tiles from the tileset. */
export function renderTilemap(
  rc: RenderContext,
  map: TileMap,
  tileset: TilesetGrid,
  theme: Theme,
): void {
  const z = rc.zoom;
  const floorSprite = getTileSprite(tileset, theme.floorTile);
  const wallSprite = getTileSprite(tileset, theme.wallTile);
  const floorCanvas = getCachedCanvas(floorSprite, z);
  const wallCanvas = getCachedCanvas(wallSprite, z);

  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const tile = map.tiles[row]![col]!;
      const px = col * TILE_SIZE * z - rc.camera.x;
      const py = row * TILE_SIZE * z - rc.camera.y;

      if (tile === TileType.Wall) {
        rc.ctx.drawImage(wallCanvas, px, py);
      } else {
        // Everything that's not a wall gets a floor tile underneath
        rc.ctx.drawImage(floorCanvas, px, py);
      }
    }
  }
}

/** Drawable item for z-sorting. */
interface ZDrawable {
  zY: number;
  draw: () => void;
}

/** Render a single sprite at a world position using the cache. */
function drawSprite(rc: RenderContext, sprite: SpriteData, worldX: number, worldY: number): void {
  const z = rc.zoom;
  const canvas = getCachedCanvas(sprite, z);
  rc.ctx.drawImage(canvas, worldX * z - rc.camera.x, worldY * z - rc.camera.y);
}

/** Get the current sprite frame for a character based on state. */
function getCharacterFrame(
  sprites: CharacterSprites,
  char: Character,
): SpriteData | null {
  const dir = char.direction;
  const dirSprites = sprites[dir];
  if (!dirSprites) return null;

  const st = char.state;
  switch (st.state) {
    case 'idle':
    case 'celebrating':
      return dirSprites.idle[char.animFrame % dirSprites.idle.length] ?? null;
    case 'walking':
    case 'carrying':
      return dirSprites.walk[char.animFrame % dirSprites.walk.length] ?? null;
    case 'working':
      return dirSprites.idle[char.animFrame % dirSprites.idle.length] ?? null;
    default:
      return dirSprites.idle[0] ?? null;
  }
}

/** Render furniture and characters together with Y-based depth sorting. */
export function renderScene(
  rc: RenderContext,
  tileset: TilesetGrid,
  theme: Theme,
  characters: Map<AgentRole, Character>,
  characterSprites: Record<AgentRole, CharacterSprites>,
): void {
  const drawables: ZDrawable[] = [];

  // Add furniture to draw list
  for (const fp of theme.furniture) {
    const sprite = getTileSprite(tileset, fp.tile);
    const worldX = fp.pos.col * TILE_SIZE;
    const worldY = fp.pos.row * TILE_SIZE;
    const zY = worldY + TILE_SIZE + (fp.zOffset ?? 0);
    drawables.push({
      zY,
      draw: () => drawSprite(rc, sprite, worldX, worldY),
    });
  }

  // Add characters to draw list
  for (const [role, char] of characters) {
    const sprites = characterSprites[role];
    if (!sprites) continue;
    const frame = getCharacterFrame(sprites, char);
    if (!frame) continue;

    // Center sprite on tile, offset up so feet align with tile bottom
    const spriteH = frame.length;
    const spriteW = frame[0]?.length ?? 0;
    const worldX = char.pos.x + (TILE_SIZE - spriteW) / 2;
    const worldY = char.pos.y + TILE_SIZE - spriteH;
    const zY = char.pos.y + TILE_SIZE + 0.5; // slight offset to render in front of same-row furniture

    drawables.push({
      zY,
      draw: () => drawSprite(rc, frame, worldX, worldY),
    });
  }

  // Sort by Y (painter's algorithm — further back drawn first)
  drawables.sort((a, b) => a.zY - b.zY);

  // Draw all
  for (const d of drawables) {
    d.draw();
  }
}

/** Render agent name labels above characters. */
export function renderLabels(
  rc: RenderContext,
  characters: Map<AgentRole, Character>,
  colors: Record<AgentRole, string>,
): void {
  const z = rc.zoom;
  rc.ctx.textAlign = 'center';
  rc.ctx.font = `bold ${Math.max(10, 7 * z)}px 'Courier New', monospace`;

  for (const [role, char] of characters) {
    const px = (char.pos.x + TILE_SIZE / 2) * z - rc.camera.x;
    const py = (char.pos.y - 4) * z - rc.camera.y;
    rc.ctx.fillStyle = colors[role] ?? '#ffffff';
    rc.ctx.fillText(role, px, py);
  }
}

const BUBBLE_OFFSET_Y = 24; // pixels above character head

/** Render speech bubbles above working/celebrating characters. */
export function renderBubbles(
  rc: RenderContext,
  characters: Map<AgentRole, Character>,
): void {
  for (const [, char] of characters) {
    let bubble: SpriteData | null = null;
    if (char.state.state === 'working') {
      bubble = BUBBLE_WORKING;
    } else if (char.state.state === 'celebrating') {
      bubble = BUBBLE_WAITING;
    }
    if (!bubble) continue;

    const bw = bubble[0]!.length;
    const worldX = char.pos.x + (TILE_SIZE - bw) / 2;
    const worldY = char.pos.y - BUBBLE_OFFSET_Y;
    drawSprite(rc, bubble, worldX, worldY);
  }
}

/** Render pipeline label at the bottom of the map. */
export function renderPipelineLabel(
  rc: RenderContext,
  map: TileMap,
  label: string,
): void {
  if (!label) return;
  const z = rc.zoom;
  const cx = (map.width * TILE_SIZE * z) / 2 - rc.camera.x;
  const cy = (map.height * TILE_SIZE - 2) * z - rc.camera.y;
  rc.ctx.textAlign = 'center';
  rc.ctx.font = `${8 * z}px 'Courier New', monospace`;
  rc.ctx.fillStyle = '#888888';
  rc.ctx.fillText(label, cx, cy);
}
