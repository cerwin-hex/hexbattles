import React from "react";
import { StyleSheet, View } from "react-native";
import { useOwnerColors } from "@/contexts/SettingsContext";
import { UnitToken } from "@/components/UnitToken";
import type { HexTile } from "@/types";
import { areCityOverlayLayerEqual } from "@/components/layerEquality";

export interface CityOverlayLayerProps {
  cities: Set<string>;
  activeTileMap: Map<string, HexTile>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

/**
 * Cities render through the shared building UnitToken (isBuilding: bare icon,
 * no background, no ring) so they match towers/castles and bridges. The passed
 * borderColor is ignored for buildings but kept for the shared prop shape.
 */
function CityOverlayLayerInner({
  cities,
  activeTileMap,
  tileDataMap,
  HEX_SIZE,
}: CityOverlayLayerProps) {
  const { borders: TERRITORY_BORDERS } = useOwnerColors();
  const r = HEX_SIZE * 0.5;
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {Array.from(cities).map((key) => {
        const pos = tileDataMap.get(key);
        if (!pos) return null;
        const liveTile = activeTileMap.get(key);
        const borderColor =
          TERRITORY_BORDERS[liveTile?.owner ?? "neutral"] ?? "#888888";
        return (
          <View
            key={`city-${key}`}
            style={{ position: "absolute", left: pos.cx - r, top: pos.cy - r }}
          >
            <UnitToken
              r={r}
              entityId="city"
              borderColor={borderColor}
              borderWidth={2.2}
              isBuilding
            />
          </View>
        );
      })}
    </View>
  );
}

export { areCityOverlayLayerEqual };
export const CityOverlayLayer = React.memo(
  CityOverlayLayerInner,
  areCityOverlayLayerEqual,
);
