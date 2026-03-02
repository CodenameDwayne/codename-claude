import type { Direction } from '../agents/characterState';

/** 2D array of hex color strings. Empty string = transparent. */
export type SpriteData = string[][];

export interface CharacterSprites {
  idle: Record<Direction, [SpriteData, SpriteData]>;
  walk: Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>;
  work: Record<Direction, [SpriteData, SpriteData]>;
  carry: Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>;
  celebrate: [SpriteData, SpriteData];
}

export interface CharacterPalette {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  accent: string; // glow color
}

export interface FurnitureSprite {
  sprite: SpriteData;
  widthTiles: number;
  heightTiles: number;
}
