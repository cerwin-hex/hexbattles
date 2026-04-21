import { useMemo } from "react";
import type { EntityType, HexTile, TerritoryOwner, Difficulty, AiState } from "@/types";
import {
  CITY_BONUS,
  TERRAIN_INCOME,
  findCentralTile,
  getContiguousTerritory,
  getTerritoryId,
} from "@/utils/hexGrid";
import { hexDistance } from "@/utils/hexMath";
import { calcTerritoryUpkeep } from "@/logic/gameLogic";

export interface DevEconomicOverlay {
  cx: number;
  cy: number;
  label: string;
  aiLabel?: string;
}

interface UseDevEconomicOverlaysParams {
  isDeveloperModeActive: boolean;
  aiOwners: TerritoryOwner[];
  activeTileMap: Map<string, HexTile>;
  territoryBalances: Map<string, number>;
  entities: Map<string, EntityType>;
  cities: Set<string>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  aiDifficulty: Difficulty;
  aiStateMap: Map<string, AiState>;
}

export function useDevEconomicOverlays({
  isDeveloperModeActive,
  aiOwners,
  activeTileMap,
  territoryBalances,
  entities,
  cities,
  tileDataMap,
  aiDifficulty,
  aiStateMap,
}: UseDevEconomicOverlaysParams): DevEconomicOverlay[] {
  return useMemo<DevEconomicOverlay[]>(() => {
    if (!isDeveloperModeActive) return [];
    const result: DevEconomicOverlay[] = [];
    const visited = new Set<string>();
    const diffLabel =
      aiDifficulty === "super_hard"
        ? "S.Hrd"
        : aiDifficulty === "hard"
          ? "Hrd"
          : aiDifficulty === "medium"
            ? "Med"
            : aiDifficulty === "easy"
              ? "Esy"
              : "S.Esy";
    for (const aiOwner of aiOwners) {
      for (const tile of Array.from(activeTileMap.values())) {
        if (tile.owner !== aiOwner || visited.has(tile.key)) continue;
        const territory = getContiguousTerritory(
          activeTileMap,
          tile.key,
          aiOwner,
          entities,
        );
        for (const t of territory) visited.add(t.key);
        const territoryId = getTerritoryId(territory);
        if (!territoryId) continue;
        const balance = territoryBalances.get(territoryId) ?? 0;
        const income = territory.reduce((s, t) => {
          if (entities.get(t.key) === "rebel") return s;
          return (
            s +
            TERRAIN_INCOME[t.terrain] +
            (cities.has(t.key) ? CITY_BONUS : 0)
          );
        }, 0);
        const upkeep = calcTerritoryUpkeep(territory, entities);
        const net = income - upkeep;
        const label = net >= 0 ? `${balance}(+${net})` : `${balance}(${net})`;
        const stateVal = aiStateMap.get(territoryId);
        const stateLabel = stateVal === "attacking" ? "Atk" : "Def";
        const aiLabel = `${diffLabel}·${stateLabel}`;
        const central = findCentralTile(territory);
        if (!central) continue;
        const [centQ, centR] = central.key.split(",").map(Number);
        const vacantTiles = territory.filter(
          (t) =>
            t.terrain !== "mountain" &&
            t.terrain !== "lake" &&
            !entities.has(t.key),
        );
        const towerTiles = territory.filter(
          (t) => entities.get(t.key) === "tower",
        );
        const labelCandidates =
          vacantTiles.length > 0
            ? vacantTiles
            : towerTiles.length > 0
              ? towerTiles
              : [central];
        let labelTile = labelCandidates[0];
        let labelDist = hexDistance(centQ, centR, labelTile.q, labelTile.r);
        for (const t of labelCandidates) {
          const d = hexDistance(centQ, centR, t.q, t.r);
          if (d < labelDist) {
            labelDist = d;
            labelTile = t;
          }
        }
        const pos = tileDataMap.get(labelTile.key);
        if (!pos) continue;
        result.push({ cx: pos.cx, cy: pos.cy, label, aiLabel });
      }
    }
    return result;
  }, [
    isDeveloperModeActive,
    aiOwners,
    activeTileMap,
    territoryBalances,
    entities,
    cities,
    tileDataMap,
    aiDifficulty,
    aiStateMap,
  ]);
}
