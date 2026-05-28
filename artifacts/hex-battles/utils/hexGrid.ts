import type {
  TerrainType,
  TerritoryOwner,
  EntityType,
  HexTile,
  EntityMeta,
  BoardBounds,
} from "@/types";

export type {
  TerrainType,
  TerritoryOwner,
  EntityType,
  HexTile,
  EntityMeta,
  BoardBounds,
};

export const ENTITY_META: Record<EntityType, EntityMeta> = {
  simple_unit:   { name: 'Peasant',   icon: '⚒️',  cost: 10, upkeep: 3,  isUnit: true,  strength: 1 },
  advanced_unit: { name: 'Warrior',   icon: '🗡️',  cost: 20, upkeep: 9,  isUnit: true,  strength: 2 },
  expert_unit:   { name: 'Swordsman', icon: '⚔️',  cost: 30, upkeep: 27, isUnit: true,  strength: 3 },
  // NOTE: tower/castle upkeep here is the per-building BASE rate only.
  // Actual territory upkeep is LINEAR (n-th building costs n×base); use calcDefenseUpkeep/nextDefenseUpkeep.
  tower:         { name: 'Tower',     icon: '🛕',  cost: 15, upkeep: 1,  isUnit: false, strength: 1 },
  castle:        { name: 'Castle',    icon: '🏰',  cost: 30, upkeep: 5,  isUnit: false, strength: 2 },
  bridge:        { name: 'Bridge',    icon: '➖',   cost: 5,  upkeep: 1,  isUnit: false, strength: 0 },
  rebel:         { name: 'Rebel',     icon: '✊',   cost: 0,  upkeep: 0,  isUnit: false, strength: 0 },
  city:          { name: 'City',      icon: '🏘️',  cost: 10, upkeep: 0,  isUnit: false, strength: 0 },
};

export const TERRAIN_INCOME: Record<TerrainType, number> = {
  grass:    2,
  desert:   1,
  mountain: 0,
  lake:     0,
  forest:   2,
};

export const TERRAIN_MOVE_COST: Record<TerrainType, number> = {
  grass:    1,
  desert:   1,
  mountain: Infinity,
  lake:     1,
  forest:   2,
};

export const CITY_BONUS = 2;

export const UNIT_UPGRADE: Partial<Record<EntityType, EntityType>> = {
  simple_unit: 'advanced_unit',
  advanced_unit: 'expert_unit',
  tower: 'castle',
};

/**
 * Total upkeep for `count` defense buildings of the given type in one territory.
 * Towers:  1 + 2 + ... + n = n*(n+1)/2
 * Castles: 5 + 10 + ... + 5n = 5*n*(n+1)/2
 */
export function calcDefenseUpkeep(type: 'tower' | 'castle', count: number): number {
  if (count <= 0) return 0;
  const base = type === 'castle' ? 5 : 1;
  return base * count * (count + 1) / 2;
}

/**
 * Upkeep cost of the NEXT defense building of the given type,
 * given `currentCount` already in the territory.
 * Towers:  currentCount + 1
 * Castles: 5 * (currentCount + 1)
 */
export function nextDefenseUpkeep(type: 'tower' | 'castle', currentCount: number): number {
  const base = type === 'castle' ? 5 : 1;
  return base * (currentCount + 1);
}

/** Returns true when a lake tile is bridged or occupied by a unit (captured bridge). */
function isLakePassable(key: string, entities?: Map<string, EntityType>): boolean {
  const e = entities?.get(key);
  if (!e) return false;
  return e === 'bridge' || ENTITY_META[e].isUnit;
}

/** A lake tile counts as territory only when it has a bridge entity or a unit standing on it. */
function isTerritoryTile(
  tileMap: Map<string, HexTile>,
  key: string,
  owner: TerritoryOwner,
  entities?: Map<string, EntityType>,
): boolean {
  const t = tileMap.get(key);
  if (!t || t.owner !== owner || t.terrain === 'mountain') return false;
  if (t.terrain === 'lake') return isLakePassable(key, entities);
  return true;
}

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
  if (!targetTile || targetTile.owner === playerOwner || targetTile.owner === 'neutral') return 0;

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

function bfsInsert(queue: Array<{ key: string; cost: number }>, item: { key: string; cost: number }): void {
  let lo = 0, hi = queue.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (queue[mid].cost <= item.cost) lo = mid + 1;
    else hi = mid;
  }
  queue.splice(lo, 0, item);
}

export function getValidMoves(
  unitKey: string,
  owner: TerritoryOwner,
  entities: Map<string, EntityType>,
  tileMap: Map<string, HexTile>,
  spentUnits: Set<string>,
  maxRange: number = 3,
): Set<string> {
  const result = new Set<string>();
  if (spentUnits.has(unitKey)) return result;
  if (maxRange <= 0) return result;

  const unitTile = tileMap.get(unitKey);
  if (!unitTile) return result;
  const unitEntity = entities.get(unitKey);
  if (!unitEntity) return result;
  const unitStrength = ENTITY_META[unitEntity].strength;

  const bestCost = new Map<string, number>([[unitKey, 0]]);
  const queue: Array<{ key: string; cost: number }> = [{ key: unitKey, cost: 0 }];

  while (queue.length > 0) {
    const { key: curr, cost } = queue.shift()!;
    if ((bestCost.get(curr) ?? Infinity) < cost) continue;
    const [cq, cr] = curr.split(',').map(Number);

    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(cq + dq, cr + dr);
      const neighbor = tileMap.get(nk);
      if (!neighbor) continue;
      if (neighbor.terrain === 'mountain') continue;

      // Lake tiles are impassable unless they have a bridge entity
      if (neighbor.terrain === 'lake' && !isLakePassable(nk, entities)) continue;

      const moveCost = TERRAIN_MOVE_COST[neighbor.terrain] ?? 1;
      const newCost = cost + moveCost;

      if (newCost > maxRange) continue;
      const prev = bestCost.get(nk) ?? Infinity;
      if (newCost >= prev) continue;
      bestCost.set(nk, newCost);

      if (neighbor.owner === owner) {
        const allyEntity = entities.get(nk);
        const allyIsRebel = allyEntity === 'rebel';
        const allyIsCity = allyEntity === 'city';
        const allyIsBridge = allyEntity === 'bridge';
        const allyIsUnit = allyEntity ? ENTITY_META[allyEntity].isUnit : false;
        if (!allyEntity) {
          result.add(nk);
          bfsInsert(queue, { key: nk, cost: newCost });
        } else if (allyIsRebel) {
          // Can move ONTO a rebel tile to clear it, but cannot pass THROUGH it.
          result.add(nk);
        } else if (allyIsCity || allyIsBridge) {
          result.add(nk);
          bfsInsert(queue, { key: nk, cost: newCost });
        } else if (allyIsUnit) {
          result.add(nk);
          bfsInsert(queue, { key: nk, cost: newCost });
        } else {
          bfsInsert(queue, { key: nk, cost: newCost });
        }
      } else if (neighbor.owner === 'neutral') {
        result.add(nk);
      } else {
        const enemyZoC = getMaxEnemyZoC(nk, owner, entities, tileMap);
        if (unitStrength > enemyZoC) {
          result.add(nk);
        }
      }
    }
  }

  return result;
}

export function getMoveCost(
  fromKey: string,
  toKey: string,
  tileMap: Map<string, HexTile>,
  entities?: Map<string, EntityType>,
): number {
  if (fromKey === toKey) return 0;
  const bestCost = new Map<string, number>([[fromKey, 0]]);
  const queue: Array<{ key: string; cost: number }> = [{ key: fromKey, cost: 0 }];
  while (queue.length > 0) {
    const { key: curr, cost } = queue.shift()!;
    if ((bestCost.get(curr) ?? Infinity) < cost) continue;
    if (curr === toKey) return cost;
    const [cq, cr] = curr.split(',').map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(cq + dq, cr + dr);
      const neighbor = tileMap.get(nk);
      if (!neighbor || neighbor.terrain === 'mountain') continue;
      if (neighbor.terrain === 'lake' && !isLakePassable(nk, entities)) continue;
      const moveCost = TERRAIN_MOVE_COST[neighbor.terrain] ?? 1;
      const newCost = cost + moveCost;
      const prev = bestCost.get(nk) ?? Infinity;
      if (newCost < prev) {
        bestCost.set(nk, newCost);
        bfsInsert(queue, { key: nk, cost: newCost });
      }
    }
  }
  return Infinity;
}

export function recalculateTerritories(
  changedTileKey: string,
  previousOwner: TerritoryOwner,
  previousTileMap: Map<string, HexTile>,
  newTiles: Map<string, HexTile>,
  previousBalances: Map<string, number>,
  entities?: Map<string, EntityType>,
  prevEntities?: Map<string, EntityType>,
): { balances: Map<string, number>; tiles: Map<string, HexTile> } {
  const balances = new Map(previousBalances);
  // prevEntities: used for BFS over previousTileMap (old state).
  // entities: used for BFS over newTiles (new state).
  // Defaults to entities if prevEntities is not provided (backwards compat).
  const oldEnt = prevEntities ?? entities;

  function clusterOwnerOld(tileMap: Map<string, HexTile>, startKey: string, owner: TerritoryOwner): HexTile[] {
    if (!isTerritoryTile(tileMap, startKey, owner, oldEnt)) return [];
    const cluster: HexTile[] = [];
    const visited = new Set<string>([startKey]);
    const q = [startKey];
    while (q.length > 0) {
      const curr = q.shift()!;
      const t = tileMap.get(curr);
      if (!t || t.owner !== owner) continue;
      if (t.terrain === 'mountain') continue;
      if (t.terrain === 'lake' && !isLakePassable(curr, oldEnt)) continue;
      cluster.push(t);
      const [cq, cr] = curr.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(cq + dq, cr + dr);
        if (visited.has(nk)) continue;
        visited.add(nk);
        if (isTerritoryTile(tileMap, nk, owner, oldEnt)) q.push(nk);
      }
    }
    return cluster;
  }

  function clusterOwnerNew(tileMap: Map<string, HexTile>, startKey: string, owner: TerritoryOwner): HexTile[] {
    if (!isTerritoryTile(tileMap, startKey, owner, entities)) return [];
    const cluster: HexTile[] = [];
    const visited = new Set<string>([startKey]);
    const q = [startKey];
    while (q.length > 0) {
      const curr = q.shift()!;
      const t = tileMap.get(curr);
      if (!t || t.owner !== owner) continue;
      if (t.terrain === 'mountain') continue;
      if (t.terrain === 'lake' && !isLakePassable(curr, entities)) continue;
      cluster.push(t);
      const [cq, cr] = curr.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(cq + dq, cr + dr);
        if (visited.has(nk)) continue;
        visited.add(nk);
        if (isTerritoryTile(tileMap, nk, owner, entities)) q.push(nk);
      }
    }
    return cluster;
  }

  const oldPlayerTerrContainingChanged = clusterOwnerOld(previousTileMap, changedTileKey, 'player');
  const oldPlayerIdChanged = getTerritoryId(oldPlayerTerrContainingChanged);

  const newPlayerCluster = clusterOwnerNew(newTiles, changedTileKey, 'player');
  const newPlayerId = getTerritoryId(newPlayerCluster);

  if (newPlayerId) {
    const oldIdsCollected = new Set<string>();
    for (const t of newPlayerCluster) {
      if (t.key === changedTileKey) continue;
      const oldTerr = clusterOwnerOld(previousTileMap, t.key, 'player');
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
    const oldDispTerr = clusterOwnerOld(previousTileMap, changedTileKey, previousOwner);
    const oldDispId = getTerritoryId(oldDispTerr);
    const oldDispBalance = oldDispId ? (previousBalances.get(oldDispId) ?? 0) : 0;

    if (oldDispId && oldDispId !== newPlayerId) {
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
      const cluster = clusterOwnerNew(newTiles, key, previousOwner);
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
  entities?: Map<string, EntityType>,
  prevEntities?: Map<string, EntityType>,
): Map<string, number> {
  const balances = new Map(previousBalances);
  // prevEntities: used for BFS over previousTileMap (old entity state).
  // entities: used for BFS over newTileMap (new entity state).
  const oldEnt = prevEntities ?? entities;

  function clusterOwnerOld(map: Map<string, HexTile>, startKey: string, owner: TerritoryOwner): HexTile[] {
    if (!isTerritoryTile(map, startKey, owner, oldEnt)) return [];
    const cluster: HexTile[] = [];
    const visited = new Set<string>([startKey]);
    const q = [startKey];
    while (q.length > 0) {
      const curr = q.shift()!;
      const t = map.get(curr);
      if (!t || t.owner !== owner) continue;
      if (t.terrain === 'mountain') continue;
      if (t.terrain === 'lake' && !isLakePassable(curr, oldEnt)) continue;
      cluster.push(t);
      const [cq, cr] = curr.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(cq + dq, cr + dr);
        if (visited.has(nk)) continue;
        visited.add(nk);
        if (isTerritoryTile(map, nk, owner, oldEnt)) q.push(nk);
      }
    }
    return cluster;
  }

  function clusterOwnerNew(map: Map<string, HexTile>, startKey: string, owner: TerritoryOwner): HexTile[] {
    if (!isTerritoryTile(map, startKey, owner, entities)) return [];
    const cluster: HexTile[] = [];
    const visited = new Set<string>([startKey]);
    const q = [startKey];
    while (q.length > 0) {
      const curr = q.shift()!;
      const t = map.get(curr);
      if (!t || t.owner !== owner) continue;
      if (t.terrain === 'mountain') continue;
      if (t.terrain === 'lake' && !isLakePassable(curr, entities)) continue;
      cluster.push(t);
      const [cq, cr] = curr.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(cq + dq, cr + dr);
        if (visited.has(nk)) continue;
        visited.add(nk);
        if (isTerritoryTile(map, nk, owner, entities)) q.push(nk);
      }
    }
    return cluster;
  }

  if (previousOwner !== 'neutral' && previousOwner !== newOwner) {
    const oldTerr = clusterOwnerOld(previousTileMap, changedTileKey, previousOwner);
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
      const cluster = clusterOwnerNew(newTileMap, key, previousOwner);
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
    const oldNewOwnerTerr = clusterOwnerOld(previousTileMap, changedTileKey, newOwner);
    const oldNewOwnerId = getTerritoryId(oldNewOwnerTerr);

    const newTerr = clusterOwnerNew(newTileMap, changedTileKey, newOwner);
    const newTerrId = getTerritoryId(newTerr);

    if (newTerrId) {
      const mergedIds = new Set<string>();
      for (const t of newTerr) {
        if (t.key === changedTileKey) continue;
        const oldTerr2 = clusterOwnerOld(previousTileMap, t.key, newOwner);
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
  entities?: Map<string, EntityType>,
): HexTile[] {
  const start = tileMap.get(startKey);
  if (!start || start.owner !== owner || start.terrain === 'mountain') return [];
  // Lake tiles are only part of territory if bridged or unit is standing on it
  if (start.terrain === 'lake' && !isLakePassable(startKey, entities)) return [];
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
      if (!neighbor || neighbor.owner !== owner || neighbor.terrain === 'mountain') continue;
      // Lake tiles only traversable as territory when bridged or unit is standing on it
      if (neighbor.terrain === 'lake' && !isLakePassable(nk, entities)) continue;
      result.push(neighbor);
      queue.push(nk);
    }
  }
  return result;
}

/**
 * Lightweight per-turn cache for `getContiguousTerritory` results.
 * Key: `"${startKey}:${owner}"`. Assumes the underlying tileMap and entities
 * are immutable for the lifetime of the cache; call `clear()` whenever either
 * mutates so stale results are never returned.
 */
export class TerritoryCache {
  private _cache = new Map<string, HexTile[]>();

  get(
    tileMap: Map<string, HexTile>,
    startKey: string,
    owner: TerritoryOwner,
    entities?: Map<string, EntityType>,
  ): HexTile[] {
    const cacheKey = `${startKey}:${owner}`;
    const hit = this._cache.get(cacheKey);
    if (hit !== undefined) return hit;
    const result = getContiguousTerritory(tileMap, startKey, owner, entities);
    this._cache.set(cacheKey, result);
    return result;
  }

  clear(): void {
    this._cache.clear();
  }
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

export {
  HEX_EDGES,
  tileKey,
  hexDistance,
  hexToPixel,
  hexCornerPoint,
  hexCornersString,
  getBoardBounds,
} from "@/utils/hexMath";
import { HEX_EDGES, tileKey, hexDistance, hexToPixel } from "@/utils/hexMath";

function getNeighborsOf(q: number, r: number): [number, number][] {
  return HEX_EDGES.map(({ dir: [dq, dr] }) => [q + dq, r + dr] as [number, number]);
}

const MIN_CITY_DISTANCE = 5;

export interface MapGenOptions {
  mountainPct?: number;
  lakePct?: number;
  desertPct?: number;
  forestPct?: number;
  cityCount?: number;
}

export function generateHexGrid(
  tileCount: number,
  playerCount: number,
  options: MapGenOptions = {},
): HexTile[] {
  const clampedCount = Math.min(200, Math.max(40, tileCount));
  const clampedPlayers = Math.min(6, Math.max(1, playerCount));

  const clampPct = (v: number | undefined, fallback: number) => {
    const n = v ?? fallback;
    return Math.max(0, Math.min(25, n)) / 100;
  };
  const mountainP = clampPct(options.mountainPct, 8);
  const lakeP = clampPct(options.lakePct, 10);
  const desertP = clampPct(options.desertPct, 10);
  const forestP = clampPct(options.forestPct, 10);
  const cityTarget = Math.max(0, Math.min(5, Math.round(options.cityCount ?? 2)));

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

  // Fill internal voids
  let voidFilled = true;
  while (voidFilled) {
    voidFilled = false;
    for (const tile of Array.from(tileMap.values())) {
      for (const [nq, nr] of getNeighborsOf(tile.q, tile.r)) {
        const nk = tileKey(nq, nr);
        if (tileMap.has(nk)) continue;
        const allSixInMap = getNeighborsOf(nq, nr).every(
          ([nnq, nnr]) => tileMap.has(tileKey(nnq, nnr)),
        );
        if (allSixInMap) {
          tileMap.set(nk, { q: nq, r: nr, terrain: 'grass', owner: 'neutral', key: nk, cityBuffer: false, isCity: false });
          voidFilled = true;
        }
      }
    }
  }

  const tiles = Array.from(tileMap.values());

  const mThr = mountainP;
  const lThr = mThr + lakeP;
  const dThr = lThr + desertP;
  const fThr = dThr + forestP;
  for (const tile of tiles) {
    const rand = Math.random();
    if (rand < mThr) tile.terrain = 'mountain';
    else if (rand < lThr) tile.terrain = 'lake';
    else if (rand < dThr) tile.terrain = 'desert';
    else if (rand < fThr) tile.terrain = 'forest';
    else tile.terrain = 'grass';
  }

  // Pick exactly `cityTarget` cities from grass/desert tiles with spacing.
  const cityCandidates = tiles.filter(
    (t) => t.terrain !== 'mountain' && t.terrain !== 'lake',
  );
  for (let i = cityCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cityCandidates[i], cityCandidates[j]] = [cityCandidates[j], cityCandidates[i]];
  }
  const acceptedCities: HexTile[] = [];
  for (const tile of cityCandidates) {
    if (acceptedCities.length >= cityTarget) break;
    const tooClose = acceptedCities.some(
      (c) => hexDistance(tile.q, tile.r, c.q, c.r) < MIN_CITY_DISTANCE,
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
      if (neighbor && !neighbor.isCity && neighbor.terrain !== 'mountain' && neighbor.terrain !== 'lake') {
        neighbor.cityBuffer = true;
      }
    }
  }

  const nonMountain = tiles.filter(t => t.terrain !== 'mountain' && t.terrain !== 'lake');
  if (nonMountain.length > 1) {
    const reachable = new Set<string>([nonMountain[0].key]);
    const queue: string[] = [nonMountain[0].key];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const [cq, cr] = curr.split(',').map(Number);
      for (const [nq, nr] of getNeighborsOf(cq, cr)) {
        const nk = tileKey(nq, nr);
        const neighbor = tileMap.get(nk);
        if (!reachable.has(nk) && neighbor && neighbor.terrain !== 'mountain' && neighbor.terrain !== 'lake') {
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
    ['player', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5'] as TerritoryOwner[]
  ).slice(0, clampedPlayers);

  const assignable = tiles.filter(
    t => t.terrain !== 'mountain' && t.terrain !== 'lake' && !t.isCity && !t.cityBuffer,
  );

  for (let i = assignable.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [assignable[i], assignable[j]] = [assignable[j], assignable[i]];
  }

  for (let i = 0; i < assignable.length; i++) {
    assignable[i].owner = ownerList[i % ownerList.length];
  }

  for (const tile of tiles) {
    if (!tile.isCity) continue;
    for (const [nq, nr] of getNeighborsOf(tile.q, tile.r)) {
      const neighbor = tileMap.get(tileKey(nq, nr));
      if (neighbor && neighbor.terrain !== 'mountain' && neighbor.terrain !== 'lake') {
        neighbor.cityBuffer = true;
        neighbor.owner = 'neutral';
      }
    }
  }

  return tiles;
}
