import { useMemo } from "react";
import type { EntityType, HexTile } from "@/types";
import {
  CITY_BONUS,
  ENTITY_META,
  TERRAIN_INCOME,
  calcDefenseUpkeep,
  nextDefenseUpkeep,
} from "@/utils/hexGrid";
import { ENTITY_UPKEEP_ORDER } from "@/constants/gameConstants";

export interface EconBreakdownResult {
  grassCount: number;
  forestCount: number;
  desertCount: number;
  cityCount: number;
  grassIncome: number;
  forestIncome: number;
  desertIncome: number;
  cityIncome: number;
  upkeepGroups: Array<{
    icon: string;
    name: string;
    count: number;
    category: "infantry" | "cavalry" | "buildings";
    upkeepPerUnit: number | null;
    mostExpensiveCost: number | null;
    total: number;
  }>;
  totalIncome: number;
  totalUpkeep: number;
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
    let forestCount = 0;
    let desertCount = 0;
    let cityCount = 0;
    const upkeepGroupMap = new Map<EntityType, number>();
    for (const t of selectedTerritory) {
      if (t.terrain === "grass") grassCount++;
      else if (t.terrain === "forest") forestCount++;
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
        icon: meta.icon,
        name: meta.name,
        count,
        category,
        upkeepPerUnit: isDefense ? null : meta.upkeep,
        mostExpensiveCost,
        total,
      };
    });
    const grassIncome = grassCount * 2;
    const forestIncome = forestCount * 2;
    const desertIncome = desertCount * 1;
    const cityIncome = cityCount * CITY_BONUS;
    const totalIncome = grassIncome + forestIncome + desertIncome + cityIncome;
    const totalUpkeep = upkeepGroups.reduce((s, g) => s + g.total, 0);
    let rebelCount = 0;
    let rebelTotalLoss = 0;
    for (const t of selectedTerritory) {
      if (entities.get(t.key) !== "rebel") continue;
      rebelCount++;
      rebelTotalLoss += TERRAIN_INCOME[t.terrain];
    }
    const net = totalIncome - totalUpkeep - rebelTotalLoss;
    return {
      grassCount,
      forestCount,
      desertCount,
      cityCount,
      grassIncome,
      forestIncome,
      desertIncome,
      cityIncome,
      upkeepGroups,
      totalIncome,
      totalUpkeep,
      rebelCount,
      rebelTotalLoss,
      net,
    };
  }, [selectedTerritory, entities, cities]);
}
