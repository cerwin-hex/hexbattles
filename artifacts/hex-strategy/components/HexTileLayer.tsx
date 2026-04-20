import React from "react";
import {
  CITY_NEUTRAL_FILL,
  TERRAIN_FILLS,
  TERRITORY_FILLS,
} from "@/constants/colors";
import type { HexTile } from "@/types";
import { HexCell } from "@/components/HexCell";
import { areHexTileLayerEqual } from "@/components/layerEquality";

export interface HexTileLayerProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  activeTileMap: Map<string, HexTile>;
  cities: Set<string>;
  hasSelection: boolean;
  HEX_SIZE: number;
}

function HexTileLayerInner({
  tileData,
  activeTileMap,
  cities,
  hasSelection,
  HEX_SIZE,
}: HexTileLayerProps) {
  return (
    <>
      {tileData.map(({ tile, cx, cy }) => {
        const liveTile = activeTileMap.get(tile.key) ?? tile;
        const isCityZone = tile.cityBuffer || cities.has(tile.key);
        const liveOwner = liveTile.owner;
        const terrain = tile.terrain;
        const fill =
          terrain === "lake"
            ? "#5BAFD6"
            : hasSelection
              ? (TERRAIN_FILLS[terrain] ?? TERRAIN_FILLS.grass)
              : terrain === "mountain"
                ? TERRAIN_FILLS.mountain
                : isCityZone && liveOwner === "neutral"
                  ? CITY_NEUTRAL_FILL
                  : (TERRITORY_FILLS[liveOwner] ?? TERRITORY_FILLS.neutral);
        return (
          <HexCell
            key={tile.key}
            tileKey={tile.key}
            cx={cx}
            cy={cy}
            hexSize={HEX_SIZE}
            fill={fill}
          />
        );
      })}
    </>
  );
}

export { areHexTileLayerEqual };
export const HexTileLayer = React.memo(HexTileLayerInner, areHexTileLayerEqual);
