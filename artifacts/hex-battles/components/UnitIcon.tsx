import React from "react";
import { parse, SvgAst } from "react-native-svg";
import type { EntityType } from "@/types";

/**
 * Inline SVG markup for every unit/building plus the coin/skull/ruin markers —
 * the single icon source for board tokens, the purchase ribbon, the reference
 * tables, the economy ledger, the HUD gold counter and the battlefield
 * graves/ruins. These replace the game's former emoji glyphs entirely.
 *
 * The source art lives in assets/icons/*.svg. There is no
 * react-native-svg-transformer configured, so the markup is inlined as strings
 * and rendered through SvgXml rather than imported from the .svg files.
 *
 * Each icon is a 64x64 viewBox drawn as two passes of the same body: a thick
 * dark stroke underlay followed by the filled shapes on top. (The source files
 * express this with `<use href="#g">`, which react-native-svg does not render
 * reliably, so we emit both passes literally from one shared body string.)
 */
function withOutline(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<g stroke="#2B2118" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${body}</g>` +
    `<g>${body}</g>` +
    `</svg>`
  );
}

const PEASANT_BODY = `<g transform="rotate(28 32 32)"><g transform="scale(-1 1) translate(-64 0)">
  <polygon points="31,8 36,9 29,58 24,57" fill="#7A4A28"></polygon>
  <path d="M33 7 Q60 11 63 38 Q47 16 32 15 Z" fill="#C7CDD4"></path>
  <rect x="29" y="10" width="8" height="5" rx="2" fill="#D6A23E" transform="rotate(8 33 12.5)"></rect>
  </g></g>`;

const WARRIOR_BODY = `<g transform="translate(10 0)">
  <path d="M32 1 L36.5 9 V40 H27.5 V9 Z" fill="#C7CDD4"></path>
  <rect x="21" y="39" width="22" height="5" rx="2.5" fill="#D6A23E"></rect>
  <rect x="29" y="44" width="6" height="10" fill="#7A4A28"></rect>
  <circle cx="32" cy="57.5" r="4" fill="#D6A23E"></circle>
  </g>
  <circle cx="22" cy="38" r="14.5" fill="#9A6B3F"></circle>
  <circle cx="22" cy="38" r="14.5" fill="none" stroke="#6B4423" stroke-width="3.5"></circle>
  <circle cx="22" cy="38" r="4.5" fill="#877E6F"></circle>`;

const SWORDSMAN_BODY = `<g transform="rotate(-45 32 32)">
  <path d="M32 1 L36.5 9 V40 H27.5 V9 Z" fill="#9AA3AD"></path>
  <rect x="21" y="39" width="22" height="5" rx="2.5" fill="#B8893A"></rect>
  <rect x="29" y="44" width="6" height="10" fill="#5C3A1E"></rect>
  <circle cx="32" cy="57.5" r="4" fill="#B8893A"></circle>
  </g>
  <g transform="rotate(45 32 32)">
  <path d="M32 1 L36.5 9 V40 H27.5 V9 Z" fill="#C7CDD4"></path>
  <rect x="21" y="39" width="22" height="5" rx="2.5" fill="#D6A23E"></rect>
  <rect x="29" y="44" width="6" height="10" fill="#7A4A28"></rect>
  <circle cx="32" cy="57.5" r="4" fill="#D6A23E"></circle>
  </g>`;

const SCOUT_BODY = `<path d="M32 6 Q52 6 52 30 Q52 44 45 54 L36 50 Q43 42 43 30 Q43 15 32 15 Q21 15 21 30 Q21 42 28 50 L19 54 Q12 44 12 30 Q12 6 32 6 Z" fill="#C7CDD4"></path>
  <path d="M32 6 Q52 6 52 30 Q52 44 45 54 L40.5 52 Q47 42 47 28 Q46 10 32 10 Z" fill="#AEB6BE"></path>
  <g fill="#2B2118">
  <circle cx="18" cy="22" r="2.2"></circle>
  <circle cx="46" cy="22" r="2.2"></circle>
  <circle cx="16.5" cy="34" r="2.2"></circle>
  <circle cx="47.5" cy="34" r="2.2"></circle>
  <circle cx="21.5" cy="46" r="2.2"></circle>
  <circle cx="42.5" cy="46" r="2.2"></circle>
  </g>`;

const KNIGHT_BODY = `<path d="M17 30 Q17 8 32 8 Q47 8 47 30 V55 H17 Z" fill="#C7CDD4"></path>
  <path d="M32 8 Q47 8 47 30 V55 H32 Z" fill="#AEB6BE"></path>
  <rect x="17" y="27" width="30" height="5.5" fill="#2B2118"></rect>
  <rect x="29.25" y="32.5" width="5.5" height="14" fill="#2B2118"></rect>
  <rect x="17" y="50" width="30" height="5" fill="#D6A23E"></rect>`;

const TOWER_BODY = `<g fill="#9C937F">
  <rect x="19" y="7" width="7.5" height="13"></rect>
  <rect x="28.25" y="7" width="7.5" height="13"></rect>
  <rect x="37.5" y="7" width="7.5" height="13"></rect>
  </g>
  <rect x="21" y="18" width="22" height="36" fill="#B5AC9C"></rect>
  <rect x="16" y="52" width="32" height="6" rx="1.5" fill="#877E6F"></rect>
  <rect x="29" y="27" width="6" height="13" rx="3" fill="#2B2118"></rect>`;

const CASTLE_BODY = `<rect x="22" y="26" width="20" height="30" fill="#9C937F"></rect>
  <g fill="#877E6F">
  <rect x="24" y="20" width="4.5" height="7"></rect>
  <rect x="29.75" y="20" width="4.5" height="7"></rect>
  <rect x="35.5" y="20" width="4.5" height="7"></rect>
  </g>
  <g fill="#B5AC9C">
  <rect x="10" y="14" width="12" height="42"></rect>
  <rect x="42" y="14" width="12" height="42"></rect>
  <rect x="9" y="8" width="5" height="7"></rect>
  <rect x="17" y="8" width="5" height="7"></rect>
  <rect x="42" y="8" width="5" height="7"></rect>
  <rect x="50" y="8" width="5" height="7"></rect>
  </g>
  <path d="M27 56 V45 Q27 39 32 39 Q37 39 37 45 V56 Z" fill="#2B2118"></path>
  <rect x="14" y="24" width="4" height="9" rx="2" fill="#2B2118"></rect>
  <rect x="46" y="24" width="4" height="9" rx="2" fill="#2B2118"></rect>`;

const BRIDGE_BODY = `<path d="M8 29 V52 H16 V46 Q16 34 32 34 Q48 34 48 46 V52 H56 V29 Z" fill="#877E6F"></path>
  <rect x="4" y="22" width="56" height="8" fill="#B5AC9C"></rect>
  <rect x="4" y="16" width="56" height="5" rx="2" fill="#9C937F"></rect>`;

const REBEL_BODY = `<g transform="rotate(-35 32 32)">
  <rect x="30" y="20" width="4.5" height="38" rx="2" fill="#6B4423"></rect>
  <g fill="#9AA3AD">
  <rect x="21" y="7" width="4.5" height="14" rx="2.25"></rect>
  <rect x="30" y="7" width="4.5" height="14" rx="2.25"></rect>
  <rect x="39" y="7" width="4.5" height="14" rx="2.25"></rect>
  </g>
  <rect x="21" y="18.5" width="22.5" height="4.5" rx="2" fill="#877E6F"></rect>
  </g>
  <g transform="rotate(35 32 32)">
  <rect x="29.75" y="17" width="4.5" height="41" rx="2" fill="#7A4A28"></rect>
  <rect x="27" y="14.5" width="10" height="6" rx="2" fill="#5C3A1E"></rect>
  <path d="M32 0 Q34.5 3.5 38.5 6.5 Q42.5 11 40.5 15.5 Q38.5 19.5 32 19.5 Q25.5 19.5 23.5 15.5 Q21.5 11 25.5 6.5 Q29.5 3.5 32 0 Z" fill="#D98E32"></path>
  <path d="M32 7.5 Q36 11 35.3 14.5 Q34.6 17 32 17 Q29.4 17 28.7 14.5 Q28 11 32 7.5 Z" fill="#E5C05A"></path>
  </g>`;

const CITY_BODY = `<rect x="29" y="26" width="12" height="11" fill="#D6C8A8"></rect>
  <path d="M25 28 L35 17 L45 28 Z" fill="#8F3624"></path>
  <rect x="11" y="33" width="26" height="23" fill="#E8DCC0"></rect>
  <path d="M7 35 L24 19 L41 35 Z" fill="#A8402C"></path>
  <rect x="37" y="40" width="18" height="16" fill="#E8DCC0"></rect>
  <path d="M33 42 L46 30 L59 42 Z" fill="#8F3624"></path>
  <rect x="19" y="42" width="8" height="14" fill="#5C3A1E"></rect>
  <rect x="43" y="44" width="6" height="6" fill="#5C3A1E"></rect>`;

export const UNIT_ICON_SVG: Record<EntityType, string> = {
  peasant: withOutline(PEASANT_BODY),
  warrior: withOutline(WARRIOR_BODY),
  swordsman: withOutline(SWORDSMAN_BODY),
  scout: withOutline(SCOUT_BODY),
  knight: withOutline(KNIGHT_BODY),
  tower: withOutline(TOWER_BODY),
  castle: withOutline(CASTLE_BODY),
  bridge: withOutline(BRIDGE_BODY),
  rebel: withOutline(REBEL_BODY),
  city: withOutline(CITY_BODY),
};

const MONEY_BODY = `<circle cx="39" cy="24" r="13.5" fill="#C49232"></circle>
  <circle cx="39" cy="24" r="8.5" fill="none" stroke="#9C742C" stroke-width="2.5"></circle>
  <circle cx="25" cy="39" r="14.5" fill="#D6A23E" stroke="#2B2118" stroke-width="1.5"></circle>
  <circle cx="25" cy="39" r="9.5" fill="none" stroke="#B8893A" stroke-width="2.5"></circle>`;

const SKULL_BODY = `<g fill="#D6C8A8">
  <g transform="rotate(35 32 32)">
  <rect x="6" y="29.5" width="52" height="5" rx="2.5"></rect>
  <circle cx="7" cy="29" r="3.2"></circle>
  <circle cx="7" cy="35" r="3.2"></circle>
  <circle cx="57" cy="29" r="3.2"></circle>
  <circle cx="57" cy="35" r="3.2"></circle>
  </g>
  <g transform="rotate(-35 32 32)">
  <rect x="6" y="29.5" width="52" height="5" rx="2.5"></rect>
  <circle cx="7" cy="29" r="3.2"></circle>
  <circle cx="7" cy="35" r="3.2"></circle>
  <circle cx="57" cy="29" r="3.2"></circle>
  <circle cx="57" cy="35" r="3.2"></circle>
  </g>
  </g>
  <path d="M15 26 Q15 9 32 9 Q49 9 49 26 Q49 35 42 38 H22 Q15 35 15 26 Z" fill="#E8DCC0"></path>
  <path d="M32 9 Q49 9 49 26 Q49 35 42 38 H32 Z" fill="#D6C8A8"></path>
  <rect x="24" y="37" width="16" height="12" rx="3.5" fill="#E8DCC0"></rect>
  <circle cx="25.5" cy="26.5" r="4.8" fill="#2B2118"></circle>
  <circle cx="38.5" cy="26.5" r="4.8" fill="#2B2118"></circle>
  <path d="M32 30.5 L29.3 36 H34.7 Z" fill="#2B2118"></path>
  <rect x="29" y="42.5" width="2.2" height="6.5" rx="1.1" fill="#2B2118"></rect>
  <rect x="33" y="42.5" width="2.2" height="6.5" rx="1.1" fill="#2B2118"></rect>`;

const RUIN_BODY = `<polygon points="16,56 16,26 21,29 21,19 27,23 30,14 33,17 33,56" fill="#B5AC9C"></polygon>
  <polygon points="33,56 33,36 39,32 41,40 48,37 48,56" fill="#9C937F"></polygon>
  <rect x="21" y="34" width="6" height="9" rx="2.5" fill="#2B2118"></rect>
  <rect x="36" y="48" width="7" height="6" rx="1.5" fill="#877E6F"></rect>
  <circle cx="49" cy="53.5" r="3.5" fill="#877E6F"></circle>
  <circle cx="12" cy="54" r="2.5" fill="#877E6F"></circle>`;

/** Coin/gold marker — replaces the former coin emoji in the HUD. */
export const MONEY_ICON_SVG = withOutline(MONEY_BODY);
/** Battlefield grave marker — replaces the former skull emoji. */
export const SKULL_ICON_SVG = withOutline(SKULL_BODY);
/** Razed-building marker — replaces the former ruin emoji. */
export const RUIN_ICON_SVG = withOutline(RUIN_BODY);

// SvgXml runs parse(xml) inside a per-instance useMemo, so it re-parses the
// whole icon string every time a fresh token mounts — and a unit move mounts two
// fresh tokens (the flying token at move-start, the landed idle token at
// move-end), each re-parsing on the JS thread mid-animation. Memoizing the icon
// components below doesn't help those mounts because the useMemo is brand new.
//
// Instead we parse each icon's XML exactly once at module load into the AST that
// SvgXml would otherwise build per mount, then render it through SvgAst (the same
// component SvgXml delegates to internally). Width/height are applied per render
// via `override`, exactly as SvgXml passes them. The AST is immutable React-side,
// so the single parsed tree is safely shared across every token on the board.
const UNIT_ICON_AST: Record<EntityType, ReturnType<typeof parse>> =
  Object.fromEntries(
    (Object.keys(UNIT_ICON_SVG) as EntityType[]).map((id) => [
      id,
      parse(UNIT_ICON_SVG[id]),
    ]),
  ) as Record<EntityType, ReturnType<typeof parse>>;

const MONEY_ICON_AST = parse(MONEY_ICON_SVG);
const SKULL_ICON_AST = parse(SKULL_ICON_SVG);
const RUIN_ICON_AST = parse(RUIN_ICON_SVG);

/** Renders a unit/building icon at the given pixel size. */
export const UnitIcon = React.memo(function UnitIcon({
  entityId,
  size,
}: {
  entityId: EntityType;
  size: number;
}) {
  return (
    <SvgAst ast={UNIT_ICON_AST[entityId]} override={{ width: size, height: size }} />
  );
});

/** Renders the coin/gold icon at the given pixel size. */
export const CoinIcon = React.memo(function CoinIcon({ size }: { size: number }) {
  return <SvgAst ast={MONEY_ICON_AST} override={{ width: size, height: size }} />;
});

/** Renders the battlefield grave (skull) icon at the given pixel size. */
export const SkullIcon = React.memo(function SkullIcon({ size }: { size: number }) {
  return <SvgAst ast={SKULL_ICON_AST} override={{ width: size, height: size }} />;
});

/** Renders the razed-building (ruin) icon at the given pixel size. */
export const RuinIcon = React.memo(function RuinIcon({ size }: { size: number }) {
  return <SvgAst ast={RUIN_ICON_AST} override={{ width: size, height: size }} />;
});
