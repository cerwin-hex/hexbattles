import { useMemo } from "react";
import type { EntityType, HexTile } from "@/types";
import {
  CITY_BONUS,
  ENTITY_META,
  TERRAIN_INCOME,
  calcAdminBurden,
  calcDefenseUpkeep,
  nextDefenseUpkeep,
} from "@/utils/hexGrid";
import { HEX_EDGES, tileKey } from "@/utils/hexMath";
import { tileEconomicIncome } from "@/logic/gameLogic";
import { ENTITY_UPKEEP_ORDER } from "@/constants/gameConstants";

export interface EconBreakdownResult {
  // grass/forest counts are the whole terrain family (base + improved); the
  // improved tiles also appear in fieldCount/sawmillCount. grassIncome /
  // forestIncome are the BASE income of the whole family (counted at the base
  // rate); fieldBonus / sawmillBonus are only the +1 improvement delta per
  // improved tile, mirroring how the city-adjacency bonus is shown.
  grassCount: number;
  fieldCount: number;
  forestCount: number;
  sawmillCount: number;
  desertCount: number;
  mineCount: number;
  cityCount: number;
  grassIncome: number;
  fieldBonus: number;
  forestIncome: number;
  sawmillBonus: number;
  desertIncome: number;
  mineBonus: number;
  cityIncome: number;
  cityImproveBonus: number;
  cityImproveCount: number;
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
    let mineCount = 0;
    let cityCount = 0;
    const upkeepGroupMap = new Map<EntityType, number>();
    for (const t of selectedTerritory) {
      // Improved tiles count toward their base family AND their own line.
      if (t.terrain === "grass" || t.terrain === "field") grassCount++;
      if (t.terrain === "field") fieldCount++;
      if (t.terrain === "forest" || t.terrain === "sawmill") forestCount++;
      if (t.terrain === "sawmill") sawmillCount++;
      if (t.terrain === "desert" || t.terrain === "mine") desertCount++;
      if (t.terrain === "mine") mineCount++;
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
    // Income is derived from the family counts. grass/forest are charged the
    // base rate across the whole family (including improved tiles); the
    // improvement delta (+1 per improved tile) is broken out as a bonus line.
    // Rebel-occupied tiles are intentionally still counted here: their income
    // is offset by rebelTotalLoss in `net` below (so a rebel tile nets to zero,
    // matching the real end-turn math). Skipping would double-count the loss.
    const grassIncome = grassCount * TERRAIN_INCOME.grass;
    const fieldBonus = fieldCount * (TERRAIN_INCOME.field - TERRAIN_INCOME.grass);
    const forestIncome = forestCount * TERRAIN_INCOME.forest;
    const sawmillBonus =
      sawmillCount * (TERRAIN_INCOME.sawmill - TERRAIN_INCOME.forest);
    const desertIncome = desertCount * TERRAIN_INCOME.desert;
    const mineBonus = mineCount * (TERRAIN_INCOME.mine - TERRAIN_INCOME.desert);
    const cityIncome = cityCount * CITY_BONUS;
    // City-adjacency field bonus: +1 per Field tile neighbouring a same-owner
    // city. Mirrors calcTerritoryIncome — a city in the same territory is, by
    // construction, the same owner, so membership in the territory key set is
    // the equivalent same-owner check. Only Fields qualify (not sawmills/mines).
    const territoryKeys = new Set(selectedTerritory.map((t) => t.key));
    let cityImproveBonus = 0;
    let cityImproveCount = 0;
    for (const t of selectedTerritory) {
      if (t.terrain !== "field") continue;
      const [q, r] = t.key.split(",").map(Number);
      let fieldBonusHere = 0;
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (cities.has(nk) && territoryKeys.has(nk)) fieldBonusHere += 1;
      }
      if (fieldBonusHere > 0) cityImproveCount += 1;
      cityImproveBonus += fieldBonusHere;
    }
    const totalIncome =
      grassIncome +
      fieldBonus +
      forestIncome +
      sawmillBonus +
      desertIncome +
      mineBonus +
      cityIncome +
      cityImproveBonus;
    const totalUpkeep = upkeepGroups.reduce((s, g) => s + g.total, 0);
    const adminBurden = calcAdminBurden(selectedTerritory.length);
    let rebelCount = 0;
    let rebelTotalLoss = 0;
    for (const t of selectedTerritory) {
      if (entities.get(t.key) !== "rebel") continue;
      rebelCount++;
      // A rebel denies the tile's ENTIRE income — terrain + CITY_BONUS +
      // city-adjacency bonus — exactly as calcTerritoryIncome skips it in the
      // real economy. totalIncome (grassIncome/cityIncome/cityImproveBonus)
      // still counts the tile, so subtracting its full income nets it to zero.
      // territoryKeys.has is the same-owner proxy used for cityImproveBonus above.
      rebelTotalLoss += tileEconomicIncome(t, cities, (nk) => territoryKeys.has(nk));
    }
    const net = totalIncome - totalUpkeep - adminBurden - rebelTotalLoss;
    return {
      grassCount,
      fieldCount,
      forestCount,
      sawmillCount,
      desertCount,
      mineCount,
      cityCount,
      grassIncome,
      fieldBonus,
      forestIncome,
      sawmillBonus,
      desertIncome,
      mineBonus,
      cityIncome,
      cityImproveBonus,
      cityImproveCount,
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
