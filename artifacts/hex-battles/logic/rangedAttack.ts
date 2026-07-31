import type { EntityType, HexTile, TerritoryOwner } from "@/types";
import { ENTITY_META, isRanged } from "@/utils/hexGrid";
import { HEX_EDGES, tileKey } from "@/utils/hexMath";

/**
 * Ranged combat: a bowman shoots one adjacent enemy per turn instead of taking
 * ground. A shot kills outright when the shooter's offense beats the target's
 * defense; a target it cannot kill is never offered, so there is no partial
 * result to resolve. Kept pure and state-free so both the tap handler and (in
 * a later branch) the AI can drive it.
 */

/**
 * The adjacent tiles `shooterKey` may legally shoot right now. Empty when the
 * unit is not ranged, or has already fired this turn.
 *
 * Legal targets are enemy units and rebels. Fortifications, cities and bridges
 * are not targets — a ranged unit cannot damage structures. Rebels count
 * whoever's ground they stand on, since a rebel belongs to nobody.
 */
export function rangedTargets(o: {
  shooterKey: string;
  owner: TerritoryOwner;
  entities: Map<string, EntityType>;
  tileMap: Map<string, HexTile>;
  firedUnits: Set<string>;
}): Set<string> {
  const out = new Set<string>();
  const shooter = o.entities.get(o.shooterKey);
  if (!shooter || !isRanged(shooter)) return out;
  if (o.firedUnits.has(o.shooterKey)) return out;

  const off = ENTITY_META[shooter].offStrength;
  const [q, r] = o.shooterKey.split(",").map(Number);
  for (const { dir: [dq, dr] } of HEX_EDGES) {
    const nk = tileKey(q + dq, r + dr);
    const tile = o.tileMap.get(nk);
    if (!tile) continue;
    const target = o.entities.get(nk);
    if (!target) continue;
    if (target !== "rebel") {
      if (!ENTITY_META[target].isUnit) continue;
      if (tile.owner === o.owner) continue;
    }
    if (off <= ENTITY_META[target].defStrength) continue;
    out.add(nk);
  }
  return out;
}

/**
 * Apply one shot. Returns fresh copies of the three collections it touches and
 * mutates nothing.
 *
 * Ownership and passability are deliberately untouched, which is what lets the
 * caller skip the territory recalculation, the single-hex penalty pass and the
 * win/loss check. Restoring the bridge under a victim killed on a lake tile is
 * part of that guarantee: without it the tile would stop counting as territory
 * and could split the victim's land.
 */
export function resolveRangedShot(o: {
  shooterKey: string;
  targetKey: string;
  entities: Map<string, EntityType>;
  tileMap: Map<string, HexTile>;
  killMarks: Set<string>;
  firedUnits: Set<string>;
}): {
  entities: Map<string, EntityType>;
  killMarks: Set<string>;
  firedUnits: Set<string>;
} {
  const entities = new Map(o.entities);
  const killMarks = new Set(o.killMarks);
  const firedUnits = new Set(o.firedUnits);

  entities.delete(o.targetKey);
  if (o.tileMap.get(o.targetKey)?.terrain === "lake") {
    entities.set(o.targetKey, "bridge");
  }
  killMarks.add(o.targetKey);
  firedUnits.add(o.shooterKey);

  return { entities, killMarks, firedUnits };
}
