export type TerrainType = 'grass' | 'desert' | 'mountain' | 'lake' | 'forest';
export type TerritoryOwner = 'neutral' | 'player' | 'ai1' | 'ai2' | 'ai3' | 'ai4' | 'ai5';
export type EntityType = 'simple_unit' | 'advanced_unit' | 'expert_unit' | 'tower' | 'castle' | 'city' | 'rebel' | 'bridge';

export interface HexTile {
  q: number;
  r: number;
  terrain: TerrainType;
  owner: TerritoryOwner;
  key: string;
  cityBuffer: boolean;
  isCity: boolean;
}

export interface EntityMeta {
  name: string;
  icon: string;
  cost: number;
  upkeep: number;
  isUnit: boolean;
  strength: number;
}

export interface BoardBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

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

export type MoveHistorySnapshot = {
  entities: Map<string, EntityType>;
  cities: Set<string>;
  mutableTileMap: Map<string, HexTile>;
  territoryBalances: Map<string, number>;
  spentUnits: Set<string>;
  combatSpentUnits: Set<string>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  partialMoves: Map<string, number>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  selectedTileKey: string | null;
};

export type GameResult = "victory" | "defeat" | null;

export type AiStepSnapshot = {
  entities: Map<string, EntityType>;
  mutableTileMap: Map<string, HexTile>;
  territoryBalances: Map<string, number>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  graveyard: Set<string>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
};
