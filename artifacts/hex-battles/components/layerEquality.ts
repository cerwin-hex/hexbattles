import type { HexTile, BorderEdge } from "@/types";

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
  hasSelection: boolean;
  selectionEdges: BorderEdge[];
}

export function areBorderEdgeLayerEqual(
  prev: BorderEdgeLayerEqualProps,
  next: BorderEdgeLayerEqualProps,
): boolean {
  return (
    prev.outerEdges === next.outerEdges &&
    prev.innerEdges === next.innerEdges &&
    prev.hasSelection === next.hasSelection &&
    prev.selectionEdges === next.selectionEdges
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
