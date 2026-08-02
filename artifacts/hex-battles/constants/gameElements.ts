import type { EntityType } from "@/types";
import { ENTITY_META } from "@/utils/hexGrid";

/**
 * The parts of the game a player can switch on or off before a new game.
 *
 * Adding an element is two edits: one member in this union and one entry in
 * GAME_ELEMENTS. Everything else — the menu list, persistence, normalization —
 * derives from the registry. Features living on an unmerged branch add their
 * own entry when they merge, so this file never carries dead ids.
 */
export type GameElementId =
  | "mounted"
  | "ranged"
  | "improvements"
  | "adminBurden"
  | "rebels";

export interface GameElementDef {
  id: GameElementId;
  /** Row title in the menu. */
  name: string;
  /** One-line explanation shown under the title. */
  blurb: string;
  /**
   * An unfinished element. It is listed like any other, but carries a BETA
   * label and starts switched off, so nobody meets it without choosing to.
   */
  beta: boolean;
}

export const GAME_ELEMENTS: readonly GameElementDef[] = [
  {
    id: "mounted",
    name: "Mounted Units",
    blurb: "Scouts and knights that ride far and strike on the move",
    beta: false,
  },
  {
    // Beta: the shooting rules are playable but unbalanced, and no AI
    // difficulty knows how to buy or fire a bowman yet, so a game with ranged
    // units on is a game the AI plays a unit track short.
    id: "ranged",
    name: "Ranged Units",
    blurb: "Bowmen that shoot a neighbour instead of taking ground",
    beta: true,
  },
  {
    id: "improvements",
    name: "Improvements",
    blurb: "Fields, sawmills and mines that raise a tile's income",
    beta: false,
  },
  {
    id: "adminBurden",
    name: "Administrative Burden",
    blurb: "Territories above 20 tiles pay extra upkeep",
    beta: false,
  },
  {
    id: "rebels",
    name: "Rebels",
    blurb: "Uprisings from battle sites and restless land",
    beta: false,
  },
];

export type GameElements = Record<GameElementId, boolean>;

function build(
  defs: readonly GameElementDef[],
  pick: (def: GameElementDef) => boolean,
): GameElements {
  const out = {} as GameElements;
  for (const def of defs) out[def.id] = pick(def);
  return out;
}

/** Every shipped element on, every beta element off. */
export const DEFAULT_GAME_ELEMENTS: GameElements = build(GAME_ELEMENTS, (d) => !d.beta);

/** The full rule set. Used by self-play, by tests, and as the default wherever
 *  an element set is an optional argument. */
export const ALL_GAME_ELEMENTS: GameElements = build(GAME_ELEMENTS, () => true);

/**
 * Repair anything that claims to be an element set: fills missing ids from the
 * defaults, drops unknown ids, ignores non-boolean values. Never throws — a
 * corrupt set must never block starting or resuming a game.
 */
export function normalizeGameElements(raw: unknown): GameElements {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return build(GAME_ELEMENTS, (d) =>
    typeof src[d.id] === "boolean" ? (src[d.id] as boolean) : DEFAULT_GAME_ELEMENTS[d.id],
  );
}

/** Comma-joined ids of the enabled elements — the route-param wire format. */
export function encodeGameElements(e: GameElements): string {
  return GAME_ELEMENTS.filter((d) => e[d.id]).map((d) => d.id).join(",");
}

/**
 * Inverse of encodeGameElements. An absent param means "no choice was made"
 * and yields the defaults; an empty string is a real choice — everything off.
 */
export function decodeGameElements(s: string | undefined): GameElements {
  if (s === undefined) return { ...DEFAULT_GAME_ELEMENTS };
  const on = new Set(s.split(",").filter(Boolean));
  return build(GAME_ELEMENTS, (d) => on.has(d.id));
}

/** Entities gated by an element. Anything absent here is always available. */
const ENTITY_ELEMENT: Partial<Record<EntityType, GameElementId>> = {
  scout: "mounted",
  knight: "mounted",
  shortbowman: "ranged",
  longbowman: "ranged",
  crossbowman: "ranged",
};

export function isEntityEnabled(id: EntityType, elements: GameElements): boolean {
  const gate = ENTITY_ELEMENT[id];
  return gate === undefined || elements[gate];
}

// Memoized on the element object's identity: the expert search asks for this
// list once per candidate-generation pass, and game.tsx builds exactly one
// element object per game, so this holds a single entry.
const unitTypeCache = new WeakMap<GameElements, EntityType[]>();

/** Every buyable unit type the active elements allow, in ENTITY_META order. */
export function enabledUnitTypes(elements: GameElements): EntityType[] {
  let cached = unitTypeCache.get(elements);
  if (!cached) {
    cached = (Object.keys(ENTITY_META) as EntityType[]).filter(
      (e) => ENTITY_META[e].isUnit && isEntityEnabled(e, elements),
    );
    unitTypeCache.set(elements, cached);
  }
  return cached;
}

/**
 * "N of M" for the Settings section header. `defs` is injectable so tests can
 * cover beta behaviour against a fixture rather than against whichever real
 * element happens to be in beta.
 */
export function enabledElementCount(
  chosen: GameElements,
  defs: readonly GameElementDef[] = GAME_ELEMENTS,
): { on: number; total: number } {
  return { on: defs.filter((d) => chosen[d.id]).length, total: defs.length };
}
