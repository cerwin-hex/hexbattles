import React from "react";
import { StyleSheet, View } from "react-native";
import {
  EmojiGlyph,
  KILL_MARK_EMOJI,
  RuinIcon,
  SkullIcon,
} from "@/components/UnitIcon";
import {
  areGraveyardLayerEqual,
  type GraveyardLayerEqualProps,
} from "@/components/layerEquality";

// The prop list lives with the equality function it is compared by, so a new
// prop cannot be added without deciding how the memo compares it.
export type GraveyardLayerProps = GraveyardLayerEqualProps;

/**
 * Battlefield graves (skulls), razed buildings (ruins) and ranged kill marks
 * render as absolutely positioned icon overlays — the same RN-View overlay
 * pattern as the unit and city layers — replacing the former skull / ruin emoji
 * glyphs drawn as SVG text.
 */
function GraveyardLayerInner({
  graveyard,
  ruins,
  killMarks,
  entities,
  tileDataMap,
  HEX_SIZE,
}: GraveyardLayerProps) {
  const size = HEX_SIZE * 1.2;
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
      {killMarks.size > 0 &&
        Array.from(killMarks).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          if (entities.has(key)) return null;
          return (
            <View
              key={`kill-${key}`}
              style={{
                position: "absolute",
                left: pos.cx - size / 2,
                top: pos.cy - size / 2,
                opacity: 0.85,
              }}
            >
              <EmojiGlyph glyph={KILL_MARK_EMOJI} size={size} />
            </View>
          );
        })}
    </View>
  );
}

export const GraveyardLayer = React.memo(
  GraveyardLayerInner,
  areGraveyardLayerEqual,
);
