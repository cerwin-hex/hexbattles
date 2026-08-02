import { ENTITY_META, IMPROVEMENTS, isRanged } from "@/utils/hexGrid";
import type { EntityType, ImprovementMeta, UnitClass } from "@/utils/hexGrid";
import {
  enabledUnitTypes,
  isEntityEnabled,
  type GameElements,
} from "@/constants/gameElements";
import type { EntityMeta } from "@/types";

export const BTN_H = 52;
export const TOP_BTN_H = 40;
export const BOTTOM_BAR_H = BTN_H + 20;
export const RIBBON_H = 130;
export const ENTITY_PANEL_H = 72;
export const EXTRA_PAN = 150;

export const ORDERED_EDGES: ReadonlyArray<{
  dir: [number, number];
  verts: [number, number];
}> = [
  { dir: [1, 0], verts: [0, 1] },
  { dir: [0, 1], verts: [1, 2] },
  { dir: [-1, 1], verts: [2, 3] },
  { dir: [-1, 0], verts: [3, 4] },
  { dir: [0, -1], verts: [4, 5] },
  { dir: [1, -1], verts: [5, 0] },
];

/**
 * Merge tables, one per unit track. Two units of the same track merge into the
 * unit whose tier equals the sum of theirs; a missing entry means the merge is
 * illegal. Keyed by tier rather than by strength so a track whose strengths do
 * not equal its tiers (ranged) merges correctly.
 */
export const TIER_TO_UNIT: Record<UnitClass, Record<number, EntityType>> = {
  infantry: { 1: "peasant", 2: "warrior", 3: "swordsman" },
  cavalry:  { 1: "scout",   2: "knight" },
  ranged:   { 1: "shortbowman", 2: "longbowman", 3: "crossbowman" },
};

// Memoized on the element object's identity, like `enabledUnitTypes`: the
// expert search asks for this list once per candidate-generation pass, and
// game.tsx builds exactly one element object per game.
const aiBuyableCache = new WeakMap<GameElements, EntityType[]>();

/**
 * The units the AI is allowed to buy — the single source of truth for the
 * scope constraint "the AI never buys ranged units". Two filters compose here:
 * the element set the player chose, and the ranged exclusion. Ranged units are
 * player-only for now: the AI has no ranged behaviour, so buying one would just
 * burn gold on a unit it never fires.
 *
 * Both AI buy lists derive from this — `aiUnitBuyOrder` in `logic/aiStrategy.ts`
 * and the buy candidates in `logic/aiExpert.ts` — so the filter cannot drift out
 * of step between the difficulty tiers. Callers that need a different order must
 * copy before sorting; sorting in place would scramble the memoized array.
 */
export function aiBuyableUnits(elements: GameElements): readonly EntityType[] {
  let cached = aiBuyableCache.get(elements);
  if (!cached) {
    cached = enabledUnitTypes(elements).filter((e) => !isRanged(e));
    aiBuyableCache.set(elements, cached);
  }
  return cached;
}

export type Purchasable = { id: EntityType } & EntityMeta;

export const PURCHASABLES: Purchasable[] = (Object.keys(ENTITY_META) as EntityType[])
  .filter((id) => id !== "rebel")
  .map((id) => ({
    id,
    ...ENTITY_META[id],
  }));

/** Everything buyable under the given element set. */
export function purchasablesFor(elements: GameElements): Purchasable[] {
  return PURCHASABLES.filter((p) => isEntityEnabled(p.id, elements));
}

export function unitPurchasablesFor(elements: GameElements): Purchasable[] {
  return purchasablesFor(elements).filter((p) => p.isUnit);
}

export function buildingPurchasablesFor(elements: GameElements): Purchasable[] {
  return purchasablesFor(elements).filter((p) => !p.isUnit);
}

/**
 * Improvements shown in the Build ribbon after the buildings. Improvements are
 * deliberately absent from ENTITY_META (they are terrain, not entities), so
 * they get their own list rather than being derived from PURCHASABLES.
 */
export function improvementPurchasablesFor(
  elements: GameElements,
): readonly ImprovementMeta[] {
  return elements.improvements ? IMPROVEMENTS : [];
}

/**
 * Rows shown in the "Units & Buildings" reference tables (welcome + rules modals).
 * Derived from ENTITY_META so any new entity appears automatically.
 */
export const INFO_TABLE_ROWS = PURCHASABLES.map((p) => ({
  id: p.id,
  name: p.name,
  cost: p.cost,
  upkeep: p.upkeep,
  offStrength: p.offStrength,
  defStrength: p.defStrength,
}));

/**
 * Entity types that carry upkeep, in display order, for the economy breakdown.
 * Derived from ENTITY_META; defense buildings scale separately at render time.
 */
export const ENTITY_UPKEEP_ORDER: EntityType[] = PURCHASABLES
  .filter((p) => p.upkeep > 0)
  .map((p) => p.id);
