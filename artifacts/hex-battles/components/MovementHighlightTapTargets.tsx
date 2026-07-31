import React from "react";
import { G, Polygon } from "react-native-svg";
import { hexCornersString } from "@/utils/hexMath";
import { areMovementHighlightTapTargetsEqual } from "@/components/layerEquality";
import type { EntityType } from "@/types";

export interface MovementHighlightTapTargetsProps {
  validMoveTiles: Set<string>;
  validBridgePlacementTiles: Set<string>;
  validPlacementAttackTiles: Set<string>;
  validRangedTargets: Set<string>;
  armedEntityId: EntityType | null;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

function MovementHighlightTapTargetsInner({
  validMoveTiles,
  validBridgePlacementTiles,
  validPlacementAttackTiles,
  validRangedTargets,
  armedEntityId,
  tileDataMap,
  HEX_SIZE,
}: MovementHighlightTapTargetsProps) {
  return (
    <G>
      {validMoveTiles.size > 0 &&
        Array.from(validMoveTiles).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          return (
            <Polygon
              key={`move-tap-${key}`}
              points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
              fill="transparent"
            />
          );
        })}

      {validRangedTargets.size > 0 &&
        Array.from(validRangedTargets).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          return (
            <Polygon
              key={`shot-tap-${key}`}
              points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
              fill="transparent"
            />
          );
        })}

      {armedEntityId === "bridge" &&
        Array.from(validBridgePlacementTiles).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          return (
            <Polygon
              key={`bridge-tap-${key}`}
              points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
              fill="transparent"
            />
          );
        })}

      {armedEntityId &&
        Array.from(validPlacementAttackTiles).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          return (
            <Polygon
              key={`atk-tap-${key}`}
              points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
              fill="transparent"
            />
          );
        })}
    </G>
  );
}

export const MovementHighlightTapTargets = React.memo(
  MovementHighlightTapTargetsInner,
  areMovementHighlightTapTargetsEqual,
);
