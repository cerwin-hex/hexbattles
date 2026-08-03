import type { EntityType, HexTile, TerrainType, TerritoryOwner } from "@/types";
import type { GameElements } from "@/constants/gameElements";
import { HEX_EDGES, hexDistance, tileKey } from "@/utils/hexMath";
import {
  improveTargetFor,
  ENTITY_META,
  getContiguousTerritory,
  getTerritoryId,
  getValidMoves,
  getMoveField,
  unitMovement,
  TerritoryCache,
} from "@/utils/hexGrid";
import {
  calcTerritoryIncome,
  calcTerritoryUpkeep,
  canImproveTile,
  findImproveAnchor,
  mergeResult,
} from "@/logic/gameLogic";

export interface AiContext {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
  cities: Set<string>;
  spentUnits: Set<string>;
  partialMoves: Map<string, number>;
  /** Units that have struck a defender this turn (cavalry: no second strike). */
  combatSpentUnits: Set<string>;
  /** Cities of this AI that already paid for an improvement this turn. */
  cityImproveUsed: Set<string>;
  aiOwner: TerritoryOwner;
  /** Which parts of the game this match is played with. */
  elements: GameElements;
  territoryCache?: TerritoryCache;
}

export function dtCountClusters(
  owner: TerritoryOwner,
  simMap: Map<string, HexTile>,
): number {
  const tiles = Array.from(simMap.values()).filter(
    (t) => t.owner === owner && t.terrain !== "mountain" && t.terrain !== "lake",
  );
  const vis = new Set<string>();
  let cnt = 0;
  for (const tile of tiles) {
    if (vis.has(tile.key)) continue;
    cnt++;
    const q = [tile.key];
    vis.add(tile.key);
    while (q.length > 0) {
      const curr = q.shift()!;
      const [cq, cr] = curr.split(",").map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(cq + dq, cr + dr);
        if (vis.has(nk)) continue;
        const nt = simMap.get(nk);
        if (nt && nt.owner === owner && nt.terrain !== "mountain" && nt.terrain !== "lake") {
          vis.add(nk);
          q.push(nk);
        }
      }
    }
  }
  return cnt;
}

export function dtSplitScore(
  captureKey: string,
  enemyOwner: TerritoryOwner,
  ctx: AiContext,
): number {
  const capTile = ctx.tileMap.get(captureKey);
  if (!capTile || capTile.owner !== enemyOwner) return 0;
  const [cq, cr] = captureKey.split(",").map(Number);
  const adjOwnerCount = HEX_EDGES.filter(({ dir: [dq, dr] }) => {
    const nk = tileKey(cq + dq, cr + dr);
    const nt = ctx.tileMap.get(nk);
    return nt && nt.owner === enemyOwner;
  }).length;
  if (adjOwnerCount < 2) return 0;
  const before = dtCountClusters(enemyOwner, ctx.tileMap);
  const simMap = new Map(ctx.tileMap);
  simMap.set(captureKey, { ...capTile, owner: ctx.aiOwner });
  return dtCountClusters(enemyOwner, simMap) - before;
}

export function dtCaptureNegatesIncome(
  captureKey: string,
  enemyOwner: TerritoryOwner,
  ctx: AiContext,
): boolean {
  const capTile = ctx.tileMap.get(captureKey);
  if (!capTile || capTile.owner !== enemyOwner) return false;
  const origTerr = ctx.territoryCache
    ? ctx.territoryCache.get(ctx.tileMap, captureKey, enemyOwner, ctx.entities)
    : getContiguousTerritory(ctx.tileMap, captureKey, enemyOwner, ctx.entities);
  const origId = getTerritoryId(origTerr);
  const enemyBal = origId ? (ctx.balances.get(origId) ?? 0) : 0;
  const simMap = new Map(ctx.tileMap);
  simMap.set(captureKey, { ...capTile, owner: ctx.aiOwner });
  const simEntities = new Map(ctx.entities);
  simEntities.delete(captureKey);
  const anyRemaining = Array.from(simMap.values()).find((t) => t.owner === enemyOwner);
  if (!anyRemaining) return true;
  const remTerr = getContiguousTerritory(simMap, anyRemaining.key, enemyOwner, simEntities);
  const remIncome = calcTerritoryIncome(remTerr, simEntities, ctx.cities, simMap);
  const remUpkeep = calcTerritoryUpkeep(remTerr, simEntities, ctx.elements);
  return enemyBal + (remIncome - remUpkeep) < 0;
}

export function dtCaptureCreatesOneHex(
  captureKey: string,
  enemyOwner: TerritoryOwner,
  ctx: AiContext,
): boolean {
  const capTile = ctx.tileMap.get(captureKey);
  if (!capTile || capTile.owner !== enemyOwner) return false;
  const simMap = new Map(ctx.tileMap);
  simMap.set(captureKey, { ...capTile, owner: ctx.aiOwner });
  const vis = new Set<string>();
  for (const t of Array.from(simMap.values())) {
    if (t.owner !== enemyOwner || vis.has(t.key)) continue;
    const comp = getContiguousTerritory(simMap, t.key, enemyOwner, ctx.entities);
    for (const ct of comp) vis.add(ct.key);
    if (comp.length === 1) return true;
  }
  return false;
}

export function dtBfsStep(
  fromKey: string,
  targetKey: string,
  validMoves: Set<string>,
  ctx: AiContext,
): string | null {
  if (fromKey === targetKey) return null;
  if (validMoves.has(targetKey)) return targetKey;
  const prev = new Map<string, string>();
  const vis = new Set<string>([fromKey]);
  const q: string[] = [fromKey];
  while (q.length > 0) {
    const curr = q.shift()!;
    const [cq, cr] = curr.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(cq + dq, cr + dr);
      if (vis.has(nk)) continue;
      const nt = ctx.tileMap.get(nk);
      if (!nt || nt.terrain === "mountain") continue;
      vis.add(nk);
      prev.set(nk, curr);
      if (nk === targetKey) {
        let step = nk;
        while (prev.get(step) !== fromKey) {
          const p = prev.get(step);
          if (!p) break;
          step = p;
        }
        return validMoves.has(step) ? step : null;
      }
      q.push(nk);
    }
  }
  return null;
}

export function dtDefenseMinDist(
  tk: string,
  ctx: AiContext,
): number {
  const [tq, tr] = tk.split(",").map(Number);
  let minD = Infinity;
  for (const [bk, be] of ctx.entities) {
    if (be !== "tower" && be !== "castle") continue;
    const bt = ctx.tileMap.get(bk);
    if (!bt || bt.owner !== ctx.aiOwner) continue;
    const [bq2, br2] = bk.split(",").map(Number);
    const d = hexDistance(tq, tr, bq2, br2);
    if (d < minD) minD = d;
  }
  return minD;
}

export function dtSpacedPlacements(
  candidates: HexTile[],
  ctx: AiContext,
): HexTile[] {
  const best = candidates.filter((t) => dtDefenseMinDist(t.key, ctx) >= 3);
  if (best.length > 0) return best;
  return candidates.filter((t) => dtDefenseMinDist(t.key, ctx) >= 2);
}

export function dtFindMergeMove(
  requiredStr: number,
  targetKeys: Set<string>,
  units: [string, EntityType][],
  ctx: AiContext,
): { from: string; to: string } | null {
  if (units.length < 2 || targetKeys.size === 0) return null;
  for (let i = 0; i < units.length; i++) {
    for (let j = 0; j < units.length; j++) {
      if (i === j) continue;
      const [uk1, ue1] = units[i];
      const [uk2, ue2] = units[j];
      const mergedType = mergeResult(ue1, ue2);
      // Offense, not defense: every caller ends in a move onto `targetKeys`, so
      // the merged unit has to out-attack what holds that tile. `requiredStr` is
      // a ZoC threshold at one call site (`dtFindMergeMove(zoc + 1, …)`) and an
      // enemy unit's offense at another.
      if (!mergedType || ENTITY_META[mergedType].offStrength < requiredStr) continue;
      // A unit with no partial entry is at its own full budget — which is 5 for
      // the cavalry track, not the infantry 3. Hard-coding 3 hid every merge
      // that needed a scout's or knight's extra reach.
      const range1 = ctx.partialMoves.get(uk1) ?? unitMovement(ue1);
      const { reachable: vm1, cost: cost1 } = getMoveField(uk1, ctx.aiOwner, ctx.entities, ctx.tileMap, ctx.spentUnits, ctx.cities, range1, ctx.combatSpentUnits);
      if (!vm1.has(uk2)) continue;
      // Cost comes from the same search that just vouched for the move, so the
      // merged unit's leftover movement reflects the route it would really walk.
      const stepsUsed = cost1.get(uk2) ?? Infinity;
      const remainingAfterMerge = Math.max(0, range1 - stepsUsed);
      const destRemaining = ctx.partialMoves.get(uk2) ?? unitMovement(ue2);
      const mergedRemaining = Math.min(remainingAfterMerge, destRemaining);
      const tempEntities = new Map(ctx.entities);
      tempEntities.delete(uk1);
      tempEntities.set(uk2, mergedType);
      const vmMerged = getValidMoves(uk2, ctx.aiOwner, tempEntities, ctx.tileMap, new Set(), ctx.cities, mergedRemaining);
      for (const tk of targetKeys) {
        if (vmMerged.has(tk)) return { from: uk1, to: uk2 };
      }
    }
  }
  return null;
}

/**
 * Finds the best tile improvement for the AI: any tile of its territory whose
 * terrain can be improved (grass→field, forest→sawmill, desert→mine), that
 * lies within CITY_IMPROVE_RADIUS of a city of the same territory which has
 * not already built this turn, and that the territory can afford. The same
 * zone and per-turn-allowance rule the player follows, via the shared
 * `canImproveTile` predicate and `findImproveAnchor`.
 *
 * Prefers a tile adjacent to one of the AI's own cities, where the Field's
 * city-adjacency bonus stacks on top of the terrain income.
 *
 * No `spentUnits` filter: improvements are purchases, not unit actions. The
 * decision loop cannot re-pick a tile because the executor rewrites the live
 * tile map, after which `improveTargetFor` no longer matches.
 *
 * This is also the single choke point for AI improvements — the decision tree's
 * priority J and the expert search's last resort both call it — so the element
 * gate below is all it takes to keep both brains off improvements.
 */
export function dtFindImproveMove(
  territory: HexTile[],
  ctx: AiContext,
  balance: number,
): { key: string; terrain: TerrainType } | null {
  if (!ctx.elements.improvements) return null;
  const territoryCityKeys = territory.filter((t) => ctx.cities.has(t.key)).map((t) => t.key);
  if (territoryCityKeys.length === 0) return null;
  let best: { key: string; terrain: TerrainType } | null = null;
  let bestPrio = -1;
  for (const t of territory) {
    const target = improveTargetFor(t.terrain);
    if (!target) continue;
    const { anchor } = findImproveAnchor({
      tileKey: t.key,
      territoryCityKeys,
      usedCities: ctx.cityImproveUsed,
    });
    if (
      !canImproveTile({
        terrain: t.terrain,
        targetTerrain: target,
        balance,
        anchor,
        isCity: ctx.cities.has(t.key),
        occupantEntity: ctx.entities.get(t.key),
      })
    )
      continue;
    let prio = 1;
    const [q, r] = t.key.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(q + dq, r + dr);
      if (ctx.cities.has(nk) && ctx.tileMap.get(nk)?.owner === ctx.aiOwner) {
        prio = 2;
        break;
      }
    }
    if (prio > bestPrio) {
      bestPrio = prio;
      best = { key: t.key, terrain: target };
    }
  }
  return best;
}
