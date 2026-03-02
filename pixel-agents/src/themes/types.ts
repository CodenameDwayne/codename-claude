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
  wallColor: string;
  map: TileMap;
  desks: DeskAssignment[];
  furniture: FurniturePlacement[];
}
