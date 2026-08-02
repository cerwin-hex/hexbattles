# Game Elements Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player switch parts of the game (mounted units, improvements, administrative burden, rebels) on and off from the main menu before starting a new game, with unfinished features hidden behind a beta setting.

**Architecture:** A registry file (`constants/gameElements.ts`) owns the element list and a `GameElements` value (`Record<GameElementId, boolean>`). That value is threaded explicitly from the main menu through route params into `game.tsx`, and from there into the tap handler, the AI working state and the AI context. No module-level "active rule set" — `logic/aiSelfPlay.ts` runs many complete games in one process.

**Tech Stack:** TypeScript, React Native (Expo Router), Vitest, pnpm workspaces.

## Global Constraints

- All code, comments, identifiers and string literals in **English**. The user may write in Danish; code never does.
- Typecheck from the repository root only: `pnpm run typecheck`. Running `tsc` inside a package fails.
- Run tests with `pnpm --filter @workspace/hex-battles exec vitest run <path>` (paths relative to `artifacts/hex-battles/`).
- All paths below are relative to `artifacts/hex-battles/` unless stated otherwise.
- The `@/` import alias maps to `artifacts/hex-battles/`.
- Never run `git push`.
- Test files are colocated with their subject as `<name>.test.ts`.
- Modules that import `@react-native-async-storage/async-storage` need the hoisted `vi.mock` block shown in Task 2; copy it verbatim.
- Do not change `INFO_TABLE_ROWS` or `ENTITY_UPKEEP_ORDER` — the rules and welcome modals keep describing the whole game regardless of the active elements.
- Do not add per-candidate work to the AI hot paths. There is an existing 900 ms peak-turn guard that must not regress.

## File Structure

**Created:**
- `constants/gameElements.ts` — the registry, the `GameElements` value, and every pure helper over it.
- `constants/gameElements.test.ts`
- `constants/gameConstants.test.ts`
- `utils/settings.test.ts`
- `components/Toggle.tsx` — a small on/off switch in the menu's gold-on-brown style.
- `components/GameElementsSection.tsx` — the collapsible main-menu section.

**Modified:**
- `constants/gameConstants.ts` — the four purchasable lists become functions of `GameElements`.
- `utils/settings.ts` — `GameSettings` gains `elements` and `showBetaElements`.
- `utils/savedGame.ts` — `SavedGameConfig` gains an optional `elements`.
- `logic/gameLogic.ts` — admin burden gate, rebel spawn gate.
- `logic/aiHelpers.ts` — `AiContext.elements`, improvement gate.
- `logic/aiStrategy.ts` — `AiWorkingState.elements`, buy orders, spawn/economy calls.
- `logic/aiExpert.ts` — candidate unit types.
- `logic/tileTapHandler.ts` — refuse disabled purchases and improvements.
- `hooks/useEconBreakdown.ts`, `hooks/useDevEconomicOverlays.ts` — display gate for the admin burden.
- `components/PurchaseRibbon.tsx` — takes `elements` as a prop.
- `components/MainMenu.tsx` — renders the section, sends the route param.
- `components/SettingsModal.tsx` — "Show beta elements" row.
- `app/game.tsx` — parses the element set once and distributes it.

---

### Task 1: The element registry

**Files:**
- Create: `constants/gameElements.ts`
- Test: `constants/gameElements.test.ts`

**Interfaces:**
- Consumes: `EntityType` and `ENTITY_META` from the existing code.
- Produces — every later task depends on these exact names:
  - `type GameElementId = "mounted" | "improvements" | "adminBurden" | "rebels"`
  - `interface GameElementDef { id: GameElementId; name: string; blurb: string; beta: boolean }`
  - `const GAME_ELEMENTS: readonly GameElementDef[]`
  - `type GameElements = Record<GameElementId, boolean>`
  - `const DEFAULT_GAME_ELEMENTS: GameElements`
  - `const ALL_GAME_ELEMENTS: GameElements`
  - `function normalizeGameElements(raw: unknown): GameElements`
  - `function encodeGameElements(e: GameElements): string`
  - `function decodeGameElements(s: string | undefined): GameElements`
  - `function isEntityEnabled(id: EntityType, elements: GameElements): boolean`
  - `function enabledUnitTypes(elements: GameElements): EntityType[]`
  - `function visibleGameElements(showBeta: boolean, defs?: readonly GameElementDef[]): GameElementDef[]`
  - `function elementsForNewGame(chosen: GameElements, showBeta: boolean, defs?: readonly GameElementDef[]): GameElements`
  - `function enabledVisibleCount(chosen: GameElements, showBeta: boolean, defs?: readonly GameElementDef[]): { on: number; total: number }`

The `defs` parameter exists purely so tests can exercise beta behaviour: `main` ships no beta element, and the two that will be beta (`ranged`, `fogOfWar`) live on unmerged branches.

- [ ] **Step 1: Write the failing test**

Create `constants/gameElements.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ALL_GAME_ELEMENTS,
  DEFAULT_GAME_ELEMENTS,
  GAME_ELEMENTS,
  decodeGameElements,
  elementsForNewGame,
  enabledUnitTypes,
  enabledVisibleCount,
  encodeGameElements,
  isEntityEnabled,
  normalizeGameElements,
  visibleGameElements,
  type GameElementDef,
} from "@/constants/gameElements";

// main ships no beta element, so beta behaviour is exercised against a fixture
// that marks a real element as beta. Using real ids keeps the types honest.
const BETA_FIXTURE: readonly GameElementDef[] = GAME_ELEMENTS.map((d) =>
  d.id === "rebels" ? { ...d, beta: true } : d,
);

describe("GAME_ELEMENTS", () => {
  it("has no duplicate ids", () => {
    const ids = GAME_ELEMENTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every element a name and a blurb", () => {
    for (const d of GAME_ELEMENTS) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.blurb.length).toBeGreaterThan(0);
    }
  });
});

describe("DEFAULT_GAME_ELEMENTS / ALL_GAME_ELEMENTS", () => {
  it("defaults every non-beta element on and every beta element off", () => {
    for (const d of GAME_ELEMENTS) {
      expect(DEFAULT_GAME_ELEMENTS[d.id]).toBe(!d.beta);
    }
  });

  it("turns everything on in ALL_GAME_ELEMENTS", () => {
    for (const d of GAME_ELEMENTS) expect(ALL_GAME_ELEMENTS[d.id]).toBe(true);
  });
});

describe("normalizeGameElements", () => {
  it("returns the defaults for null and undefined", () => {
    expect(normalizeGameElements(null)).toEqual(DEFAULT_GAME_ELEMENTS);
    expect(normalizeGameElements(undefined)).toEqual(DEFAULT_GAME_ELEMENTS);
  });

  it("keeps known booleans and fills the rest from the defaults", () => {
    const out = normalizeGameElements({ rebels: false });
    expect(out.rebels).toBe(false);
    expect(out.mounted).toBe(DEFAULT_GAME_ELEMENTS.mounted);
  });

  it("drops unknown keys and non-boolean values", () => {
    const out = normalizeGameElements({ nonsense: true, mounted: "yes" });
    expect(out).toEqual(DEFAULT_GAME_ELEMENTS);
    expect("nonsense" in out).toBe(false);
  });
});

describe("encode / decode", () => {
  it("round-trips a mixed set", () => {
    const set = { ...ALL_GAME_ELEMENTS, rebels: false };
    expect(decodeGameElements(encodeGameElements(set))).toEqual(set);
  });

  it("round-trips the all-on and all-off sets", () => {
    const allOff = normalizeGameElements(
      Object.fromEntries(GAME_ELEMENTS.map((d) => [d.id, false])),
    );
    expect(decodeGameElements(encodeGameElements(ALL_GAME_ELEMENTS))).toEqual(ALL_GAME_ELEMENTS);
    expect(encodeGameElements(allOff)).toBe("");
    expect(decodeGameElements("")).toEqual(allOff);
  });

  it("treats a missing param as the defaults, not as all-off", () => {
    expect(decodeGameElements(undefined)).toEqual(DEFAULT_GAME_ELEMENTS);
  });
});

describe("isEntityEnabled / enabledUnitTypes", () => {
  it("gates scout and knight behind mounted", () => {
    const off = { ...ALL_GAME_ELEMENTS, mounted: false };
    expect(isEntityEnabled("scout", off)).toBe(false);
    expect(isEntityEnabled("knight", off)).toBe(false);
    expect(isEntityEnabled("scout", ALL_GAME_ELEMENTS)).toBe(true);
  });

  it("leaves ungated entities alone", () => {
    const off = { ...ALL_GAME_ELEMENTS, mounted: false };
    for (const id of ["peasant", "warrior", "swordsman", "tower", "castle"] as const) {
      expect(isEntityEnabled(id, off)).toBe(true);
    }
  });

  it("lists only enabled units and never a building", () => {
    const off = { ...ALL_GAME_ELEMENTS, mounted: false };
    expect(enabledUnitTypes(off)).toEqual(["peasant", "warrior", "swordsman"]);
    expect(enabledUnitTypes(ALL_GAME_ELEMENTS)).toContain("knight");
    expect(enabledUnitTypes(ALL_GAME_ELEMENTS)).not.toContain("tower");
  });

  it("returns the same array instance for the same element object", () => {
    const set = { ...ALL_GAME_ELEMENTS };
    expect(enabledUnitTypes(set)).toBe(enabledUnitTypes(set));
  });
});

describe("beta visibility", () => {
  it("hides beta elements until they are opted into", () => {
    expect(visibleGameElements(false, BETA_FIXTURE).map((d) => d.id)).not.toContain("rebels");
    expect(visibleGameElements(true, BETA_FIXTURE).map((d) => d.id)).toContain("rebels");
  });

  it("forces a hidden beta element off for a new game", () => {
    const chosen = { ...ALL_GAME_ELEMENTS };
    expect(elementsForNewGame(chosen, false, BETA_FIXTURE).rebels).toBe(false);
    expect(elementsForNewGame(chosen, true, BETA_FIXTURE).rebels).toBe(true);
  });

  it("leaves the stored choice untouched", () => {
    const chosen = { ...ALL_GAME_ELEMENTS };
    elementsForNewGame(chosen, false, BETA_FIXTURE);
    expect(chosen.rebels).toBe(true);
  });

  it("counts only the visible elements", () => {
    const chosen = { ...ALL_GAME_ELEMENTS, mounted: false };
    expect(enabledVisibleCount(chosen, false, BETA_FIXTURE)).toEqual({ on: 2, total: 3 });
    expect(enabledVisibleCount(chosen, true, BETA_FIXTURE)).toEqual({ on: 3, total: 4 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run constants/gameElements.test.ts`
Expected: FAIL — cannot resolve `@/constants/gameElements`.

- [ ] **Step 3: Write the implementation**

Create `constants/gameElements.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run constants/gameElements.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
git add artifacts/hex-battles/constants/gameElements.ts artifacts/hex-battles/constants/gameElements.test.ts
git commit -m "feat(elements): add the game element registry"
```

---

### Task 2: Persist the element choices in settings

**Files:**
- Modify: `utils/settings.ts:8-24` (`GameSettings`, `DEFAULT_SETTINGS`), `utils/settings.ts:36-48` (`normalizeSettings`)
- Test: `utils/settings.test.ts` (create)

**Interfaces:**
- Consumes: `GameElements`, `DEFAULT_GAME_ELEMENTS`, `normalizeGameElements` from Task 1.
- Produces: `GameSettings.elements: GameElements` and `GameSettings.showBetaElements: boolean`, both filled by `normalizeSettings`.

- [ ] **Step 1: Write the failing test**

Create `utils/settings.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// Hoisted before the import below: settings.ts captures AsyncStorage at module
// load time. These tests only exercise the pure normalizer, but the module
// still has to load.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { DEFAULT_GAME_ELEMENTS } from "@/constants/gameElements";
import { DEFAULT_SETTINGS, normalizeSettings } from "@/utils/settings";

describe("normalizeSettings — game elements", () => {
  it("fills both new fields from the defaults when absent", () => {
    const out = normalizeSettings({});
    expect(out.elements).toEqual(DEFAULT_GAME_ELEMENTS);
    expect(out.showBetaElements).toBe(false);
  });

  it("keeps a stored element set", () => {
    const stored = { ...DEFAULT_GAME_ELEMENTS, rebels: false };
    expect(normalizeSettings({ elements: stored }).elements).toEqual(stored);
  });

  it("repairs a corrupt element set", () => {
    const out = normalizeSettings({ elements: { rebels: "no", bogus: 1 } as never });
    expect(out.elements).toEqual(DEFAULT_GAME_ELEMENTS);
  });

  it("treats any non-true showBetaElements as false", () => {
    expect(normalizeSettings({ showBetaElements: true }).showBetaElements).toBe(true);
    expect(normalizeSettings({ showBetaElements: "yes" as never }).showBetaElements).toBe(false);
  });

  it("still normalizes the pre-existing fields", () => {
    expect(normalizeSettings({ mountainPct: 999 }).mountainPct).toBe(25);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/settings.test.ts`
Expected: FAIL — `out.elements` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `utils/settings.ts`, add the import at the top:

```ts
import {
  DEFAULT_GAME_ELEMENTS,
  normalizeGameElements,
  type GameElements,
} from "@/constants/gameElements";
```

Add the two fields to the interface:

```ts
export interface GameSettings {
  playerColor: ColorKey;
  mountainPct: number;
  lakePct: number;
  desertPct: number;
  forestPct: number;
  cityCount: number;
  /** Which parts of the game new games start with. Remembered between launches. */
  elements: GameElements;
  /** Whether unfinished elements appear in the menu at all. */
  showBetaElements: boolean;
}
```

Add them to `DEFAULT_SETTINGS`:

```ts
export const DEFAULT_SETTINGS: GameSettings = {
  playerColor: "blue",
  mountainPct: 8,
  lakePct: 10,
  desertPct: 10,
  forestPct: 10,
  cityCount: 2,
  elements: DEFAULT_GAME_ELEMENTS,
  showBetaElements: false,
};
```

And to the object returned by `normalizeSettings`, after `cityCount`:

```ts
    elements: normalizeGameElements((safe as { elements?: unknown }).elements),
    showBetaElements: safe.showBetaElements === true,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
git add artifacts/hex-battles/utils/settings.ts artifacts/hex-battles/utils/settings.test.ts
git commit -m "feat(elements): remember element choices in settings"
```

---

### Task 3: Carry the element set in the saved game

**Files:**
- Modify: `utils/savedGame.ts:29-33` (`SavedGameConfig`), `utils/savedGame.ts:97-102` (`deserializeSavedGame`)
- Test: `utils/savedGame.test.ts` (extend)

**Interfaces:**
- Consumes: `GameElements`, `normalizeGameElements` from Task 1.
- Produces: `SavedGameConfig.elements?: GameElements`, always populated after `deserializeSavedGame`.

**Note:** the save exists so a player who left by accident can get back in. It is treated lightly: one optional field, no version bump, no migration. `v` stays `1`, exactly like the earlier `armedGraveyard?` / `armedRuins?` additions.

- [ ] **Step 1: Write the failing test**

Append to `utils/savedGame.test.ts`. The file already has a `makeSnapshot(): SavedGame` helper at line 45 — use it, do not write a new one.

```ts
describe("saved game elements", () => {
  it("loads a save written before the feature with the default elements", () => {
    const json = serializeSavedGame(makeSnapshot());
    const parsed = JSON.parse(json);
    delete parsed.config.elements;
    const loaded = deserializeSavedGame(JSON.stringify(parsed));
    expect(loaded?.config.elements).toEqual(DEFAULT_GAME_ELEMENTS);
  });

  it("round-trips an element set", () => {
    const game = makeSnapshot();
    game.config.elements = { ...ALL_GAME_ELEMENTS, rebels: false };
    const loaded = deserializeSavedGame(serializeSavedGame(game));
    expect(loaded?.config.elements?.rebels).toBe(false);
    expect(loaded?.config.elements?.mounted).toBe(true);
  });
});
```

Add to the file's imports:

```ts
import { ALL_GAME_ELEMENTS, DEFAULT_GAME_ELEMENTS } from "@/constants/gameElements";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/savedGame.test.ts`
Expected: FAIL — `config.elements` is `undefined` after loading.

- [ ] **Step 3: Write the implementation**

In `utils/savedGame.ts`, add the import:

```ts
import { normalizeGameElements, type GameElements } from "@/constants/gameElements";
```

Extend the config interface:

```ts
export interface SavedGameConfig {
  numTiles: number;
  numOpponents: number;
  difficulty: Difficulty;
  /** Absent in saves written before the Game Elements feature; those load with
   *  DEFAULT_GAME_ELEMENTS, i.e. every shipped element on. */
  elements?: GameElements;
}
```

In `deserializeSavedGame`, replace `config: parsed.config,` with:

```ts
      config: {
        ...parsed.config,
        elements: normalizeGameElements(parsed.config.elements),
      },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/savedGame.test.ts`
Expected: PASS, including every pre-existing case in the file.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
git add artifacts/hex-battles/utils/savedGame.ts artifacts/hex-battles/utils/savedGame.test.ts
git commit -m "feat(elements): store the element set with the saved game"
```

---

### Task 4: Filter the purchasable lists

**Files:**
- Modify: `constants/gameConstants.ts:37-56`, `components/PurchaseRibbon.tsx:1-55` and its two list sites (`:77` and `:203`), `app/game.tsx:136-186` and `app/game.tsx:1456`
- Test: `constants/gameConstants.test.ts` (create)

**Interfaces:**
- Consumes: `GameElements`, `isEntityEnabled`, `decodeGameElements`, `DEFAULT_GAME_ELEMENTS` from Task 1; `SavedGameConfig.elements` from Task 3.
- Produces:
  - `type Purchasable = { id: EntityType } & EntityMeta`
  - `function purchasablesFor(elements: GameElements): Purchasable[]`
  - `function unitPurchasablesFor(elements: GameElements): Purchasable[]`
  - `function buildingPurchasablesFor(elements: GameElements): Purchasable[]`
  - `function improvementPurchasablesFor(elements: GameElements): readonly ImprovementMeta[]`
  - `PurchaseRibbon` prop `elements: GameElements`
  - `app/game.tsx` local `const elements: GameElements` — the single element set for the whole game, used by every later task.

The old `UNIT_PURCHASABLES`, `BUILDING_PURCHASABLES` and `IMPROVEMENT_PURCHASABLES` constants are **removed**. `PURCHASABLES` stays: `INFO_TABLE_ROWS` and `ENTITY_UPKEEP_ORDER` derive from it and must not change.

- [ ] **Step 1: Write the failing test**

Create `constants/gameConstants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_GAME_ELEMENTS } from "@/constants/gameElements";
import {
  INFO_TABLE_ROWS,
  buildingPurchasablesFor,
  improvementPurchasablesFor,
  unitPurchasablesFor,
} from "@/constants/gameConstants";

const noMounted = { ...ALL_GAME_ELEMENTS, mounted: false };
const noImprovements = { ...ALL_GAME_ELEMENTS, improvements: false };

describe("unitPurchasablesFor", () => {
  it("drops cavalry when mounted is off", () => {
    const ids = unitPurchasablesFor(noMounted).map((p) => p.id);
    expect(ids).not.toContain("scout");
    expect(ids).not.toContain("knight");
  });

  it("keeps cavalry when mounted is on", () => {
    const ids = unitPurchasablesFor(ALL_GAME_ELEMENTS).map((p) => p.id);
    expect(ids).toContain("scout");
    expect(ids).toContain("knight");
  });

  it("always keeps the melee track", () => {
    for (const set of [noMounted, ALL_GAME_ELEMENTS]) {
      const ids = unitPurchasablesFor(set).map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining(["peasant", "warrior", "swordsman"]));
    }
  });

  it("never lists the rebel", () => {
    expect(unitPurchasablesFor(ALL_GAME_ELEMENTS).map((p) => p.id)).not.toContain("rebel");
  });
});

describe("buildingPurchasablesFor", () => {
  it("is unaffected by the mounted element", () => {
    expect(buildingPurchasablesFor(noMounted).map((p) => p.id)).toEqual(
      buildingPurchasablesFor(ALL_GAME_ELEMENTS).map((p) => p.id),
    );
  });
});

describe("improvementPurchasablesFor", () => {
  it("is empty when improvements are off", () => {
    expect(improvementPurchasablesFor(noImprovements)).toEqual([]);
  });

  it("lists every improvement when they are on", () => {
    expect(improvementPurchasablesFor(ALL_GAME_ELEMENTS).length).toBeGreaterThan(0);
  });
});

describe("reference tables", () => {
  it("still describes the whole game", () => {
    // The rules and welcome modals never filter — see the spec, section 2.
    expect(INFO_TABLE_ROWS.map((r) => r.id)).toContain("knight");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run constants/gameConstants.test.ts`
Expected: FAIL — `unitPurchasablesFor` is not exported.

- [ ] **Step 3: Rewrite the list constants as functions**

In `constants/gameConstants.ts`, add the import:

```ts
import { isEntityEnabled, type GameElements } from "@/constants/gameElements";
import type { EntityMeta } from "@/types";
```

Replace the three derived constants (keep `PURCHASABLES` itself):

```ts
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
```

Leave `INFO_TABLE_ROWS` and `ENTITY_UPKEEP_ORDER` exactly as they are — they
still derive from the unfiltered `PURCHASABLES`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run constants/gameConstants.test.ts`
Expected: PASS.

- [ ] **Step 5: Point PurchaseRibbon at the functions**

In `components/PurchaseRibbon.tsx`, change the import block:

```ts
import {
  unitPurchasablesFor,
  buildingPurchasablesFor,
  improvementPurchasablesFor,
  ENTITY_PANEL_H,
  BOTTOM_BAR_H,
} from "@/constants/gameConstants";
import type { GameElements } from "@/constants/gameElements";
```

Add the prop to `PurchaseRibbonProps` and to the destructured parameter list:

```ts
  elements: GameElements;
```

Replace the units/buildings list expression (around line 77):

```tsx
        {(ribbonMode === "units"
          ? unitPurchasablesFor(elements)
          : buildingPurchasablesFor(elements)
        ).map((item) => {
```

Replace the improvements list expression (around line 203):

```tsx
            {improvementPurchasablesFor(elements).map((imp) => {
```

- [ ] **Step 6: Resolve the element set once in game.tsx**

In `app/game.tsx`, add to the imports:

```ts
import {
  DEFAULT_GAME_ELEMENTS,
  decodeGameElements,
  type GameElements,
} from "@/constants/gameElements";
```

Add `elements: string;` to the `useLocalSearchParams` type parameter (around line 137).

Directly after the `aiDifficulty` declaration (around line 174), add:

```ts
  // The single element set for this game. A resumed game keeps the set it was
  // started with and ignores the current menu and beta setting entirely.
  const elements: GameElements = useMemo(
    () =>
      resumeSnapshot
        ? (resumeSnapshot.config.elements ?? DEFAULT_GAME_ELEMENTS)
        : decodeGameElements(params.elements),
    // params from useLocalSearchParams are stable per nav and resumeSnapshot is captured once
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
```

Pass it to the ribbon (around line 1456):

```tsx
        elements={elements}
```

And include it in the saved-game config written by the auto-save effect
(around line 767):

```ts
      config: { numTiles, numOpponents, difficulty: aiDifficulty, elements },
```

Add `elements` to that effect's dependency array next to `aiDifficulty`.

- [ ] **Step 7: Verify the whole suite still passes**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
pnpm test
```
Expected: typecheck clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add artifacts/hex-battles/constants artifacts/hex-battles/components/PurchaseRibbon.tsx artifacts/hex-battles/app/game.tsx
git commit -m "feat(elements): derive the purchase ribbon from the element set"
```

---

### Task 5: Refuse disabled purchases in the tap handler

**Files:**
- Modify: `logic/tileTapHandler.ts:42-100` (`TileTapParams` + destructuring), `logic/tileTapHandler.ts:394` (improve branch), `logic/tileTapHandler.ts:433` and `:589` (armed-entity branches), `app/game.tsx:1083`
- Test: `logic/tileTapHandler.test.ts` (extend)

**Interfaces:**
- Consumes: `GameElements`, `isEntityEnabled`, `ALL_GAME_ELEMENTS` from Task 1; the `elements` local in `game.tsx` from Task 4.
- Produces: `TileTapParams.elements: GameElements`.

This is defence in depth. The ribbon already hides the disabled buttons; this
guarantees the rule even if a stale armed selection survives.

- [ ] **Step 1: Write the failing test**

First extend the file's existing `makeParams` helper (line 24) with one line in
its returned object, so every pre-existing test keeps the full rule set:

```ts
    elements: ALL_GAME_ELEMENTS,
```

Import it at the top of the file:

```ts
import { ALL_GAME_ELEMENTS } from "@/constants/gameElements";
```

Then append a new describe block. Note the file also has an `improveParams`
helper inside the improvement describe block (line 882) that already sets up a
city, a balance and a territory — put the improvement cases there and reuse it,
rather than building a second improvement fixture:

```ts
describe("game elements gate purchases", () => {
  it("refuses to place a scout when mounted units are off", () => {
    const params = makeParams({
      armedEntityId: "scout",
      selectedTileKeys: new Set(["0,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: [makeTile(0, 0, "player")],
      territoryBalances: new Map([["0,0", 100]]),
      elements: { ...ALL_GAME_ELEMENTS, mounted: false },
    });
    handleTileTapLogic(params);
    expect(params.setEntities).not.toHaveBeenCalled();
  });

  it("still places a peasant when mounted units are off", () => {
    const params = makeParams({
      armedEntityId: "peasant",
      selectedTileKeys: new Set(["0,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: [makeTile(0, 0, "player")],
      territoryBalances: new Map([["0,0", 100]]),
      elements: { ...ALL_GAME_ELEMENTS, mounted: false },
    });
    handleTileTapLogic(params);
    expect(params.setEntities).toHaveBeenCalled();
  });

  it("places a scout when mounted units are on", () => {
    const params = makeParams({
      armedEntityId: "scout",
      selectedTileKeys: new Set(["0,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: [makeTile(0, 0, "player")],
      territoryBalances: new Map([["0,0", 100]]),
      elements: ALL_GAME_ELEMENTS,
    });
    handleTileTapLogic(params);
    expect(params.setEntities).toHaveBeenCalled();
  });
});
```

And inside the existing improvement describe block, using its `improveParams`:

```ts
  it("refuses an improvement when improvements are off", () => {
    const params = improveParams({
      elements: { ...ALL_GAME_ELEMENTS, improvements: false },
    });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
  });
```

The neighbouring passing case in that block is the control: it already proves an
improvement lands when the element is on.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`
Expected: FAIL — the scout is placed and the improvement is applied.

- [ ] **Step 3: Write the implementation**

In `logic/tileTapHandler.ts`, add the import:

```ts
import { isEntityEnabled, type GameElements } from "@/constants/gameElements";
```

Add the field to `TileTapParams` (next to `armedImprovement`):

```ts
  /** Which parts of the game this match is played with. */
  elements: GameElements;
```

Add `elements,` to the destructuring block around line 110.

Guard the improvement branch — change line 394 from
`if (armedImprovement && validImprovementTiles.has(key)) {` to:

```ts
  if (elements.improvements && armedImprovement && validImprovementTiles.has(key)) {
```

Guard both armed-entity branches. Line 433 becomes:

```ts
  if (armedEntityId && isEntityEnabled(armedEntityId, elements) && selectedTileKeys.has(key)) {
```

Line 589 becomes:

```ts
  if (armedEntityId && isEntityEnabled(armedEntityId, elements) && validPlacementAttackTiles.has(key)) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Pass the field from game.tsx**

In `app/game.tsx`, add `elements,` to the object literal passed to
`handleTileTapLogic` (around line 1083), and add `elements` to the enclosing
`useCallback` dependency array.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
git add artifacts/hex-battles/logic/tileTapHandler.ts artifacts/hex-battles/logic/tileTapHandler.test.ts artifacts/hex-battles/app/game.tsx
git commit -m "feat(elements): refuse disabled purchases in the tap handler"
```

---

### Task 6: Gate the admin burden and rebel spawning

**Files:**
- Modify: `logic/gameLogic.ts:23-48` (`calcTerritoryUpkeep`), `logic/gameLogic.ts:67-95` (`applyOwnerEconomy`), `logic/gameLogic.ts:278-325` (`spawnRebelsForOwner`)
- Test: `logic/gameLogic.test.ts` (extend), `logic/rebelSpawn.test.ts` (extend)

**Interfaces:**
- Consumes: `GameElements`, `ALL_GAME_ELEMENTS` from Task 1.
- Produces:
  - `calcTerritoryUpkeep(territory, ents, elements?: GameElements)` — omitted means the full rule set, so the ~20 existing call sites keep working.
  - `applyOwnerEconomy({ …, elements?: GameElements })` — same default, forwarded to `calcTerritoryUpkeep`.
  - `spawnRebelsForOwner(owner, tileMap, entities, graveyard, ruins, armedGraves, armedRuins, rng?, spawnEnabled?)` — `spawnEnabled` defaults to `true`; when `false` the armed sites are still consumed and the markers still cleared, but no rebel is placed.

- [ ] **Step 1: Write the failing tests**

Extend the existing `describe("calcTerritoryUpkeep admin burden", …)` block in
`logic/gameLogic.test.ts` (line 595) with three cases, following the 26-tile
pattern the block already uses:

```ts
  it("charges no burden when the element is off", () => {
    const tiles = Array.from({ length: 26 }, (_, i) =>
      makeTile(i, 0, "player", "grass"),
    );
    const off = { ...ALL_GAME_ELEMENTS, adminBurden: false };
    expect(calcTerritoryUpkeep(tiles, new Map(), off)).toBe(0);
  });

  it("still charges unit upkeep with the burden off", () => {
    const tiles = Array.from({ length: 26 }, (_, i) =>
      makeTile(i, 0, "player", "grass"),
    );
    const off = { ...ALL_GAME_ELEMENTS, adminBurden: false };
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "peasant"]]), off)).toBe(3);
  });

  it("charges the burden when the element is explicitly on", () => {
    const tiles = Array.from({ length: 26 }, (_, i) =>
      makeTile(i, 0, "player", "grass"),
    );
    expect(calcTerritoryUpkeep(tiles, new Map(), ALL_GAME_ELEMENTS)).toBe(3);
  });
```

The block's two existing cases already cover the "no element set passed" default.
Import `ALL_GAME_ELEMENTS` from `@/constants/gameElements` at the top of the file.

Append to `logic/rebelSpawn.test.ts`, inside its existing
`describe("spawnRebelsForOwner", …)` block, using the file's `makeTile(q, r, owner)`
helper and its positional-`rng` call style:

```ts
  it("places no rebel but still consumes the grave when spawning is disabled", () => {
    const tileMap = new Map([["5,5", makeTile(5, 5, "player")]]);
    const entities = new Map<string, EntityType>();
    const graveyard = new Set(["5,5"]);
    const armedGraves = new Set(["5,5"]);

    spawnRebelsForOwner(
      "player", tileMap, entities, graveyard, new Set(),
      armedGraves, new Set(),
      () => 0,   // rng that would always spawn
      false,     // spawnEnabled
    );

    expect(entities.size).toBe(0);            // no rebel from the grave…
    expect(armedGraves.has("5,5")).toBe(false); // …but still consumed
    expect(graveyard.has("5,5")).toBe(false);   // …and the marker cleared
  });

  it("places no background rebel when spawning is disabled", () => {
    // rng() = 0 clears every spawn threshold, so any rebel here is a bug.
    const tileMap = new Map([["0,0", makeTile(0, 0, "player")]]);
    const entities = new Map<string, EntityType>();

    spawnRebelsForOwner(
      "player", tileMap, entities, new Set(), new Set(),
      new Set(), new Set(),
      () => 0,
      false,
    );

    expect(entities.size).toBe(0);
  });
```

The block's existing cases are the controls: they already prove the same grave
spawns a rebel when spawning is enabled.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts logic/rebelSpawn.test.ts
```
Expected: FAIL — `calcTerritoryUpkeep` takes two arguments; `spawnRebelsForOwner` still spawns.

- [ ] **Step 3: Write the implementation**

In `logic/gameLogic.ts`, add the import:

```ts
import { ALL_GAME_ELEMENTS, type GameElements } from "@/constants/gameElements";
```

Change the `calcTerritoryUpkeep` signature and its final term:

```ts
export function calcTerritoryUpkeep(
  territory: HexTile[],
  ents: Map<string, EntityType>,
  /** Omitted means the full rule set — keeps every existing caller honest. */
  elements: GameElements = ALL_GAME_ELEMENTS,
): number {
  // …unchanged body…
  return (
    unitUpkeep +
    calcDefenseUpkeep("tower", towers) +
    calcDefenseUpkeep("castle", castles) +
    bridges * ENTITY_META["bridge"].upkeep +
    (elements.adminBurden ? calcAdminBurden(territory.length) : 0)
  );
}
```

In `applyOwnerEconomy`, add the option and forward it:

```ts
  /** Grant the land-tile income bonus (super_expert AI tier). */
  incomeBonus: boolean;
  /** Omitted means the full rule set. */
  elements?: GameElements;
}): boolean {
  const {
    owner, tileMap, entities, balances, cities, graveyard, ruins, incomeBonus,
    elements = ALL_GAME_ELEMENTS,
  } = o;
```

and change the upkeep line inside the loop:

```ts
    const upkeep = calcTerritoryUpkeep(territory, entities, elements);
```

In `spawnRebelsForOwner`, add the trailing parameter and three guards:

```ts
export function spawnRebelsForOwner(
  owner: TerritoryOwner,
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  graveyard: Set<string>,
  ruins: Set<string>,
  armedGraves: Set<string>,
  armedRuins: Set<string>,
  rng: () => number = Math.random,
  /** When false, armed sites are still consumed and markers still cleared —
   *  they simply never breed. Keeps the bookkeeping running with rebels off. */
  spawnEnabled = true,
): void {
```

In the graves loop and the ruins loop, change the spawn line to short-circuit
before touching the rng:

```ts
    if (spawnEnabled && rng() < 0.75) entities.set(key, "rebel");
```

And wrap the third (spread) loop:

```ts
  if (!spawnEnabled) return;

  for (const tile of tileMap.values()) {
    // …unchanged spread loop…
```

Place that early return immediately before the spread loop, after the ruins
loop, so grave and ruin bookkeeping always runs.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts logic/rebelSpawn.test.ts logic/economyBankruptcy.test.ts hooks/economyDisplay.test.ts
```
Expected: PASS — including every pre-existing case, since the new arguments default to the full rule set.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
git add artifacts/hex-battles/logic/gameLogic.ts artifacts/hex-battles/logic/gameLogic.test.ts artifacts/hex-battles/logic/rebelSpawn.test.ts
git commit -m "feat(elements): gate the admin burden and rebel spawning"
```

---

### Task 7: Teach the AI the element set

**Files:**
- Modify: `logic/aiHelpers.ts:19-30` (`AiContext`), `logic/aiHelpers.ts:234` (`dtFindImproveMove`), `logic/aiStrategy.ts:40-50` (buy orders), `logic/aiStrategy.ts:63-80` (loop head), `logic/aiStrategy.ts:882`, `logic/aiStrategy.ts:949-964` (`AiWorkingState`), `logic/aiStrategy.ts:1050-1064` (`runAiTurn`), `logic/aiStrategy.ts:1087`, `:1116`, `:1201`, `:1679`, `:1708`, `logic/aiExpert.ts:937`, `app/game.tsx:691`
- Test: `logic/aiStrategy.test.ts` (extend)

**Interfaces:**
- Consumes: `GameElements`, `ALL_GAME_ELEMENTS`, `enabledUnitTypes`, `isEntityEnabled` from Task 1; the gated `calcTerritoryUpkeep`, `applyOwnerEconomy` and `spawnRebelsForOwner` from Task 6.
- Produces:
  - `AiWorkingState.elements?: GameElements` — absent means `ALL_GAME_ELEMENTS`, so `logic/aiSelfPlay.ts` and every existing AI test need no edits.
  - `AiContext.elements: GameElements` — required; populated at its single construction site.

- [ ] **Step 1: Write the failing test**

First extend the file's `makeAiCtx` helper (line 468) with a fifth positional
parameter, so every pre-existing test keeps the full rule set:

```ts
function makeAiCtx(
  tiles: HexTile[],
  aiOwner: TerritoryOwner,
  entities: Map<string, EntityType> = new Map(),
  balances: Map<string, number> = new Map(),
  elements: GameElements = ALL_GAME_ELEMENTS,
): AiContext {
  return {
    tileMap: makeTileMap(tiles),
    entities,
    balances,
    cities: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    combatSpentUnits: new Set(),
    aiOwner,
    elements,
  };
}
```

Import `ALL_GAME_ELEMENTS` and the `GameElements` type from
`@/constants/gameElements` at the top of the file.

Then append two cases that mirror the file's existing scout tests exactly — the
existing test *"buys a unit when the territory income can cover its upkeep"*
(line 526) already asserts the AI picks a **scout** from that fixture, so the
same fixture with `mounted: false` is a true negative control:

```ts
  it("buys infantry instead of cavalry when mounted units are off", async () => {
    // Same fixture as "buys a unit when the territory income can cover its
    // upkeep", which buys a Scout. With mounted units switched off the only
    // affordable choice left is the peasant.
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "player"),
    ];
    const balances = new Map([["0,0", 50]]);
    const aiCtx = makeAiCtx(tiles, "ai1", new Map(), balances, {
      ...ALL_GAME_ELEMENTS,
      mounted: false,
    });

    let bought = false;
    const exec = makeExec({
      buy: vi.fn(async () => { bought = true; return true; }),
    });

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !bought, "hard");

    expect(exec.buy).toHaveBeenCalledTimes(1);
    const [unitType] = (exec.buy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(unitType).not.toBe("scout");
    expect(unitType).not.toBe("knight");
  });

  it("buys a peasant onto a rebel when mounted units are off", async () => {
    // Mirrors "prefers buying a scout onto a rebel when the territory can
    // afford it" (the buyPreference path), with cavalry unavailable.
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
      makeTile(3, 0, "ai1"),
    ];
    const entities = new Map<string, EntityType>([["3,0", "rebel"]]);
    const balances = new Map([["0,0", 50]]);
    const aiCtx = makeAiCtx(tiles, "ai1", entities, balances, {
      ...ALL_GAME_ELEMENTS,
      mounted: false,
    });

    let bought = false;
    const exec = makeExec({
      buy: vi.fn(async () => { bought = true; return true; }),
    });

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !bought, "hard");

    if ((exec.buy as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
      const [unitType] = (exec.buy as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(unitType).toBe("peasant");
    }
  });
```

If the existing rebel test uses a different tile layout, copy that layout rather
than the one above — the point is to hit the same `buyPreference` branch.

Add one improvement case. The decision tree only improves as a last resort and
only in a territory with a city, so copy the fixture from whichever existing
test exercises `exec.improve`; if none does, assert the choke point directly
instead, which is equally decisive:

```ts
  it("offers no improvement when improvements are off", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(1, 0, "ai1", "grass")];
    const aiCtx = makeAiCtx(tiles, "ai1", new Map(), new Map([["0,0", 100]]), {
      ...ALL_GAME_ELEMENTS,
      improvements: false,
    });
    aiCtx.cities.add("0,0");
    expect(dtFindImproveMove(tiles, aiCtx, 100)).toBeNull();
  });

  it("offers an improvement when improvements are on", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(1, 0, "ai1", "grass")];
    const aiCtx = makeAiCtx(tiles, "ai1", new Map(), new Map([["0,0", 100]]));
    aiCtx.cities.add("0,0");
    expect(dtFindImproveMove(tiles, aiCtx, 100)).not.toBeNull();
  });
```

Import `dtFindImproveMove` from `@/logic/aiHelpers`. (`logic/aiHelpers.test.ts`
may be the more natural home for those two — put them wherever the existing
`dtFindImproveMove` coverage lives.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts`
Expected: FAIL — `AiContext` has no `elements` property.

- [ ] **Step 3: Add the field to AiContext and gate improvements**

In `logic/aiHelpers.ts`, add the import:

```ts
import type { GameElements } from "@/constants/gameElements";
```

Add to `AiContext`, after `aiOwner`:

```ts
  /** Which parts of the game this match is played with. */
  elements: GameElements;
```

At the very top of `dtFindImproveMove`'s body, before the city check:

```ts
  if (!ctx.elements.improvements) return null;
```

This is the single choke point for AI improvements: the decision tree's
priority J and the expert search's last resort both go through it.

- [ ] **Step 4: Gate the AI's unit purchases**

In `logic/aiStrategy.ts`, add the import:

```ts
import {
  ALL_GAME_ELEMENTS,
  enabledUnitTypes,
  isEntityEnabled,
  type GameElements,
} from "@/constants/gameElements";
```

Replace the two module-level buy-order constants with an element-aware
function. Delete `AI_UNIT_BUY_ORDER_ASC` and `AI_UNIT_BUY_ORDER_DESC` and
rewrite `aiUnitBuyOrder`:

```ts
// Unit purchase candidates for the AI, derived from ENTITY_META so new units are
// picked up automatically, and filtered by the active elements so a disabled
// track is never bought. The buy loops take the first affordable type meeting
// the strength threshold. Within a strength tier, cavalry (more attacks) is
// preferred over plain infantry, so the AI buys a Scout/Knight when it can
// afford one and falls back to cheaper infantry otherwise.
const aiUnitBuyOrder = (
  elements: GameElements,
  strengthDir: 1 | -1,
): EntityType[] =>
  enabledUnitTypes(elements)
    .slice()
    .sort(
      (a, b) =>
        strengthDir * (ENTITY_META[a].strength - ENTITY_META[b].strength) ||
        unitMaxAttacks(b) - unitMaxAttacks(a) || // cavalry first within a tier
        ENTITY_META[a].cost - ENTITY_META[b].cost,
    );
```

At the top of `runAiTerritoryDecisionLoop`'s body, right after
`const aiOwner = aiCtx.aiOwner;`, hoist both orders — once per territory, never
per iteration:

```ts
  const buyOrderAsc = aiUnitBuyOrder(aiCtx.elements, 1);
  const buyOrderDesc = aiUnitBuyOrder(aiCtx.elements, -1);
```

Replace every use of `AI_UNIT_BUY_ORDER_ASC` with `buyOrderAsc` (lines 256, 441,
740, 796) and `AI_UNIT_BUY_ORDER_DESC` with `buyOrderDesc` (line 678).

At line 882, filter the rebel-clearing preference:

```ts
        // Prefer buying a scout onto the rebel: its charge clears the rebel and
        // leaves it active to ride on and act again the same turn. Fall back to
        // a peasant when the scout is unaffordable — or unavailable, because
        // mounted units are switched off for this match.
        const buyPreference: EntityType[] = (["scout", "peasant"] as EntityType[])
          .filter((u) => isEntityEnabled(u, aiCtx.elements));
```

- [ ] **Step 5: Thread the set through the AI turn**

Still in `logic/aiStrategy.ts`, add to `AiWorkingState` after `freeTowerUsed`:

```ts
  /** Which parts of the game this match is played with. Absent means the full
   *  rule set — self-play and the AI test harnesses rely on that default. */
  elements?: GameElements;
```

At the top of `runAiTurn`'s body, before `cbs.initStepHistory(...)`:

```ts
  const elements = ws.elements ?? ALL_GAME_ELEMENTS;
```

Pass it at the five call sites:

- Line ~1087, the per-AI-owner spawn: add two arguments after `armedRuins.get(...)`:
  ```ts
        Math.random,
        elements.rebels,
  ```
- Line ~1116, the AI economy: add `elements,` after `incomeBonus,`.
- Line ~1201, the `aiCtx` literal: add
  ```ts
        get elements() { return elements; },
  ```
- Line ~1679, the player economy: add `elements,` after `incomeBonus,`.
- Line ~1708, the player spawn: add the same two trailing arguments as line 1087.

- [ ] **Step 6: Gate the expert search's buy candidates**

In `logic/aiExpert.ts`, add the import:

```ts
import { enabledUnitTypes } from "@/constants/gameElements";
```

Delete the module-level `UNIT_TYPES` constant (line 770) and change its single
use at line 937 to:

```ts
  for (const uType of enabledUnitTypes(ctx.elements)) {
```

`enabledUnitTypes` is memoized on the element object's identity, so this stays
O(1) inside the candidate loop.

- [ ] **Step 7: Set the field from game.tsx**

In `app/game.tsx`, add `elements,` to the `AiWorkingState` object literal
(around line 691, next to `freeTowerUsed`), and add `elements` to the
`useCallback` dependency array of `runAiTurn`.

- [ ] **Step 8: Run the AI suites**

```bash
pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts logic/aiExpert.test.ts logic/aiExpertPocket.test.ts logic/aiHelpers.test.ts logic/aiSelfPlay.test.ts
```
Expected: PASS, including the new cases.

- [ ] **Step 9: Typecheck and commit**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
git add artifacts/hex-battles/logic artifacts/hex-battles/app/game.tsx
git commit -m "feat(elements): make the AI obey the element set"
```

---

### Task 8: Match the economy panels to the charge

**Files:**
- Modify: `hooks/useEconBreakdown.ts:55-59` (params), `:165`; `hooks/useDevEconomicOverlays.ts:18-27` (params), `:65`; `app/game.tsx` (both hook call sites)
- Test: `hooks/economyDisplay.test.ts` (extend)

**Interfaces:**
- Consumes: `GameElements`, `ALL_GAME_ELEMENTS` from Task 1; the gated `calcTerritoryUpkeep` from Task 6; the `elements` local in `game.tsx` from Task 4.
- Produces: `UseEconBreakdownParams.elements: GameElements` and `UseDevEconomicOverlaysParams.elements: GameElements`.

Without this, the economy panel would show an administrative burden the game
never charges.

- [ ] **Step 1: Write the failing test**

Append to `hooks/economyDisplay.test.ts`. The file already guards that the
displayed net never drifts from `calcTerritoryIncome − calcTerritoryUpkeep`;
this extends that invariant to the element set, using the file's own
`makeTerritory(owner, coords)` helper:

```ts
describe("economy display with the admin burden off", () => {
  it("charges no burden for a 26-tile territory", () => {
    const { territory } = makeTerritory(
      "ai1",
      Array.from({ length: 26 }, (_, i) => [i, 0, "grass"] as [number, number, "grass"]),
    );
    const off = { ...ALL_GAME_ELEMENTS, adminBurden: false };

    expect(calcTerritoryUpkeep(territory, new Map(), off)).toBe(0);
    expect(calcTerritoryUpkeep(territory, new Map(), ALL_GAME_ELEMENTS)).toBe(3);
  });
});
```

Import `ALL_GAME_ELEMENTS` from `@/constants/gameElements` at the top of the file.

Also extend the file's `runDevOverlay` helper (line 45) so it forwards an
element set, defaulting to the full rule set:

```ts
function runDevOverlay(o: {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  cities: Set<string>;
  balances?: Map<string, number>;
  elements?: GameElements;
}) {
  // …unchanged body…
    aiStateMap: new Map<string, AiState>(),
    elements: o.elements ?? ALL_GAME_ELEMENTS,
  });
}
```

- [ ] **Step 2: Run the test to verify it fails or passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run hooks/economyDisplay.test.ts`
Expected: the `calcTerritoryUpkeep` assertions PASS already, because Task 6 did
that work — they exist to lock the invariant in. The `runDevOverlay` change will
not typecheck until Step 3 adds the hook parameter.

- [ ] **Step 3: Add the parameter to both hooks**

In `hooks/useEconBreakdown.ts`, add the import:

```ts
import type { GameElements } from "@/constants/gameElements";
```

Add to `UseEconBreakdownParams`:

```ts
  elements: GameElements;
```

Add `elements` to the destructured parameter list and to the `useMemo`
dependency array, and change line 165:

```ts
    const adminBurden = elements.adminBurden
      ? calcAdminBurden(selectedTerritory.length)
      : 0;
```

In `hooks/useDevEconomicOverlays.ts`, add the same import and interface field,
destructure `elements`, add it to the `useMemo` dependency array, and change
line 65:

```ts
        const upkeep = calcTerritoryUpkeep(territory, entities, elements);
```

- [ ] **Step 4: Pass the set from game.tsx**

Add `elements={elements}`-style entries — these are hooks, so add
`elements,` to both call objects in `app/game.tsx`.

- [ ] **Step 5: Verify**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
pnpm --filter @workspace/hex-battles exec vitest run hooks/economyDisplay.test.ts
```
Expected: typecheck clean, tests pass.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hex-battles/hooks artifacts/hex-battles/app/game.tsx
git commit -m "feat(elements): hide the admin burden from the economy panels when off"
```

---

### Task 9: The toggle switch and the menu section

**Files:**
- Create: `components/Toggle.tsx`, `components/GameElementsSection.tsx`

**Interfaces:**
- Consumes: `GameElements`, `GameElementDef`, `visibleGameElements`, `enabledVisibleCount` from Task 1.
- Produces:
  - `Toggle` — `{ value: boolean; onValueChange: (v: boolean) => void; accessibilityLabel?: string }`
  - `GameElementsSection` — `{ elements: GameElements; showBeta: boolean; onChange: (next: GameElements) => void }`

These are presentational components. The app has no test setup for rendering
React Native components (`vitest` runs in the `node` environment with no
renderer), so they carry no unit tests — every decision they make is already
covered by the pure helpers in Task 1. Verify them by eye in Task 12.

- [ ] **Step 1: Write the Toggle component**

Create `components/Toggle.tsx`:

```tsx
import * as Haptics from "expo-haptics";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

interface ToggleProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
}

/**
 * A small on/off switch in the menu's gold-on-brown style. React Native's own
 * Switch cannot be themed to match, so this is hand-rolled — the app has no
 * other switch today.
 */
export function Toggle({ value, onValueChange, accessibilityLabel }: ToggleProps) {
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.75}
      onPress={() => {
        Haptics.selectionAsync();
        onValueChange(!value);
      }}
      style={[styles.track, value ? styles.trackOn : styles.trackOff]}
    >
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 46,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  trackOn: {
    borderColor: "#C8A24A",
    backgroundColor: "#3A2A10",
  },
  trackOff: {
    borderColor: "#5A4520",
    backgroundColor: "#1E1408",
  },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  knobOn: {
    backgroundColor: "#F0D080",
    alignSelf: "flex-end",
  },
  knobOff: {
    backgroundColor: "#6B5A34",
    alignSelf: "flex-start",
  },
});
```

- [ ] **Step 2: Write the section component**

Create `components/GameElementsSection.tsx`:

```tsx
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Toggle } from "@/components/Toggle";
import {
  enabledVisibleCount,
  visibleGameElements,
  type GameElements,
} from "@/constants/gameElements";

interface GameElementsSectionProps {
  elements: GameElements;
  showBeta: boolean;
  onChange: (next: GameElements) => void;
}

/**
 * The collapsible "Game Elements" list in the main menu. Collapsed by default
 * so the menu stays compact and the start button stays reachable without
 * scrolling; the header carries an "N of M" summary of the visible elements.
 */
export function GameElementsSection({
  elements,
  showBeta,
  onChange,
}: GameElementsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const defs = visibleGameElements(showBeta);
  const { on, total } = enabledVisibleCount(elements, showBeta);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.75}
        onPress={() => {
          Haptics.selectionAsync();
          setExpanded((e) => !e);
        }}
      >
        <Text style={styles.label}>GAME ELEMENTS</Text>
        <View style={styles.headerRight}>
          <Text style={styles.summary}>{`${on} of ${total}`}</Text>
          <Text style={styles.chevron}>{expanded ? "▴" : "▾"}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.list}>
          {defs.map((def) => (
            <View key={def.id} style={styles.row}>
              <View style={styles.rowText}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle}>{def.name}</Text>
                  {def.beta && <Text style={styles.betaChip}>BETA</Text>}
                </View>
                <Text style={styles.rowBlurb}>{def.blurb}</Text>
              </View>
              <Toggle
                value={elements[def.id]}
                accessibilityLabel={def.name}
                onValueChange={(v) => onChange({ ...elements, [def.id]: v })}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 13,
    fontFamily: "Cinzel_400Regular",
    color: "#A08A60",
    letterSpacing: 2,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summary: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
  },
  chevron: {
    fontSize: 12,
    color: "#C8A24A",
  },
  list: {
    borderWidth: 1,
    borderColor: "#4A3C1E",
    borderRadius: 5,
    backgroundColor: "#1E1408",
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#D4BF96",
  },
  betaChip: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    color: "#C8A24A",
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: "#7A6030",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  rowBlurb: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
  },
});
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
git add artifacts/hex-battles/components/Toggle.tsx artifacts/hex-battles/components/GameElementsSection.tsx
git commit -m "feat(elements): add the toggle switch and the menu section"
```

---

### Task 10: Wire the section into the main menu

**Files:**
- Modify: `components/MainMenu.tsx:1-30` (imports), `:277-337` (the sections block), `:218-234` (`startNewGame`)

**Interfaces:**
- Consumes: `GameElementsSection` from Task 9; `elementsForNewGame`, `encodeGameElements` from Task 1; `settings.elements` / `settings.showBetaElements` from Task 2; the `elements` route param read in Task 4.
- Produces: nothing new — this closes the loop.

- [ ] **Step 1: Add the imports**

In `components/MainMenu.tsx`:

```ts
import { GameElementsSection } from '@/components/GameElementsSection';
import { elementsForNewGame, encodeGameElements } from '@/constants/gameElements';
```

- [ ] **Step 2: Render the section**

Inside the `<View style={styles.sections}>` block, after the AI Difficulty
section and before the closing `</View>`:

```tsx
          <GameElementsSection
            elements={settings.elements}
            showBeta={settings.showBetaElements}
            onChange={(next) => updateSettings({ ...settings, elements: next })}
          />
```

The choices persist because `updateSettings` writes through to storage — the
same path the terrain sliders already use.

- [ ] **Step 3: Send the set with the new game**

In `startNewGame`, add one param to the `router.push` params object, after
`cityCount`:

```ts
        elements: encodeGameElements(
          elementsForNewGame(settings.elements, settings.showBetaElements),
        ),
```

`elementsForNewGame` is what forces a hidden beta element off without touching
the stored choice.

- [ ] **Step 4: Typecheck**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/components/MainMenu.tsx
git commit -m "feat(elements): list the game elements in the main menu"
```

---

### Task 11: The beta setting

**Files:**
- Modify: `components/SettingsModal.tsx:1-22` (imports), `:71-86` (add a row above the sliders)

**Interfaces:**
- Consumes: `Toggle` from Task 9; `GameSettings.showBetaElements` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Add the import**

In `components/SettingsModal.tsx`:

```ts
import { Toggle } from "@/components/Toggle";
```

- [ ] **Step 2: Add the row**

Inside the `ScrollView`, after the Player Color section and before the first
slider block:

```tsx
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Beta Elements</Text>
              <View style={styles.betaRow}>
                <Text style={styles.betaBlurb}>
                  Show unfinished features in the game elements list
                </Text>
                <Toggle
                  value={draft.showBetaElements}
                  accessibilityLabel="Show beta elements"
                  onValueChange={(v) => update("showBetaElements", v)}
                />
              </View>
            </View>
```

Add the two styles to the `StyleSheet.create` block:

```ts
  betaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  betaBlurb: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
    lineHeight: 18,
  },
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
git add artifacts/hex-battles/components/SettingsModal.tsx
git commit -m "feat(elements): add the beta elements setting"
```

---

### Task 12: Full verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Typecheck the workspace**

```bash
cd /home/jo/Hex-Battles
pnpm run typecheck
```
Expected: clean.

- [ ] **Step 2: Run the whole suite**

```bash
pnpm test
```
Expected: every suite passes. The baseline before this feature is 14 files and
404 tests plus 8 env-gated ones; the count should have grown, and nothing should
have started failing.

- [ ] **Step 3: Check the AI timing guard**

Run the self-play / peak-turn suite the repository uses for AI timing and
confirm it is no slower than on `main`:

```bash
pnpm --filter @workspace/hex-battles exec vitest run logic/aiSelfPlay.test.ts
```
Expected: PASS with no peak-turn guard failure. If the guard trips, the cause is
almost certainly per-candidate work added in Task 7 — check that
`aiUnitBuyOrder` is hoisted outside the decision loop's `while` and that
`enabledUnitTypes` is hitting its `WeakMap`.

- [ ] **Step 4: Verify the feature by hand**

Start the app (`pnpm --filter @workspace/hex-battles run dev`, or
`expo start --tunnel` for a phone) and confirm:

1. The main menu shows `GAME ELEMENTS  4 of 4 ▾`, collapsed, with the start
   button still visible without scrolling.
2. Expanding shows four rows with blurbs and working switches; the counter
   updates as you toggle.
3. No `BETA` row appears until Settings → Beta Elements is switched on.
4. Starting a game with Mounted off: the Buy ribbon shows no Scout or Knight,
   and no AI ever fields one.
5. Starting a game with Improvements off: the Build ribbon shows no Field,
   Sawmill or Mine.
6. Starting a game with Rebels off: the opening board has zero rebels, and none ever appear afterwards.
7. Starting a game with Administrative Burden off: a territory above 20 tiles
   shows no burden line in the economy panel.
8. Leaving to the menu and resuming returns to the same game with the same
   elements, even after changing the menu toggles in between.
9. Closing and reopening the app keeps the toggle positions.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test(elements): verify the game element toggles end to end"
```

Only if anything needed fixing in steps 1-4; otherwise there is nothing to
commit and the branch is ready.

---

## Notes for the implementer

- **Do not** filter `INFO_TABLE_ROWS` or `ENTITY_UPKEEP_ORDER`. The rules and
  welcome modals describe the whole game on purpose; that was an explicit
  product decision, not an oversight.
- **Do not** replace the optional-argument defaults with required parameters to
  "be explicit". `calcTerritoryUpkeep`, `applyOwnerEconomy` and
  `AiWorkingState.elements` default to the full rule set precisely so the ~20
  existing test call sites and `logic/aiSelfPlay.ts` keep working untouched.
- **Do not** introduce a module-level "current elements" variable. `playMatch`
  and `playFreeForAll` run many complete games in one process.
- When the ranged-units or fog-of-war branch merges, it adds one member to
  `GameElementId` and one entry to `GAME_ELEMENTS` with `beta: true`, plus
  whatever gating its own mechanics need. Nothing in this plan has to change.
