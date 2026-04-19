import React from "react";
import { G, Text as SvgText } from "react-native-svg";
import type { EntityType } from "@/types";

export interface GraveyardLayerProps {
  graveyard: Set<string>;
  ruins: Set<string>;
  entities: Map<string, EntityType>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

function GraveyardLayerInner({
  graveyard,
  ruins,
  entities,
  tileDataMap,
  HEX_SIZE,
}: GraveyardLayerProps) {
  const fs = HEX_SIZE * 0.7;
  return (
    <G>
      {graveyard.size > 0 &&
        Array.from(graveyard).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          if (entities.has(key)) return null;
          return (
            <SvgText
              key={`grave-${key}`}
              x={pos.cx}
              y={pos.cy + fs * 0.38}
              textAnchor="middle"
              fontSize={fs}
              opacity={0.85}
            >
              ☠️
            </SvgText>
          );
        })}
      {ruins.size > 0 &&
        Array.from(ruins).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          if (entities.has(key)) return null;
          return (
            <SvgText
              key={`ruin-${key}`}
              x={pos.cx}
              y={pos.cy + fs * 0.38}
              textAnchor="middle"
              fontSize={fs}
              opacity={0.85}
            >
              🏚️
            </SvgText>
          );
        })}
    </G>
  );
}

// Reference equality is safe here because game state always replaces Set/Map
// instances (never mutates in place), so a changed reference means changed data.
function areGraveyardLayerEqual(
  prev: GraveyardLayerProps,
  next: GraveyardLayerProps,
): boolean {
  return (
    prev.graveyard === next.graveyard &&
    prev.ruins === next.ruins &&
    prev.entities === next.entities &&
    prev.tileDataMap === next.tileDataMap &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

export const GraveyardLayer = React.memo(
  GraveyardLayerInner,
  areGraveyardLayerEqual,
);
