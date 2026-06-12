import React from "react";
import { View } from "react-native";
import { UnitIcon } from "@/components/UnitIcon";
import type { EntityType } from "@/types";

export interface UnitTokenProps {
  /** Half the hex size; the token box is 2*r (a circle for units). */
  r: number;
  /** Entity whose SVG icon is rendered (from UNIT_ICON_SVG). */
  entityId: EntityType;
  /** Owner/state colour — fills the whole unit disc. */
  borderColor: string;
  /** Unused for the filled-disc style; kept for caller API compatibility. */
  borderWidth?: number;
  /**
   * Buildings render as the bare icon with no disc; units (and the rebel
   * marker) get a solid player-coloured disc, with the icon sized large so it
   * reaches toward the outline.
   */
  isBuilding?: boolean;
  opacity?: number;
}

/**
 * Shared visual for a unit/building token (icon, plus a coloured ring for
 * units — no background fill).
 *
 * IMPORTANT: This is the single render path for every unit icon, so a unit
 * looks identical regardless of state (idle, spent, selected) or owner. Keep
 * all callers routing through this component so tokens never drift in size
 * between states.
 */
/**
 * ICON_SCALE is the single knob for icon size, as a fraction of the token
 * radius (r). Buildings have no circle so their icon fills more of the token;
 * units stay inside the circle. Tweak these two constants to resize every
 * unit/building icon at once.
 */
const UNIT_ICON_SCALE = 1.75;
const BUILDING_ICON_SCALE = 1.95;

/** Thin dark outline drawn around the player-coloured disc (matches the icon ink). */
const RING_OUTLINE_WIDTH = 0.75;
const RING_OUTLINE_COLOR = "#2B2118";

function UnitTokenInner({
  r,
  entityId,
  borderColor,
  isBuilding = false,
  opacity = 1,
}: UnitTokenProps) {
  const iconSize = r * (isBuilding ? BUILDING_ICON_SCALE : UNIT_ICON_SCALE);

  // Buildings render as the bare icon — no ring, full icon, unclipped.
  if (isBuilding) {
    return (
      <View
        style={{
          width: r * 2,
          height: r * 2,
          alignItems: "center",
          justifyContent: "center",
          overflow: "visible",
          opacity,
        }}
      >
        <UnitIcon entityId={entityId} size={iconSize} />
      </View>
    );
  }

  // Units/rebels: a solid player-coloured disc wrapped in a thin dark outline.
  // The whole circle carries the owner colour (no inner ring); the icon is sized
  // large so it reaches out toward the outline. overflow:hidden clips rotated art
  // (swords, banners) so it can't spill past the disc edge.
  return (
    <View
      style={{
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        borderWidth: RING_OUTLINE_WIDTH,
        borderColor: RING_OUTLINE_COLOR,
        backgroundColor: borderColor,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity,
      }}
    >
      <UnitIcon entityId={entityId} size={iconSize} />
    </View>
  );
}

/**
 * Memoized: a unit/building token only re-renders when its own props change.
 * This keeps a single unit's move (which replaces the entities/spentUnits Sets
 * and re-renders the entity layers) from reconciling every other token's SVG
 * subtree, which would otherwise cause a one-frame hitch at the start of a move.
 */
export const UnitToken = React.memo(UnitTokenInner);
