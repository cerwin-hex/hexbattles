import type { HexTile, BorderEdge, EntityType, TerrainType } from "@/types";

// ── Terrain layer (uses terrain fills; does not depend on owner/cities) ───────
export interface HexTerrainLayerEqualProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  HEX_SIZE: number;
}

export function areHexTerrainLayerEqual(
  prev: HexTerrainLayerEqualProps,
  next: HexTerrainLayerEqualProps,
): boolean {
  return prev.tileData === next.tileData && prev.HEX_SIZE === next.HEX_SIZE;
}

// ── Territory layer (uses ownership fills; does not depend on hasSelection) ───
export interface HexTerritoryLayerEqualProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  activeTileMap: Map<string, HexTile>;
  cities: Set<string>;
  HEX_SIZE: number;
}

export function areHexTerritoryLayerEqual(
  prev: HexTerritoryLayerEqualProps,
  next: HexTerritoryLayerEqualProps,
): boolean {
  return (
    prev.tileData === next.tileData &&
    prev.activeTileMap === next.activeTileMap &&
    prev.cities === next.cities &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

// ── Legacy alias (kept so existing imports still compile) ─────────────────────
export type HexTileLayerEqualProps = HexTerritoryLayerEqualProps & {
  hasSelection: boolean;
};
export const areHexTileLayerEqual = areHexTerritoryLayerEqual;

// ── Border edges ──────────────────────────────────────────────────────────────
export interface BorderEdgeLayerEqualProps {
  outerEdges: BorderEdge[];
  innerEdges: BorderEdge[];
  showInnerEdges: boolean;
  hasSelection: boolean;
  selectionEdges: BorderEdge[];
  buildingSelectionEdges: BorderEdge[];
}

export function areBorderEdgeLayerEqual(
  prev: BorderEdgeLayerEqualProps,
  next: BorderEdgeLayerEqualProps,
): boolean {
  return (
    prev.outerEdges === next.outerEdges &&
    prev.innerEdges === next.innerEdges &&
    prev.showInnerEdges === next.showInnerEdges &&
    prev.hasSelection === next.hasSelection &&
    prev.selectionEdges === next.selectionEdges &&
    prev.buildingSelectionEdges === next.buildingSelectionEdges
  );
}

// ── City overlay ──────────────────────────────────────────────────────────────
export interface CityOverlayLayerEqualProps {
  cities: Set<string>;
  activeTileMap: Map<string, HexTile>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

export function areCityOverlayLayerEqual(
  prev: CityOverlayLayerEqualProps,
  next: CityOverlayLayerEqualProps,
): boolean {
  return (
    prev.cities === next.cities &&
    prev.activeTileMap === next.activeTileMap &&
    prev.tileDataMap === next.tileDataMap &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

// ── Movement / targeting highlights ───────────────────────────────────────────
export interface MovementHighlightLayerEqualProps {
  validMoveTiles: Set<string>;
  validBridgePlacementTiles: Set<string>;
  validImprovementTiles: Set<string>;
  validPlacementAttackTiles: Set<string>;
  validRangedTargets: Set<string>;
  selectedTileKeys: Set<string>;
  armedEntityId: EntityType | null;
  armedImprovement: TerrainType | null;
  entities: Map<string, EntityType>;
  activeTileMap: Map<string, HexTile>;
  graveyard: Set<string>;
  fortificationDots: Set<string>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  boardW: number;
  boardH: number;
  HEX_SIZE: number;
}

export function areMovementHighlightLayerEqual(
  prev: MovementHighlightLayerEqualProps,
  next: MovementHighlightLayerEqualProps,
): boolean {
  return (
    prev.validMoveTiles === next.validMoveTiles &&
    prev.validBridgePlacementTiles === next.validBridgePlacementTiles &&
    prev.validImprovementTiles === next.validImprovementTiles &&
    prev.validPlacementAttackTiles === next.validPlacementAttackTiles &&
    prev.validRangedTargets === next.validRangedTargets &&
    prev.selectedTileKeys === next.selectedTileKeys &&
    prev.armedEntityId === next.armedEntityId &&
    prev.armedImprovement === next.armedImprovement &&
    prev.entities === next.entities &&
    prev.activeTileMap === next.activeTileMap &&
    prev.graveyard === next.graveyard &&
    prev.fortificationDots === next.fortificationDots &&
    prev.tileDataMap === next.tileDataMap &&
    prev.boardW === next.boardW &&
    prev.boardH === next.boardH &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

// ── Movement / targeting tap targets ──────────────────────────────────────────
export interface MovementHighlightTapTargetsEqualProps {
  validMoveTiles: Set<string>;
  validBridgePlacementTiles: Set<string>;
  validPlacementAttackTiles: Set<string>;
  validRangedTargets: Set<string>;
  armedEntityId: EntityType | null;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

export function areMovementHighlightTapTargetsEqual(
  prev: MovementHighlightTapTargetsEqualProps,
  next: MovementHighlightTapTargetsEqualProps,
): boolean {
  return (
    prev.validMoveTiles === next.validMoveTiles &&
    prev.validBridgePlacementTiles === next.validBridgePlacementTiles &&
    prev.validPlacementAttackTiles === next.validPlacementAttackTiles &&
    prev.validRangedTargets === next.validRangedTargets &&
    prev.armedEntityId === next.armedEntityId &&
    prev.tileDataMap === next.tileDataMap &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

// ── Graves, ruins and kill marks ──────────────────────────────────────────────
export interface GraveyardLayerEqualProps {
  graveyard: Set<string>;
  ruins: Set<string>;
  killMarks: Set<string>;
  entities: Map<string, EntityType>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

// Reference equality is safe here because game state always replaces Set/Map
// instances (never mutates in place), so a changed reference means changed data.
export function areGraveyardLayerEqual(
  prev: GraveyardLayerEqualProps,
  next: GraveyardLayerEqualProps,
): boolean {
  return (
    prev.graveyard === next.graveyard &&
    prev.ruins === next.ruins &&
    prev.killMarks === next.killMarks &&
    prev.entities === next.entities &&
    prev.tileDataMap === next.tileDataMap &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}
