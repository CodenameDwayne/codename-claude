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
 * Positions verified by zoomed visual inspection of Office Tileset All 16x16.png.
 *
 * Visual layout summary (verified):
 *   Rows 0-1:   Desks, tables (wooden tops and fronts)
 *   Rows 2-3:   Couches, beds, large furniture
 *   Rows 4-5:   Shelving, cabinets (left); bookcases (right cols 8+)
 *   Rows 6-7:   Floor tiles (tan, diamond, gray, blue-gray)
 *   Rows 8-11:  More floor patterns, small furniture
 *   Rows 12-13: Large bookcase units (cols 6+)
 *   Rows 14-15: Doors, glass panels
 *   Rows 16:    Chairs (various orientations cols 0-7)
 *   Rows 17:    Water cooler, filing cabinets, vending machine
 *   Rows 18-19: Small chairs/stools, reception desk
 *   Rows 20:    Office equipment, monitors on stands
 *   Rows 21:    Windows with blinds, small accessories
 *   Rows 22-23: Desktop monitors, clocks
 *   Rows 25:    Picture frames with landscapes
 *   Rows 26-27: Framed art, printers, equipment
 *   Rows 28-29: Green potted plants, boxes/crates
 *   Rows 30-31: Small decorative items
 */
export const TILES = {
  // Floors (rows 6-7)
  floorPlain: { row: 6, col: 0 },
  floorDiamond1: { row: 6, col: 2 },
  floorDiamond2: { row: 6, col: 3 },
  floorTile1: { row: 6, col: 4 },
  floorTile2: { row: 6, col: 5 },
  floorWood1: { row: 7, col: 2 },
  floorWood2: { row: 7, col: 3 },

  // Desks (rows 0-1 — wooden desk tops and fronts)
  deskTopLeft: { row: 0, col: 0 },
  deskTopMid: { row: 0, col: 1 },
  deskTopRight: { row: 0, col: 2 },
  deskBotLeft: { row: 1, col: 0 },
  deskBotMid: { row: 1, col: 1 },
  deskBotRight: { row: 1, col: 2 },

  // Chairs (row 16 — various orientations)
  chairDown: { row: 16, col: 0 },
  chairUp: { row: 16, col: 1 },
  chairLeft: { row: 16, col: 2 },
  chairRight: { row: 16, col: 3 },

  // Electronics
  monitorOff: { row: 22, col: 4 },
  monitorOn: { row: 22, col: 6 },
  keyboard: { row: 26, col: 10 },
  computer: { row: 26, col: 8 },
  printer: { row: 26, col: 12 },

  // Decor — plants (row 28, verified green)
  plantSmall: { row: 28, col: 4 },
  plantLarge: { row: 28, col: 5 },

  // Decor — bookshelves (rows 9 cols 6-7, small units)
  bookshelfTop: { row: 9, col: 6 },
  bookshelfBot: { row: 9, col: 7 },

  // Decor — water cooler (row 17 cols 6-7)
  waterCoolerTop: { row: 17, col: 6 },
  waterCoolerBot: { row: 17, col: 7 },

  // Decor — clock (row 23, col 0)
  clock: { row: 23, col: 0 },

  // Wall art — framed paintings (row 25)
  paintingSmall: { row: 25, col: 8 },
  paintingLarge1: { row: 25, col: 0 },
  paintingLarge2: { row: 25, col: 2 },

  // Windows with blinds (row 21)
  windowLeft: { row: 21, col: 2 },
  windowRight: { row: 21, col: 3 },

  // Storage — boxes/crates (row 29)
  boxSmall: { row: 29, col: 10 },
  boxLarge: { row: 29, col: 12 },
} as const satisfies Record<string, TilePos>;

export type TileName = keyof typeof TILES;

/** Extract a single tile sprite from a loaded tileset grid. */
export function getTileSprite(grid: TilesetGrid, name: TileName): SpriteData {
  const pos = TILES[name];
  return grid[pos.row]![pos.col]!;
}
