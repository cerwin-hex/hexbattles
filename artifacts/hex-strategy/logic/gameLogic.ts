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
  let towers = 0, castles = 0, unitUpkeep = 0;
  for (const t of territory) {
    const e = ents.get(t.key);
    if (!e) continue;
    if (e === "tower") towers++;
    else if (e === "castle") castles++;
    else unitUpkeep += ENTITY_META[e].upkeep;
  }
  return unitUpkeep + calcDefenseUpkeep("tower", towers) + calcDefenseUpkeep("castle", castles);
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
    if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
    const territory = getContiguousTerritory(
      tileMap,
      tile.key,
      tile.owner as TerritoryOwner,
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
      );
      if (prevTerritory.length === 1) continue;
    }
    const id = getTerritoryId(territory);
    if (id) balances.set(id, 0);
    const entity = entities.get(singleKey);
    if (entity) {
      entities.delete(singleKey);
      if (ENTITY_META[entity].isUnit) {
        graveyard.add(singleKey);
      } else if (entity !== "rebel" && entity !== "city") {
        ruins.add(singleKey);
      }
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
