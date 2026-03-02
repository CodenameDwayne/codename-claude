/** 2D array of hex color strings. Empty string = transparent. */
export type SpriteData = string[][];

export interface CharacterSprites {
  down: { idle: SpriteData[]; walk: SpriteData[] };
  up: { idle: SpriteData[]; walk: SpriteData[] };
  right: { idle: SpriteData[]; walk: SpriteData[] };
  left: { idle: SpriteData[]; walk: SpriteData[] };
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

/** A loaded tileset: grid of SpriteData indexed by [row][col]. */
export type TilesetGrid = SpriteData[][];
