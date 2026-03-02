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
