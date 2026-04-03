export type TerrainType = 'grass' | 'desert' | 'mountain';
export type TerritoryOwner = 'neutral' | 'player' | 'ai1' | 'ai2' | 'ai3';
export type EntityType = 'simple_unit' | 'advanced_unit' | 'expert_unit' | 'tower' | 'castle' | 'city' | 'rebel';

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
  strength: number;
}

export const ENTITY_META: Record<EntityType, EntityMeta> = {
  simple_unit:   { name: 'Simple Unit',   icon: '⚔️',  cost: 10, upkeep: 2,  isUnit: true,  strength: 1 },
  advanced_unit: { name: 'Advanced Unit', icon: '🛡️',  cost: 20, upkeep: 6,  isUnit: true,  strength: 2 },
  expert_unit:   { name: 'Expert Unit',   icon: '🗡️',  cost: 30, upkeep: 18, isUnit: true,  strength: 3 },
  tower:         { name: 'Tower',         icon: '🗼',  cost: 15, upkeep: 1,  isUnit: false, strength: 2 },
  castle:        { name: 'Castle',        icon: '🏰',  cost: 30, upkeep: 5,  isUnit: false, strength: 3 },
  city:          { name: 'City',          icon: '🏙️',  cost: 10, upkeep: 0,  isUnit: false, strength: 1 },
  rebel:         { name: 'Rebel',         icon: '✊',   cost: 0,  upkeep: 0,  isUnit: false, strength: 0 },
};

export const TERRAIN_INCOME: Record<TerrainType, number> = {
  grass:    1,
  desert:   0,
  mountain: 0,
};

export const CITY_BONUS = 1;

export const UNIT_UPGRADE: Partial<Record<EntityType, EntityType>> = {
  simple_unit: 'advanced_unit',
  advanced_unit: 'expert_unit',
  tower: 'castle',
};

export function getZoCStrength(
  tileKey2: string,
  owner: TerritoryOwner,
  entities: Map<string, EntityType>,
  tileMap: Map<string, HexTile>,
): number {
  const tile = tileMap.get(tileKey2);
  if (!tile) return 0;
  const [q, r] = tileKey2.split(',').map(Number);
  let maxStr = 0;
  const candidateKeys = [tileKey2, ...HEX_EDGES.map(({ dir: [dq, dr] }) => tileKey(q + dq, r + dr))];
  for (const ck of candidateKeys) {
    const t = tileMap.get(ck);
    if (!t || t.owner !== owner) continue;
    const e = entities.get(ck);
    if (e) {
      const str = ENTITY_META[e].strength;
      if (str > maxStr) maxStr = str;
    }
  }
  return maxStr;
}

export function getMaxEnemyZoC(
  targetKey: string,
  playerOwner: TerritoryOwner,
  entities: Map<string, EntityType>,
  tileMap: Map<string, HexTile>,
): number {
  const targetTile = tileMap.get(targetKey);
  // Neutral tiles have no defending faction — no ZoC.
  // Player's own tiles are never attacked via this path.
  if (!targetTile || targetTile.owner === playerOwner || targetTile.owner === 'neutral') return 0;

  // Only units belonging to the tile's own faction count as defenders.
  const defenderOwner = targetTile.owner;

  const [q, r] = targetKey.split(',').map(Number);
  const candidateKeys = [targetKey, ...HEX_EDGES.map(({ dir: [dq, dr] }) => tileKey(q + dq, r + dr))];
  let maxStr = 0;
  for (const ck of candidateKeys) {
    const t = tileMap.get(ck);
    if (!t || t.owner !== defenderOwner) continue;
    const e = entities.get(ck);
    if (e) {
      const str = ENTITY_META[e].strength;
      if (str > maxStr) maxStr = str;
    }
  }
  return maxStr;
}

export function getValidMoves(
  unitKey: string,
  owner: TerritoryOwner,
  entities: Map<string, EntityType>,
  tileMap: Map<string, HexTile>,
  spentUnits: Set<string>,
): Set<string> {
  const result = new Set<string>();
  if (spentUnits.has(unitKey)) return result;

  const unitTile = tileMap.get(unitKey);
  if (!unitTile) return result;
  const unitEntity = entities.get(unitKey);
  if (!unitEntity) return result;
  const unitStrength = ENTITY_META[unitEntity].strength;

  const [uq, ur] = unitKey.split(',').map(Number);

  const visited = new Set<string>([unitKey]);
  const queue: Array<{ key: string; depth: number }> = [{ key: unitKey, depth: 0 }];

  while (queue.length > 0) {
    const { key: curr, depth } = queue.shift()!;
    const [cq, cr] = curr.split(',').map(Number);

    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(cq + dq, cr + dr);
      if (visited.has(nk)) continue;
      const neighbor = tileMap.get(nk);
      if (!neighbor) continue;
      if (neighbor.terrain === 'mountain') continue;

      if (neighbor.owner === owner) {
        visited.add(nk);
        if (depth < 3) {
          const allyEntity = entities.get(nk);
          const allyIsRebel = allyEntity === 'rebel';
          const allyIsUnit = allyEntity ? ENTITY_META[allyEntity].isUnit : false;
          if (!allyEntity || allyIsRebel) {
            result.add(nk);
            queue.push({ key: nk, depth: depth + 1 });
          } else if (allyIsUnit) {
            result.add(nk);
            queue.push({ key: nk, depth: depth + 1 });
          } else {
            queue.push({ key: nk, depth: depth + 1 });
          }
        }
      } else if (neighbor.owner === 'neutral') {
        visited.add(nk);
        if (depth < 3) {
          result.add(nk);
        }
      } else {
        visited.add(nk);
        if (depth < 3) {
          const enemyZoC = getMaxEnemyZoC(nk, owner, entities, tileMap);
          if (unitStrength > enemyZoC) {
            result.add(nk);
          }
        }
      }
    }
  }

  return result;
}

export function recalculateTerritories(
  changedTileKey: string,
  previousOwner: TerritoryOwner,
  previousTileMap: Map<string, HexTile>,
  newTiles: Map<string, HexTile>,
  previousBalances: Map<string, number>,
): { balances: Map<string, number>; tiles: Map<string, HexTile> } {
  const balances = new Map(previousBalances);

  function clusterOwner(tileMap: Map<string, HexTile>, startKey: string, owner: TerritoryOwner): HexTile[] {
    const cluster: HexTile[] = [];
    const visited = new Set<string>([startKey]);
    const q = [startKey];
    while (q.length > 0) {
      const curr = q.shift()!;
      const t = tileMap.get(curr);
      if (!t || t.owner !== owner) continue;
      cluster.push(t);
      const [cq, cr] = curr.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(cq + dq, cr + dr);
        if (visited.has(nk)) continue;
        visited.add(nk);
        const nt = tileMap.get(nk);
        if (nt && nt.owner === owner) q.push(nk);
      }
    }
    return cluster;
  }

  const oldPlayerTerrContainingChanged = clusterOwner(previousTileMap, changedTileKey, 'player');
  const oldPlayerIdChanged = getTerritoryId(oldPlayerTerrContainingChanged);

  const newPlayerCluster = clusterOwner(newTiles, changedTileKey, 'player');
  const newPlayerId = getTerritoryId(newPlayerCluster);

  if (newPlayerId) {
    const oldIdsCollected = new Set<string>();
    for (const t of newPlayerCluster) {
      if (t.key === changedTileKey) continue;
      const oldTerr = clusterOwner(previousTileMap, t.key, 'player');
      const oldId = getTerritoryId(oldTerr);
      if (oldId) oldIdsCollected.add(oldId);
    }
    if (oldPlayerIdChanged) oldIdsCollected.add(oldPlayerIdChanged);

    let mergedTotal = 0;
    for (const id of oldIdsCollected) {
      mergedTotal += previousBalances.get(id) ?? 0;
    }
    for (const id of oldIdsCollected) {
      balances.delete(id);
    }
    balances.set(newPlayerId, mergedTotal);
  }

  if (previousOwner !== 'neutral' && previousOwner !== 'player') {
    const oldDispTerr = clusterOwner(previousTileMap, changedTileKey, previousOwner);
    const oldDispId = getTerritoryId(oldDispTerr);
    const oldDispBalance = oldDispId ? (previousBalances.get(oldDispId) ?? 0) : 0;

    if (oldDispId) {
      balances.delete(oldDispId);
    }

    const oldDispTileKeys = new Set(oldDispTerr.map(t => t.key));
    oldDispTileKeys.delete(changedTileKey);

    const dispVisited = new Set<string>();
    const dispClusters: HexTile[][] = [];
    for (const key of oldDispTileKeys) {
      if (dispVisited.has(key)) continue;
      const tile = newTiles.get(key);
      if (!tile || tile.owner !== previousOwner) continue;
      const cluster = clusterOwner(newTiles, key, previousOwner);
      for (const ct of cluster) dispVisited.add(ct.key);
      dispClusters.push(cluster);
    }

    if (dispClusters.length === 0) {
    } else if (dispClusters.length === 1) {
      const newId = getTerritoryId(dispClusters[0]);
      if (newId) balances.set(newId, oldDispBalance);
    } else {
      const maxSize = Math.max(...dispClusters.map(c => c.length));
      const largestClusters = dispClusters.filter(c => c.length === maxSize);
      const exactlyTwoEqual = dispClusters.length === 2 && largestClusters.length === 2;
      const winnerCluster = largestClusters[0];

      for (const cluster of dispClusters) {
        const newId = getTerritoryId(cluster);
        if (!newId) continue;
        if (exactlyTwoEqual) {
          const half = Math.floor(oldDispBalance / 2);
          const extra = oldDispBalance % 2;
          const idfirst = getTerritoryId(dispClusters[0]) ?? '';
          balances.set(newId, half + (newId === idfirst ? extra : 0));
        } else if (cluster === winnerCluster) {
          balances.set(newId, oldDispBalance);
        } else {
          balances.set(newId, 0);
        }
      }
    }
  }

  return { balances, tiles: newTiles };
}

export function recalculateTerritoriesForCapture(
  changedTileKey: string,
  newOwner: TerritoryOwner,
  previousOwner: TerritoryOwner,
  previousTileMap: Map<string, HexTile>,
  newTileMap: Map<string, HexTile>,
  previousBalances: Map<string, number>,
): Map<string, number> {
  const balances = new Map(previousBalances);

  function clusterOwner(map: Map<string, HexTile>, startKey: string, owner: TerritoryOwner): HexTile[] {
    const start = map.get(startKey);
    if (!start || start.owner !== owner) return [];
    const cluster: HexTile[] = [];
    const visited = new Set<string>([startKey]);
    const q = [startKey];
    while (q.length > 0) {
      const curr = q.shift()!;
      const t = map.get(curr);
      if (!t || t.owner !== owner) continue;
      cluster.push(t);
      const [cq, cr] = curr.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(cq + dq, cr + dr);
        if (visited.has(nk)) continue;
        visited.add(nk);
        const nt = map.get(nk);
        if (nt && nt.owner === owner) q.push(nk);
      }
    }
    return cluster;
  }

  if (previousOwner !== 'neutral' && previousOwner !== newOwner) {
    const oldTerr = clusterOwner(previousTileMap, changedTileKey, previousOwner);
    const oldId = getTerritoryId(oldTerr);
    const oldBalance = oldId ? (previousBalances.get(oldId) ?? 0) : 0;
    if (oldId) balances.delete(oldId);

    const oldKeys = new Set(oldTerr.map(t => t.key));
    oldKeys.delete(changedTileKey);

    const dispVisited = new Set<string>();
    const dispClusters: HexTile[][] = [];
    for (const key of oldKeys) {
      if (dispVisited.has(key)) continue;
      const tile = newTileMap.get(key);
      if (!tile || tile.owner !== previousOwner) continue;
      const cluster = clusterOwner(newTileMap, key, previousOwner);
      for (const ct of cluster) dispVisited.add(ct.key);
      dispClusters.push(cluster);
    }

    if (dispClusters.length === 1) {
      const newId = getTerritoryId(dispClusters[0]);
      if (newId) balances.set(newId, oldBalance);
    } else if (dispClusters.length > 1) {
      const maxSize = Math.max(...dispClusters.map(c => c.length));
      const largestClusters = dispClusters.filter(c => c.length === maxSize);
      const exactlyTwoEqual = dispClusters.length === 2 && largestClusters.length === 2;
      const winnerCluster = largestClusters[0];
      for (const cluster of dispClusters) {
        const newId = getTerritoryId(cluster);
        if (!newId) continue;
        if (exactlyTwoEqual) {
          const half = Math.floor(oldBalance / 2);
          const extra = oldBalance % 2;
          const firstId = getTerritoryId(dispClusters[0]) ?? '';
          balances.set(newId, half + (newId === firstId ? extra : 0));
        } else if (cluster === winnerCluster) {
          balances.set(newId, oldBalance);
        } else {
          balances.set(newId, 0);
        }
      }
    }
  }

  if (newOwner !== 'neutral') {
    const oldNewOwnerTerr = clusterOwner(previousTileMap, changedTileKey, newOwner);
    const oldNewOwnerId = getTerritoryId(oldNewOwnerTerr);

    const newTerr = clusterOwner(newTileMap, changedTileKey, newOwner);
    const newTerrId = getTerritoryId(newTerr);

    if (newTerrId) {
      const mergedIds = new Set<string>();
      for (const t of newTerr) {
        if (t.key === changedTileKey) continue;
        const oldTerr2 = clusterOwner(previousTileMap, t.key, newOwner);
        const oldId2 = getTerritoryId(oldTerr2);
        if (oldId2) mergedIds.add(oldId2);
      }
      if (oldNewOwnerId) mergedIds.add(oldNewOwnerId);

      let mergedTotal = 0;
      for (const id of mergedIds) {
        mergedTotal += previousBalances.get(id) ?? 0;
      }
      for (const id of mergedIds) {
        balances.delete(id);
      }
      balances.set(newTerrId, mergedTotal);
    }
  }

  return balances;
}

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
    if (rand < 0.08) tile.terrain = 'mountain';
    else if (rand < 0.23) tile.terrain = 'desert';
    else if (rand < 0.25) pendingCityKeys.add(tile.key);
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

  for (const tile of tiles) {
    if (tile.terrain !== 'mountain') continue;
    const hasMountainNeighbor = getNeighborsOf(tile.q, tile.r).some(([nq, nr]) => {
      const t = tileMap.get(tileKey(nq, nr));
      return t && t.terrain === 'mountain';
    });
    if (!hasMountainNeighbor) {
      tile.terrain = 'grass';
      if (tile.cityBuffer || tile.isCity) continue;
      const neighborOwners = getNeighborsOf(tile.q, tile.r)
        .map(([nq, nr]) => tileMap.get(tileKey(nq, nr))?.owner)
        .filter((o): o is TerritoryOwner => !!o && o !== 'neutral');
      if (neighborOwners.length > 0) {
        const counts = new Map<TerritoryOwner, number>();
        for (const o of neighborOwners) counts.set(o, (counts.get(o) ?? 0) + 1);
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        tile.owner = best;
      } else {
        tile.owner = ownerList[Math.floor(Math.random() * ownerList.length)];
      }
    }
  }

  return tiles;
}
