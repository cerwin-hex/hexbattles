import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { hexCornersString } from "@/utils/hexMath";

export interface ErrorTileFlashProps {
  errorTileKey: string | null;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  boardW: number;
  boardH: number;
  HEX_SIZE: number;
}

function ErrorTileFlashInner({
  errorTileKey,
  tileDataMap,
  boardW,
  boardH,
  HEX_SIZE,
}: ErrorTileFlashProps) {
  if (!errorTileKey) return null;
  const pos = tileDataMap.get(errorTileKey);
  if (!pos) return null;
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Svg width={boardW} height={boardH}>
        <Polygon
          points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
          fill="rgba(0,0,0,0.55)"
        />
      </Svg>
    </View>
  );
}

function areErrorTileFlashEqual(
  prev: ErrorTileFlashProps,
  next: ErrorTileFlashProps,
): boolean {
  return (
    prev.errorTileKey === next.errorTileKey &&
    prev.tileDataMap === next.tileDataMap &&
    prev.boardW === next.boardW &&
    prev.boardH === next.boardH &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

export const ErrorTileFlash = React.memo(
  ErrorTileFlashInner,
  areErrorTileFlashEqual,
);
