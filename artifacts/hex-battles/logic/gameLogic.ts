import {
  EntityType,
  HexTile,
  TerritoryOwner,
  ENTITY_META,
  calcDefenseUpkeep,
  getContiguousTerritory,
  getTerritoryId,
  TERRAIN_INCOME,
  unitMaxAttacks,
  isCavalry,
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
  return unitUpkeep + calcDefenseUpkeep("tower", towers) + calcDefenseUpkeep("castle", castles) + bridges * ENTITY_META["bridge"].upkeep;
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
