import React from "react";
import { Polygon } from "react-native-svg";
import { TERRAIN_FILLS, TERRITORY_FILLS, CITY_NEUTRAL_FILL } from "@/constants/colors";
import { hexCornersString } from "@/utils/hexGrid";
import type { HexTile, TerritoryOwner } from "@/types";

interface HexCellProps {
  tileKey: string;
  terrain: HexTile["terrain"];
  cx: number;
  cy: number;
  hexSize: number;
  liveOwner: TerritoryOwner;
  hasSelection: boolean;
  isCityZone: boolean;
  cityBuffer: boolean;
}

function HexCellInner({
  tileKey,
  terrain,
  cx,
  cy,
  hexSize,
  liveOwner,
  hasSelection,
  isCityZone,
  cityBuffer,
}: HexCellProps) {
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
    <Polygon
      key={tileKey}
      points={hexCornersString(cx, cy, hexSize)}
      fill={fill}
    />
  );
}

function areEqual(prev: HexCellProps, next: HexCellProps): boolean {
  return (
    prev.tileKey === next.tileKey &&
    prev.terrain === next.terrain &&
    prev.cx === next.cx &&
    prev.cy === next.cy &&
    prev.hexSize === next.hexSize &&
    prev.liveOwner === next.liveOwner &&
    prev.hasSelection === next.hasSelection &&
    prev.isCityZone === next.isCityZone &&
    prev.cityBuffer === next.cityBuffer
  );
}

export const HexCell = React.memo(HexCellInner, areEqual);
