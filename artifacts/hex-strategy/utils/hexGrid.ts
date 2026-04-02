export type TerrainType = 'grass' | 'desert' | 'mountain';
export type TerritoryOwner = 'neutral' | 'player' | 'ai1' | 'ai2' | 'ai3';
export type EntityType = 'simple_unit' | 'advanced_unit' | 'expert_unit' | 'tower' | 'castle' | 'city';

export interface HexTile {
  q: number;
  r: number;
  terrain: TerrainType;
  owner: TerritoryOwner;
  key: string;
  cityBuffer: boolean;
  isCity: boolean;
}

export interface EntityMeta {
  name: string;
  icon: string;
  cost: number;
  upkeep: number;
  isUnit: boolean;
}

export const ENTITY_META: Record<EntityType, EntityMeta> = {
  simple_unit:   { name: 'Simple Unit',   icon: '⚔️',  cost: 10, upkeep: 3, isUnit: true  },
  advanced_unit: { name: 'Advanced Unit', icon: '🛡️',  cost: 20, upkeep: 5, isUnit: true  },
  expert_unit:   { name: 'Expert Unit',   icon: '🗡️',  cost: 30, upkeep: 9, isUnit: true  },
  tower:         { name: 'Tower',         icon: '🗼',  cost: 10, upkeep: 2, isUnit: false },
  castle:        { name: 'Castle',        icon: '🏰',  cost: 20, upkeep: 5, isUnit: false },
  city:          { name: 'City',          icon: '🏙️',  cost: 10, upkeep: 0, isUnit: false },
};

export const TERRAIN_INCOME: Record<TerrainType, number> = {
  grass:    1,
  desert:   0,
  mountain: 0,
};

export const CITY_BONUS = 1;

export function getContiguousTerritory(
  tileMap: Map<string, HexTile>,
  startKey: string,
  owner: TerritoryOwner,
): HexTile[] {
  const start = tileMap.get(startKey);
  if (!start || start.owner !== owner) return [];
  const visited = new Set<string>([startKey]);
  const queue: string[] = [startKey];
  const result: HexTile[] = [start];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const [cq, cr] = curr.split(',').map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(cq + dq, cr + dr);
      if (visited.has(nk)) continue;
      visited.add(nk);
      const neighbor = tileMap.get(nk);
      if (neighbor && neighbor.owner === owner) {
        result.push(neighbor);
        queue.push(nk);
      }
    }
  }
  return result;
}

/** Stable territory ID: lexicographically smallest tile key. Order-independent. */
export function getTerritoryId(tiles: HexTile[]): string | null {
  if (tiles.length === 0) return null;
  return tiles.reduce((best, t) => (t.key < best ? t.key : best), tiles[0].key);
}

export function findCentralTile(tiles: HexTile[]): HexTile | null {
  if (tiles.length === 0) return null;
  const avgQ = tiles.reduce((s, t) => s + t.q, 0) / tiles.length;
  const avgR = tiles.reduce((s, t) => s + t.r, 0) / tiles.length;
  let best = tiles[0];
  let bestDist = Infinity;
  for (const t of tiles) {
    const d = Math.hypot(t.q - avgQ, t.r - avgR);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best;
}

export interface BoardBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export const HEX_EDGES: Array<{ dir: [number, number]; verts: [number, number] }> = [
  { dir: [1, 0],   verts: [0, 1] },
  { dir: [-1, 0],  verts: [3, 4] },
  { dir: [0, 1],   verts: [1, 2] },
  { dir: [0, -1],  verts: [4, 5] },
  { dir: [1, -1],  verts: [5, 0] },
  { dir: [-1, 1],  verts: [2, 3] },
];

export function tileKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs(q1 + r1 - q2 - r2));
}

export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * (3 / 2) * q,
    y: size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r),
  };
}

export function hexCornerPoint(
  cx: number,
  cy: number,
  size: number,
  i: number,
): { x: number; y: number } {
  const angle = (Math.PI / 3) * i;
  return {
    x: cx + size * Math.cos(angle),
    y: cy + size * Math.sin(angle),
  };
}

export function hexCornersString(cx: number, cy: number, size: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const pt = hexCornerPoint(cx, cy, size, i);
    return `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`;
  }).join(' ');
}

export function getBoardBounds(tiles: HexTile[], size: number): BoardBounds {
  if (tiles.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const tile of tiles) {
    const { x, y } = hexToPixel(tile.q, tile.r, size);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = size * 1.5;
  minX -= pad; minY -= pad;
  maxX += pad; maxY += pad;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function getNeighborsOf(q: number, r: number): [number, number][] {
  return HEX_EDGES.map(({ dir: [dq, dr] }) => [q + dq, r + dr] as [number, number]);
}

const MIN_CITY_DISTANCE = 5;

export function generateHexGrid(tileCount: number, playerCount: number): HexTile[] {
  const clampedCount = Math.min(200, Math.max(40, tileCount));
  const clampedPlayers = Math.min(4, Math.max(1, playerCount));

  const tileMap = new Map<string, HexTile>();
  const frontier: [number, number][] = [[0, 0]];
  const visited = new Set<string>([tileKey(0, 0)]);

  tileMap.set(tileKey(0, 0), {
    q: 0, r: 0, terrain: 'grass', owner: 'neutral', key: tileKey(0, 0), cityBuffer: false, isCity: false,
  });

  while (tileMap.size < clampedCount && frontier.length > 0) {
    const idx = Math.floor(Math.random() * frontier.length);
    const [q, r] = frontier[idx];
    const unvisited = getNeighborsOf(q, r).filter(
      ([nq, nr]) => !visited.has(tileKey(nq, nr)),
    );

    if (unvisited.length === 0) {
      frontier.splice(idx, 1);
      continue;
    }

    const [nq, nr] = unvisited[Math.floor(Math.random() * unvisited.length)];
    const key = tileKey(nq, nr);
    visited.add(key);
    tileMap.set(key, { q: nq, r: nr, terrain: 'grass', owner: 'neutral', key, cityBuffer: false, isCity: false });
    frontier.push([nq, nr]);
  }

  const tiles = Array.from(tileMap.values());

  const pendingCityKeys = new Set<string>();

  for (const tile of tiles) {
    const rand = Math.random();
    if (rand < 0.05) tile.terrain = 'mountain';
    else if (rand < 0.20) tile.terrain = 'desert';
    else if (rand < 0.21) pendingCityKeys.add(tile.key);
    else tile.terrain = 'grass';
  }

  const acceptedCities: HexTile[] = [];
  for (const tile of tiles) {
    if (!pendingCityKeys.has(tile.key)) continue;
    const tooClose = acceptedCities.some(
      c => hexDistance(tile.q, tile.r, c.q, c.r) < MIN_CITY_DISTANCE,
    );
    if (!tooClose) {
      acceptedCities.push(tile);
    }
  }

  for (const city of acceptedCities) {
    city.isCity = true;
    city.terrain = Math.random() < 0.5 ? 'grass' : 'desert';
    for (const [nq, nr] of getNeighborsOf(city.q, city.r)) {
      const neighbor = tileMap.get(tileKey(nq, nr));
      if (neighbor && !neighbor.isCity) {
        neighbor.cityBuffer = true;
      }
    }
  }

  const nonMountain = tiles.filter(t => t.terrain !== 'mountain');
  if (nonMountain.length > 1) {
    const reachable = new Set<string>([nonMountain[0].key]);
    const queue: string[] = [nonMountain[0].key];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const [cq, cr] = curr.split(',').map(Number);
      for (const [nq, nr] of getNeighborsOf(cq, cr)) {
        const nk = tileKey(nq, nr);
        const neighbor = tileMap.get(nk);
        if (!reachable.has(nk) && neighbor && neighbor.terrain !== 'mountain') {
          reachable.add(nk);
          queue.push(nk);
        }
      }
    }

    for (const tile of nonMountain) {
      if (reachable.has(tile.key)) continue;
      const visited2 = new Set<string>([tile.key]);
      const bfsQ: string[] = [tile.key];
      const parent = new Map<string, string>();
      let found = false;
      while (bfsQ.length > 0 && !found) {
        const curr = bfsQ.shift()!;
        const [cq, cr] = curr.split(',').map(Number);
        for (const [nq, nr] of getNeighborsOf(cq, cr)) {
          const nk = tileKey(nq, nr);
          if (!tileMap.has(nk) || visited2.has(nk)) continue;
          visited2.add(nk);
          parent.set(nk, curr);
          if (reachable.has(nk)) {
            let p = nk;
            while (parent.has(p)) {
              const prev = parent.get(p)!;
              const t = tileMap.get(prev);
              if (t && t.terrain === 'mountain') t.terrain = 'grass';
              p = prev;
            }
            reachable.add(tile.key);
            found = true;
            break;
          }
          bfsQ.push(nk);
        }
      }
    }
  }

  const ownerList: TerritoryOwner[] = (
    ['player', 'ai1', 'ai2', 'ai3'] as TerritoryOwner[]
  ).slice(0, clampedPlayers);

  const assignable = tiles.filter(
    t => t.terrain !== 'mountain' && !t.isCity && !t.cityBuffer,
  );

  for (let i = assignable.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [assignable[i], assignable[j]] = [assignable[j], assignable[i]];
  }

  for (let i = 0; i < assignable.length; i++) {
    assignable[i].owner = ownerList[i % ownerList.length];
  }

  return tiles;
}
