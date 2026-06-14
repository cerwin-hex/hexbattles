import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { HEX_EDGES, tileKey } from "@/utils/hexMath";
import {
  ENTITY_META,
  UNIT_UPGRADE,
  TERRAIN_INCOME,
  CITY_BONUS,
  getContiguousTerritory,
  getTerritoryId,
  getValidMoves,
  getMaxEnemyZoC,
  recalculateTerritoriesForCapture,
  unitMovement,
  isCavalry,
  cavalryMoveKind,
} from "@/utils/hexGrid";
import { calcTerritoryUpkeep, mergeResult } from "@/logic/gameLogic";
import { dtCountClusters } from "@/logic/aiHelpers";
import type { AiContext } from "@/logic/aiHelpers";
import type { AiDecisionExec } from "@/logic/aiStrategy";

// ════════════════════════════════════════════════════════════════════════════
// Expert AI — evaluation-driven best-action selection.
//
// Unlike the heuristic loop (which takes the first action matching a fixed
// priority list), the expert brain enumerates every legal action, simulates
// each on a pure copy of the eval-relevant state, scores the resulting position
// with `evaluatePosition`, and executes the highest-scoring action. The threat
// term in the evaluation is the avoid-counterattack measure. Real execution
// still goes through the untouched `AiDecisionExec`; simulation is for ranking
// only, re-derived from ground truth each iteration so drift never compounds.
// ════════════════════════════════════════════════════════════════════════════

const OPPONENT_OWNERS: TerritoryOwner[] = ["player", "ai1", "ai2", "ai3", "ai4", "ai5"];

export interface EvalWeights {
  /** Reward per point of gross territory income (drives expansion). */
  income: number;
  reserves: number;
  reservesCap: number;
  /** Reserve level (per territory) below which a cash-buffer penalty kicks in. */
  bufferThreshold: number;
  /** Penalty per gold a territory's reserve sits below `bufferThreshold`. */
  buffer: number;
  /** Penalty per point of negative net income (asymmetric — healthy armies free). */
  deficitMag: number;
  /** Flat penalty per territory currently running a deficit. */
  bankruptcyPenalty: number;
  unitStrength: number;
  /** Reward per owned unit that can capture an adjacent non-owned tile. */
  breakthrough: number;
  fortification: number;
  borderBonus: number;
  /** Reward per owned-tile edge facing enemy territory (the contested front). */
  frontier: number;
  /** Reward per owned-tile edge facing void / mountain (a "covered back"). */
  secured: number;
  fragmentation: number;
  threat: number;
  /** Extra penalty per own city/fort tile left capturable by an adjacent enemy. */
  assetThreat: number;
  /** Reward per cluster the strongest opponent's territory is split into. */
  enemyFragmentation: number;
  leader: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  income: 10,
  reserves: 0.3,
  reservesCap: 30,
  bufferThreshold: 12,
  buffer: 1,
  deficitMag: 6,
  bankruptcyPenalty: 15,
  unitStrength: 2,
  breakthrough: 1.5,
  fortification: 3,
  borderBonus: 1.5,
  frontier: 0.8,
  secured: 0.4,
  fragmentation: 2,
  threat: 4,
  assetThreat: 8,
  enemyFragmentation: 2,
  leader: 1.5,
};

function tileValue(
  key: string,
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  cities: Set<string>,
): number {
  const t = tileMap.get(key);
  if (!t) return 0;
  const e = entities.get(key);
  const isFort = e === "tower" || e === "castle";
  return (
    (TERRAIN_INCOME[t.terrain] ?? 0) +
    (cities.has(key) ? CITY_BONUS : 0) +
    (e && ENTITY_META[e].isUnit ? ENTITY_META[e].strength : 0) +
    // A fortification's defensive strength is real value: losing the tile both
    // hands the enemy ground and demolishes the fort. Without this a tower tile
    // scored the same as bare grass, so the AI never prioritised protecting (or
    // picking off) forts — exactly the gap a human exploits.
    (isFort ? ENTITY_META[e as EntityType].strength : 0) +
    1
  );
}

/**
 * Score a board position from one owner's perspective. Higher is better.
 * Pure: reads only the supplied state.
 */
export function evaluatePosition(
  owner: TerritoryOwner,
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  balances: Map<string, number>,
  cities: Set<string>,
  w: EvalWeights = DEFAULT_WEIGHTS,
): number {
  // ── Economy: income, reserves, per-territory deficit penalty ──
  let income = 0;
  let reserves = 0;
  let bufferShortfall = 0;
  let deficitMag = 0;
  let deficitCount = 0;
  const visited = new Set<string>();
  for (const t of tileMap.values()) {
    if (t.owner !== owner || visited.has(t.key)) continue;
    const terr = getContiguousTerritory(tileMap, t.key, owner, entities);
    if (terr.length === 0) {
      visited.add(t.key);
      continue;
    }
    for (const ct of terr) visited.add(ct.key);
    const tid = getTerritoryId(terr);
    const bal = tid ? balances.get(tid) ?? 0 : 0;
    reserves += Math.max(-w.reservesCap, Math.min(bal, w.reservesCap));
    bufferShortfall += Math.max(0, w.bufferThreshold - bal);
    const terrIncome = terr.reduce((s, x) => {
      if (entities.get(x.key) === "rebel") return s;
      return s + (TERRAIN_INCOME[x.terrain] ?? 0) + (cities.has(x.key) ? CITY_BONUS : 0);
    }, 0);
    income += terrIncome;
    const net = terrIncome - calcTerritoryUpkeep(terr, entities);
    // Asymmetric: only deficits are penalised; a profitable army is free.
    if (net < 0) {
      deficitMag += -net;
      deficitCount += 1;
    }
  }

  // ── Military: unit strength, fortifications, border presence, breakthrough ──
  let unitStrength = 0;
  let fortification = 0;
  let borderBonus = 0;
  let breakthrough = 0;
  for (const [k, e] of entities) {
    const t = tileMap.get(k);
    if (!t || t.owner !== owner) continue;
    const meta = ENTITY_META[e];
    const [kq, kr] = k.split(",").map(Number);
    const onBorder = HEX_EDGES.some(({ dir: [dq, dr] }) => {
      const nt = tileMap.get(tileKey(kq + dq, kr + dr));
      return !!nt && nt.owner !== owner;
    });
    if (meta.isUnit) {
      unitStrength += meta.strength;
      if (onBorder) borderBonus += meta.strength;
      // Breakthrough: can this unit capture an adjacent non-owned tile? Rewards
      // concentrating force (e.g. merging two weak units into one strong enough
      // to break a defence) and keeping attack-capable units at the front.
      const canCapture = HEX_EDGES.some(({ dir: [dq, dr] }) => {
        const nk = tileKey(kq + dq, kr + dr);
        const nt = tileMap.get(nk);
        if (!nt || nt.owner === owner) return false;
        if (nt.terrain === "lake" || nt.terrain === "mountain") return false;
        return meta.strength > getMaxEnemyZoC(nk, owner, entities, tileMap);
      });
      if (canCapture) breakthrough += 1;
    } else if (e === "tower" || e === "castle") {
      fortification += meta.strength;
      if (onBorder) borderBonus += meta.strength;
    }
  }

  // ── Positional value: every owned land tile's edges are classified by what
  // they face. Edges toward enemy territory are the contested front (valuable to
  // hold/contest); edges toward void or mountain are a "covered back" that never
  // needs defending. This makes a tile pointing at the enemy worth more than one
  // pointing at the void, while still rewarding backing the territory against the
  // map edge. ──
  let frontier = 0;
  let secured = 0;
  for (const t of tileMap.values()) {
    if (t.owner !== owner || t.terrain === "mountain" || t.terrain === "lake") continue;
    const [q, r] = t.key.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nt = tileMap.get(tileKey(q + dq, r + dr));
      if (!nt || nt.terrain === "mountain") {
        secured += 1; // void or impassable mountain — safe back
      } else if (nt.owner !== owner && nt.owner !== "neutral") {
        frontier += 1; // edge against enemy territory — the contested front
      }
    }
  }

  // ── Threat (avoid counterattack): own tiles capturable by an adjacent enemy ──
  const threatened = new Map<string, number>();
  for (const [k, e] of entities) {
    if (!ENTITY_META[e].isUnit) continue;
    const t = tileMap.get(k);
    if (!t || t.owner === owner || t.owner === "neutral") continue;
    const s = ENTITY_META[e].strength;
    const [kq, kr] = k.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(kq + dq, kr + dr);
      const nt = tileMap.get(nk);
      if (!nt || nt.owner !== owner) continue;
      if (nt.terrain === "mountain" || nt.terrain === "lake") continue;
      const def = getMaxEnemyZoC(nk, t.owner as TerritoryOwner, entities, tileMap);
      if (s > def) {
        const v = tileValue(nk, tileMap, entities, cities);
        threatened.set(nk, Math.max(threatened.get(nk) ?? 0, v));
      }
    }
  }
  let threat = 0;
  let assetThreat = 0;
  for (const [nk, v] of threatened) {
    threat += v;
    const ae = entities.get(nk);
    // A threatened tile that holds a city or fortification is a high-value loss
    // (income / defence both gone). Count these so the AI prioritises shielding
    // them — the defensive half of the human "bait + counterattack" play.
    if (cities.has(nk) || ae === "tower" || ae === "castle") assetThreat += 1;
  }

  // ── Leader pressure: suppress the strongest opponent (modest weight) ──
  let leaderIncome = 0;
  let leaderOwner: TerritoryOwner | null = null;
  for (const o of OPPONENT_OWNERS) {
    if (o === owner) continue;
    let inc = 0;
    for (const t of tileMap.values()) {
      if (t.owner !== o) continue;
      if (entities.get(t.key) === "rebel") continue;
      inc += (TERRAIN_INCOME[t.terrain] ?? 0) + (cities.has(t.key) ? CITY_BONUS : 0);
    }
    if (inc > leaderIncome) {
      leaderIncome = inc;
      leaderOwner = o;
    }
  }

  // ── Enemy fragmentation: reward splitting the strongest opponent's territory.
  // Capturing a tile that connects two of their clusters raises this count, so a
  // cut move (exploiting a gap in their defence) outscores a plain grab. ──
  const enemyClusters = leaderOwner ? dtCountClusters(leaderOwner, tileMap) : 0;

  const clusters = dtCountClusters(owner, tileMap);

  return (
    income * w.income +
    reserves * w.reserves -
    bufferShortfall * w.buffer -
    deficitMag * w.deficitMag -
    deficitCount * w.bankruptcyPenalty +
    unitStrength * w.unitStrength +
    breakthrough * w.breakthrough +
    fortification * w.fortification +
    borderBonus * w.borderBonus +
    frontier * w.frontier +
    secured * w.secured -
    clusters * w.fragmentation -
    threat * w.threat -
    assetThreat * w.assetThreat +
    enemyClusters * w.enemyFragmentation -
    leaderIncome * w.leader
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Action model + pure simulation (ranking only).
// ════════════════════════════════════════════════════════════════════════════

export type ExpertAction =
  | { kind: "move"; from: string; to: string }
  | { kind: "buy"; unitType: EntityType; target: string; cost: number; outside: boolean }
  | { kind: "build"; buildingType: EntityType; target: string; cost: number }
  | { kind: "upgrade"; target: string; to: EntityType; cost: number }
  | { kind: "remove"; target: string };

export interface SimState {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
  cities: Set<string>;
}

function cloneState(s: SimState): SimState {
  return {
    tileMap: new Map(s.tileMap),
    entities: new Map(s.entities),
    balances: new Map(s.balances),
    cities: new Set(s.cities),
  };
}

function chargeCost(s: SimState, anchorKey: string, owner: TerritoryOwner, cost: number): void {
  const terr = getContiguousTerritory(s.tileMap, anchorKey, owner, s.entities);
  const tid = getTerritoryId(terr);
  if (tid) s.balances.set(tid, (s.balances.get(tid) ?? 0) - cost);
}

/**
 * Apply an action's ownership / entity / balance delta to a fresh copy of the
 * state, for evaluation only. Skips animation, charge bookkeeping and
 * bankruptcy — none of which change candidate ranking. Reuses the real
 * `recalculateTerritoriesForCapture` so balance geometry matches the game.
 */
export function simulateAction(s0: SimState, a: ExpertAction, owner: TerritoryOwner): SimState {
  const s = cloneState(s0);
  switch (a.kind) {
    case "move": {
      const fromE = s.entities.get(a.from);
      const destTile = s.tileMap.get(a.to);
      if (!fromE || !destTile) return s;
      const prevOwner = destTile.owner as TerritoryOwner;
      const destExisting = s.entities.get(a.to);
      // Only a real mergeable ally counts as a merge. Moving onto a rebel (or any
      // non-mergeable occupant) is combat: the occupant is removed and the unit
      // takes the tile — matching dtExecMove in the real game.
      const mergeInto =
        destExisting && destExisting !== "bridge" && prevOwner === owner
          ? mergeResult(fromE, destExisting)
          : null;
      const isAllyMerge = mergeInto !== null;
      const prevMap = new Map(s.tileMap);
      const prevEnt = new Map(s.entities);
      if (prevOwner !== owner) s.tileMap.set(a.to, { ...destTile, owner });
      if (isAllyMerge) {
        s.entities.delete(a.from);
        s.entities.set(a.to, mergeInto);
      } else {
        s.entities.delete(a.to);
        s.entities.delete(a.from);
        s.entities.set(a.to, fromE);
      }
      if (s.tileMap.get(a.from)?.terrain === "lake") s.entities.set(a.from, "bridge");
      if (prevOwner !== owner) {
        s.balances = recalculateTerritoriesForCapture(
          a.to, owner, prevOwner, prevMap, s.tileMap, s.balances, s.entities, prevEnt,
        );
      }
      return s;
    }
    case "buy": {
      const target = s.tileMap.get(a.target);
      if (!target) return s;
      if (a.outside) {
        const prevOwner = target.owner as TerritoryOwner;
        const prevMap = new Map(s.tileMap);
        s.tileMap.set(a.target, { ...target, owner });
        if (a.unitType === "city") {
          s.cities.add(a.target);
        } else {
          s.entities.delete(a.target);
          s.entities.set(a.target, a.unitType);
        }
        s.balances = recalculateTerritoriesForCapture(
          a.target, owner, prevOwner, prevMap, s.tileMap, s.balances, s.entities,
        );
      } else if (a.unitType === "city") {
        s.cities.add(a.target);
      } else {
        s.entities.set(a.target, a.unitType);
      }
      chargeCost(s, a.target, owner, a.cost);
      return s;
    }
    case "build": {
      const target = s.tileMap.get(a.target);
      if (!target) return s;
      if (a.buildingType === "bridge") {
        const prevMap = new Map(s.tileMap);
        s.tileMap.set(a.target, { ...target, owner });
        s.entities.set(a.target, "bridge");
        s.balances = recalculateTerritoriesForCapture(
          a.target, owner, "neutral", prevMap, s.tileMap, s.balances, s.entities,
        );
      } else if (a.buildingType === "city") {
        s.cities.add(a.target);
      } else {
        s.entities.set(a.target, a.buildingType);
      }
      chargeCost(s, a.target, owner, a.cost);
      return s;
    }
    case "upgrade": {
      s.entities.set(a.target, a.to);
      chargeCost(s, a.target, owner, a.cost);
      return s;
    }
    case "remove": {
      const e = s.entities.get(a.target);
      s.entities.delete(a.target);
      if (e === "bridge") {
        const lt = s.tileMap.get(a.target);
        if (lt?.terrain === "lake") s.tileMap.set(a.target, { ...lt, owner: "neutral" });
      }
      return s;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Candidate generation — must cover every category the heuristic loop handles
// (moves, buys, builds, upgrades, removes) so expert has no blind spots.
// ════════════════════════════════════════════════════════════════════════════

const UNIT_TYPES: EntityType[] = (Object.keys(ENTITY_META) as EntityType[]).filter(
  (e) => ENTITY_META[e].isUnit,
);

export function generateCandidateActions(
  ctx: AiContext,
  territory: HexTile[],
  balanceForTid: number,
  capPerKind = 60,
): ExpertAction[] {
  const out: ExpertAction[] = [];
  const owner = ctx.aiOwner;
  const terrKeys = new Set(territory.map((t) => t.key));

  const income = territory.reduce((s, t) => {
    if (ctx.entities.get(t.key) === "rebel") return s;
    return s + (TERRAIN_INCOME[t.terrain] ?? 0) + (ctx.cities.has(t.key) ? CITY_BONUS : 0);
  }, 0);
  const upkeep = calcTerritoryUpkeep(territory, ctx.entities);
  const canAfford = (cost: number, extraUpkeep = 0): boolean =>
    balanceForTid >= cost && balanceForTid + (income - (upkeep + extraUpkeep)) >= 0;

  const availUnits: [string, EntityType][] = territory
    .map((t) => [t.key, ctx.entities.get(t.key)] as [string, EntityType | undefined])
    .filter(
      (pair): pair is [string, EntityType] =>
        !!pair[1] && ENTITY_META[pair[1]].isUnit && !ctx.spentUnits.has(pair[0]),
    );

  const borderTiles = territory.filter((t) => {
    const [tq, tr] = t.key.split(",").map(Number);
    return HEX_EDGES.some(({ dir: [dq, dr] }) => {
      const nt = ctx.tileMap.get(tileKey(tq + dq, tr + dr));
      return !!nt && nt.owner !== owner;
    });
  });

  // ── Moves: each available unit to each valid destination ──
  let moveCount = 0;
  for (const [uk, ue] of availUnits) {
    if (moveCount >= capPerKind) break;
    const range = ctx.partialMoves.get(uk) ?? unitMovement(ue);
    const vm = getValidMoves(uk, owner, ctx.entities, ctx.tileMap, ctx.spentUnits, range, ctx.combatSpentUnits);
    for (const mk of vm) {
      if (moveCount >= capPerKind) break;
      const mt = ctx.tileMap.get(mk);
      if (!mt) continue;
      if (mt.owner !== owner) {
        // capture / neutral grab — must beat the defending ZoC
        const targetE = ctx.entities.get(mk);
        if (isCavalry(ue) && cavalryMoveKind(targetE) === "building") continue;
        const zoc = getMaxEnemyZoC(mk, owner, ctx.entities, ctx.tileMap);
        if (ENTITY_META[ue].strength <= zoc) continue;
        out.push({ kind: "move", from: uk, to: mk });
        moveCount++;
      } else {
        const destE = ctx.entities.get(mk);
        // own-tile move worth considering as: a merge, clearing a rebel (an owned
        // tile a rebel sits on yields no income until cleared), or repositioning
        // to a border tile (interior shuffles never improve the position).
        const isMerge = !!destE && destE !== "bridge" && !!mergeResult(ue, destE);
        const isRebelClear = destE === "rebel";
        const isBorderReposition = borderTiles.some((b) => b.key === mk) && !destE;
        if (isMerge || isRebelClear || isBorderReposition) {
          out.push({ kind: "move", from: uk, to: mk });
          moveCount++;
        }
      }
    }
  }

  // ── Buys ──
  let buyCount = 0;
  const innerPlacements = territory.filter(
    (t) =>
      t.terrain !== "mountain" &&
      t.terrain !== "lake" &&
      !ctx.entities.has(t.key) &&
      !ctx.cities.has(t.key),
  );
  for (const uType of UNIT_TYPES) {
    if (buyCount >= capPerKind) break;
    const cost = ENTITY_META[uType].cost;
    const upk = ENTITY_META[uType].upkeep;
    if (!canAfford(cost, upk)) continue;
    // inside / border placement
    for (const t of innerPlacements) {
      if (buyCount >= capPerKind) break;
      out.push({ kind: "buy", unitType: uType, target: t.key, cost, outside: false });
      buyCount++;
    }
    // outside attack placement (buy directly onto an attackable enemy/neutral tile)
    for (const t of borderTiles) {
      if (buyCount >= capPerKind) break;
      const [tq, tr] = t.key.split(",").map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(tq + dq, tr + dr);
        const nt = ctx.tileMap.get(nk);
        if (!nt || nt.owner === owner) continue;
        if (nt.terrain === "lake" || nt.terrain === "mountain") continue;
        const ne = ctx.entities.get(nk);
        if (isCavalry(uType) && cavalryMoveKind(ne) === "building") continue;
        const zoc = getMaxEnemyZoC(nk, owner, ctx.entities, ctx.tileMap);
        if (ENTITY_META[uType].strength <= zoc) continue;
        out.push({ kind: "buy", unitType: uType, target: nk, cost, outside: true });
        buyCount++;
        if (buyCount >= capPerKind) break;
      }
    }
  }

  // ── Builds: tower / castle / city / bridge ──
  const hasStrongUnit = territory.some((t) => {
    const e = ctx.entities.get(t.key);
    return !!e && ENTITY_META[e].isUnit && ENTITY_META[e].strength >= 2;
  });
  for (const bType of ["tower", "castle"] as EntityType[]) {
    const cost = ENTITY_META[bType].cost;
    const upk = ENTITY_META[bType].upkeep;
    if (!canAfford(cost, upk)) continue;
    if (bType === "castle" && !hasStrongUnit) continue;
    for (const t of innerPlacements) {
      out.push({ kind: "build", buildingType: bType, target: t.key, cost });
    }
  }
  const cityCost = ENTITY_META.city.cost;
  const hasCity = territory.some((t) => ctx.cities.has(t.key));
  if (!hasCity && territory.length >= 6 && canAfford(cityCost)) {
    for (const t of innerPlacements) {
      out.push({ kind: "build", buildingType: "city", target: t.key, cost: cityCost });
    }
  }
  const bridgeCost = ENTITY_META.bridge.cost;
  if (canAfford(bridgeCost, 1)) {
    const seen = new Set<string>();
    for (const t of territory) {
      const [tq, tr] = t.key.split(",").map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(tq + dq, tr + dr);
        if (terrKeys.has(nk) || seen.has(nk)) continue;
        const nt = ctx.tileMap.get(nk);
        if (!nt || nt.terrain !== "lake" || ctx.entities.has(nk)) continue;
        seen.add(nk);
        out.push({ kind: "build", buildingType: "bridge", target: nk, cost: bridgeCost });
      }
    }
  }

  // ── Upgrades: any owned entity with a defined upgrade we can afford ──
  for (const t of territory) {
    const e = ctx.entities.get(t.key);
    if (!e) continue;
    const up = UNIT_UPGRADE[e];
    if (!up) continue;
    const cost = ENTITY_META[up].cost - ENTITY_META[e].cost;
    const dUpk = ENTITY_META[up].upkeep - ENTITY_META[e].upkeep;
    if (cost > 0 && canAfford(cost, dUpk)) {
      out.push({ kind: "upgrade", target: t.key, to: up, cost });
    }
  }

  // ── Removes: obsolete fortifications and surrounded bridges ──
  for (const t of territory) {
    const e = ctx.entities.get(t.key);
    if (e === "tower" || e === "castle") {
      const [tq, tr] = t.key.split(",").map(Number);
      const enemyNear = Array.from(ctx.tileMap.values()).some((nt) => {
        if (nt.owner === owner || nt.owner === "neutral") return false;
        const [nq, nr] = nt.key.split(",").map(Number);
        return Math.max(Math.abs(tq - nq), Math.abs(tr - nr), Math.abs(-tq - tr + nq + nr)) <= 6;
      });
      if (!enemyNear) out.push({ kind: "remove", target: t.key });
    } else if (e === "bridge" && t.terrain === "lake") {
      const [tq, tr] = t.key.split(",").map(Number);
      let owned = 0;
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        if (ctx.tileMap.get(tileKey(tq + dq, tr + dr))?.owner === owner) owned++;
      }
      if (owned >= 5) out.push({ kind: "remove", target: t.key });
    }
  }

  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Expert decision loop — pick the best-scoring action each step until none
// strictly improves the position.
// ════════════════════════════════════════════════════════════════════════════

const SCORE_EPSILON = 1e-6;

/** True if any tile of `territory` is capturable by an adjacent enemy unit. */
function territoryThreatened(
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  territory: HexTile[],
  owner: TerritoryOwner,
): boolean {
  const terrKeys = new Set(territory.map((t) => t.key));
  for (const [k, e] of entities) {
    if (!ENTITY_META[e].isUnit) continue;
    const t = tileMap.get(k);
    if (!t || t.owner === owner || t.owner === "neutral") continue;
    const s = ENTITY_META[e].strength;
    const [kq, kr] = k.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(kq + dq, kr + dr);
      if (!terrKeys.has(nk)) continue;
      const nt = tileMap.get(nk);
      if (!nt || nt.terrain === "mountain" || nt.terrain === "lake") continue;
      if (s > getMaxEnemyZoC(nk, t.owner as TerritoryOwner, entities, tileMap)) return true;
    }
  }
  return false;
}

// Tuning hook: the self-play harness can override the active weights to search
// for strong values without recompiling. null ⇒ use DEFAULT_WEIGHTS.
let WEIGHTS_OVERRIDE: EvalWeights | null = null;
export function __setExpertWeightsOverride(w: EvalWeights | null): void {
  WEIGHTS_OVERRIDE = w;
}

export async function runExpertTerritoryDecisionLoop(
  startTileKey: string,
  ctx: AiContext,
  exec: AiDecisionExec,
  isTurnActive: () => boolean,
  weights: EvalWeights = WEIGHTS_OVERRIDE ?? DEFAULT_WEIGHTS,
): Promise<void> {
  const owner = ctx.aiOwner;
  let iter = 0;
  while (iter++ < 100) {
    if (!isTurnActive()) return;

    const territory = getContiguousTerritory(ctx.tileMap, startTileKey, owner, ctx.entities);
    if (territory.length === 0) break;
    const tid = getTerritoryId(territory);
    if (!tid) break;
    const bal = ctx.balances.get(tid) ?? 0;

    const base: SimState = {
      tileMap: ctx.tileMap,
      entities: ctx.entities,
      balances: ctx.balances,
      cities: ctx.cities,
    };
    const baseScore = evaluatePosition(owner, base.tileMap, base.entities, base.balances, base.cities, weights);

    const candidates = generateCandidateActions(ctx, territory, bal);
    let best: ExpertAction | null = null;
    let bestDelta = SCORE_EPSILON;
    for (const cand of candidates) {
      const after = simulateAction(base, cand, owner);
      const score = evaluatePosition(owner, after.tileMap, after.entities, after.balances, after.cities, weights);
      const delta = score - baseScore;
      if (delta > bestDelta) {
        bestDelta = delta;
        best = cand;
      }
    }

    exec.setTerritoryState(
      tid,
      territoryThreatened(ctx.tileMap, ctx.entities, territory, owner) ? "defending" : "attacking",
    );

    if (!best) break;
    let ok = false;
    switch (best.kind) {
      case "move":
        ok = await exec.move(best.from, best.to);
        break;
      case "buy":
        ok = await exec.buy(best.unitType, best.target, best.cost, best.outside);
        break;
      case "build":
        ok = await exec.build(best.buildingType, best.target, best.cost);
        break;
      case "upgrade":
        ok = await exec.upgrade(best.target, best.to, best.cost);
        break;
      case "remove":
        ok = await exec.remove(best.target);
        break;
    }
    if (!ok) break;
  }
}
