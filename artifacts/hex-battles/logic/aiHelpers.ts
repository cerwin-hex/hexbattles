import type { EntityType, HexTile, TerrainType, TerritoryOwner } from "@/types";
import { HEX_EDGES, hexDistance, tileKey } from "@/utils/hexMath";
import {
  DEVELOP_COST,
  developTargetFor,
  ENTITY_META,
  getContiguousTerritory,
  getTerritoryId,
  getValidMoves,
  getMoveCost,
  TerritoryCache,
} from "@/utils/hexGrid";
import { calcTerritoryIncome, calcTerritoryUpkeep, mergeResult } from "@/logic/gameLogic";

export interface AiContext {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
  cities: Set<string>;
  spentUnits: Set<string>;
  partialMoves: Map<string, number>;
  /** Units that have struck a defender this turn (cavalry: no second strike). */
  combatSpentUnits: Set<string>;
  aiOwner: TerritoryOwner;
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
  const remUpkeep = calcTerritoryUpkeep(remTerr, simEntities);
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
      if (!mergedType || ENTITY_META[mergedType].strength < requiredStr) continue;
      const range1 = ctx.partialMoves.get(uk1) ?? 3;
      const vm1 = getValidMoves(uk1, ctx.aiOwner, ctx.entities, ctx.tileMap, ctx.spentUnits, range1, ctx.combatSpentUnits);
      if (!vm1.has(uk2)) continue;
      const stepsUsed = getMoveCost(uk1, uk2, ctx.tileMap);
      const remainingAfterMerge = Math.max(0, range1 - stepsUsed);
      const destRemaining = ctx.partialMoves.get(uk2) ?? 3;
      const mergedRemaining = Math.min(remainingAfterMerge, destRemaining);
      const tempEntities = new Map(ctx.entities);
      tempEntities.delete(uk1);
      tempEntities.set(uk2, mergedType);
      const vmMerged = getValidMoves(uk2, ctx.aiOwner, tempEntities, ctx.tileMap, new Set(), mergedRemaining);
      for (const tk of targetKeys) {
        if (vmMerged.has(tk)) return { from: uk1, to: uk2 };
      }
    }
  }
  return null;
}

/**
 * Finds the best in-place tile development for the AI: a non-spent peasant
 * standing on developable terrain (grass→field, forest→sawmill). Prefers a
 * peasant adjacent to one of the AI's own cities (the income bonus stacks
 * there). v1 scope: develops ONLY peasants already on a developable tile — it
 * does not reposition peasants.
 */
export function dtFindDevelopMove(
  territory: HexTile[],
  ctx: AiContext,
  spentUnits: Set<string>,
  balance: number,
): { key: string; terrain: TerrainType } | null {
  if (balance < DEVELOP_COST) return null;
  let best: { key: string; terrain: TerrainType } | null = null;
  let bestPrio = -1;
  for (const t of territory) {
    const target = developTargetFor(t.terrain);
    if (!target) continue;
    if (ctx.entities.get(t.key) !== "peasant") continue;
    if (ctx.cities.has(t.key)) continue;
    if (spentUnits.has(t.key)) continue;
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
