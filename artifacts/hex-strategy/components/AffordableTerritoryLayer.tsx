import React from "react";
import { StyleSheet, ViewStyle } from "react-native";
import Animated, { AnimatedStyle } from "react-native-reanimated";
import Svg, { Polygon } from "react-native-svg";
import { hexCornersString } from "@/utils/hexMath";
import type { HexTile } from "@/types";

export interface AffordableTerritoryLayerProps {
  affordableTerritoryTileKeys: Set<string>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  activeTileMap: Map<string, HexTile>;
  boardW: number;
  boardH: number;
  HEX_SIZE: number;
  territoryPulseStyle: AnimatedStyle<ViewStyle>;
}

function AffordableTerritoryLayerInner({
  affordableTerritoryTileKeys,
  tileDataMap,
  activeTileMap,
  boardW,
  boardH,
  HEX_SIZE,
  territoryPulseStyle,
}: AffordableTerritoryLayerProps) {
  return (
    <Animated.View
      style={[StyleSheet.absoluteFillObject, territoryPulseStyle]}
      pointerEvents="none"
    >
      <Svg width={boardW} height={boardH}>
        {Array.from(affordableTerritoryTileKeys).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          const tile = activeTileMap.get(key);
          if (
            !tile ||
            tile.terrain === "mountain" ||
            tile.terrain === "lake"
          )
            return null;
          return (
            <Polygon
              key={`afford-${key}`}
              points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
              fill="white"
            />
          );
        })}
      </Svg>
    </Animated.View>
  );
}

function areAffordableTerritoryLayerEqual(
  prev: AffordableTerritoryLayerProps,
  next: AffordableTerritoryLayerProps,
): boolean {
  return (
    prev.affordableTerritoryTileKeys === next.affordableTerritoryTileKeys &&
    prev.tileDataMap === next.tileDataMap &&
    prev.activeTileMap === next.activeTileMap
  );
}

export const AffordableTerritoryLayer = React.memo(
  AffordableTerritoryLayerInner,
  areAffordableTerritoryLayerEqual,
);
