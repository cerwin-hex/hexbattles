import React from "react";
import { G, Rect, Text as SvgText } from "react-native-svg";
import { ENTITY_META } from "@/utils/hexGrid";
import { TERRITORY_BORDERS } from "@/constants/colors";
import type { HexTile } from "@/types";

export interface BridgeOverlayLayerProps {
  activeTileMap: Map<string, HexTile>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  selectedEntityKey: string | null;
  HEX_SIZE: number;
}

function BridgeOverlayLayerInner({
  activeTileMap,
  tileDataMap,
  selectedEntityKey,
  HEX_SIZE,
}: BridgeOverlayLayerProps) {
  const bridgeTiles: HexTile[] = [];
  for (const tile of activeTileMap.values()) {
    if (tile.terrain === "lake" && tile.owner !== "neutral") {
      bridgeTiles.push(tile);
    }
  }
  if (bridgeTiles.length === 0) return null;
  const r = HEX_SIZE * 0.5;
  return (
    <G>
      {bridgeTiles.map((tile) => {
        const pos = tileDataMap.get(tile.key);
        if (!pos) return null;
        const { cx, cy } = pos;
        const isSelected = selectedEntityKey === tile.key;
        const bgColor = isSelected ? "rgba(20,80,20,0.95)" : "rgba(80,40,10,0.9)";
        const strokeColor = isSelected
          ? "#50FF50"
          : (TERRITORY_BORDERS[tile.owner] ?? "#888888");
        const strokeWidth = isSelected ? 4.0 : 3.2;
        return (
          <React.Fragment key={`bridge-${tile.key}`}>
            <Rect
              x={cx - r}
              y={cy - r}
              width={r * 2}
              height={r * 2}
              rx={4}
              fill={bgColor}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <SvgText
              x={cx}
              y={cy + r * 0.35}
              textAnchor="middle"
              fontSize={r * 1.1}
              fill="#fff"
            >
              {ENTITY_META.bridge.icon}
            </SvgText>
          </React.Fragment>
        );
      })}
    </G>
  );
}

function areBridgeOverlayLayerEqual(
  prev: BridgeOverlayLayerProps,
  next: BridgeOverlayLayerProps,
): boolean {
  return (
    prev.activeTileMap === next.activeTileMap &&
    prev.tileDataMap === next.tileDataMap &&
    prev.selectedEntityKey === next.selectedEntityKey &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

export const BridgeOverlayLayer = React.memo(
  BridgeOverlayLayerInner,
  areBridgeOverlayLayerEqual,
);
