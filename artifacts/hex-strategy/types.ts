import type { EntityType, HexTile, TerritoryOwner } from "@/utils/hexGrid";

export type Difficulty = "super_easy" | "easy" | "medium" | "hard" | "super_hard";
export type AiState = "attacking" | "defending";

export interface BorderEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export type AiStepSnapshot = {
  entities: Map<string, EntityType>;
  mutableTileMap: Map<string, HexTile>;
  territoryBalances: Map<string, number>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  graveyard: Set<string>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
};
