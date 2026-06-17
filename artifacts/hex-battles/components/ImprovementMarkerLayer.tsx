import React from "react";
import { Polygon } from "react-native-svg";
import { hexCornersString } from "@/utils/hexMath";
import { TERRAIN_FILLS } from "@/constants/colors";
import type { HexTile } from "@/types";

export interface ImprovementMarkerLayerProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  activeTileMap: Map<string, HexTile>;
  HEX_SIZE: number;
}

// Draws a half-size hex on top of improved tiles so the upgrade is visible in
// terrain view (the base terrain layer keeps showing the original grass/forest
// colour underneath). Field = corn-yellow, sawmill = brown, mine = silver-grey.
function ImprovementMarkerLayerInner({
  tileData,
  activeTileMap,
  HEX_SIZE,
}: ImprovementMarkerLayerProps) {
  const markerSize = HEX_SIZE / 2;
  return (
    <>
      {tileData.map(({ tile, cx, cy }) => {
        const terrain = activeTileMap.get(tile.key)?.terrain ?? tile.terrain;
        if (terrain !== "field" && terrain !== "sawmill" && terrain !== "mine")
          return null;
        return (
          <Polygon
            key={tile.key}
            points={hexCornersString(cx, cy, markerSize)}
            fill={TERRAIN_FILLS[terrain]}
            stroke="#0D0A06"
            strokeWidth={1}
          />
        );
      })}
    </>
  );
}

function areEqual(
  prev: ImprovementMarkerLayerProps,
  next: ImprovementMarkerLayerProps,
): boolean {
  return (
    prev.tileData === next.tileData &&
    prev.activeTileMap === next.activeTileMap &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

export const ImprovementMarkerLayer = React.memo(
  ImprovementMarkerLayerInner,
  areEqual,
);
