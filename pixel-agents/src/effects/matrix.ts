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
