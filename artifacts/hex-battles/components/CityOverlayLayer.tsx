import React from "react";
import { G, Rect, Text as SvgText } from "react-native-svg";
import { ENTITY_META } from "@/utils/hexGrid";
import { useOwnerColors } from "@/contexts/SettingsContext";
import type { HexTile } from "@/types";
import { areCityOverlayLayerEqual } from "@/components/layerEquality";

export interface CityOverlayLayerProps {
  cities: Set<string>;
  activeTileMap: Map<string, HexTile>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

function CityOverlayLayerInner({
  cities,
  activeTileMap,
  tileDataMap,
  HEX_SIZE,
}: CityOverlayLayerProps) {
  const { borders: TERRITORY_BORDERS } = useOwnerColors();
  return (
    <G>
      {Array.from(cities).map((key) => {
        const pos = tileDataMap.get(key);
        if (!pos) return null;
        const { cx, cy } = pos;
        const liveTile = activeTileMap.get(key);
        const cityBorderColor =
          TERRITORY_BORDERS[liveTile?.owner ?? "neutral"] ?? "#888888";
        const cr = HEX_SIZE * 0.46;
        return (
          <React.Fragment key={`city-${key}`}>
            <Rect
              x={cx - cr}
              y={cy - cr}
              width={cr * 2}
              height={cr * 2}
              rx={4}
              fill="rgba(0,0,0,0.25)"
              stroke={cityBorderColor}
              strokeWidth={3.2}
            />
            <SvgText
              x={cx}
              y={cy + HEX_SIZE * 0.28}
              textAnchor="middle"
              fontSize={HEX_SIZE * 0.72}
              fill="#fff"
              opacity={0.9}
            >
              {ENTITY_META.city.icon}
            </SvgText>
          </React.Fragment>
        );
      })}
    </G>
  );
}

export { areCityOverlayLayerEqual };
export const CityOverlayLayer = React.memo(
  CityOverlayLayerInner,
  areCityOverlayLayerEqual,
);
