import type { TileMap } from '../engine/tileMap';
import type { DeskAssignment } from '../agents/characterState';

export interface Theme {
  name: string;
  background: string;
  floorColor: string;
  wallColor: string;
  map: TileMap;
  desks: DeskAssignment[];
}
