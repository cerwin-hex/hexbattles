import { useMemo } from "react";
import type { EntityType, HexTile } from "@/types";
import {
  CITY_BONUS,
  ENTITY_META,
  TERRAIN_INCOME,
  DEVELOPED_TERRAINS,
  calcAdminBurden,
  calcDefenseUpkeep,
  nextDefenseUpkeep,
} from "@/utils/hexGrid";
import { HEX_EDGES, tileKey } from "@/utils/hexMath";
import { ENTITY_UPKEEP_ORDER } from "@/constants/gameConstants";

export interface EconBreakdownResult {
  grassCount: number;
  fieldCount: number;
  forestCount: number;
  sawmillCount: number;
  desertCount: number;
  cityCount: number;
  grassIncome: number;
  fieldIncome: number;
  forestIncome: number;
  sawmillIncome: number;
  desertIncome: number;
  cityIncome: number;
  cityDevBonus: number;
  upkeepGroups: Array<{
    id: EntityType;
    name: string;
    count: number;
    category: "infantry" | "cavalry" | "buildings";
    upkeepPerUnit: number | null;
    mostExpensiveCost: number | null;
    total: number;
  }>;
  totalIncome: number;
  totalUpkeep: number;
  adminBurden: number;
  rebelCount: number;
  rebelTotalLoss: number;
  net: number;
}

interface UseEconBreakdownParams {
  selectedTerritory: HexTile[];
  entities: Map<string, EntityType>;
  cities: Set<string>;
}

export function useEconBreakdown({
  selectedTerritory,
  entities,
  cities,
}: UseEconBreakdownParams): EconBreakdownResult | null {
  return useMemo(() => {
    if (selectedTerritory.length === 0) return null;
    let grassCount = 0;
    let fieldCount = 0;
    let forestCount = 0;
    let sawmillCount = 0;
    let desertCount = 0;
    let cityCount = 0;
    const upkeepGroupMap = new Map<EntityType, number>();
    for (const t of selectedTerritory) {
      if (t.terrain === "grass") grassCount++;
      else if (t.terrain === "field") fieldCount++;
      else if (t.terrain === "forest") forestCount++;
      else if (t.terrain === "sawmill") sawmillCount++;
      else if (t.terrain === "desert") desertCount++;
      const entityId = entities.get(t.key);
      if (cities.has(t.key)) cityCount++;
      if (entityId && entityId !== "rebel") {
        const meta = ENTITY_META[entityId];
        if (meta.upkeep > 0) {
          upkeepGroupMap.set(entityId, (upkeepGroupMap.get(entityId) ?? 0) + 1);
        }
        // Unit standing on a lake tile = unit on bridge; count the bridge upkeep too.
        if (meta.isUnit && t.terrain === "lake") {
          upkeepGroupMap.set("bridge", (upkeepGroupMap.get("bridge") ?? 0) + 1);
        }
      }
    }
    const upkeepGroups = ENTITY_UPKEEP_ORDER.filter((type) =>
      upkeepGroupMap.has(type),
    ).map((type) => {
      const count = upkeepGroupMap.get(type)!;
      const meta = ENTITY_META[type];
      const isDefense = type === "tower" || type === "castle";
      const total = isDefense
        ? calcDefenseUpkeep(type as "tower" | "castle", count)
        : meta.upkeep * count;
      const mostExpensiveCost = isDefense
        ? nextDefenseUpkeep(type as "tower" | "castle", count - 1)
        : null;
      const category: "infantry" | "cavalry" | "buildings" = !meta.isUnit
        ? "buildings"
        : meta.movement
          ? "cavalry"
          : "infantry";
      return {
        id: type,
        name: meta.name,
        count,
        category,
        upkeepPerUnit: isDefense ? null : meta.upkeep,
        mostExpensiveCost,
        total,
      };
    });
    let grassIncome = 0;
    let fieldIncome = 0;
    let forestIncome = 0;
    let sawmillIncome = 0;
    let desertIncome = 0;
    // Rebel-occupied tiles are intentionally NOT skipped here: their income is
    // counted into the per-terrain lines and then offset by rebelTotalLoss in
    // `net` below (so a rebel tile nets to zero, matching the real end-turn
    // math). Skipping here as well would double-count the loss.
    for (const t of selectedTerritory) {
      if (t.terrain === "grass") grassIncome += TERRAIN_INCOME[t.terrain];
      else if (t.terrain === "field") fieldIncome += TERRAIN_INCOME[t.terrain];
      else if (t.terrain === "forest") forestIncome += TERRAIN_INCOME[t.terrain];
      else if (t.terrain === "sawmill") sawmillIncome += TERRAIN_INCOME[t.terrain];
      else if (t.terrain === "desert") desertIncome += TERRAIN_INCOME[t.terrain];
    }
    const cityIncome = cityCount * CITY_BONUS;
    // City-adjacency development bonus: +1 per developed tile neighbouring a
    // same-owner city. Mirrors calcTerritoryIncome — a city in the same
    // territory is, by construction, the same owner, so membership in the
    // territory key set is the equivalent same-owner check.
    const territoryKeys = new Set(selectedTerritory.map((t) => t.key));
    let cityDevBonus = 0;
    for (const t of selectedTerritory) {
      if (!DEVELOPED_TERRAINS.has(t.terrain)) continue;
      const [q, r] = t.key.split(",").map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (cities.has(nk) && territoryKeys.has(nk)) cityDevBonus += 1;
      }
    }
    const totalIncome =
      grassIncome +
      fieldIncome +
      forestIncome +
      sawmillIncome +
      desertIncome +
      cityIncome +
      cityDevBonus;
    const totalUpkeep = upkeepGroups.reduce((s, g) => s + g.total, 0);
    const adminBurden = calcAdminBurden(selectedTerritory.length);
    let rebelCount = 0;
    let rebelTotalLoss = 0;
    for (const t of selectedTerritory) {
      if (entities.get(t.key) !== "rebel") continue;
      rebelCount++;
      rebelTotalLoss += TERRAIN_INCOME[t.terrain];
    }
    const net = totalIncome - totalUpkeep - adminBurden - rebelTotalLoss;
    return {
      grassCount,
      fieldCount,
      forestCount,
      sawmillCount,
      desertCount,
      cityCount,
      grassIncome,
      fieldIncome,
      forestIncome,
      sawmillIncome,
      desertIncome,
      cityIncome,
      cityDevBonus,
      upkeepGroups,
      totalIncome,
      totalUpkeep,
      adminBurden,
      rebelCount,
      rebelTotalLoss,
      net,
    };
  }, [selectedTerritory, entities, cities]);
}
