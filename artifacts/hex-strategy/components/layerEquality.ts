import type { HexTile, BorderEdge } from "@/types";

export interface HexTileLayerEqualProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  activeTileMap: Map<string, HexTile>;
  cities: Set<string>;
  hasSelection: boolean;
  HEX_SIZE: number;
}

export function areHexTileLayerEqual(
  prev: HexTileLayerEqualProps,
  next: HexTileLayerEqualProps,
): boolean {
  return (
    prev.tileData === next.tileData &&
    prev.activeTileMap === next.activeTileMap &&
    prev.cities === next.cities &&
    prev.hasSelection === next.hasSelection &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

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
