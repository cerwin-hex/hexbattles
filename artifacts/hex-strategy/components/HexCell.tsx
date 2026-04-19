import React from "react";
import { Polygon } from "react-native-svg";
import { hexCornersString } from "@/utils/hexGrid";

interface HexCellProps {
  tileKey: string;
  cx: number;
  cy: number;
  hexSize: number;
  fill: string;
}

function HexCellInner({ tileKey, cx, cy, hexSize, fill }: HexCellProps) {
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
    prev.cx === next.cx &&
    prev.cy === next.cy &&
    prev.hexSize === next.hexSize &&
    prev.fill === next.fill
  );
}

export const HexCell = React.memo(HexCellInner, areEqual);
