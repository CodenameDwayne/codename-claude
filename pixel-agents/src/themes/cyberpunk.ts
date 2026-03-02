import type { Theme } from './types';
import { TileType } from '../engine/tileMap';

// 20x15 tile grid
const W = TileType.Wall;
const F = TileType.Floor;
const D = TileType.Desk;
const C = TileType.Chair;

const MAP_DATA = [
  [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, D, D, F, F, F, F, F, F, F, F, F, F, F, F, D, D, F, W],
  [W, F, F, C, F, F, F, F, F, F, F, F, F, F, F, F, C, F, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, F, F, C, F, F, F, F, F, F, F, F, F, F, F, F, C, F, F, W],
  [W, F, D, D, F, F, F, F, F, F, F, F, F, F, F, F, D, D, F, W],
  [W, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, W],
  [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
];

export const cyberpunkTheme: Theme = {
  name: 'Cyberpunk Lab',
  background: '#0a0a1a',
  floorColor: '#0f0f2a',
  wallColor: '#1a1a3a',
  map: {
    width: 20,
    height: 15,
    tiles: MAP_DATA,
  },
  desks: [
    // Scout — top-left (radar station)
    { role: 'scout', seatPos: { col: 3, row: 3 }, approachPos: { col: 3, row: 4 } },
    // Architect — top-right (command deck)
    { role: 'architect', seatPos: { col: 16, row: 3 }, approachPos: { col: 16, row: 4 } },
    // Builder — bottom-left (engineering bay)
    { role: 'builder', seatPos: { col: 3, row: 11 }, approachPos: { col: 3, row: 10 } },
    // Reviewer — bottom-right (analysis console)
    { role: 'reviewer', seatPos: { col: 16, row: 11 }, approachPos: { col: 16, row: 10 } },
  ],
};
