import React from "react";
import { G, Polygon } from "react-native-svg";
import { hexCornersString } from "@/utils/hexMath";
import type { EntityType } from "@/types";

export interface MovementHighlightTapTargetsProps {
  validMoveTiles: Set<string>;
  validBridgePlacementTiles: Set<string>;
  validPlacementAttackTiles: Set<string>;
  armedEntityId: EntityType | null;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

function MovementHighlightTapTargetsInner({
  validMoveTiles,
  validBridgePlacementTiles,
  validPlacementAttackTiles,
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

function areMovementHighlightTapTargetsEqual(
  prev: MovementHighlightTapTargetsProps,
  next: MovementHighlightTapTargetsProps,
): boolean {
  return (
    prev.validMoveTiles === next.validMoveTiles &&
    prev.validBridgePlacementTiles === next.validBridgePlacementTiles &&
    prev.validPlacementAttackTiles === next.validPlacementAttackTiles &&
    prev.armedEntityId === next.armedEntityId &&
    prev.tileDataMap === next.tileDataMap &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

export const MovementHighlightTapTargets = React.memo(
  MovementHighlightTapTargetsInner,
  areMovementHighlightTapTargetsEqual,
);
