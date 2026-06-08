import React from "react";
import { Text, View } from "react-native";

export interface UnitTokenProps {
  /** Half the hex size; the token is a 2*r square (circle for units). */
  r: number;
  /** Emoji glyph from ENTITY_META. */
  icon: string;
  bgColor: string;
  borderColor: string;
  borderWidth: number;
  /** Buildings render as a rounded square instead of a circle. */
  square?: boolean;
  opacity?: number;
}

/**
 * Shared visual for a unit/building token (background + emoji glyph).
 *
 * IMPORTANT: This is the single render path for every unit glyph, so a unit
 * looks identical regardless of state (idle, spent, selected) or owner.
 * Previously idle player units were drawn with an RN <Text> while spent/AI
 * units were drawn with an SVG <Text>; the SVG stroke straddles the circle
 * path (outer diameter 2r + strokeWidth) and the two text engines render the
 * same emoji at different sizes, so units visibly changed size when spent.
 * Keep all callers routing through this component to prevent that drift.
 */
export function UnitToken({
  r,
  icon,
  bgColor,
  borderColor,
  borderWidth,
  square = false,
  opacity = 1,
}: UnitTokenProps) {
  return (
    <View
      style={{
        width: r * 2,
        height: r * 2,
        borderRadius: square ? 4 : r,
        backgroundColor: bgColor,
        borderWidth,
        borderColor,
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      {/*
       * GLYPH_SCALE calibrates the emoji to the larger size units used to have
       * when spent/AI units were drawn with SVG <Text>. RN <Text> renders the
       * same emoji smaller than react-native-svg at an identical fontSize, so
       * we scale up here. Tweak this single factor to resize every unit glyph.
       */}
      <Text style={{ fontSize: r * 1.45, lineHeight: r * 1.95 }}>{icon}</Text>
    </View>
  );
}
