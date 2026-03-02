// pixel-agents/src/hooks/useAssets.ts
import { useState, useEffect } from 'react';
import type { CharacterSprites, TilesetGrid } from '../sprites/types';
import type { AgentRole } from '../ws/types';
import { loadImage, imageToPixels, sliceTileset } from '../sprites/loader';
import { extractCharacterSprites } from '../sprites/characters';
import tilesetUrl from '../assets/tileset.png';
import charactersUrl from '../assets/characters.png';

export interface LoadedAssets {
  tileset: TilesetGrid;
  characters: Record<AgentRole, CharacterSprites>;
}

export function useAssets(): { assets: LoadedAssets | null; error: string | null } {
  const [assets, setAssets] = useState<LoadedAssets | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [tilesetImg, charsImg] = await Promise.all([
          loadImage(tilesetUrl),
          loadImage(charactersUrl),
        ]);

        if (cancelled) return;

        const tilesetData = imageToPixels(tilesetImg);
        const charsData = imageToPixels(charsImg);

        const tileset = sliceTileset(tilesetData, 16, 16);

        const roles: AgentRole[] = ['scout', 'architect', 'builder', 'reviewer'];
        const characters = {} as Record<AgentRole, CharacterSprites>;
        for (const role of roles) {
          characters[role] = extractCharacterSprites(charsData, role);
        }

        if (!cancelled) {
          setAssets({ tileset, characters });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load assets');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { assets, error };
}
