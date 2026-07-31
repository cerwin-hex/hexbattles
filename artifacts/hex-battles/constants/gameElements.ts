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
export type GameElementId = "mounted" | "improvements" | "adminBurden" | "rebels";

export interface GameElementDef {
  id: GameElementId;
  /** Row title in the menu. */
  name: string;
  /** One-line explanation shown under the title. */
  blurb: string;
  /** Beta elements stay hidden until the player opts into seeing them. */
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
 * The elements the menu should list. `defs` is injectable so tests can cover
 * beta behaviour — main ships no beta element today.
 */
export function visibleGameElements(
  showBeta: boolean,
  defs: readonly GameElementDef[] = GAME_ELEMENTS,
): GameElementDef[] {
  return defs.filter((d) => showBeta || !d.beta);
}

/**
 * The set a new game actually starts with. A beta element the player cannot
 * currently see is forced off, whatever the stored choice says — but the stored
 * choice itself is left alone, so it returns when beta is switched back on.
 */
export function elementsForNewGame(
  chosen: GameElements,
  showBeta: boolean,
  defs: readonly GameElementDef[] = GAME_ELEMENTS,
): GameElements {
  return build(defs, (d) => (!showBeta && d.beta ? false : chosen[d.id]));
}

/** "N of M" for the collapsed section header, counting visible elements only. */
export function enabledVisibleCount(
  chosen: GameElements,
  showBeta: boolean,
  defs: readonly GameElementDef[] = GAME_ELEMENTS,
): { on: number; total: number } {
  const visible = visibleGameElements(showBeta, defs);
  return { on: visible.filter((d) => chosen[d.id]).length, total: visible.length };
}
