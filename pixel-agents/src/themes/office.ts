// pixel-agents/src/themes/office.ts
import type { Theme } from './types';
import { TileType } from '../engine/tileMap';

const F = TileType.Floor;
const W = TileType.Wall;
const D = TileType.Desk;
const C = TileType.Chair;

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
