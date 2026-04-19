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

const WATER_IMG = require("../assets/images/water.webp");

export interface LakeImageLayerProps {
  tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
  HEX_SIZE: number;
}

function LakeImageLayerInner({ tileData, HEX_SIZE }: LakeImageLayerProps) {
  const lakeTiles = tileData.filter(({ tile }) => tile.terrain === "lake");
  const s = HEX_SIZE * 2;
  return (
    <>
      <Defs>
        {lakeTiles.map(({ tile, cx, cy }) => (
          <ClipPath key={`clip-def-${tile.key}`} id={`lclip-${tile.key}`}>
            <Polygon points={hexCornersString(cx, cy, HEX_SIZE)} />
          </ClipPath>
        ))}
      </Defs>
      <G>
        {lakeTiles.map(({ tile, cx, cy }) => (
          <SvgImage
            key={`lake-img-${tile.key}`}
            href={WATER_IMG}
            x={cx - HEX_SIZE}
            y={cy - HEX_SIZE}
            width={s}
            height={s}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#lclip-${tile.key})`}
          />
        ))}
      </G>
    </>
  );
}

// Reference equality is safe here: tileData is a stable memoized array that
// is only replaced when the board layout or HEX_SIZE changes, not on every
// state update.
function areLakeImageLayerEqual(
  prev: LakeImageLayerProps,
  next: LakeImageLayerProps,
): boolean {
  return prev.tileData === next.tileData && prev.HEX_SIZE === next.HEX_SIZE;
}

export const LakeImageLayer = React.memo(
  LakeImageLayerInner,
  areLakeImageLayerEqual,
);
