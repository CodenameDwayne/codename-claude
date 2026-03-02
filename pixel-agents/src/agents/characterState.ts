import type { GridPos } from '../engine/tileMap';
import type { AgentRole, AgentActivity } from '../ws/types';

export type CharacterState =
  | { state: 'idle' }
  | { state: 'walking'; path: GridPos[]; pathIndex: number; targetState: CharacterState }
  | { state: 'working'; activity: AgentActivity }
  | { state: 'carrying'; path: GridPos[]; pathIndex: number; item: string; targetAgent: AgentRole }
  | { state: 'celebrating' };

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Character {
  role: AgentRole;
  pos: { x: number; y: number }; // pixel position
  gridPos: GridPos;
  direction: Direction;
  state: CharacterState;
  animFrame: number;
  animTimer: number;
}

export interface DeskAssignment {
  role: AgentRole;
  seatPos: GridPos;    // where the character sits
  approachPos: GridPos; // walkable tile in front of desk
}

const WALK_SPEED = 48; // pixels per second (3 tiles/sec at 16px)
const ANIM_SPEEDS: Record<string, number> = {
  idle: 0.5,
  walk: 0.15,
  working: 0.3,
  celebrating: 0.2,
};

export function createCharacter(role: AgentRole, startPos: GridPos): Character {
  return {
    role,
    pos: { x: startPos.col * 16, y: startPos.row * 16 },
    gridPos: startPos,
    direction: 'down',
    state: { state: 'idle' },
    animFrame: 0,
    animTimer: 0,
  };
}

export function updateCharacter(char: Character, dt: number): void {
  // Advance animation timer
  const speed = getAnimSpeed(char.state);
  char.animTimer += dt;
  if (char.animTimer >= speed) {
    char.animTimer -= speed;
    char.animFrame = (char.animFrame + 1) % getFrameCount(char.state);
  }

  // Movement for walking/carrying states
  if (char.state.state === 'walking' || char.state.state === 'carrying') {
    const path = char.state.path;
    const idx = char.state.pathIndex;

    if (idx >= path.length) {
      // Arrived at destination
      if (char.state.state === 'walking') {
        char.state = char.state.targetState;
      } else {
        char.state = { state: 'idle' };
      }
      char.animFrame = 0;
      char.animTimer = 0;
      return;
    }

    const target = path[idx]!;
    const targetX = target.col * 16;
    const targetY = target.row * 16;
    const dx = targetX - char.pos.x;
    const dy = targetY - char.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) {
      // Snap to target tile and advance path
      char.pos.x = targetX;
      char.pos.y = targetY;
      char.gridPos = target;
      if (char.state.state === 'walking') {
        char.state = { ...char.state, pathIndex: idx + 1 };
      } else {
        char.state = { ...char.state, pathIndex: idx + 1 };
      }
    } else {
      // Move toward target
      const move = WALK_SPEED * dt;
      char.pos.x += (dx / dist) * Math.min(move, dist);
      char.pos.y += (dy / dist) * Math.min(move, dist);

      // Update direction
      if (Math.abs(dx) > Math.abs(dy)) {
        char.direction = dx > 0 ? 'right' : 'left';
      } else {
        char.direction = dy > 0 ? 'down' : 'up';
      }
    }
  }
}

function getAnimSpeed(state: CharacterState): number {
  switch (state.state) {
    case 'idle': return ANIM_SPEEDS['idle']!;
    case 'walking':
    case 'carrying': return ANIM_SPEEDS['walk']!;
    case 'working': return ANIM_SPEEDS['working']!;
    case 'celebrating': return ANIM_SPEEDS['celebrating']!;
  }
}

function getFrameCount(state: CharacterState): number {
  switch (state.state) {
    case 'idle': return 2;
    case 'walking':
    case 'carrying': return 4;
    case 'working': return 2;
    case 'celebrating': return 2;
  }
}
