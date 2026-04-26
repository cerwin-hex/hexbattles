import { useMemo } from "react";
import type { HexTile } from "@/types";

export interface DevTerrainOverlay {
  cx: number;
  cy: number;
  terrain: string;
}

const TERRAIN_LABEL: Record<string, string> = {
  grass: "Grass",
  forest: "Forest",
  desert: "Desert",
};

interface UseDevTerrainOverlaysParams {
  isDeveloperModeActive: boolean;
  isAiTurn: boolean;
  activeTileMap: Map<string, HexTile>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
}

export function useDevTerrainOverlays({
  isDeveloperModeActive,
  isAiTurn,
  activeTileMap,
  tileDataMap,
}: UseDevTerrainOverlaysParams): DevTerrainOverlay[] {
  return useMemo<DevTerrainOverlay[]>(() => {
    if (!isDeveloperModeActive || !isAiTurn) return [];
    const result: DevTerrainOverlay[] = [];
    for (const tile of activeTileMap.values()) {
      const label = TERRAIN_LABEL[tile.terrain];
      if (!label) continue;
      const pos = tileDataMap.get(tile.key);
      if (!pos) continue;
      result.push({ cx: pos.cx, cy: pos.cy, terrain: label });
    }
    return result;
  }, [isDeveloperModeActive, isAiTurn, activeTileMap, tileDataMap]);
}
