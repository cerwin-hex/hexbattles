import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

export interface FortificationDotLayerProps {
  fortificationDots: Set<string>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  boardW: number;
  boardH: number;
  HEX_SIZE: number;
}

function FortificationDotLayerInner({
  fortificationDots,
  tileDataMap,
  boardW,
  boardH,
  HEX_SIZE,
}: FortificationDotLayerProps) {
  if (fortificationDots.size === 0) return null;
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Svg width={boardW} height={boardH}>
        {Array.from(fortificationDots).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          return (
            <Circle
              key={`fort-${key}`}
              cx={pos.cx}
              cy={pos.cy}
              r={HEX_SIZE * 0.15}
              fill="#4488FF"
              opacity={0.75}
            />
          );
        })}
      </Svg>
    </View>
  );
}

function areFortificationDotLayerEqual(
  prev: FortificationDotLayerProps,
  next: FortificationDotLayerProps,
): boolean {
  return (
    prev.fortificationDots === next.fortificationDots &&
    prev.tileDataMap === next.tileDataMap &&
    prev.boardW === next.boardW &&
    prev.boardH === next.boardH &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

export const FortificationDotLayer = React.memo(
  FortificationDotLayerInner,
  areFortificationDotLayerEqual,
);
