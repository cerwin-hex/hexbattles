import React from "react";
import { StyleSheet, View } from "react-native";
import { RuinIcon, SkullIcon } from "@/components/UnitIcon";
import type { EntityType } from "@/types";

export interface GraveyardLayerProps {
  graveyard: Set<string>;
  ruins: Set<string>;
  entities: Map<string, EntityType>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  HEX_SIZE: number;
}

/**
 * Battlefield graves (skulls) and razed buildings (ruins) render as absolutely
 * positioned icon overlays — the same RN-View overlay pattern as the unit and
 * city layers — replacing the former skull / ruin emoji glyphs drawn as SVG text.
 */
function GraveyardLayerInner({
  graveyard,
  ruins,
  entities,
  tileDataMap,
  HEX_SIZE,
}: GraveyardLayerProps) {
  const size = HEX_SIZE * 0.9;
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {graveyard.size > 0 &&
        Array.from(graveyard).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          if (entities.has(key)) return null;
          return (
            <View
              key={`grave-${key}`}
              style={{
                position: "absolute",
                left: pos.cx - size / 2,
                top: pos.cy - size / 2,
                opacity: 0.85,
              }}
            >
              <SkullIcon size={size} />
            </View>
          );
        })}
      {ruins.size > 0 &&
        Array.from(ruins).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          if (entities.has(key)) return null;
          return (
            <View
              key={`ruin-${key}`}
              style={{
                position: "absolute",
                left: pos.cx - size / 2,
                top: pos.cy - size / 2,
                opacity: 0.85,
              }}
            >
              <RuinIcon size={size} />
            </View>
          );
        })}
    </View>
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
