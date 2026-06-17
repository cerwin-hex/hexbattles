import React from "react";
import { CITY_NEUTRAL_FILL, TERRAIN_FILLS } from "@/constants/colors";
import { useOwnerColors } from "@/contexts/SettingsContext";
import type { HexTile } from "@/types";
import { HexCell } from "@/components/HexCell";
import {
  areHexTerrainLayerEqual,
  areHexTerritoryLayerEqual,
} from "@/components/layerEquality";

export interface HexTileTerrainLayerProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  HEX_SIZE: number;
}

function HexTileTerrainLayerInner({ tileData, HEX_SIZE }: HexTileTerrainLayerProps) {
  return (
    <>
      {tileData.map(({ tile, cx, cy }) => {
        const fill =
          tile.terrain === "lake"
            ? "#5BAFD6"
            : (TERRAIN_FILLS[tile.terrain] ?? TERRAIN_FILLS.grass);
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

export const HexTileTerrainLayer = React.memo(
  HexTileTerrainLayerInner,
  areHexTerrainLayerEqual,
);

export interface HexTileTerritoryLayerProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  activeTileMap: Map<string, HexTile>;
  cities: Set<string>;
  HEX_SIZE: number;
}

function HexTileTerritoryLayerInner({
  tileData,
  activeTileMap,
  cities,
  HEX_SIZE,
}: HexTileTerritoryLayerProps) {
  const { fills: TERRITORY_FILLS } = useOwnerColors();
  return (
    <>
      {tileData.map(({ tile, cx, cy }) => {
        const liveTile = activeTileMap.get(tile.key) ?? tile;
        const isCityZone = tile.cityBuffer || cities.has(tile.key);
        const liveOwner = liveTile.owner;
        const terrain = tile.terrain;
        // Lakes always keep the water fill (the water image overlays on top), even
        // when owned via a bridge: ownership reads through the owner-coloured
        // outer border drawn in BorderEdgeLayer, so the lake stays visibly water
        // instead of being painted solid with the owner colour.
        const fill =
          terrain === "lake"
            ? "#5BAFD6"
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

export const HexTileTerritoryLayer = React.memo(
  HexTileTerritoryLayerInner,
  areHexTerritoryLayerEqual,
);

// Legacy export kept so any remaining references compile without error.
export { areHexTerrainLayerEqual as areHexTileLayerEqual };
