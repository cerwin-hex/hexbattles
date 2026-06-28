import { ENTITY_META } from "@/utils/hexGrid";
import type { EntityType } from "@/utils/hexGrid";

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

export const STRENGTH_TO_UNIT: Record<number, EntityType> = {
  1: "peasant",
  2: "warrior",
  3: "swordsman",
};

// Cavalry merge track, parallel to STRENGTH_TO_UNIT. Cavalry keeps its own
// upgrade line, so two scouts (strength 1) merge into a knight (strength 2)
// rather than collapsing into an infantry unit. There is no strength-3 cavalry,
// so only scout + scout is a valid cavalry merge.
export const STRENGTH_TO_CAVALRY: Record<number, EntityType> = {
  1: "scout",
  2: "knight",
};

export const PURCHASABLES = (Object.keys(ENTITY_META) as EntityType[])
  .filter((id) => id !== "rebel")
  .map((id) => ({
    id,
    ...ENTITY_META[id],
  }));

export const UNIT_PURCHASABLES = PURCHASABLES.filter((p) => p.isUnit);
export const BUILDING_PURCHASABLES = PURCHASABLES.filter((p) => !p.isUnit);

/**
 * Rows shown in the "Units & Buildings" reference tables (welcome + rules modals).
 * Derived from ENTITY_META so any new entity appears automatically.
 */
export const INFO_TABLE_ROWS = PURCHASABLES.map((p) => ({
  id: p.id,
  name: p.name,
  cost: p.cost,
  upkeep: p.upkeep,
  strength: p.strength,
}));

/**
 * Entity types that carry upkeep, in display order, for the economy breakdown.
 * Derived from ENTITY_META; defense buildings scale separately at render time.
 */
export const ENTITY_UPKEEP_ORDER: EntityType[] = PURCHASABLES
  .filter((p) => p.upkeep > 0)
  .map((p) => p.id);
