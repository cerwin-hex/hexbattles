import { ENTITY_META } from "@/utils/hexGrid";
import type { EntityType } from "@/utils/hexGrid";

export const BTN_H = 52;
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
  1: "simple_unit",
  2: "advanced_unit",
  3: "expert_unit",
};

export const PURCHASABLES = (Object.keys(ENTITY_META) as EntityType[])
  .filter((id) => id !== "rebel")
  .map((id) => ({
    id,
    ...ENTITY_META[id],
  }));

export const UNIT_PURCHASABLES = PURCHASABLES.filter((p) => p.isUnit);
export const BUILDING_PURCHASABLES = PURCHASABLES.filter((p) => !p.isUnit);
