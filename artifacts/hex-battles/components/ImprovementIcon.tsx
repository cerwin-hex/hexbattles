import React from "react";
import Svg, { Polygon } from "react-native-svg";
import { hexCornersString } from "@/utils/hexMath";
import { TERRAIN_FILLS } from "@/constants/colors";
import type { TerrainType } from "@/types";

interface ImprovementIconProps {
  terrain: TerrainType;
  size: number;
}

/**
 * A small hexagon in the improvement's terrain colour, matching the marker
 * ImprovementMarkerLayer draws on the board — so a ribbon card looks like the
 * tile the player is about to create. Improvements have no UnitIcon because
 * they are terrain, not entities.
 */
export function ImprovementIcon({ terrain, size }: ImprovementIconProps) {
  const half = size / 2;
  return (
    <Svg width={size} height={size}>
      <Polygon
        points={hexCornersString(half, half, half - 1)}
        fill={TERRAIN_FILLS[terrain]}
        stroke="#0D0A06"
        strokeWidth={1}
      />
    </Svg>
  );
}
