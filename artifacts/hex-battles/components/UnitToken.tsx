import React from "react";
import { View } from "react-native";
import { UnitIcon } from "@/components/UnitIcon";
import { ENTITY_META } from "@/utils/hexGrid";
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

/** Dark outline drawn around the player-coloured disc (matches the icon ink). */
const RING_OUTLINE_COLOR = "#2B2118";

/**
 * Outline thickness scales with unit strength so stronger units read as more
 * heavily armoured: str 1 → 1.0, str 2 → 1.5, str 3 → 2.0. Non-unit discs
 * (e.g. the rebel marker) fall back to the str-1 weight.
 */
function ringOutlineWidth(entityId: EntityType): number {
  const meta = ENTITY_META[entityId];
  return meta.isUnit ? 0.5 + meta.strength * 0.5 : 1.0;
}

/**
 * How far the disc fill is mixed toward white relative to the raw owner colour
 * (0 = owner colour as-is, 1 = white). The owner colour is now the (darker) fill
 * colour rather than the old lighter border variant, so this is tuned higher
 * (~0.42, was 0.22) to keep unit discs about as bright as before — a least-fit
 * across the palette put the matching amount near 0.40.
 */
const DISC_LIGHTEN = 0.42;

/** Mix a #rrggbb colour toward white by `amount` (0..1). Non-hex inputs pass through. */
function lighten(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

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
        borderWidth: ringOutlineWidth(entityId),
        borderColor: RING_OUTLINE_COLOR,
        backgroundColor: lighten(borderColor, DISC_LIGHTEN),
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
