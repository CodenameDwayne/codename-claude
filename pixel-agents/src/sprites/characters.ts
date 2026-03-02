import type { SpriteData, CharacterPalette } from './types';
import type { Direction } from '../agents/characterState';
import type { AgentRole } from '../ws/types';

// Template keys
const _ = ''; // transparent
const H = 'hair';
const K = 'skin';
const S = 'shirt';
const P = 'pants';
const O = 'shoes';
const E = 'eyes';

type TemplateCell = '' | 'hair' | 'skin' | 'shirt' | 'pants' | 'shoes' | 'eyes';

// --- Character Palettes ---

export const PALETTES: Record<AgentRole, CharacterPalette> = {
  scout: {
    skin: '#f5c5a3',
    hair: '#2a2a3a',
    shirt: '#1a3a5a',   // dark hoodie
    pants: '#2a2a3a',
    shoes: '#3a3a4a',
    accent: '#00ffff',  // cyan glow
  },
  architect: {
    skin: '#d4a574',
    hair: '#4a3a2a',
    shirt: '#8a7a5a',   // vest/tie
    pants: '#3a3a4a',
    shoes: '#2a2a2a',
    accent: '#ffd700',  // gold glow
  },
  builder: {
    skin: '#c49a6c',
    hair: '#5a4a3a',
    shirt: '#4a6a3a',   // work shirt green
    pants: '#5a5a6a',
    shoes: '#4a3a2a',
    accent: '#00ff41',  // green glow
  },
  reviewer: {
    skin: '#f0d5b8',
    hair: '#6a5a4a',
    shirt: '#e8e8f0',   // lab coat white
    pants: '#3a3a4a',
    shoes: '#2a2a3a',
    accent: '#ff00ff',  // magenta glow
  },
};

// --- Sprite Templates (10w x 16h) ---
// These are facing DOWN. Other directions derived by shifting pixels.

const TEMPLATE_IDLE_DOWN_1: TemplateCell[][] = [
  [_, _, _, H, H, H, H, _, _, _],
  [_, _, H, H, H, H, H, H, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, K, E, K, K, E, K, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, _, K, K, K, K, _, _, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, K, S, S, S, S, K, S, _],
  [_, S, K, S, S, S, S, K, S, _],
  [_, _, _, S, S, S, S, _, _, _],
  [_, _, P, P, P, P, P, P, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, _, O, O, _, _, O, O, _, _],
  [_, _, O, O, _, _, O, O, _, _],
];

const TEMPLATE_IDLE_DOWN_2: TemplateCell[][] = [
  [_, _, _, H, H, H, H, _, _, _],
  [_, _, H, H, H, H, H, H, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, K, E, K, K, E, K, _, _],
  [_, _, _, K, K, K, K, _, _, _],
  [_, _, _, K, K, K, K, _, _, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, K, S, S, S, S, K, S, _],
  [_, _, K, S, S, S, S, K, _, _],
  [_, _, _, S, S, S, S, _, _, _],
  [_, _, P, P, P, P, P, P, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, _, O, O, _, _, O, O, _, _],
  [_, _, O, O, _, _, O, O, _, _],
];

// Walk frames — slight leg shifts
const TEMPLATE_WALK_DOWN_1 = TEMPLATE_IDLE_DOWN_1; // standing
const TEMPLATE_WALK_DOWN_2: TemplateCell[][] = [
  [_, _, _, H, H, H, H, _, _, _],
  [_, _, H, H, H, H, H, H, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, K, E, K, K, E, K, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, _, K, K, K, K, _, _, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, K, S, S, S, S, K, S, _],
  [_, S, K, S, S, S, S, K, S, _],
  [_, _, _, S, S, S, S, _, _, _],
  [_, _, P, P, P, P, P, P, _, _],
  [_, _, _, P, P, P, P, _, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, O, O, _, _, _, _, O, O, _],
  [_, O, O, _, _, _, _, O, O, _],
];
const TEMPLATE_WALK_DOWN_3 = TEMPLATE_IDLE_DOWN_1; // standing
const TEMPLATE_WALK_DOWN_4: TemplateCell[][] = [
  [_, _, _, H, H, H, H, _, _, _],
  [_, _, H, H, H, H, H, H, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, K, E, K, K, E, K, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, _, K, K, K, K, _, _, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, K, S, S, S, S, K, S, _],
  [_, S, K, S, S, S, S, K, S, _],
  [_, _, _, S, S, S, S, _, _, _],
  [_, _, P, P, P, P, P, P, _, _],
  [_, _, P, P, P, P, _, _, _, _],
  [_, _, _, _, P, P, P, P, _, _],
  [_, _, _, _, O, O, O, O, _, _],
  [_, _, O, O, _, _, _, _, _, _],
];

// Work frame (typing) — arms forward
const TEMPLATE_WORK_DOWN_1: TemplateCell[][] = [
  [_, _, _, H, H, H, H, _, _, _],
  [_, _, H, H, H, H, H, H, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, K, E, K, K, E, K, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, _, K, K, K, K, _, _, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, K, S, S, S, S, S, S, K, _],
  [_, K, K, S, S, S, S, K, K, _],
  [_, _, K, S, S, S, S, K, _, _],
  [_, _, P, P, P, P, P, P, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, _, O, O, _, _, O, O, _, _],
  [_, _, O, O, _, _, O, O, _, _],
];

const TEMPLATE_WORK_DOWN_2: TemplateCell[][] = [
  [_, _, _, H, H, H, H, _, _, _],
  [_, _, H, H, H, H, H, H, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, K, E, K, K, E, K, _, _],
  [_, _, K, K, K, K, K, K, _, _],
  [_, _, _, K, K, K, K, _, _, _],
  [_, S, S, S, S, S, S, S, S, _],
  [_, S, S, S, S, S, S, S, S, _],
  [K, _, S, S, S, S, S, S, _, K],
  [K, K, S, S, S, S, S, S, K, K],
  [_, K, _, S, S, S, S, _, K, _],
  [_, _, P, P, P, P, P, P, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, _, P, P, _, _, P, P, _, _],
  [_, _, O, O, _, _, O, O, _, _],
  [_, _, O, O, _, _, O, O, _, _],
];

// --- Template -> SpriteData Resolution ---

function resolveTemplate(template: TemplateCell[][], palette: CharacterPalette): SpriteData {
  return template.map((row) =>
    row.map((cell) => {
      switch (cell) {
        case '': return '';
        case 'hair': return palette.hair;
        case 'skin': return palette.skin;
        case 'shirt': return palette.shirt;
        case 'pants': return palette.pants;
        case 'shoes': return palette.shoes;
        case 'eyes': return '#1a1a2a';
      }
    })
  );
}

function flipHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse());
}

// --- Public API ---

export interface ResolvedSprites {
  idle: { down: [SpriteData, SpriteData] };
  walk: { down: [SpriteData, SpriteData, SpriteData, SpriteData] };
  work: { down: [SpriteData, SpriteData] };
}

export function resolveCharacterSprites(role: AgentRole): ResolvedSprites {
  const palette = PALETTES[role];
  return {
    idle: {
      down: [
        resolveTemplate(TEMPLATE_IDLE_DOWN_1, palette),
        resolveTemplate(TEMPLATE_IDLE_DOWN_2, palette),
      ],
    },
    walk: {
      down: [
        resolveTemplate(TEMPLATE_WALK_DOWN_1, palette),
        resolveTemplate(TEMPLATE_WALK_DOWN_2, palette),
        resolveTemplate(TEMPLATE_WALK_DOWN_3, palette),
        resolveTemplate(TEMPLATE_WALK_DOWN_4, palette),
      ],
    },
    work: {
      down: [
        resolveTemplate(TEMPLATE_WORK_DOWN_1, palette),
        resolveTemplate(TEMPLATE_WORK_DOWN_2, palette),
      ],
    },
  };
}

export function getGlowColor(role: AgentRole): string {
  return PALETTES[role].accent;
}
