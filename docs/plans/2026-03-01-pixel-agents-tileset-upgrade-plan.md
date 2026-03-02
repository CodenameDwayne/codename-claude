# Pixel Agents Tileset Upgrade — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hand-coded pixel sprites with professional Donarg Office Tileset + MetroCity 2.0 characters, creating a warm natural office scene matching the visual quality of pablodelucca/pixel-agents.

**Architecture:** Assets (PNGs) are loaded at runtime via HTML Image elements, drawn to off-screen canvases, and extracted to `SpriteData` (`string[][]`) arrays. A sprite cache renders each sprite once per zoom level to an off-screen canvas, then frame rendering uses a single `drawImage()` call. The tilemap is a 2D grid of tile IDs referencing extracted tileset sprites. Characters and furniture are z-sorted by Y position.

**Tech Stack:** TypeScript, React 19, Vite 7, Canvas 2D API. No new dependencies needed.

**Design doc:** `docs/plans/2026-03-01-pixel-agents-tileset-upgrade-design.md`

---

## Task 1: Copy Assets Into Project

**Files:**
- Create: `pixel-agents/src/assets/characters.png` (copy from `/tmp/metrocity/MetroCity 2.0/Suit.png`)
- Create: `pixel-agents/src/assets/tileset.png` (copy from `/tmp/office-tileset/Office Tileset/Office Tileset All 16x16.png`)
- Create: `pixel-agents/src/assets/tileset-no-shadow.png` (copy from `/tmp/office-tileset/Office Tileset/Office Tileset All 16x16 no shadow.png`)

**Step 1: Create assets directory and copy files**

```bash
mkdir -p pixel-agents/src/assets
cp "/tmp/metrocity/MetroCity 2.0/Suit.png" pixel-agents/src/assets/characters.png
cp "/tmp/office-tileset/Office Tileset/Office Tileset All 16x16.png" pixel-agents/src/assets/tileset.png
cp "/tmp/office-tileset/Office Tileset/Office Tileset All 16x16 no shadow.png" pixel-agents/src/assets/tileset-no-shadow.png
```

**Step 2: Verify Vite resolves PNG imports**

Add to `pixel-agents/src/vite-env.d.ts` (create if missing):

```typescript
/// <reference types="vite/client" />
```

This enables `import url from './assets/foo.png'` to return a string URL.

**Step 3: Commit**

```bash
git add pixel-agents/src/assets/ pixel-agents/src/vite-env.d.ts
git commit -m "chore: add Donarg tileset and MetroCity character assets"
```

---

## Task 2: Sprite Loader — PNG to SpriteData Extraction

**Files:**
- Create: `pixel-agents/src/sprites/loader.ts`

This module loads a PNG via an HTML `Image` element, draws it to an off-screen canvas, and extracts pixel data as `SpriteData` (`string[][]`).

**Step 1: Write `loader.ts`**

```typescript
// pixel-agents/src/sprites/loader.ts
import type { SpriteData } from './types';

/**
 * Load a PNG from a URL and return its ImageData.
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
```

**Step 2: Verify type-check passes**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add pixel-agents/src/sprites/loader.ts
git commit -m "feat(pixel-agents): add PNG sprite loader with extraction and flip utilities"
```

---

## Task 3: Sprite Cache Upgrade — Off-Screen Canvas Rendering

**Files:**
- Modify: `pixel-agents/src/sprites/cache.ts`

The existing cache creates `ImageData` objects. Upgrade it to render sprites onto off-screen `HTMLCanvasElement` instances for use with `drawImage()`.

**Step 1: Rewrite `cache.ts`**

```typescript
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
```

**Step 2: Verify type-check passes**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add pixel-agents/src/sprites/cache.ts
git commit -m "feat(pixel-agents): upgrade sprite cache to off-screen canvas with drawImage support"
```

---

## Task 4: Tileset System — Tile IDs and Extraction

**Files:**
- Create: `pixel-agents/src/sprites/tileset.ts`
- Modify: `pixel-agents/src/sprites/types.ts`

Define an enum of tile IDs that map to (row, col) positions in the 16x16 tileset PNG. The tileset is 256×512 (16 cols × 32 rows).

**Step 1: Add `TileId` enum and tileset types to `types.ts`**

Add to the bottom of `pixel-agents/src/sprites/types.ts`:

```typescript
/** A loaded tileset: grid of SpriteData indexed by [row][col]. */
export type TilesetGrid = SpriteData[][];
```

**Step 2: Write `tileset.ts` with tile ID mappings**

The tileset at 256×512 has 16 cols × 32 rows of 16×16 tiles. Tile positions are identified by visual inspection of the tileset image. Below are the key tiles needed for an office scene.

```typescript
// pixel-agents/src/sprites/tileset.ts
import type { SpriteData, TilesetGrid } from './types';

/** Position of a tile in the tileset grid. */
interface TilePos {
  row: number;
  col: number;
}

/**
 * Tile catalog — maps tile names to grid positions in the 16x16 tileset.
 * Tileset is 256×512 (16 cols × 32 rows).
 * Positions determined by visual inspection of Office Tileset All 16x16.png.
 */
export const TILES = {
  // Floors (rows 10-11, various patterns)
  floorPlain: { row: 10, col: 0 },
  floorDiamond1: { row: 10, col: 2 },
  floorDiamond2: { row: 10, col: 3 },
  floorTile1: { row: 10, col: 4 },
  floorTile2: { row: 10, col: 5 },
  floorWood1: { row: 11, col: 0 },
  floorWood2: { row: 11, col: 1 },

  // Walls (rows 2-3)
  wallTop: { row: 2, col: 0 },
  wallMid: { row: 3, col: 0 },
  wallSide: { row: 2, col: 2 },
  wallCornerTL: { row: 2, col: 4 },
  wallCornerTR: { row: 2, col: 5 },
  wallCornerBL: { row: 3, col: 4 },
  wallCornerBR: { row: 3, col: 5 },

  // Desks (rows 0-1, wooden desks with monitor)
  deskTopLeft: { row: 0, col: 1 },
  deskTopMid: { row: 0, col: 2 },
  deskTopRight: { row: 0, col: 3 },
  deskBotLeft: { row: 1, col: 1 },
  deskBotMid: { row: 1, col: 2 },
  deskBotRight: { row: 1, col: 3 },

  // Chairs (row 14)
  chairDown: { row: 14, col: 0 },
  chairUp: { row: 14, col: 1 },
  chairLeft: { row: 14, col: 2 },
  chairRight: { row: 14, col: 3 },

  // Electronics (rows 20-21)
  monitorOff: { row: 20, col: 0 },
  monitorOn: { row: 20, col: 1 },
  keyboard: { row: 20, col: 2 },
  computer: { row: 20, col: 4 },
  printer: { row: 20, col: 6 },

  // Decor (rows 22-27)
  plantSmall: { row: 29, col: 0 },
  plantLarge: { row: 29, col: 2 },
  bookshelfTop: { row: 12, col: 8 },
  bookshelfBot: { row: 13, col: 8 },
  waterCoolerTop: { row: 16, col: 7 },
  waterCoolerBot: { row: 17, col: 7 },
  clock: { row: 21, col: 8 },

  // Wall art (rows 24-25)
  paintingSmall: { row: 24, col: 0 },
  paintingLarge1: { row: 24, col: 2 },
  paintingLarge2: { row: 24, col: 4 },
  windowLeft: { row: 24, col: 8 },
  windowRight: { row: 24, col: 9 },

  // Storage (rows 28-29)
  boxSmall: { row: 29, col: 6 },
  boxLarge: { row: 29, col: 7 },
} as const satisfies Record<string, TilePos>;

export type TileName = keyof typeof TILES;

/** Extract a single tile sprite from a loaded tileset grid. */
export function getTileSprite(grid: TilesetGrid, name: TileName): SpriteData {
  const pos = TILES[name];
  return grid[pos.row]![pos.col]!;
}
```

> **Note for implementer:** The exact row/col positions above are initial estimates from the tileset grid analysis. After loading the tileset, visually verify each tile position by rendering them and adjust the TILES mapping as needed. The tileset image is at `pixel-agents/src/assets/tileset.png` — open it in an image viewer with a 16×16 grid overlay to confirm positions.

**Step 3: Verify type-check**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add pixel-agents/src/sprites/tileset.ts pixel-agents/src/sprites/types.ts
git commit -m "feat(pixel-agents): add tileset system with tile ID catalog"
```

---

## Task 5: Character Sprite Extraction from MetroCity Sheet

**Files:**
- Modify: `pixel-agents/src/sprites/characters.ts` (full rewrite)
- Modify: `pixel-agents/src/sprites/types.ts` (update CharacterSprites)

The MetroCity `Suit.png` is 768×128 with a 24×4 grid of 32×32 cells. Layout:

```
Cols 0-5:   Char A front (down) — 16px wide, 6 frames (idle + walk)
Cols 6-11:  Char A side (right) — 19px wide, 6 frames
Cols 12-17: Char B front (down) — 16px wide, 6 frames
Cols 18-23: Char B side (right) — 19px wide, 6 frames

Row 0: Character pair 1 — front-facing (blue suit)
Row 1: Character pair 1 — back-facing (up)
Row 2: Shadow/accessory sprites (skip for now)
Row 3: Character pair 2 — different outfit (orange)
```

Each group of 6 frames: frame 0 = idle, frames 1-2 = walk step A, frame 3 = idle variant, frames 4-5 = walk step B.

**Step 1: Update CharacterSprites in `types.ts`**

Replace the existing `CharacterSprites` interface:

```typescript
export interface CharacterSprites {
  down: { idle: SpriteData[]; walk: SpriteData[] };
  up: { idle: SpriteData[]; walk: SpriteData[] };
  right: { idle: SpriteData[]; walk: SpriteData[] };
  left: { idle: SpriteData[]; walk: SpriteData[] };
}
```

Keep `SpriteData`, `CharacterPalette`, `FurnitureSprite`, and `TilesetGrid` exports.

Remove the old `CharacterSprites` definition and the unused `Direction`-keyed Record types.

**Step 2: Rewrite `characters.ts`**

```typescript
// pixel-agents/src/sprites/characters.ts
import type { SpriteData, CharacterSprites } from './types';
import { extractSprite, flipSpriteH } from './loader';
import type { AgentRole } from '../ws/types';

/** Cell size in the MetroCity sprite sheet. */
const CELL = 32;

/** Frame layout within each 6-frame group. */
const IDLE_FRAMES = [0, 3]; // frames 0 and 3 are idle poses
const WALK_FRAMES = [1, 2, 4, 5]; // frames 1,2,4,5 are walk cycle

/**
 * Character definitions mapping agent roles to sprite sheet positions.
 * Each character occupies a half-row (12 cells) in the sheet.
 *
 * halfCol: 0 = left half (cols 0-11), 12 = right half (cols 12-23)
 * frontRow: row index for front-facing (down) sprites
 * backRow: row index for back-facing (up) sprites
 */
const CHARACTER_MAP: Record<AgentRole, { halfCol: number; frontRow: number; backRow: number }> = {
  scout:     { halfCol: 0,  frontRow: 0, backRow: 1 },
  architect: { halfCol: 12, frontRow: 0, backRow: 1 },
  builder:   { halfCol: 0,  frontRow: 3, backRow: 3 },
  reviewer:  { halfCol: 12, frontRow: 3, backRow: 3 },
};

/** Agent accent colors for labels and UI (preserved from original). */
export const AGENT_COLORS: Record<AgentRole, string> = {
  scout: '#00ffff',
  architect: '#ffd700',
  builder: '#00ff41',
  reviewer: '#ff00ff',
};

function extractFrames(
  imageData: ImageData,
  row: number,
  startCol: number,
  frameIndices: number[],
): SpriteData[] {
  return frameIndices.map((fi) => {
    const x = (startCol + fi) * CELL;
    const y = row * CELL;
    return extractSprite(imageData, x, y, CELL, CELL);
  });
}

/**
 * Extract all character sprites for a given agent role from the loaded character sheet.
 */
export function extractCharacterSprites(
  imageData: ImageData,
  role: AgentRole,
): CharacterSprites {
  const def = CHARACTER_MAP[role];

  // Front (down) — narrow frames, cols 0-5 within the half
  const downIdle = extractFrames(imageData, def.frontRow, def.halfCol, IDLE_FRAMES);
  const downWalk = extractFrames(imageData, def.frontRow, def.halfCol, WALK_FRAMES);

  // Back (up) — narrow frames, cols 0-5 within the half
  const upIdle = extractFrames(imageData, def.backRow, def.halfCol, IDLE_FRAMES);
  const upWalk = extractFrames(imageData, def.backRow, def.halfCol, WALK_FRAMES);

  // Right — wider frames, cols 6-11 within the half
  const rightStartCol = def.halfCol + 6;
  const rightIdle = extractFrames(imageData, def.frontRow, rightStartCol, IDLE_FRAMES);
  const rightWalk = extractFrames(imageData, def.frontRow, rightStartCol, WALK_FRAMES);

  // Left — flip right sprites horizontally
  const leftIdle = rightIdle.map(flipSpriteH);
  const leftWalk = rightWalk.map(flipSpriteH);

  return {
    down: { idle: downIdle, walk: downWalk },
    up: { idle: upIdle, walk: upWalk },
    right: { idle: rightIdle, walk: rightWalk },
    left: { idle: leftIdle, walk: leftWalk },
  };
}
```

**Step 3: Verify type-check**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: May have errors in `scene.ts` and `renderer.ts` due to changed sprite types. That's expected — those files are rewritten in later tasks.

**Step 4: Commit**

```bash
git add pixel-agents/src/sprites/characters.ts pixel-agents/src/sprites/types.ts
git commit -m "feat(pixel-agents): extract MetroCity characters with 4-direction animation"
```

---

## Task 6: Asset Loading Hook

**Files:**
- Create: `pixel-agents/src/hooks/useAssets.ts`

Async hook that loads both PNGs at startup and extracts all sprite data. Returns a loading state and the extracted assets.

**Step 1: Write `useAssets.ts`**

```typescript
// pixel-agents/src/hooks/useAssets.ts
import { useState, useEffect } from 'react';
import type { CharacterSprites, TilesetGrid } from '../sprites/types';
import type { AgentRole } from '../ws/types';
import { loadImage, imageToPixels, sliceTileset } from '../sprites/loader';
import { extractCharacterSprites } from '../sprites/characters';
import tilesetUrl from '../assets/tileset.png';
import charactersUrl from '../assets/characters.png';

export interface LoadedAssets {
  tileset: TilesetGrid;
  characters: Record<AgentRole, CharacterSprites>;
}

export function useAssets(): { assets: LoadedAssets | null; error: string | null } {
  const [assets, setAssets] = useState<LoadedAssets | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [tilesetImg, charsImg] = await Promise.all([
          loadImage(tilesetUrl),
          loadImage(charactersUrl),
        ]);

        if (cancelled) return;

        const tilesetData = imageToPixels(tilesetImg);
        const charsData = imageToPixels(charsImg);

        const tileset = sliceTileset(tilesetData, 16, 16);

        const roles: AgentRole[] = ['scout', 'architect', 'builder', 'reviewer'];
        const characters = {} as Record<AgentRole, CharacterSprites>;
        for (const role of roles) {
          characters[role] = extractCharacterSprites(charsData, role);
        }

        if (!cancelled) {
          setAssets({ tileset, characters });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load assets');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { assets, error };
}
```

**Step 2: Verify type-check**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: Pass (or minor errors in downstream files not yet updated)

**Step 3: Commit**

```bash
git add pixel-agents/src/hooks/useAssets.ts
git commit -m "feat(pixel-agents): add useAssets hook for async PNG loading"
```

---

## Task 7: Office Theme and Layout

**Files:**
- Create: `pixel-agents/src/themes/office.ts`
- Modify: `pixel-agents/src/themes/types.ts`
- Delete content of: `pixel-agents/src/themes/cyberpunk.ts` (keep file, re-export office)

The office layout is a 20×15 tile grid using an enum-based tile map. Furniture is placed as separate positioned objects (not baked into the tile grid) so they can be z-sorted with characters.

**Step 1: Update Theme type in `types.ts`**

```typescript
// pixel-agents/src/themes/types.ts
import type { TileMap, GridPos } from '../engine/tileMap';
import type { AgentRole } from '../ws/types';
import type { TileName } from '../sprites/tileset';

export interface DeskAssignment {
  role: AgentRole;
  seatPos: GridPos;
  approachPos: GridPos;
  facing: 'up' | 'down' | 'left' | 'right';
}

/** A furniture item placed in the office. */
export interface FurniturePlacement {
  tile: TileName;
  pos: GridPos;       // grid position
  zOffset?: number;   // optional z-sort tweak
}

export interface Theme {
  name: string;
  background: string;
  floorTile: TileName;
  wallTile: TileName;
  map: TileMap;
  desks: DeskAssignment[];
  furniture: FurniturePlacement[];
}
```

**Step 2: Update TileType enum in `tileMap.ts`**

Add `Furniture = 4` to the existing `TileType` enum so furniture tiles can block pathfinding but render separately:

In `pixel-agents/src/engine/tileMap.ts`, add to the `TileType` enum:
```typescript
export enum TileType {
  Floor = 0,
  Wall = 1,
  Desk = 2,
  Chair = 3,
  Furniture = 4,  // ADD THIS — blocks walking but renders as furniture
}
```

Update `isWalkable()` to include Furniture as non-walkable (it already blocks Desk and Wall).

**Step 3: Write `office.ts`**

```typescript
// pixel-agents/src/themes/office.ts
import type { Theme } from './types';
import { TileType } from '../engine/tileMap';

const F = TileType.Floor;
const W = TileType.Wall;
const D = TileType.Desk;
const C = TileType.Chair;
const U = TileType.Furniture;

// 20 wide × 15 tall open-plan office
const tiles: TileType[][] = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
  [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W], // 0 top wall
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 1 decor row
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 2
  [W, F, F, D, D, D, F, F, F, F, F, F, F, D, D, D, F, F, F, W], // 3 desks top
  [W, F, F, F, C, F, F, F, F, F, F, F, F, F, C, F, F, F, F, W], // 4 chairs
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 5 open
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 6 open
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 7 open
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 8 open
  [W, F, F, F, C, F, F, F, F, F, F, F, F, F, C, F, F, F, F, W], // 9 chairs
  [W, F, F, D, D, D, F, F, F, F, F, F, F, D, D, D, F, F, F, W], // 10 desks bottom
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 11
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 12 decor row
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W], // 13
  [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W], // 14 bottom wall
];

export const officeTheme: Theme = {
  name: 'Office',
  background: '#4a4a52', // dark gray surround
  floorTile: 'floorDiamond1',
  wallTile: 'wallTop',
  map: {
    width: 20,
    height: 15,
    tiles,
  },
  desks: [
    { role: 'scout',     seatPos: { col: 4, row: 4 },  approachPos: { col: 4, row: 5 },  facing: 'up' },
    { role: 'architect', seatPos: { col: 14, row: 4 },  approachPos: { col: 14, row: 5 }, facing: 'up' },
    { role: 'builder',   seatPos: { col: 4, row: 9 },  approachPos: { col: 4, row: 8 },  facing: 'down' },
    { role: 'reviewer',  seatPos: { col: 14, row: 9 },  approachPos: { col: 14, row: 8 }, facing: 'down' },
  ],
  furniture: [
    // Top desks — Scout (left) and Architect (right)
    { tile: 'deskTopLeft',  pos: { col: 3, row: 3 } },
    { tile: 'deskTopMid',   pos: { col: 4, row: 3 } },
    { tile: 'deskTopRight', pos: { col: 5, row: 3 } },
    { tile: 'monitorOn',    pos: { col: 4, row: 3 }, zOffset: 0.1 },
    { tile: 'deskTopLeft',  pos: { col: 13, row: 3 } },
    { tile: 'deskTopMid',   pos: { col: 14, row: 3 } },
    { tile: 'deskTopRight', pos: { col: 15, row: 3 } },
    { tile: 'monitorOn',    pos: { col: 14, row: 3 }, zOffset: 0.1 },

    // Bottom desks — Builder (left) and Reviewer (right)
    { tile: 'deskTopLeft',  pos: { col: 3, row: 10 } },
    { tile: 'deskTopMid',   pos: { col: 4, row: 10 } },
    { tile: 'deskTopRight', pos: { col: 5, row: 10 } },
    { tile: 'monitorOn',    pos: { col: 4, row: 10 }, zOffset: 0.1 },
    { tile: 'deskTopLeft',  pos: { col: 13, row: 10 } },
    { tile: 'deskTopMid',   pos: { col: 14, row: 10 } },
    { tile: 'deskTopRight', pos: { col: 15, row: 10 } },
    { tile: 'monitorOn',    pos: { col: 14, row: 10 }, zOffset: 0.1 },

    // Chairs
    { tile: 'chairDown', pos: { col: 4, row: 4 } },
    { tile: 'chairDown', pos: { col: 14, row: 4 } },
    { tile: 'chairUp',   pos: { col: 4, row: 9 } },
    { tile: 'chairUp',   pos: { col: 14, row: 9 } },

    // Decor — top wall
    { tile: 'waterCoolerTop', pos: { col: 9, row: 1 } },
    { tile: 'waterCoolerBot', pos: { col: 9, row: 2 } },
    { tile: 'bookshelfTop',   pos: { col: 2, row: 1 } },
    { tile: 'bookshelfBot',   pos: { col: 2, row: 2 } },
    { tile: 'plantSmall',     pos: { col: 17, row: 1 } },
    { tile: 'clock',          pos: { col: 10, row: 1 } },

    // Decor — bottom / sides
    { tile: 'plantLarge',     pos: { col: 1, row: 12 } },
    { tile: 'plantSmall',     pos: { col: 18, row: 12 } },
    { tile: 'paintingSmall',  pos: { col: 7, row: 1 } },
    { tile: 'paintingLarge1', pos: { col: 12, row: 1 } },

    // Wall windows
    { tile: 'windowLeft',  pos: { col: 5, row: 0 } },
    { tile: 'windowRight', pos: { col: 6, row: 0 } },
    { tile: 'windowLeft',  pos: { col: 13, row: 0 } },
    { tile: 'windowRight', pos: { col: 14, row: 0 } },
  ],
};
```

**Step 4: Update `cyberpunk.ts` to re-export office theme for backward compat**

```typescript
// pixel-agents/src/themes/cyberpunk.ts
// Legacy — redirects to office theme
export { officeTheme as cyberpunkTheme } from './office';
```

**Step 5: Verify type-check**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: Errors in scene.ts and renderer.ts (expected — those are next)

**Step 6: Commit**

```bash
git add pixel-agents/src/themes/
git commit -m "feat(pixel-agents): add warm office theme with furniture layout"
```

---

## Task 8: Renderer Rewrite — Tileset + Cached drawImage

**Files:**
- Modify: `pixel-agents/src/engine/renderer.ts` (full rewrite)

Replace per-pixel `fillRect` rendering with tileset-based floor/wall rendering and cached `drawImage` for sprites. Add z-sorted rendering of furniture and characters together.

**Step 1: Rewrite `renderer.ts`**

```typescript
// pixel-agents/src/engine/renderer.ts
import type { Character } from '../agents/characterState';
import type { TileMap } from './tileMap';
import { TileType, TILE_SIZE } from './tileMap';
import type { SpriteData, TilesetGrid, CharacterSprites } from '../sprites/types';
import type { Theme, FurniturePlacement } from '../themes/types';
import type { AgentRole } from '../ws/types';
import { getCachedCanvas } from '../sprites/cache';
import { getTileSprite } from '../sprites/tileset';

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
```

**Step 2: Verify type-check**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: Errors in scene.ts (expected — rewritten next)

**Step 3: Commit**

```bash
git add pixel-agents/src/engine/renderer.ts
git commit -m "feat(pixel-agents): rewrite renderer with tileset, sprite cache, and z-sorted scene"
```

---

## Task 9: Scene Update — Wire New Renderer and Assets

**Files:**
- Modify: `pixel-agents/src/engine/scene.ts`
- Modify: `pixel-agents/src/hooks/useGameScene.ts`
- Modify: `pixel-agents/src/agents/characterState.ts` (minor — use 'facing' from desk)

Update GameScene to accept loaded assets (tileset + character sprites) and use the new renderer functions. Update the hook to pass assets through.

**Step 1: Update `characterState.ts`**

In the `DeskAssignment` interface, the `facing` field was added in the Theme type. Remove the duplicate `DeskAssignment` from `characterState.ts` and import it from `themes/types.ts`:

At the top of `pixel-agents/src/agents/characterState.ts`, replace the local `DeskAssignment` interface with an import from `../themes/types`. Keep the `Character`, `CharacterState`, `Direction`, `createCharacter`, and `updateCharacter` exports unchanged.

**Step 2: Rewrite `scene.ts`**

Key changes:
- Accept `TilesetGrid` and `Record<AgentRole, CharacterSprites>` in constructor
- Remove old `resolveCharacterSprites()` calls
- Use `renderTilemap()`, `renderScene()`, `renderLabels()`, `renderPipelineLabel()` from new renderer
- Remove old `renderSprite()`, `renderGlow()` calls

```typescript
// pixel-agents/src/engine/scene.ts
import { GameLoop } from './gameLoop';
import { TileMap, TILE_SIZE, findPath } from './tileMap';
import {
  RenderContext,
  createRenderContext,
  resizeCanvas,
  clearCanvas,
  renderTilemap,
  renderScene,
  renderLabels,
  renderPipelineLabel,
} from './renderer';
import { Character, createCharacter, updateCharacter, Direction } from '../agents/characterState';
import type { CharacterSprites, TilesetGrid } from '../sprites/types';
import { AGENT_COLORS } from '../sprites/characters';
import type { Theme } from '../themes/types';
import type { WSEvent, AgentRole } from '../ws/types';

export class GameScene {
  private rc: RenderContext | null = null;
  private loop: GameLoop;
  private characters = new Map<AgentRole, Character>();
  private theme: Theme;
  private tileset: TilesetGrid;
  private charSprites: Record<AgentRole, CharacterSprites>;
  private eventQueue: WSEvent[] = [];
  private pipelineLabel = '';

  constructor(
    theme: Theme,
    tileset: TilesetGrid,
    charSprites: Record<AgentRole, CharacterSprites>,
  ) {
    this.theme = theme;
    this.tileset = tileset;
    this.charSprites = charSprites;
    this.loop = new GameLoop(
      (dt) => this.update(dt),
      () => this.render(),
    );

    // Create characters at their desk positions
    for (const desk of theme.desks) {
      const char = createCharacter(desk.role, desk.seatPos);
      char.direction = desk.facing as Direction;
      this.characters.set(desk.role, char);
    }
  }

  attach(canvas: HTMLCanvasElement, zoom: number): void {
    this.rc = createRenderContext(canvas, zoom);
    resizeCanvas(this.rc);
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  pushEvent(event: WSEvent): void {
    this.eventQueue.push(event);
  }

  setZoom(z: number): void {
    if (this.rc) this.rc.zoom = z;
  }

  private update(dt: number): void {
    // Process queued events
    while (this.eventQueue.length > 0) {
      this.processEvent(this.eventQueue.shift()!);
    }

    // Update character animations and movement
    for (const char of this.characters.values()) {
      updateCharacter(char, dt, this.theme.map);
    }
  }

  private render(): void {
    if (!this.rc) return;
    const rc = this.rc;

    resizeCanvas(rc);
    clearCanvas(rc, this.theme.background);

    // 1. Floor and wall tiles
    renderTilemap(rc, this.theme.map, this.tileset, this.theme);

    // 2. Furniture + characters (z-sorted)
    renderScene(rc, this.tileset, this.theme, this.characters, this.charSprites);

    // 3. Labels on top
    renderLabels(rc, this.characters, AGENT_COLORS);

    // 4. Pipeline label
    renderPipelineLabel(rc, this.theme.map, this.pipelineLabel);
  }

  private processEvent(event: WSEvent): void {
    switch (event.type) {
      case 'agent:active': {
        const char = this.characters.get(event.agent);
        if (!char) break;
        const desk = this.theme.desks.find((d) => d.role === event.agent);
        if (!desk) break;
        const path = findPath(this.theme.map, char.gridPos, desk.seatPos);
        if (path.length > 0) {
          char.state = {
            state: 'walking',
            path,
            pathIndex: 1,
            targetState: { state: 'working', activity: event.activity },
          };
        } else {
          char.state = { state: 'working', activity: event.activity };
        }
        break;
      }
      case 'agent:idle': {
        const char = this.characters.get(event.agent);
        if (char) char.state = { state: 'idle' };
        break;
      }
      case 'handoff': {
        const from = this.characters.get(event.from);
        const toDesk = this.theme.desks.find((d) => d.role === event.to);
        if (!from || !toDesk) break;
        const path = findPath(this.theme.map, from.gridPos, toDesk.approachPos);
        if (path.length > 0) {
          from.state = {
            state: 'carrying',
            path,
            pathIndex: 1,
            item: event.artifact,
            targetAgent: event.to,
          };
        }
        break;
      }
      case 'verdict': {
        if (event.verdict === 'approve') {
          for (const char of this.characters.values()) {
            char.state = { state: 'celebrating' };
            setTimeout(() => {
              char.state = { state: 'idle' };
            }, 2000);
          }
        }
        break;
      }
      case 'pipeline:start':
        this.pipelineLabel = event.taskDescription;
        break;
      case 'pipeline:end':
        this.pipelineLabel = '';
        break;
      case 'state:snapshot':
        for (const [role, activity] of Object.entries(event.agents)) {
          const char = this.characters.get(role as AgentRole);
          if (char && activity !== 'idle') {
            char.state = { state: 'working', activity };
          }
        }
        break;
    }
  }
}
```

**Step 3: Update `useGameScene.ts`**

```typescript
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
```

**Step 4: Verify type-check**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: Errors only in App.tsx (updated next task)

**Step 5: Commit**

```bash
git add pixel-agents/src/engine/scene.ts pixel-agents/src/hooks/useGameScene.ts pixel-agents/src/agents/characterState.ts
git commit -m "feat(pixel-agents): wire scene to new renderer, tileset, and character assets"
```

---

## Task 10: Update React Shell — App.tsx + CSS

**Files:**
- Modify: `pixel-agents/src/App.tsx`
- Modify: `pixel-agents/src/App.css`

Wire `useAssets` into App, show loading state, add vignette overlay, update CSS to warm palette.

**Step 1: Update `App.tsx`**

Key changes:
- Import `useAssets` hook
- Show "Loading assets..." state while PNGs load
- Pass `assets` to `useGameScene`
- Import `officeTheme` instead of `cyberpunkTheme`
- Replace `GLOW_COLORS` with `AGENT_COLORS` import
- Add vignette overlay div

```typescript
// pixel-agents/src/App.tsx
import { useRef, useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './ws/useWebSocket';
import { useGameScene } from './hooks/useGameScene';
import { useAssets } from './hooks/useAssets';
import { officeTheme } from './themes/office';
import { AGENT_COLORS } from './sprites/characters';
import { DemoRunner } from './demo/demoMode';
import type { WSEvent, AgentRole, ConnectionStatus } from './ws/types';
import './App.css';

const ROLES: AgentRole[] = ['scout', 'architect', 'builder', 'reviewer'];

function useAgentStates(events: WSEvent[]) {
  const states = useRef<Record<AgentRole, string>>({
    scout: 'Idle', architect: 'Idle', builder: 'Idle', reviewer: 'Idle',
  });
  const latest = events[events.length - 1];
  if (latest) {
    if (latest.type === 'agent:active') states.current[latest.agent] = latest.activity;
    if (latest.type === 'agent:idle') states.current[latest.agent] = 'Idle';
  }
  return states.current;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(3);
  const [demoActive, setDemoActive] = useState(false);
  const [demoEvents, setDemoEvents] = useState<WSEvent[]>([]);
  const demoRef = useRef<DemoRunner | null>(null);

  const { assets, error: assetError } = useAssets();
  const { status, events: wsEvents } = useWebSocket();

  const events = status === 'connected' ? wsEvents : demoEvents;
  const agentStates = useAgentStates(events);

  useGameScene(canvasRef, officeTheme, events, zoom, assets);

  const toggleDemo = useCallback(() => {
    if (demoActive) {
      demoRef.current?.stop();
      demoRef.current = null;
      setDemoActive(false);
      setDemoEvents([]);
    } else {
      const runner = new DemoRunner((e) => setDemoEvents((prev) => [...prev, e]));
      runner.start();
      demoRef.current = runner;
      setDemoActive(true);
    }
  }, [demoActive]);

  useEffect(() => {
    if (status === 'connected' && demoActive) {
      demoRef.current?.stop();
      demoRef.current = null;
      setDemoActive(false);
    }
  }, [status, demoActive]);

  if (assetError) {
    return <div className="app loading">Failed to load assets: {assetError}</div>;
  }

  if (!assets) {
    return <div className="app loading">Loading assets...</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Codename Claude — Pixel Agents</h1>
        <div className="controls">
          <button className="demo-btn" onClick={toggleDemo}>
            {demoActive ? 'STOP DEMO' : 'RUN DEMO'}
          </button>
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
          <StatusDot status={status} />
        </div>
      </header>
      <div className="canvas-container">
        <canvas ref={canvasRef} />
        <div className="vignette" />
      </div>
      <footer className="status-bar">
        {ROLES.map((role) => (
          <span key={role} className="agent-status" style={{ color: AGENT_COLORS[role] }}>
            {role}: {agentStates[role]}
          </span>
        ))}
        {demoActive && <span className="agent-status demo-label">DEMO</span>}
      </footer>
    </div>
  );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  return <span className={`status-dot ${status}`} />;
}
```

**Step 2: Update `App.css`**

Replace cyberpunk CSS variables with warm office palette. Add vignette overlay styles.

Key changes:
- `--bg-primary: #3d3d44` (warm dark gray)
- `--bg-secondary: #4a4a52`
- `--text-primary: #e8e0d8` (warm white)
- `--text-secondary: #9a9088`
- Keep accent colors for agent labels
- Add `.vignette` class with radial gradient
- Add `.loading` class for loading state

```css
/* Add to App.css — replace the :root variables */
:root {
  --bg-primary: #3d3d44;
  --bg-secondary: #4a4a52;
  --text-primary: #e8e0d8;
  --text-secondary: #9a9088;
  --accent-cyan: #00ffff;
  --accent-green: #00ff41;
  --accent-gold: #ffd700;
  --accent-magenta: #ff00ff;
  --border: #5a5a62;
}

/* Add vignette overlay */
.vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.4) 100%);
  z-index: 1;
}

.canvas-container {
  position: relative;
  /* existing styles... */
}

/* Loading state */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Courier New', monospace;
  color: var(--text-secondary);
}
```

**Step 3: Verify it builds**

Run: `cd pixel-agents && npx tsc --noEmit`
Expected: Clean compile (or minor issues to fix)

**Step 4: Visual verification**

Run: `cd pixel-agents && npm run dev`
Open browser. You should see:
- Loading state briefly
- Warm office scene with tileset floor/walls
- Furniture (desks, monitors, chairs, plants, bookshelves)
- MetroCity character sprites at their desks
- Demo mode should animate characters walking between desks

**Step 5: Commit**

```bash
git add pixel-agents/src/App.tsx pixel-agents/src/App.css
git commit -m "feat(pixel-agents): warm office UI with vignette and asset loading"
```

---

## Task 11: Speech Bubbles

**Files:**
- Create: `pixel-agents/src/sprites/bubbles.ts`
- Modify: `pixel-agents/src/engine/renderer.ts` (add `renderBubbles`)
- Modify: `pixel-agents/src/engine/scene.ts` (call renderBubbles)

**Step 1: Write `bubbles.ts`**

Hardcoded 11×13 pixel-art bubble sprites:

```typescript
// pixel-agents/src/sprites/bubbles.ts
import type { SpriteData } from './types';

const _ = '';
const W = '#eeeeff'; // bubble fill
const B = '#555566'; // border
const A = '#ddaa44'; // amber dots (working)
const G = '#44dd66'; // green check (waiting)

/** Working bubble — "..." dots */
export const BUBBLE_WORKING: SpriteData = [
  [_, _, B, B, B, B, B, B, B, _, _],
  [_, B, W, W, W, W, W, W, W, B, _],
  [_, B, W, W, W, W, W, W, W, B, _],
  [_, B, W, W, W, W, W, W, W, B, _],
  [_, B, W, A, W, A, W, A, W, B, _],
  [_, B, W, W, W, W, W, W, W, B, _],
  [_, B, W, W, W, W, W, W, W, B, _],
  [_, _, B, B, B, B, B, B, B, _, _],
  [_, _, _, _, _, B, _, _, _, _, _],
  [_, _, _, _, _, _, B, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _],
];

/** Waiting/done bubble — checkmark */
export const BUBBLE_WAITING: SpriteData = [
  [_, _, B, B, B, B, B, B, B, _, _],
  [_, B, W, W, W, W, W, W, W, B, _],
  [_, B, W, W, W, W, W, W, W, B, _],
  [_, B, W, W, W, W, W, G, W, B, _],
  [_, B, W, W, W, W, G, W, W, B, _],
  [_, B, W, G, W, G, W, W, W, B, _],
  [_, B, W, W, G, W, W, W, W, B, _],
  [_, _, B, B, B, B, B, B, B, _, _],
  [_, _, _, _, _, B, _, _, _, _, _],
  [_, _, _, _, _, _, B, _, _, _, _],
  [_, _, _, _, _, _, _, _, _, _, _],
];
```

**Step 2: Add `renderBubbles` to `renderer.ts`**

Add this function to the end of `renderer.ts`:

```typescript
import { BUBBLE_WORKING, BUBBLE_WAITING } from '../sprites/bubbles';

const BUBBLE_OFFSET_Y = 24; // pixels above character head

export function renderBubbles(
  rc: RenderContext,
  characters: Map<AgentRole, Character>,
): void {
  const z = rc.zoom;
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
```

**Step 3: Call `renderBubbles` in scene `render()` method**

In `scene.ts`, add after `renderLabels`:

```typescript
renderBubbles(rc, this.characters);
```

**Step 4: Commit**

```bash
git add pixel-agents/src/sprites/bubbles.ts pixel-agents/src/engine/renderer.ts pixel-agents/src/engine/scene.ts
git commit -m "feat(pixel-agents): add speech bubble sprites for working and done states"
```

---

## Task 12: Matrix Spawn/Despawn Effect

**Files:**
- Create: `pixel-agents/src/effects/matrix.ts`
- Modify: `pixel-agents/src/engine/renderer.ts` (add renderMatrixEffect)
- Modify: `pixel-agents/src/engine/scene.ts` (trigger on pipeline events)

**Step 1: Write `matrix.ts`**

```typescript
// pixel-agents/src/effects/matrix.ts
import type { SpriteData } from '../sprites/types';

const DURATION = 0.3;  // seconds
const TRAIL_LENGTH = 6; // pixels
const STAGGER_RANGE = 0.3;

export interface MatrixEffect {
  sprite: SpriteData;
  worldX: number;
  worldY: number;
  timer: number;
  duration: number;
  type: 'spawn' | 'despawn';
  columnSeeds: number[]; // random stagger per column
}

export function createMatrixEffect(
  sprite: SpriteData,
  worldX: number,
  worldY: number,
  type: 'spawn' | 'despawn',
): MatrixEffect {
  const w = sprite[0]?.length ?? 0;
  const columnSeeds = Array.from({ length: w }, () => Math.random() * STAGGER_RANGE);
  return { sprite, worldX, worldY, timer: 0, duration: DURATION, type, columnSeeds };
}

export function updateMatrixEffect(effect: MatrixEffect, dt: number): boolean {
  effect.timer += dt;
  return effect.timer < effect.duration;
}

/**
 * Render the matrix effect. Returns per-pixel color decisions.
 * For spawn: columns sweep top-to-bottom revealing the sprite.
 * For despawn: columns sweep top-to-bottom consuming the sprite.
 */
export function getMatrixPixel(
  effect: MatrixEffect,
  col: number,
  row: number,
): { color: string; alpha: number } | null {
  const progress = Math.min(effect.timer / effect.duration, 1);
  const h = effect.sprite.length;
  const seed = effect.columnSeeds[col] ?? 0;
  const colProgress = Math.max(0, Math.min(1, (progress - seed) / (1 - STAGGER_RANGE)));

  const headRow = colProgress * (h + TRAIL_LENGTH);
  const distFromHead = headRow - row;

  const originalColor = effect.sprite[row]?.[col];
  if (!originalColor) return null;

  if (effect.type === 'spawn') {
    if (distFromHead < 0) return null; // not yet revealed
    if (distFromHead < TRAIL_LENGTH) {
      // Trail zone — green tint fading
      const trailAlpha = 1 - distFromHead / TRAIL_LENGTH;
      return { color: '#00ff41', alpha: trailAlpha * 0.6 };
    }
    return { color: originalColor, alpha: 1 }; // fully revealed
  } else {
    // Despawn
    if (distFromHead < 0) return { color: originalColor, alpha: 1 }; // not yet consumed
    if (distFromHead < TRAIL_LENGTH) {
      const trailAlpha = 1 - distFromHead / TRAIL_LENGTH;
      return { color: '#00ff41', alpha: trailAlpha * 0.6 };
    }
    return null; // consumed
  }
}
```

**Step 2: Integrate into renderer and scene**

This is a stretch goal. The core rendering with tileset, characters, and bubbles should be working first. The matrix effect can be wired in after visual verification of the main scene.

Add to `scene.ts`: track active MatrixEffect instances, trigger on `pipeline:start` (spawn) and `pipeline:end` (despawn), render in the draw loop.

**Step 3: Commit**

```bash
git add pixel-agents/src/effects/matrix.ts
git commit -m "feat(pixel-agents): add matrix spawn/despawn effect module"
```

---

## Task 13: Final Integration and Polish

**Step 1: Run dev server and visually verify**

```bash
cd pixel-agents && npm run dev
```

Check:
- [ ] Assets load without errors
- [ ] Warm office floor tiles render correctly
- [ ] Wall tiles form a border
- [ ] Furniture (desks, chairs, monitors, bookshelves, plants) renders at correct positions
- [ ] Character sprites show MetroCity characters (not colored blocks)
- [ ] Characters face the correct direction at their desks
- [ ] Demo mode: characters walk between desks with correct direction changes
- [ ] Demo mode: speech bubbles appear during working state
- [ ] Z-sorting: characters render in front of / behind furniture correctly
- [ ] Zoom slider works (1x to 5x)
- [ ] Vignette overlay darkens edges
- [ ] Agent labels render above characters in accent colors
- [ ] Pipeline label shows at bottom during demo

**Step 2: Fix tile positions**

The TILES mapping in `tileset.ts` uses estimated positions. Open the tileset image alongside the running app and adjust any misaligned tile positions. The tileset is at `pixel-agents/src/assets/tileset.png` (256×512, 16 cols × 32 rows).

**Step 3: Fix character frame alignment**

If characters appear offset or the wrong frames are used, adjust the `CHARACTER_MAP` in `characters.ts` and the `IDLE_FRAMES` / `WALK_FRAMES` indices.

**Step 4: Final commit**

```bash
git add -A pixel-agents/src/
git commit -m "feat(pixel-agents): complete tileset upgrade with warm office scene"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Copy assets | `assets/characters.png`, `assets/tileset.png` |
| 2 | Sprite loader | `sprites/loader.ts` |
| 3 | Sprite cache upgrade | `sprites/cache.ts` |
| 4 | Tileset system | `sprites/tileset.ts`, `sprites/types.ts` |
| 5 | Character extraction | `sprites/characters.ts` |
| 6 | Asset loading hook | `hooks/useAssets.ts` |
| 7 | Office theme + layout | `themes/office.ts`, `themes/types.ts` |
| 8 | Renderer rewrite | `engine/renderer.ts` |
| 9 | Scene + hooks update | `engine/scene.ts`, `hooks/useGameScene.ts` |
| 10 | React shell + CSS | `App.tsx`, `App.css` |
| 11 | Speech bubbles | `sprites/bubbles.ts` |
| 12 | Matrix effect | `effects/matrix.ts` |
| 13 | Integration + polish | Visual verification, tile position fixes |
