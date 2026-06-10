import React from "react";
import { StyleSheet, View } from "react-native";
import { ENTITY_META } from "@/utils/hexGrid";
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
 * Cities render through the shared building UnitToken (square, owner-coloured
 * border, building glyph scale) so they match towers/castles and bridges in
 * border weight and icon size. Only the background hue distinguishes them.
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
              icon={ENTITY_META.city.icon}
              bgColor="rgba(205,205,212,0.9)"
              borderColor={borderColor}
              borderWidth={2.2}
              square
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
