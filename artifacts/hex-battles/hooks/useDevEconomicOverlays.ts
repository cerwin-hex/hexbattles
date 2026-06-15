import { useMemo } from "react";
import type { EntityType, HexTile, TerritoryOwner, AiState } from "@/types";
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
  aiStateMap,
}: UseDevEconomicOverlaysParams): DevEconomicOverlay[] {
  return useMemo<DevEconomicOverlay[]>(() => {
    if (!isDeveloperModeActive) return [];
    const result: DevEconomicOverlay[] = [];
    const visited = new Set<string>();
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
        const money = net >= 0 ? `${balance}(+${net})` : `${balance}(${net})`;
        // State (only the heuristic AIs act on it; for the expert brain it is a
        // display-only "is this territory threatened" flag). Shown as a single
        // A/D prefix in front of the money.
        const stateChar = aiStateMap.get(territoryId) === "defending" ? "D" : "A";
        const label = `${stateChar} ${money}`;
        const central = findCentralTile(territory);
        if (!central) continue;
        const [centQ, centR] = central.key.split(",").map(Number);
        // Pick which tile the label sits on, in priority order:
        //   1. an empty land tile (nothing on it), as central as possible
        //   2. a city   3. a rebel   4. a fortification   5. any unit
        // Cities live in their own Set, so "empty" must also exclude them.
        const isFort = (e: EntityType | undefined) =>
          e === "tower" || e === "castle";
        const isUnit = (e: EntityType | undefined) =>
          !!e && e !== "rebel" && e !== "bridge" && !isFort(e);
        const emptyTiles = territory.filter(
          (t) =>
            t.terrain !== "mountain" &&
            t.terrain !== "lake" &&
            !entities.has(t.key) &&
            !cities.has(t.key),
        );
        const cityTiles = territory.filter((t) => cities.has(t.key));
        const rebelTiles = territory.filter(
          (t) => entities.get(t.key) === "rebel",
        );
        const fortTiles = territory.filter((t) => isFort(entities.get(t.key)));
        const unitTiles = territory.filter((t) => isUnit(entities.get(t.key)));
        const labelCandidates =
          emptyTiles.length > 0
            ? emptyTiles
            : cityTiles.length > 0
              ? cityTiles
              : rebelTiles.length > 0
                ? rebelTiles
                : fortTiles.length > 0
                  ? fortTiles
                  : unitTiles.length > 0
                    ? unitTiles
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
        result.push({ cx: pos.cx, cy: pos.cy, label });
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
    aiStateMap,
  ]);
}
