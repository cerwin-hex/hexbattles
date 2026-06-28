import {
  EntityType,
  TerrainType,
  HexTile,
  TerritoryOwner,
  ENTITY_META,
  calcDefenseUpkeep,
  getContiguousTerritory,
  getTerritoryId,
  TERRAIN_INCOME,
  CITY_BONUS,
  unitMaxAttacks,
  isCavalry,
  calcAdminBurden,
  HEX_EDGES,
  tileKey,
  improveCostFor,
  improveTargetFor,
} from "@/utils/hexGrid";
import { STRENGTH_TO_UNIT, STRENGTH_TO_CAVALRY } from "@/constants/gameConstants";

export function calcTerritoryUpkeep(
  territory: HexTile[],
  ents: Map<string, EntityType>,
): number {
  let towers = 0, castles = 0, unitUpkeep = 0, bridges = 0;
  for (const t of territory) {
    const e = ents.get(t.key);
    if (!e) continue;
    if (e === "tower") towers++;
    else if (e === "castle") castles++;
    else if (e === "bridge") bridges++;
    else {
      unitUpkeep += ENTITY_META[e].upkeep;
      // Unit standing on a lake tile implies a bridge underneath — count its upkeep too.
      if (t.terrain === "lake") bridges++;
    }
  }
  return (
    unitUpkeep +
    calcDefenseUpkeep("tower", towers) +
    calcDefenseUpkeep("castle", castles) +
    bridges * ENTITY_META["bridge"].upkeep +
    calcAdminBurden(territory.length)
  );
}

/**
 * Apply one owner's per-turn economy to every territory they hold: credit net
 * income (income − upkeep, plus an optional land-tile income bonus for the
 * "super" AI tiers) and, when reserves + income cannot cover upkeep, drain the
 * balance to 0 and liquidate units — demolishing buildings too on a deep
 * shortfall, releasing any ruined bridge's lake tile back to neutral.
 *
 * This is the SINGLE source of truth for the economy step, applied exactly once
 * per owner per round at the start of that owner's turn. It replaces four
 * drifted inline copies (the player + AI branches of endTurnHandler, the
 * end-of-AI-phase player re-check in aiStrategy, and self-play's creditIncome) —
 * the drift between them caused upkeep to be charged twice and wrongly bankrupt
 * negative-net territories whose reserves covered exactly one application.
 *
 * Mutates `tileMap`/`entities`/`balances`/`graveyard`/`ruins` in place; callers
 * own those maps and publish fresh copies afterwards. Returns whether ANY of the
 * owner's territories went bankrupt, so the caller can run the single-hex sweep.
 */
export function applyOwnerEconomy(o: {
  owner: TerritoryOwner;
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
  cities: Set<string>;
  graveyard: Set<string>;
  ruins: Set<string>;
  /** Grant the land-tile income bonus (super_expert AI tier). */
  incomeBonus: boolean;
}): boolean {
  const { owner, tileMap, entities, balances, cities, graveyard, ruins, incomeBonus } = o;
  let bankruptcyOccurred = false;
  const visited = new Set<string>();
  for (const tile of Array.from(tileMap.values())) {
    if (tile.owner !== owner || visited.has(tile.key)) continue;
    if (tile.terrain === "mountain") continue;
    const territory = getContiguousTerritory(tileMap, tile.key, owner, entities);
    for (const t of territory) visited.add(t.key);
    const territoryId = getTerritoryId(territory);
    if (!territoryId) continue;
    const income = calcTerritoryIncome(territory, entities, cities, tileMap);
    const incomeModifier = incomeBonus
      ? territory.filter((t) => t.terrain !== "lake").length
      : 0;
    const upkeep = calcTerritoryUpkeep(territory, entities);
    const current = balances.get(territoryId) ?? 0;
    const delta = income + incomeModifier - upkeep;
    const newBalance = current + delta;
    if (newBalance < 0) {
      // Bankruptcy: reserves + income cannot cover upkeep, so the balance is
      // drained to 0 (paying as much of the bill as possible) and units are
      // liquidated; if upkeep still outstrips income, buildings are demolished.
      bankruptcyOccurred = true;
      balances.set(territoryId, 0);
      let unitUpkeepSaved = 0;
      for (const t of territory) {
        const e = entities.get(t.key);
        if (e && ENTITY_META[e].isUnit) {
          unitUpkeepSaved += ENTITY_META[e].upkeep;
          // A unit on a lake tile sat on a bridge — restore the bridge so the
          // lake tile stays connected to the territory.
          if (tileMap.get(t.key)?.terrain === "lake") entities.set(t.key, "bridge");
          else entities.delete(t.key);
          graveyard.add(t.key);
        }
      }
      if (delta + unitUpkeepSaved < 0) {
        for (const t of territory) {
          const e = entities.get(t.key);
          if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
            entities.delete(t.key);
            ruins.add(t.key);
            // A demolished bridge must release its lake tile to neutral, else the
            // owned lake keeps rendering as a bridge with a territory border.
            if (e === "bridge") {
              const lt = tileMap.get(t.key);
              if (lt?.terrain === "lake") tileMap.set(t.key, { ...lt, owner: "neutral" });
            }
          }
        }
      }
    } else {
      balances.set(territoryId, newBalance);
    }
  }
  return bankruptcyOccurred;
}

export function applySingleHexPenalty(
  prevTileMap: Map<string, HexTile>,
  tileMap: Map<string, HexTile>,
  balances: Map<string, number>,
  entities: Map<string, EntityType>,
  graveyard: Set<string>,
  ruins: Set<string>,
  exemptKey?: string,
): void {
  const allOwners = new Set<TerritoryOwner>([
    "player",
    "ai1",
    "ai2",
    "ai3",
    "ai4",
    "ai5",
  ]);
  const visited = new Set<string>();
  for (const tile of tileMap.values()) {
    if (!allOwners.has(tile.owner as TerritoryOwner) || visited.has(tile.key))
      continue;
    if (tile.terrain === "mountain") continue;
    const territory = getContiguousTerritory(
      tileMap,
      tile.key,
      tile.owner as TerritoryOwner,
      entities,
    );
    for (const t of territory) visited.add(t.key);
    if (territory.length !== 1) continue;
    const singleKey = territory[0].key;
    if (exemptKey && singleKey === exemptKey) continue;
    const prevOwner = prevTileMap.get(singleKey)?.owner;
    if (prevOwner === tile.owner) {
      const prevTerritory = getContiguousTerritory(
        prevTileMap,
        singleKey,
        tile.owner as TerritoryOwner,
        entities,
      );
      if (prevTerritory.length === 1) continue;
    }
    const id = getTerritoryId(territory);
    if (id) balances.set(id, 0);
    const entity = entities.get(singleKey);
    const lt = tileMap.get(singleKey);
    if (entity && entity !== "rebel") {
      entities.delete(singleKey);
      if (ENTITY_META[entity].isUnit) {
        graveyard.add(singleKey);
        // Unit was on a bridge tile — also demolish the bridge since its territory is gone.
        if (lt?.terrain === "lake") {
          tileMap.set(singleKey, { ...lt, owner: "neutral" });
        }
      } else if (entity !== "city") {
        ruins.add(singleKey);
        // Bridge removed: lake tile must lose owner.
        if (entity === "bridge" && lt?.terrain === "lake") {
          tileMap.set(singleKey, { ...lt, owner: "neutral" });
        }
      }
    } else if (lt?.terrain === "lake" && lt.owner !== "neutral") {
      // Ownerless lake tile with no entity — reset to neutral.
      tileMap.set(singleKey, { ...lt, owner: "neutral" });
    }
  }
}

/**
 * Per-owner variant of rebel spawning. Fires at the start of each owner's
 * turn. Both grave/ruin spawn (75%) and background/spread (2/7.5/10%) are
 * restricted to tiles where tile.owner === owner. Neighbour-rebel counts for
 * spread still read the full global entities map (enemy rebels count).
 *
 * armedGraves / armedRuins are the shared round-start armed sets; this
 * function consumes (deletes) the owner's entries — both from the armed sets
 * and from graveyard/ruins — so each site rolls exactly once and skull markers
 * are cleared after processing.
 *
 * Callers must clone entities/graveyard/ruins before passing.
 */
export function spawnRebelsForOwner(
  owner: TerritoryOwner,
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  graveyard: Set<string>,
  ruins: Set<string>,
  armedGraves: Set<string>,
  armedRuins: Set<string>,
  rng: () => number = Math.random,
): void {
  const preSpread = new Map(entities);

  for (const key of [...armedGraves]) {
    if (tileMap.get(key)?.owner !== owner) continue;
    armedGraves.delete(key);
    if (!graveyard.has(key)) continue;
    graveyard.delete(key);
    if (tileMap.get(key)?.terrain === "lake") continue;
    if (entities.has(key)) continue;
    if (rng() < 0.75) entities.set(key, "rebel");
  }
  for (const key of [...armedRuins]) {
    if (tileMap.get(key)?.owner !== owner) continue;
    armedRuins.delete(key);
    if (!ruins.has(key)) continue;
    ruins.delete(key);
    if (tileMap.get(key)?.terrain === "lake") continue;
    if (entities.has(key)) continue;
    if (rng() < 0.75) entities.set(key, "rebel");
  }

  for (const tile of tileMap.values()) {
    if (tile.owner !== owner) continue;
    if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
    if (entities.has(tile.key)) continue;
    const [tq, tr] = tile.key.split(",").map(Number);
    const neighborRebelCount = HEX_EDGES.filter(({ dir: [dq, dr] }) => {
      const nk = tileKey(tq + dq, tr + dr);
      return preSpread.get(nk) === "rebel";
    }).length;
    const chance =
      neighborRebelCount >= 2 ? 0.1 : neighborRebelCount === 1 ? 0.075 : 0.02;
    if (rng() < chance) entities.set(tile.key, "rebel");
  }
}

export function initTerritoryBalances(
  tiles: HexTile[],
  tileMap: Map<string, HexTile>,
): Map<string, number> {
  const balances = new Map<string, number>();
  const visited = new Set<string>();
  const owners: TerritoryOwner[] = [
    "player",
    "ai1",
    "ai2",
    "ai3",
    "ai4",
    "ai5",
  ];
  for (const tile of tiles) {
    if (!owners.includes(tile.owner) || visited.has(tile.key)) continue;
    const territory = getContiguousTerritory(tileMap, tile.key, tile.owner);
    const id = getTerritoryId(territory);
    if (!id) continue;
    balances.set(id, territory.length >= 2 ? 10 : 0);
    for (const t of territory) visited.add(t.key);
  }
  return balances;
}

/**
 * Track-aware merge resolution and the single source of truth for whether two
 * units may merge — replacing the old per-unit `unitCanMerge` + strength-only
 * `mergedUnitType`, neither of which could enforce same-track pairing. Returns
 * the merged unit type, or null when the merge is illegal: two units merge only
 * within the same track — both infantry or both
 * cavalry, never mixed — and only when their combined strength maps to a unit
 * in that track (so warrior + warrior, scout + knight, etc. all return null).
 *
 * Invariant: when non-null, the result's strength equals strA + strB, because
 * each STRENGTH_TO_* table maps n to a unit of strength n.
 */
export function mergeResult(a: EntityType, b: EntityType): EntityType | null {
  if (!ENTITY_META[a].isUnit || !ENTITY_META[b].isUnit) return null;
  const aCav = isCavalry(a);
  if (aCav !== isCavalry(b)) return null;
  const total = ENTITY_META[a].strength + ENTITY_META[b].strength;
  const table = aCav ? STRENGTH_TO_CAVALRY : STRENGTH_TO_UNIT;
  return table[total] ?? null;
}

/**
 * Resolves how a unit's movement budget is recorded at its destination after a
 * move, so a turn can be split into several individual moves up to the unit's
 * max movement (`maxRange`, e.g. 3 for infantry, 5 for cavalry).
 *
 * - Plain move: keep the unit active and store its remaining moves. Only spend
 *   it when no moves are left.
 * - Combat (attacking enemy units, buildings, or capturing an enemy tile):
 *   always spend the unit, regardless of remaining moves. (Charge units that
 *   still have attacks left pass `isCombat: false` so they stay active — the
 *   caller tracks the attack budget separately.)
 * - Merge: never spends on its own; the merged unit keeps the lower of the two
 *   units' remaining moves and is only spent once that hits zero.
 *
 * `remaining` is `null` when the unit is at full range — callers should NOT
 * store a partialMoves entry in that case (absence means "full").
 */
/**
 * Charge ability: a unit with maxAttacks > 1 (cavalry) keeps acting after a
 * combat move instead of being spent, as long as it still has an attack AND
 * movement left. The attack budget is shared with movement — once movement is
 * gone the unit is spent even if attacks remain.
 *
 * This is the single source of truth for charge, shared by the player tap
 * handler and the AI exec, so both sides resolve cavalry charges identically
 * (the original bug was the rebel path drifting from the capture path).
 */
export function isChargeAttack(o: {
  isCombatMove: boolean;
  entity: EntityType;
  attacksUsedSoFar: number;
  remainingAfterMove: number;
}): boolean {
  const maxAttacks = unitMaxAttacks(o.entity);
  return (
    o.isCombatMove &&
    maxAttacks > 1 &&
    o.attacksUsedSoFar + 1 < maxAttacks &&
    o.remainingAfterMove > 0
  );
}

/**
 * Advance the per-turn attack counter when a unit moves from `fromKey` to
 * `toKey`. A combat move increments the count; a non-combat move carries it.
 * The source key is always cleared (so a stale count can't attach to a unit
 * that later lands there). Spent units drop their counter entirely. Returns a
 * new map; shared by the player tap handler and the AI exec.
 */
export function advanceAttacksUsed(o: {
  attacksUsed: Map<string, number>;
  fromKey: string;
  toKey: string;
  isCombatMove: boolean;
  spent: boolean;
}): Map<string, number> {
  const next = new Map(o.attacksUsed);
  const used = next.get(o.fromKey) ?? 0;
  next.delete(o.fromKey);
  if (!o.spent) {
    const now = o.isCombatMove ? used + 1 : used;
    if (now > 0) next.set(o.toKey, now);
  }
  return next;
}

/**
 * Carry the "combat-locked" flag with a unit as it moves from `fromKey` to
 * `toKey`. A unit is combat-locked once it has struck a defender (cavalry, who
 * may then still take one open tile) or finished its combat for the turn
 * (everyone else). The flag follows the unit so cavalry can't strike a second
 * defender after repositioning, and so a stale entry never lingers on the
 * vacated tile. Returns a new set; shared by the player tap handler and the AI.
 */
export function advanceCombatSpent(o: {
  combatSpentUnits: Set<string>;
  fromKey: string;
  toKey: string;
  /** True if this move leaves the unit combat-locked (struck or spent-by-combat). */
  locks: boolean;
}): Set<string> {
  const next = new Set(o.combatSpentUnits);
  const wasLocked = next.has(o.fromKey);
  next.delete(o.fromKey);
  if (wasLocked || o.locks) next.add(o.toKey);
  return next;
}

/**
 * The remaining movement budget of the unit at `key`. A unit with a recorded
 * partial-move count uses that; a spent unit (tracked in `spentUnits` with no
 * partial entry) has 0 remaining; an untouched unit is at full `maxRange`.
 *
 * Used when merging onto an existing unit: the merged unit keeps the LOWER of
 * the two budgets, so merging a fresh unit into a spent one (e.g. one bought
 * into an attack) must not resurrect a movement budget. Shared by the player
 * tap handler and the AI so the two paths cannot drift apart.
 */
export function effectiveRemaining(
  key: string,
  partialMoves: Map<string, number>,
  spentUnits: Set<string>,
  maxRange: number,
): number {
  const pm = partialMoves.get(key);
  if (pm !== undefined) return pm;
  return spentUnits.has(key) ? 0 : maxRange;
}

export function resolveMovedUnitMoves(o: {
  isMerge: boolean;
  isCombat: boolean;
  remainingAfterMove: number;
  destRemaining: number;
  maxRange: number;
}): { spent: boolean; remaining: number | null } {
  if (o.isMerge) {
    const merged = Math.min(o.remainingAfterMove, o.destRemaining);
    if (merged <= 0) return { spent: true, remaining: null };
    return { spent: false, remaining: merged < o.maxRange ? merged : null };
  }
  if (o.isCombat || o.remainingAfterMove <= 0) {
    return { spent: true, remaining: null };
  }
  return {
    spent: false,
    remaining: o.remainingAfterMove < o.maxRange ? o.remainingAfterMove : null,
  };
}

/**
 * Whether a selected unit may improve the tile it stands on: a non-spent peasant
 * on improvable terrain (grass→field, forest→sawmill, desert→mine) whose
 * territory holds a city and at least the improvement's cost in gold. Shared by
 * the player UI (EntityPanel) and the AI.
 */
export function canImproveTile(o: {
  entityId: EntityType | undefined;
  terrain: TerrainType;
  isSpent: boolean;
  balance: number;
  isCity: boolean;
  /** Whether the peasant's territory contains a city (required to improve). */
  territoryHasCity: boolean;
}): boolean {
  if (o.entityId !== "peasant") return false;
  if (o.isCity) return false;
  if (o.isSpent) return false;
  if (!o.territoryHasCity) return false;
  const target = improveTargetFor(o.terrain);
  if (target === null) return false;
  return o.balance >= improveCostFor(target);
}

/**
 * Gross per-turn income of a single tile: terrain income, plus CITY_BONUS when
 * the tile is a city, plus the city-adjacency field bonus (+1 per adjacent
 * owned city for a Field tile only). `isOwnedCityNeighbor` decides whether a
 * neighbouring city counts as same-owner — callers supply the appropriate check
 * (tileMap owner comparison in the real economy, a same-territory key set in the
 * UI breakdown). Sharing this with calcTerritoryIncome keeps the rebel-loss
 * offset and the actual income formula from drifting apart.
 */
export function tileEconomicIncome(
  tile: HexTile,
  cities: Set<string>,
  isOwnedCityNeighbor: (neighborKey: string) => boolean,
): number {
  let income = (TERRAIN_INCOME[tile.terrain] ?? 0) + (cities.has(tile.key) ? CITY_BONUS : 0);
  // Only Fields earn the city-adjacency bonus (+1 per neighbouring owned city).
  if (tile.terrain === "field") {
    const [q, r] = tile.key.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(q + dq, r + dr);
      if (cities.has(nk) && isOwnedCityNeighbor(nk)) income += 1;
    }
  }
  return income;
}

/**
 * Single source of truth for a territory's per-turn income. Sums each non-rebel
 * tile's gross income (see tileEconomicIncome) — a rebel on a tile denies that
 * tile's ENTIRE income, terrain + city bonus + adjacency. Centralizing this
 * avoids the income formula drifting across the ~8 sites that previously inlined it.
 */
export function calcTerritoryIncome(
  territory: HexTile[],
  entities: Map<string, EntityType>,
  cities: Set<string>,
  tileMap: Map<string, HexTile>,
): number {
  let income = 0;
  for (const t of territory) {
    if (entities.get(t.key) === "rebel") continue;
    income += tileEconomicIncome(t, cities, (nk) => tileMap.get(nk)?.owner === t.owner);
  }
  return income;
}
