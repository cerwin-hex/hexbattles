import React from "react";
import {
  ClipPath,
  Defs,
  G,
  Image as SvgImage,
  Polygon,
} from "react-native-svg";
import { hexCornersString } from "@/utils/hexMath";
import type { HexTile } from "@/types";

const MOUNTAIN_IMG = require("../assets/images/mountain.webp");

export interface MountainImageLayerProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  HEX_SIZE: number;
}

function MountainImageLayerInner({
  tileData,
  HEX_SIZE,
}: MountainImageLayerProps) {
  const mountainTiles = tileData.filter(
    ({ tile }) => tile.terrain === "mountain",
  );
  const s = HEX_SIZE * 2;
  return (
    <>
      <Defs>
        {mountainTiles.map(({ tile, cx, cy }) => (
          <ClipPath key={`mclip-def-${tile.key}`} id={`mclip-${tile.key}`}>
            <Polygon points={hexCornersString(cx, cy, HEX_SIZE)} />
          </ClipPath>
        ))}
      </Defs>
      <G>
        {mountainTiles.map(({ tile, cx, cy }) => (
          <SvgImage
            key={`mtn-${tile.key}`}
            href={MOUNTAIN_IMG}
            x={cx - HEX_SIZE}
            y={cy - HEX_SIZE}
            width={s}
            height={s}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#mclip-${tile.key})`}
          />
        ))}
      </G>
    </>
  );
}

// Reference equality is safe here: tileData is a stable memoized array that
// is only replaced when the board layout or HEX_SIZE changes, not on every
// state update.
function areMountainImageLayerEqual(
  prev: MountainImageLayerProps,
  next: MountainImageLayerProps,
): boolean {
  return prev.tileData === next.tileData && prev.HEX_SIZE === next.HEX_SIZE;
}

export const MountainImageLayer = React.memo(
  MountainImageLayerInner,
  areMountainImageLayerEqual,
);
