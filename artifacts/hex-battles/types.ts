export type TerrainType = 'grass' | 'desert' | 'mountain' | 'lake' | 'forest' | 'field' | 'sawmill' | 'mine';
export type TerritoryOwner = 'neutral' | 'player' | 'ai1' | 'ai2' | 'ai3' | 'ai4' | 'ai5';
export type EntityType = 'peasant' | 'warrior' | 'swordsman' | 'scout' | 'knight' | 'shortbowman' | 'longbowman' | 'crossbowman' | 'tower' | 'castle' | 'city' | 'rebel' | 'bridge';

/**
 * Grave/ruin sites that have stood since the start of an owner's previous turn,
 * bucketed by the owner whose sweep will consume them. A site only breeds a
 * rebel once it appears here, which is what guarantees every marker at least one
 * full player turn on screen.
 *
 * The `neutral` bucket is not a player: it holds orphaned markers on water tiles
 * whose bridge is gone. Nobody owns those tiles, so no owner sweep would ever
 * reach them; they are expired by `sweepNeutralMarkers` instead and never spawn.
 */
export type ArmedSites = Map<TerritoryOwner, Set<string>>;

export interface HexTile {
  q: number;
  r: number;
  terrain: TerrainType;
  owner: TerritoryOwner;
  key: string;
  cityBuffer: boolean;
  isCity: boolean;
}

/**
 * Which track a unit belongs to. The track decides what a unit may merge with
 * and which tile-entry rules apply to it. Buildings and markers have no class.
 */
export type UnitClass = 'infantry' | 'cavalry' | 'ranged';

export interface EntityMeta {
  name: string;
  cost: number;
  upkeep: number;
  isUnit: boolean;
  /** Strength used when this entity attacks, captures or shoots. */
  offStrength: number;
  /** Strength this entity projects in defense — the value ZoC is built from. */
  defStrength: number;
  /**
   * Merge/upgrade rank inside the unit's own track. Two units merge into the
   * unit whose tier is the sum of theirs. 0 for non-combat entities.
   */
  tier: number;
  /** Units only; drives the merge track and the tile-entry rules. */
  unitClass?: UnitClass;
  /** Max movement budget per turn. Defaults to DEFAULT_MOVEMENT (3) when absent. */
  movement?: number;
  /** Max combat actions per turn. Defaults to 1 when absent; >1 enables the charge ability. */
  maxAttacks?: number;
}

export interface BoardBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export type Difficulty = "easy" | "medium" | "hard" | "expert" | "super_expert";
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
  attacksUsed: Map<string, number>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  graveyard: Set<string>;
  ruins: Set<string>;
  selectedTileKey: string | null;
};

export type GameResult = "victory" | "defeat" | null;

export type AiStepSnapshot = {
  entities: Map<string, EntityType>;
  mutableTileMap: Map<string, HexTile>;
  territoryBalances: Map<string, number>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  graveyard: Set<string>;
  ruins: Set<string>;
  cities: Set<string>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  // Captured so rewinding a step also rewinds which sites have already been
  // consumed. Without these, replaying a step could spawn a second rebel from a
  // grave that is already gone, or resurrect an expired water marker.
  armedGraveyard: ArmedSites;
  armedRuins: ArmedSites;
};
