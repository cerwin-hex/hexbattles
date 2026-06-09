import {
  EntityType,
  HexTile,
  TerritoryOwner,
  ENTITY_META,
  calcDefenseUpkeep,
  getContiguousTerritory,
  getTerritoryId,
  TERRAIN_INCOME,
} from "@/utils/hexGrid";
import { STRENGTH_TO_UNIT } from "@/constants/gameConstants";

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

export function mergedUnitType(strA: number, strB: number): EntityType {
  const total = Math.min(strA + strB, 3);
  return STRENGTH_TO_UNIT[total] ?? "expert_unit";
}

/**
 * Resolves how a unit's movement budget is recorded at its destination after a
 * move, so a turn can be split into several individual moves up to the unit's
 * max movement (3).
 *
 * - Plain move: keep the unit active and store its remaining moves. Only spend
 *   it when no moves are left.
 * - Combat (attacking enemy units, buildings, or capturing an enemy tile):
 *   always spend the unit, regardless of remaining moves.
 * - Merge: never spends on its own; the merged unit keeps the lower of the two
 *   units' remaining moves and is only spent once that hits zero.
 *
 * `remaining` is `null` when the unit is at full range (3) — callers should NOT
 * store a partialMoves entry in that case (absence means "full").
 */
export function resolveMovedUnitMoves(o: {
  isMerge: boolean;
  isCombat: boolean;
  remainingAfterMove: number;
  destRemaining: number;
}): { spent: boolean; remaining: number | null } {
  if (o.isMerge) {
    const merged = Math.min(o.remainingAfterMove, o.destRemaining);
    if (merged <= 0) return { spent: true, remaining: null };
    return { spent: false, remaining: merged < 3 ? merged : null };
  }
  if (o.isCombat || o.remainingAfterMove <= 0) {
    return { spent: true, remaining: null };
  }
  return {
    spent: false,
    remaining: o.remainingAfterMove < 3 ? o.remainingAfterMove : null,
  };
}
