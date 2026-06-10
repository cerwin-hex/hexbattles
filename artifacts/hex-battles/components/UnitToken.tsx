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
/**
 * GLYPH_SCALE is the single knob for glyph size, as a fraction of the token
 * diameter (2r). Units fill more of the circle; buildings stay deliberately
 * smaller inside their rounded square. Tweak these two constants to resize
 * every unit/building glyph at once.
 */
const UNIT_GLYPH_SCALE = 1.15;
const BUILDING_GLYPH_SCALE = 0.9;

export function UnitToken({
  r,
  icon,
  bgColor,
  borderColor,
  borderWidth,
  square = false,
  opacity = 1,
}: UnitTokenProps) {
  const fontSize = r * (square ? BUILDING_GLYPH_SCALE : UNIT_GLYPH_SCALE);
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
       * Centering: keep lineHeight == fontSize and disable Android's font
       * padding so the emoji's line box has no asymmetric top/bottom bias —
       * otherwise the glyph baseline-positions low and looks crooked inside
       * the circle. The parent View handles horizontal+vertical centering.
       */}
      <Text
        style={{
          fontSize,
          lineHeight: fontSize,
          textAlign: "center",
          textAlignVertical: "center",
          includeFontPadding: false,
        }}
      >
        {icon}
      </Text>
    </View>
  );
}
