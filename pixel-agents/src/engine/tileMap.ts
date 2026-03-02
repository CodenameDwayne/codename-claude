export const TILE_SIZE = 16;

export enum TileType {
  Floor = 0,
  Wall = 1,
  Desk = 2,
  Chair = 3,
  Furniture = 4,
}

export interface GridPos {
  col: number;
  row: number;
}

export interface TileMap {
  width: number;  // in tiles
  height: number; // in tiles
  tiles: TileType[][];
}

export function isWalkable(tile: TileType): boolean {
  return tile === TileType.Floor;
}

/**
 * BFS pathfinding on a tile grid.
 * Returns array of GridPos from start to end (inclusive), or empty if no path.
 */
export function findPath(map: TileMap, start: GridPos, end: GridPos): GridPos[] {
  if (start.col === end.col && start.row === end.row) return [start];

  const endTile = map.tiles[end.row]?.[end.col];
  if (endTile === undefined || !isWalkable(endTile)) return [];

  const visited = new Set<string>();
  const parent = new Map<string, GridPos>();
  const queue: GridPos[] = [start];
  const key = (p: GridPos) => `${p.col},${p.row}`;

  visited.add(key(start));

  const directions = [
    { col: 0, row: -1 },
    { col: 0, row: 1 },
    { col: -1, row: 0 },
    { col: 1, row: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const dir of directions) {
      const next: GridPos = { col: current.col + dir.col, row: current.row + dir.row };
      const k = key(next);

      if (visited.has(k)) continue;
      if (next.col < 0 || next.col >= map.width || next.row < 0 || next.row >= map.height) continue;

      const tile = map.tiles[next.row]?.[next.col];
      if (tile === undefined || !isWalkable(tile)) continue;

      visited.add(k);
      parent.set(k, current);

      if (next.col === end.col && next.row === end.row) {
        // Reconstruct path
        const path: GridPos[] = [end];
        let cur = end;
        while (cur.col !== start.col || cur.row !== start.row) {
          cur = parent.get(key(cur))!;
          path.unshift(cur);
        }
        return path;
      }

      queue.push(next);
    }
  }

  return []; // No path found
}
