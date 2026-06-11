import React from "react";
import { StyleSheet, View } from "react-native";
import { useOwnerColors } from "@/contexts/SettingsContext";
import { UnitToken } from "@/components/UnitToken";
import type { HexTile } from "@/types";

export interface BridgeOverlayLayerProps {
  activeTileMap: Map<string, HexTile>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  selectedEntityKey: string | null;
  HEX_SIZE: number;
}

/**
 * Bridges render through the shared building UnitToken (isBuilding: bare icon,
 * no background, no ring) so they match towers/castles and cities. The passed
 * borderColor is ignored for buildings but kept for the shared prop shape.
 */
function BridgeOverlayLayerInner({
  activeTileMap,
  tileDataMap,
  selectedEntityKey,
  HEX_SIZE,
}: BridgeOverlayLayerProps) {
  const { borders: TERRITORY_BORDERS } = useOwnerColors();
  const bridgeTiles: HexTile[] = [];
  for (const tile of activeTileMap.values()) {
    if (tile.terrain === "lake" && tile.owner !== "neutral") {
      bridgeTiles.push(tile);
    }
  }
  if (bridgeTiles.length === 0) return null;
  const r = HEX_SIZE * 0.5;
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {bridgeTiles.map((tile) => {
        const pos = tileDataMap.get(tile.key);
        if (!pos) return null;
        const isSelected = selectedEntityKey === tile.key;
        const borderColor = isSelected
          ? "#50FF50"
          : TERRITORY_BORDERS[tile.owner] ?? "#888888";
        const borderWidth = isSelected ? 2.6 : 2.2;
        return (
          <View
            key={`bridge-${tile.key}`}
            style={{ position: "absolute", left: pos.cx - r, top: pos.cy - r }}
          >
            <UnitToken
              r={r}
              entityId="bridge"
              borderColor={borderColor}
              borderWidth={borderWidth}
              isBuilding
            />
          </View>
        );
      })}
    </View>
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
