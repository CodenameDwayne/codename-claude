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
