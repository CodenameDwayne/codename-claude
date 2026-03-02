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
