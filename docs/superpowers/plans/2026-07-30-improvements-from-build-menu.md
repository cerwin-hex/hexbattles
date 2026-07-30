# Improvements from the Build Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the peasant requirement for building Field/Sawmill/Mine improvements and turn them into ordinary purchases in the Build ribbon, for both the player and the AI.

**Architecture:** A new exported `IMPROVEMENTS` catalogue in `hexGrid.ts` becomes the single source of truth for source terrain, target terrain, cost and income delta. Improvements stay out of `ENTITY_META`. A second armed-state slot (`armedImprovement: TerrainType | null`) sits alongside `armedEntityId`, with mutual exclusion enforced by two wrapper setters in `game.tsx`. A rewritten `canImproveTile` predicate in `gameLogic.ts` is the one rule consumed by the ribbon, the tap handler and the AI helper.

**Tech Stack:** TypeScript, React Native (Expo), react-native-svg, Vitest, pnpm workspaces.

Spec: `docs/superpowers/specs/2026-07-30-improvements-from-build-menu-design.md`

## Global Constraints

- **All code in English** — identifiers, comments, string literals, type names. No Danish anywhere in the codebase.
- **Typecheck from the repo root only:** `pnpm run typecheck`. Running `tsc` inside `artifacts/hex-battles` fails because workspace dependencies are not built.
- **Test command:** `pnpm --filter @workspace/hex-battles exec vitest run <file>` for one file, `pnpm test` for the full suite.
- **Never run `git push`.** Commit freely; the user pushes manually.
- **Package manager is `pnpm`.** Never `npm` or `yarn`. No new dependencies are needed for this plan.
- **Improvement costs and names are fixed:** Field = grass → field, cost 2, income delta +1. Sawmill = forest → sawmill, cost 3, income delta +1. Mine = desert → mine, cost 4, income delta +2.
- **Working directory for all paths below:** `/home/jo/Hex-Battles/artifacts/hex-battles` unless a path starts with `docs/`.
- All new game rules live behind `canImproveTile`; never duplicate a rule check in a component.

---

## File Structure

**Modified:**
- `utils/hexGrid.ts` — export the `IMPROVEMENTS` catalogue; derive the existing improvement helpers from it.
- `constants/gameConstants.ts` — add `IMPROVEMENT_PURCHASABLES`.
- `logic/gameLogic.ts` — rewrite `canImproveTile` as the shared predicate.
- `logic/aiHelpers.ts` — `dtFindImproveMove` drops the peasant/spent filters, adopts `canImproveTile`.
- `logic/aiStrategy.ts` — update the `dtFindImproveMove` call site; remove the `spentUnits.add` line in `dtExecImprove`.
- `logic/aiExpert.ts` — update the `dtFindImproveMove` call site and its comment.
- `hooks/useSelectionState.ts` — add `validImprovementTiles` and `improvementAvailability`.
- `logic/tileTapHandler.ts` — new improvement-placement branch.
- `components/PurchaseRibbon.tsx` — render the three improvement cards.
- `components/MovementHighlightLayer.tsx` — highlight `validImprovementTiles`.
- `components/EntityPanel.tsx` — remove the Improve button and its derivations.
- `app/game.tsx` — `armedImprovement` state, wrapper setters, remove `handleImproveTile`, thread new props.

**Created:**
- `components/ImprovementIcon.tsx` — the terrain-coloured hex swatch used on ribbon cards.

**Test files touched:**
- `utils/hexGrid.test.ts`, `logic/gameLogic.test.ts`, `logic/aiHelpers.test.ts`, `logic/tileTapHandler.test.ts`.

---

### Task 1: Improvement catalogue in hexGrid

**Files:**
- Modify: `utils/hexGrid.ts:107-157`
- Modify: `constants/gameConstants.ts` (append at end)
- Test: `utils/hexGrid.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `export interface ImprovementMeta { source: TerrainType; target: TerrainType; name: string; cost: number; incomeDelta: number }`
  - `export const IMPROVEMENTS: readonly ImprovementMeta[]` — order: field, sawmill, mine.
  - `export function improvementFor(target: TerrainType): ImprovementMeta | undefined`
  - Unchanged signatures kept: `improveTargetFor(terrain: TerrainType): TerrainType | null`, `improveCostFor(targetTerrain: TerrainType): number`, `baseTerrainFor(terrain: TerrainType): TerrainType`, `IMPROVED_TERRAINS: ReadonlySet<TerrainType>`.
  - `constants/gameConstants.ts` exports `IMPROVEMENT_PURCHASABLES: readonly ImprovementMeta[]` (re-export of `IMPROVEMENTS`, named for symmetry with `UNIT_PURCHASABLES` / `BUILDING_PURCHASABLES`).

- [ ] **Step 1: Write the failing test**

Append to `utils/hexGrid.test.ts`. That file's existing `from "@/utils/hexGrid"` import already includes `improveCostFor`, `improveTargetFor`, `baseTerrainFor` and `IMPROVED_TERRAINS`; add `IMPROVEMENTS` and `improvementFor` to it (do not add a second import statement from the same module).

```ts
// ─── IMPROVEMENTS catalogue ───────────────────────────────────────────────────

describe("IMPROVEMENTS catalogue", () => {
  it("lists field, sawmill and mine with their source terrain, cost and income delta", () => {
    expect(IMPROVEMENTS).toEqual([
      { source: "grass", target: "field", name: "Field", cost: 2, incomeDelta: 1 },
      { source: "forest", target: "sawmill", name: "Sawmill", cost: 3, incomeDelta: 1 },
      { source: "desert", target: "mine", name: "Mine", cost: 4, incomeDelta: 2 },
    ]);
  });

  it("agrees with improveTargetFor for every source terrain", () => {
    for (const imp of IMPROVEMENTS) {
      expect(improveTargetFor(imp.source)).toBe(imp.target);
    }
  });

  it("agrees with improveCostFor for every target terrain", () => {
    for (const imp of IMPROVEMENTS) {
      expect(improveCostFor(imp.target)).toBe(imp.cost);
    }
  });

  it("round-trips target back to source via baseTerrainFor", () => {
    for (const imp of IMPROVEMENTS) {
      expect(baseTerrainFor(imp.target)).toBe(imp.source);
    }
  });

  it("lists exactly the improved terrains in IMPROVED_TERRAINS", () => {
    expect(new Set(IMPROVEMENTS.map((i) => i.target))).toEqual(IMPROVED_TERRAINS);
  });

  it("returns undefined from improvementFor for non-improved terrain", () => {
    expect(improvementFor("grass")).toBeUndefined();
    expect(improvementFor("mountain")).toBeUndefined();
    expect(improvementFor("field")?.cost).toBe(2);
  });

  it("returns null from improveTargetFor for terrain that cannot be improved", () => {
    expect(improveTargetFor("mountain")).toBeNull();
    expect(improveTargetFor("lake")).toBeNull();
    expect(improveTargetFor("field")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts`
Expected: FAIL — `IMPROVEMENTS` and `improvementFor` are not exported.

- [ ] **Step 3: Replace the improvement block in hexGrid.ts**

In `utils/hexGrid.ts`, replace everything from the `IMPROVE_COST_BY_TARGET` comment block (line 107) through the end of `baseTerrainFor` (line 157) with:

```ts
/**
 * A terrain improvement: the base terrain it is built on, the terrain it
 * produces, its gold cost, and how much per-turn income the tile gains.
 * (The Field's extra +1 per adjacent owned city is applied separately in
 * `tileEconomicIncome` and is not part of `incomeDelta`.)
 */
export interface ImprovementMeta {
  source: TerrainType;
  target: TerrainType;
  name: string;
  cost: number;
  incomeDelta: number;
}

/**
 * Single source of truth for the three improvements. Every helper below is
 * derived from this table so source, target and cost cannot drift apart.
 * Order is the display order used by the Build ribbon.
 */
export const IMPROVEMENTS: readonly ImprovementMeta[] = [
  { source: 'grass',  target: 'field',   name: 'Field',   cost: 2, incomeDelta: 1 },
  { source: 'forest', target: 'sawmill', name: 'Sawmill', cost: 3, incomeDelta: 1 },
  { source: 'desert', target: 'mine',    name: 'Mine',    cost: 4, incomeDelta: 2 },
];

const IMPROVEMENT_BY_TARGET = new Map<TerrainType, ImprovementMeta>(
  IMPROVEMENTS.map((i) => [i.target, i]),
);

const IMPROVEMENT_BY_SOURCE = new Map<TerrainType, ImprovementMeta>(
  IMPROVEMENTS.map((i) => [i.source, i]),
);

/** The improvement that produces `targetTerrain`, or undefined. */
export function improvementFor(targetTerrain: TerrainType): ImprovementMeta | undefined {
  return IMPROVEMENT_BY_TARGET.get(targetTerrain);
}

/** Gold cost to build the given improvement terrain. */
export function improveCostFor(targetTerrain: TerrainType): number {
  return IMPROVEMENT_BY_TARGET.get(targetTerrain)?.cost ?? 0;
}

/** Tile-count above which a single territory pays administrative burden. */
export const ADMIN_BURDEN_THRESHOLD = 20;

/** Terrain types produced by improvement (cannot be improved further). */
export const IMPROVED_TERRAINS: ReadonlySet<TerrainType> = new Set<TerrainType>(
  IMPROVEMENTS.map((i) => i.target),
);

/** The terrain an improvement on `terrain` would produce, or null. */
export function improveTargetFor(terrain: TerrainType): TerrainType | null {
  return IMPROVEMENT_BY_SOURCE.get(terrain)?.target ?? null;
}

/**
 * The base terrain an improved tile reverts to (field→grass, sawmill→forest).
 * Returns `terrain` unchanged for non-improved terrain. Used when a building is
 * founded on an improved tile, which destroys the improvement.
 */
export function baseTerrainFor(terrain: TerrainType): TerrainType {
  return IMPROVEMENT_BY_TARGET.get(terrain)?.source ?? terrain;
}
```

Note: `ADMIN_BURDEN_THRESHOLD` sits inside this block in the original file — it is carried over above so it is not lost. `calcAdminBurden` (line 164 onward) is untouched.

- [ ] **Step 4: Add `IMPROVEMENT_PURCHASABLES`**

Append to `constants/gameConstants.ts`:

```ts
/**
 * Improvements shown in the Build ribbon after the buildings. Improvements are
 * deliberately absent from ENTITY_META (they are terrain, not entities), so
 * they get their own purchasable list rather than being derived from
 * PURCHASABLES.
 */
export const IMPROVEMENT_PURCHASABLES: readonly ImprovementMeta[] = IMPROVEMENTS;
```

and extend the existing imports at the top of that file:

```ts
import { ENTITY_META, IMPROVEMENTS } from "@/utils/hexGrid";
import type { EntityType, ImprovementMeta } from "@/utils/hexGrid";
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts`
Expected: PASS.

Run (from `/home/jo/Hex-Battles`): `pnpm run typecheck`
Expected: PASS — the derived helpers keep their old signatures, so existing callers still compile.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hex-battles/utils/hexGrid.ts artifacts/hex-battles/utils/hexGrid.test.ts artifacts/hex-battles/constants/gameConstants.ts
git commit -m "refactor(improvements): derive improvement helpers from one catalogue"
```

---

### Task 2: Rewrite `canImproveTile` as the shared rule

**Files:**
- Modify: `logic/gameLogic.ts:506-522`
- Test: `logic/gameLogic.test.ts:612-649`

**Interfaces:**
- Consumes: `improveTargetFor`, `improveCostFor`, `ENTITY_META` from `@/utils/hexGrid` (Task 1).
- Produces:
  ```ts
  export function canImproveTile(o: {
    terrain: TerrainType;
    targetTerrain: TerrainType;
    balance: number;
    territoryHasCity: boolean;
    isCity: boolean;
    occupantEntity: EntityType | undefined;
  }): boolean
  ```
  Consumed by Tasks 4, 5 and 6.

The old parameters `entityId` and `isSpent` are gone. The round-1 lock is *not*
in this predicate — it stays a ribbon-level gate (Task 6), matching how
buildings already work.

- [ ] **Step 1: Replace the `canImproveTile` test block**

In `logic/gameLogic.test.ts`, replace the whole `describe("canImproveTile", ...)` block (lines 612–649, including the `// ─── canImproveTile ───` banner comment) with:

```ts
// ─── canImproveTile ───────────────────────────────────────────────────────────

describe("canImproveTile", () => {
  const base = {
    terrain: "grass" as const,
    targetTerrain: "field" as const,
    balance: 5,
    territoryHasCity: true,
    isCity: false,
    occupantEntity: undefined as EntityType | undefined,
  };

  it("allows an empty tile whose terrain matches the improvement", () => {
    expect(canImproveTile(base)).toBe(true);
    expect(
      canImproveTile({ ...base, terrain: "forest", targetTerrain: "sawmill", balance: 3 }),
    ).toBe(true);
    expect(
      canImproveTile({ ...base, terrain: "desert", targetTerrain: "mine", balance: 4 }),
    ).toBe(true);
  });

  it("rejects a terrain that does not match the chosen improvement", () => {
    expect(canImproveTile({ ...base, terrain: "forest" })).toBe(false);
    expect(canImproveTile({ ...base, terrain: "desert" })).toBe(false);
  });

  it("rejects non-improvable and already-improved terrain", () => {
    expect(canImproveTile({ ...base, terrain: "mountain" })).toBe(false);
    expect(canImproveTile({ ...base, terrain: "lake" })).toBe(false);
    expect(canImproveTile({ ...base, terrain: "field" })).toBe(false);
    expect(canImproveTile({ ...base, terrain: "mine", targetTerrain: "mine" })).toBe(false);
  });

  it("requires a city in the territory", () => {
    expect(canImproveTile({ ...base, territoryHasCity: false })).toBe(false);
  });

  it("rejects a city tile", () => {
    expect(canImproveTile({ ...base, isCity: true })).toBe(false);
  });

  it("rejects insufficient gold (field 2, sawmill 3, mine 4)", () => {
    expect(canImproveTile({ ...base, balance: 1 })).toBe(false);
    expect(
      canImproveTile({ ...base, terrain: "forest", targetTerrain: "sawmill", balance: 2 }),
    ).toBe(false);
    expect(
      canImproveTile({ ...base, terrain: "desert", targetTerrain: "mine", balance: 3 }),
    ).toBe(false);
  });

  it("allows building under a friendly unit", () => {
    expect(canImproveTile({ ...base, occupantEntity: "peasant" })).toBe(true);
    expect(canImproveTile({ ...base, occupantEntity: "swordsman" })).toBe(true);
    expect(canImproveTile({ ...base, occupantEntity: "knight" })).toBe(true);
  });

  it("rejects a tile occupied by a building", () => {
    expect(canImproveTile({ ...base, occupantEntity: "tower" })).toBe(false);
    expect(canImproveTile({ ...base, occupantEntity: "castle" })).toBe(false);
    expect(canImproveTile({ ...base, occupantEntity: "bridge" })).toBe(false);
  });

  it("rejects a tile occupied by a rebel", () => {
    expect(canImproveTile({ ...base, occupantEntity: "rebel" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: FAIL — the current `canImproveTile` signature has no `targetTerrain` / `occupantEntity`, so TypeScript errors and the new expectations do not hold.

- [ ] **Step 3: Rewrite `canImproveTile`**

In `logic/gameLogic.ts`, replace the existing function (lines 506–522) with:

```ts
/**
 * The single rule for whether an improvement may be built on a tile. Consumed
 * by the Build ribbon, the tile-tap handler and the AI's improve helper, so all
 * three agree: the ribbon can never offer something the tap handler refuses.
 *
 * Not covered here: the round-1 lock (a ribbon-level gate, like every other
 * buildable) and territory ownership (callers pass tiles from their own
 * territory).
 */
export function canImproveTile(o: {
  /** The tile's current terrain. */
  terrain: TerrainType;
  /** The improvement being built, identified by the terrain it produces. */
  targetTerrain: TerrainType;
  /** The territory's gold balance. */
  balance: number;
  /** Improvements require a city in the same territory. */
  territoryHasCity: boolean;
  /** Whether the tile itself is a city. */
  isCity: boolean;
  /** The entity standing on the tile, if any. */
  occupantEntity: EntityType | undefined;
}): boolean {
  if (!o.territoryHasCity) return false;
  if (o.isCity) return false;
  // A friendly unit occupies the terrain, it does not consume it — improving
  // under a unit is allowed and does not spend that unit. Buildings and rebels
  // block.
  if (o.occupantEntity && !ENTITY_META[o.occupantEntity].isUnit) return false;
  if (o.occupantEntity === "rebel") return false;
  if (improveTargetFor(o.terrain) !== o.targetTerrain) return false;
  return o.balance >= improveCostFor(o.targetTerrain);
}
```

Note: `ENTITY_META.rebel.isUnit` is `false`, so the rebel case is already caught by the building check; the explicit line is kept so the intent survives any future change to `ENTITY_META`.

Confirm `TerrainType` and `EntityType` are already imported in `gameLogic.ts`; add whichever is missing to the existing `import type` line. Confirm `improveTargetFor` and `improveCostFor` are in the existing `@/utils/hexGrid` import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the expected callers now break**

Run (from `/home/jo/Hex-Battles`): `pnpm run typecheck`
Expected: FAIL, with errors only in `components/EntityPanel.tsx` (the old call site). That file is removed in Task 7. Do not fix it here and do not commit a broken typecheck — proceed straight to Step 6, which stubs it out.

- [ ] **Step 6: Temporarily neutralise the EntityPanel call site**

The Improve button is deleted entirely in Task 7, but the tree must typecheck between commits. In `components/EntityPanel.tsx`, change the `improveEnabled` expression (lines 83–93) to:

```ts
  const improveEnabled =
    !!entityTile &&
    !!improveTarget &&
    canImproveTile({
      terrain: entityTile.terrain,
      targetTerrain: improveTarget,
      balance: entityTerritoryBalance,
      territoryHasCity,
      isCity: cities.has(selectedEntityKey),
      occupantEntity: entityId,
    });
```

- [ ] **Step 7: Typecheck, run the full suite, commit**

Run (from `/home/jo/Hex-Battles`): `pnpm run typecheck`
Expected: PASS.

Run: `pnpm test`
Expected: PASS.

```bash
git add artifacts/hex-battles/logic/gameLogic.ts artifacts/hex-battles/logic/gameLogic.test.ts artifacts/hex-battles/components/EntityPanel.tsx
git commit -m "feat(improvements): make canImproveTile the shared build rule"
```

---

### Task 3: AI — drop the peasant requirement

**Files:**
- Modify: `logic/aiHelpers.ts:217-256`
- Modify: `logic/aiStrategy.ts:932-939`, `logic/aiStrategy.ts:1596-1618`
- Modify: `logic/aiExpert.ts:1264-1274`
- Test: `logic/aiHelpers.test.ts:349-427`

**Interfaces:**
- Consumes: `canImproveTile` (Task 2), `IMPROVEMENTS` / `improveTargetFor` / `improveCostFor` (Task 1).
- Produces: `dtFindImproveMove(territory: HexTile[], ctx: AiContext, balance: number): { key: string; terrain: TerrainType } | null` — the `spentUnits` parameter is **removed**, so the parameter count drops from 4 to 3.

- [ ] **Step 1: Replace the `dtFindImproveMove` test block**

In `logic/aiHelpers.test.ts`, replace the whole `describe("dtFindImproveMove", ...)` block (lines 349–427, including its banner comment) with:

```ts
// ─── dtFindImproveMove ─────────────────────────────────────────────────────────

describe("dtFindImproveMove", () => {
  it("returns null when the territory has no city", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass")];
    const ctx = makeCtx(tiles, [], [], "ai1");
    expect(dtFindImproveMove(tiles, ctx, 10)).toBeNull();
  });

  it("returns null when balance < the improvement cost (field 2)", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(1, 0, "ai1", "grass")];
    const ctx = makeCtx(tiles, [], [], "ai1");
    ctx.cities = new Set(["1,0"]);
    expect(dtFindImproveMove(tiles, ctx, 1)).toBeNull();
  });

  it("improves an empty grass tile into a field — no peasant needed", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(5, 5, "ai1", "grass")];
    const ctx = makeCtx(tiles, [], [], "ai1");
    ctx.cities = new Set(["5,5"]);
    expect(dtFindImproveMove(tiles, ctx, 10)).toEqual({
      key: "0,0",
      terrain: "field",
    });
  });

  it("improves a tile that a friendly unit is standing on", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(5, 5, "ai1", "grass")];
    const ctx = makeCtx(tiles, [["0,0", "swordsman"]], [], "ai1");
    ctx.cities = new Set(["5,5"]);
    expect(dtFindImproveMove(tiles, ctx, 10)).toEqual({
      key: "0,0",
      terrain: "field",
    });
  });

  it("ignores spent units — a spent unit no longer blocks improving its tile", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(5, 5, "ai1", "grass")];
    const ctx = makeCtx(tiles, [["0,0", "peasant"]], [], "ai1");
    ctx.cities = new Set(["5,5"]);
    ctx.spentUnits = new Set(["0,0"]);
    expect(dtFindImproveMove(tiles, ctx, 10)).toEqual({
      key: "0,0",
      terrain: "field",
    });
  });

  it("skips a tile occupied by a tower", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(5, 5, "ai1", "grass")];
    const ctx = makeCtx(tiles, [["0,0", "tower"]], [], "ai1");
    ctx.cities = new Set(["5,5"]);
    expect(dtFindImproveMove(tiles, ctx, 10)).toBeNull();
  });

  it("skips a city tile", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass")];
    const ctx = makeCtx(tiles, [], [], "ai1");
    ctx.cities = new Set(["0,0"]);
    expect(dtFindImproveMove(tiles, ctx, 10)).toBeNull();
  });

  it("skips already-improved and non-improvable terrain", () => {
    const tiles = [
      makeTile(0, 0, "ai1", "field"),
      makeTile(1, 0, "ai1", "mountain"),
      makeTile(2, 0, "ai1", "lake"),
      makeTile(5, 5, "ai1", "grass"),
    ];
    const ctx = makeCtx(tiles, [], [], "ai1");
    ctx.cities = new Set(["5,5"]);
    // "5,5" is the city tile and is skipped, so nothing is left to improve.
    expect(dtFindImproveMove(tiles, ctx, 10)).toBeNull();
  });

  it("prefers a tile adjacent to an own city", () => {
    // City at 0,0 (own); forest at 1,0 (adjacent to the city);
    // grass at 5,5 (far from any city). Both are improvable and affordable.
    const cityTile = makeTile(0, 0, "ai1", "grass");
    const forestTile = makeTile(1, 0, "ai1", "forest");
    const farGrass = makeTile(5, 5, "ai1", "grass");
    const territory = [cityTile, forestTile, farGrass];
    const ctx = makeCtx(territory, [], [], "ai1");
    ctx.cities = new Set(["0,0"]);
    expect(dtFindImproveMove(territory, ctx, 10)).toEqual({
      key: "1,0",
      terrain: "sawmill",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiHelpers.test.ts`
Expected: FAIL — `dtFindImproveMove` still takes 4 arguments and still requires a peasant.

- [ ] **Step 3: Rewrite `dtFindImproveMove`**

In `logic/aiHelpers.ts`, replace the function (lines 217–256) with:

```ts
/**
 * Finds the best tile improvement for the AI: any tile of its territory whose
 * terrain can be improved (grass→field, forest→sawmill, desert→mine) and that
 * the territory can afford. Requires a city in the territory — the same rule
 * the player follows, via the shared `canImproveTile` predicate.
 *
 * Prefers a tile adjacent to one of the AI's own cities, where the Field's
 * city-adjacency bonus stacks on top of the terrain income.
 *
 * No `spentUnits` filter: improvements are purchases, not unit actions. The
 * decision loop cannot re-pick a tile because the executor rewrites the live
 * tile map, after which `improveTargetFor` no longer matches.
 */
export function dtFindImproveMove(
  territory: HexTile[],
  ctx: AiContext,
  balance: number,
): { key: string; terrain: TerrainType } | null {
  const territoryHasCity = territory.some((t) => ctx.cities.has(t.key));
  if (!territoryHasCity) return null;
  let best: { key: string; terrain: TerrainType } | null = null;
  let bestPrio = -1;
  for (const t of territory) {
    const target = improveTargetFor(t.terrain);
    if (!target) continue;
    if (
      !canImproveTile({
        terrain: t.terrain,
        targetTerrain: target,
        balance,
        territoryHasCity,
        isCity: ctx.cities.has(t.key),
        occupantEntity: ctx.entities.get(t.key),
      })
    )
      continue;
    let prio = 1;
    const [q, r] = t.key.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(q + dq, r + dr);
      if (ctx.cities.has(nk) && ctx.tileMap.get(nk)?.owner === ctx.aiOwner) {
        prio = 2;
        break;
      }
    }
    if (prio > bestPrio) {
      bestPrio = prio;
      best = { key: t.key, terrain: target };
    }
  }
  return best;
}
```

Update the imports at the top of `logic/aiHelpers.ts`: remove `improveCostFor` (line 4) — `dtFindImproveMove` was its only user in this file. Add `canImproveTile` to the existing `from "@/logic/gameLogic"` import (currently `import { calcTerritoryIncome, calcTerritoryUpkeep, mergeResult } from "@/logic/gameLogic";`).

- [ ] **Step 4: Update the two call sites**

`logic/aiStrategy.ts` — the priority-J block (around line 932). Replace the comment and the call:

```ts
    // ══ PRIORITY J (LAST RESORT): Improve a tile with spare gold ═════════════
    // Only reached when nothing else this iteration was worth doing. Improving
    // is income-positive (field/sawmill +1, mine +2 per turn) so spare gold is
    // better spent here than held. dtFindImproveMove prefers city-adjacent
    // tiles. The loop cannot re-pick a tile: exec.improve rewrites the live
    // tile map, after which the tile's terrain no longer matches.
    if (!actionTaken) {
      const dev = dtFindImproveMove(currTerr, aiCtx, currBal);
      if (dev) actionTaken = await exec.improve(dev.key, dev.terrain, improveCostFor(dev.terrain));
    }
```

Match the surrounding `if (!actionTaken)` structure exactly as it appears in the file — only the comment and the `dtFindImproveMove(...)` argument list change.

`logic/aiExpert.ts` — the last-resort block (around line 1264). Replace the comment and the call:

```ts
      // LAST RESORT: no action strictly improves the evaluated position. Before
      // ending the territory's turn, improve a tile if there is spare gold —
      // an improvement is always income-positive. Mirrors the decision tree's
      // final improve priority (aiStrategy.ts) and is intentionally placed
      // AFTER the "nothing helps" check so it never displaces a better move.
      // The improved tile cannot be re-picked: exec.improve rewrites the live
      // tile map, after which its terrain no longer matches.
      const dev = dtFindImproveMove(territory, ctx, bal);
      if (dev && (await exec.improve(dev.key, dev.terrain, improveCostFor(dev.terrain))))
```

Keep whatever follows the `if` on the next line unchanged.

- [ ] **Step 5: Remove the spent-unit side effect from `dtExecImprove`**

In `logic/aiStrategy.ts`, in `dtExecImprove` (around lines 1612–1613), delete these two lines:

```ts
        ws.spentUnits = new Set(ws.spentUnits);
        ws.spentUnits.add(target);
```

They existed only to stop the old peasant-based finder re-picking the same peasant. Under the new rules an improvement can be built under a friendly unit, and marking the tile spent would freeze that unit for the rest of the turn.

- [ ] **Step 6: Run the AI tests**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiHelpers.test.ts`
Expected: PASS.

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts logic/aiExpert.test.ts logic/aiExpertPocket.test.ts`
Expected: PASS. If a case fails because it placed a peasant purely to enable an improvement, or asserted that an improved tile lands in `spentUnits`, update that fixture to the new rules — do not delete the case. If a failure is not explained by one of those two causes, stop and report it rather than adjusting the assertion.

- [ ] **Step 7: Typecheck and commit**

Run (from `/home/jo/Hex-Battles`): `pnpm run typecheck`
Expected: PASS.

```bash
git add artifacts/hex-battles/logic/aiHelpers.ts artifacts/hex-battles/logic/aiHelpers.test.ts artifacts/hex-battles/logic/aiStrategy.ts artifacts/hex-battles/logic/aiExpert.ts
git commit -m "feat(ai): build improvements without a peasant"
```

---

### Task 4: Selection state — valid improvement tiles

**Files:**
- Modify: `hooks/useSelectionState.ts:16-35` (params), `:181-228` (add memos after `hasBridgePlacementAvailable`), `:337-353` (return block)

**Interfaces:**
- Consumes: `canImproveTile` (Task 2), `IMPROVEMENTS` (Task 1).
- Produces, on the object returned by `useSelectionState`:
  - `validImprovementTiles: Set<string>`
  - `improvementAvailability: Map<TerrainType, boolean>` — keyed by **target** terrain (`"field" | "sawmill" | "mine"`), one entry per improvement, always all three keys present.
  - New hook parameter: `armedImprovement: TerrainType | null` (Task 5 supplies it).

This task has no unit test of its own — `useSelectionState` is a React hook with no existing test file, and the behaviour it feeds is covered by the tap-handler tests in Task 5. Verification is `pnpm run typecheck` plus the manual check in Task 8.

- [ ] **Step 1: Add the hook parameter**

In `hooks/useSelectionState.ts`, add to `SelectionStateParams` (after `armedEntityId` on line 19):

```ts
  armedImprovement: TerrainType | null;
```

and to the destructured argument list (after `armedEntityId` on line 40):

```ts
  armedImprovement,
```

Extend the type import on line 2 to include `TerrainType`:

```ts
import type { BorderEdge, EntityType, HexTile, TerrainType, TerritoryOwner } from "@/types";
```

- [ ] **Step 2: Add the two memos**

Insert immediately after the `hasBridgePlacementAvailable` memo (after line 211):

```ts
  // Every tile of the selected territory where the armed improvement may be
  // built. Empty when no improvement is armed, so arming Field lights up only
  // grass tiles rather than the whole territory.
  const validImprovementTiles = useMemo<Set<string>>(() => {
    if (!armedImprovement) return new Set();
    const result = new Set<string>();
    for (const tile of selectedTerritory) {
      if (
        canImproveTile({
          terrain: tile.terrain,
          targetTerrain: armedImprovement,
          balance: selectedTerritoryBalance,
          territoryHasCity,
          isCity: cities.has(tile.key),
          occupantEntity: entities.get(tile.key),
        })
      )
        result.add(tile.key);
    }
    return result;
  }, [
    armedImprovement,
    selectedTerritory,
    selectedTerritoryBalance,
    territoryHasCity,
    cities,
    entities,
  ]);

  // Whether the territory holds at least one tile each improvement could be
  // built on, ignoring gold — an unaffordable item dims with its price showing,
  // which is the ribbon's existing convention, but an item with no possible
  // target says so instead ("No grass"). Computed for all three at once because
  // the ribbon renders all three regardless of what is armed.
  const improvementAvailability = useMemo<Map<TerrainType, boolean>>(() => {
    const result = new Map<TerrainType, boolean>();
    for (const imp of IMPROVEMENTS) {
      result.set(
        imp.target,
        selectedTerritory.some((tile) =>
          canImproveTile({
            terrain: tile.terrain,
            targetTerrain: imp.target,
            balance: imp.cost,
            territoryHasCity,
            isCity: cities.has(tile.key),
            occupantEntity: entities.get(tile.key),
          }),
        ),
      );
    }
    return result;
  }, [selectedTerritory, territoryHasCity, cities, entities]);
```

Note the deliberate `balance: imp.cost` in the availability memo: passing exactly the cost makes the affordability clause inside `canImproveTile` always true, so this memo reports *terrain* availability only.

`territoryHasCity` is declared at line 238, **below** this insertion point. `const` declarations in the same function body are hoisted into scope but are in the temporal dead zone until evaluated — referencing `territoryHasCity` inside a `useMemo` callback is fine (the callback runs after all declarations), but the dependency array is evaluated immediately and would throw. Move the `territoryHasCity` memo (lines 238–241) up so it sits **before** `validImprovementTiles`.

- [ ] **Step 3: Add the imports**

Add `IMPROVEMENTS` to the existing `@/utils/hexGrid` import block, and `canImproveTile` to the existing `@/logic/gameLogic` import (currently `import { mergeResult } from "@/logic/gameLogic";`):

```ts
import { canImproveTile, mergeResult } from "@/logic/gameLogic";
```

- [ ] **Step 4: Export the new values**

Add to the returned object (after `hasBridgePlacementAvailable` on line 346):

```ts
    validImprovementTiles,
    improvementAvailability,
```

- [ ] **Step 5: Typecheck**

Run (from `/home/jo/Hex-Battles`): `pnpm run typecheck`
Expected: FAIL with exactly one error — `game.tsx` does not pass `armedImprovement` to `useSelectionState`. That is wired in Task 5. Do not commit yet; Task 5 finishes this.

---

### Task 5: Armed improvement state and the placement branch

**Files:**
- Modify: `app/game.tsx:323` (state), `:812-828` (hook call), `:1105-1230` (tap callback), `:1447-1461` (highlight layer props), and the `handleImproveTile` block at `:1060-1103` (delete)
- Modify: `logic/tileTapHandler.ts:40-94` (params), `:96-144` (destructure), insert branch before `:382`
- Modify: `components/MovementHighlightLayer.tsx`
- Test: `logic/tileTapHandler.test.ts`

**Interfaces:**
- Consumes: `canImproveTile` (Task 2), `validImprovementTiles` (Task 4), `improveCostFor` (Task 1).
- Produces:
  - `TileTapParams` gains `armedImprovement: TerrainType | null`, `validImprovementTiles: Set<string>`, `setArmedImprovement: (t: TerrainType | null) => void`.
  - `game.tsx` gains `armedImprovement` state and two wrapper setters used by every child:
    - `armEntity(id: EntityType | null): void`
    - `armImprovement(t: TerrainType | null): void`
  - `MovementHighlightLayerProps` gains `armedImprovement: TerrainType | null` and `validImprovementTiles: Set<string>`.

- [ ] **Step 1: Write the failing tests**

Append to `logic/tileTapHandler.test.ts`:

```ts
// ─── Improvement placement ────────────────────────────────────────────────────

describe("improvement placement", () => {
  function improveParams(overrides: Partial<TileTapParams> = {}): TileTapParams {
    const tiles = [makeTile(0, 0, "player", "grass"), makeTile(1, 0, "player", "grass")];
    const map = tileMap(tiles);
    return makeParams({
      key: "0,0",
      activeTileMap: map,
      selectedTerritory: tiles,
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      territoryBalances: new Map([["0,0", 10]]),
      cities: new Set(["1,0"]),
      armedImprovement: "field",
      validImprovementTiles: new Set(["0,0"]),
      ...overrides,
    });
  }

  it("changes the terrain and debits the cost", () => {
    const params = improveParams();
    handleTileTapLogic(params);
    const written = vi.mocked(params.setMutableTileMap).mock.calls[0][0];
    expect(written.get("0,0")?.terrain).toBe("field");
    const balanceUpdater = vi.mocked(params.setTerritoryBalances).mock.calls[0][0];
    const nextBalances =
      typeof balanceUpdater === "function"
        ? balanceUpdater(params.territoryBalances)
        : balanceUpdater;
    expect(nextBalances.get("0,0")).toBe(8); // 10 − field cost 2
  });

  it("pushes history, clears the armed improvement and closes the ribbon", () => {
    const params = improveParams();
    handleTileTapLogic(params);
    expect(params.pushHistory).toHaveBeenCalled();
    expect(params.setArmedImprovement).toHaveBeenCalledWith(null);
    expect(params.closeRibbon).toHaveBeenCalled();
  });

  it("leaves units and spent units untouched when building under a unit", () => {
    const params = improveParams({ entities: ents([["0,0", "swordsman"]]) });
    handleTileTapLogic(params);
    expect(params.setEntities).not.toHaveBeenCalled();
    expect(params.setSpentUnits).not.toHaveBeenCalled();
    const written = vi.mocked(params.setMutableTileMap).mock.calls[0][0];
    expect(written.get("0,0")?.terrain).toBe("field");
  });

  it("flashes an error and builds nothing when the territory cannot afford it", () => {
    const params = improveParams({ territoryBalances: new Map([["0,0", 1]]) });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("0,0");
  });

  it("flashes an error when the territory has no city", () => {
    const params = improveParams({ cities: new Set() });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("0,0");
  });

  it("does not build on a tile outside validImprovementTiles", () => {
    const params = improveParams({ key: "1,0", validImprovementTiles: new Set(["0,0"]) });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
  });
});
```

Also add the three new fields to the shared `makeParams` factory (after `armedEntityId: null,` and `validBridgePlacementTiles: new Set(),`):

```ts
    armedImprovement: null,
    validImprovementTiles: new Set(),
    setArmedImprovement: vi.fn(),
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`
Expected: FAIL — `TileTapParams` has no `armedImprovement`, and no branch handles it.

- [ ] **Step 3: Extend `TileTapParams`**

In `logic/tileTapHandler.ts`, add to the interface (after `armedEntityId` on line 48):

```ts
  armedImprovement: TerrainType | null;
```

after `validBridgePlacementTiles` (line 63):

```ts
  validImprovementTiles: Set<string>;
```

and after `setArmedEntityId` (line 79):

```ts
  setArmedImprovement: (t: TerrainType | null) => void;
```

Add the same three names to the destructuring block in `handleTileTapLogic` (lines 97–144), and extend the type import on line 4:

```ts
import type { EntityType, HexTile, TerrainType, TerritoryOwner } from "@/types";
```

Add `improveCostFor` to the existing `@/utils/hexGrid` import and `canImproveTile` to the existing `@/logic/gameLogic` import.

- [ ] **Step 4: Add the placement branch**

Insert into `logic/tileTapHandler.ts` immediately **before** the `// ─── Armed entity placement on own territory ───` comment (line 382):

```ts
  // ─── Improvement placement on own territory ───────────────────────────────────
  // Improvements are purchases, not unit actions: no unit is spent, no entity is
  // created, and the terrain change alters neither ownership nor passability, so
  // no territory recalculation is needed.
  if (armedImprovement && validImprovementTiles.has(key)) {
    if (!selectedTerritoryId) return;
    const targetTile = activeTileMap.get(key);
    const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
    const territoryHasCity = selectedTerritory.some((t) => cities.has(t.key));
    // Re-check the rule rather than trusting the highlight set, which is
    // computed from a render-time snapshot.
    if (
      !targetTile ||
      !canImproveTile({
        terrain: targetTile.terrain,
        targetTerrain: armedImprovement,
        balance,
        territoryHasCity,
        isCity: cities.has(key),
        occupantEntity: entities.get(key),
      })
    ) {
      triggerErrorFlash(key);
      return;
    }
    const cost = improveCostFor(armedImprovement);
    pushHistory();
    const newTileMap = new Map(activeTileMap);
    newTileMap.set(key, { ...targetTile, terrain: armedImprovement });
    unstable_batchedUpdates(() => {
      setMutableTileMap(newTileMap);
      setTerritoryBalances((prev) => {
        const next = new Map(prev);
        next.set(selectedTerritoryId, (next.get(selectedTerritoryId) ?? 0) - cost);
        return next;
      });
      setArmedImprovement(null);
      closeRibbon();
    });
    return;
  }

```

- [ ] **Step 5: Run the tap-handler tests**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the highlight layer support**

In `components/MovementHighlightLayer.tsx`, add to `MovementHighlightLayerProps` (after `validBridgePlacementTiles`):

```ts
  validImprovementTiles: Set<string>;
```

and after `armedEntityId`:

```ts
  armedImprovement: TerrainType | null;
```

Extend the type import on line 5 to `import type { EntityType, HexTile, TerrainType } from "@/types";`, add both names to the destructured props, and insert this block immediately after the bridge-dot block (after line 72):

```ts
        {armedImprovement &&
          Array.from(validImprovementTiles).map((key) => {
            const pos = tileDataMap.get(key);
            if (!pos) return null;
            return (
              <Circle
                key={`improve-dot-${key}`}
                cx={pos.cx}
                cy={pos.cy}
                r={HEX_SIZE * 0.18}
                fill="rgba(255,220,0,0.85)"
              />
            );
          })}
```

Add both to the equality function so the layer re-renders when they change:

```ts
    prev.validImprovementTiles === next.validImprovementTiles &&
    prev.armedImprovement === next.armedImprovement &&
```

`MovementHighlightTapTargets` needs no change: improvement targets are always inside the player's own territory, which is already tappable. Only bridges (neutral lake tiles) and placement-attack tiles need synthetic tap targets.

- [ ] **Step 7: Wire up `game.tsx`**

**7a — state and wrapper setters.** Replace line 323 with:

```ts
  const [armedEntityId, setArmedEntityIdState] = useState<EntityType | null>(null);
  const [armedImprovement, setArmedImprovementState] = useState<TerrainType | null>(null);

  // At most one thing is armed at a time. Every arming path in the app goes
  // through these two setters, so the invariant lives in exactly one place and
  // children keep their existing `setArmedEntityId(null)` call shape.
  const setArmedEntityId = useCallback((id: EntityType | null) => {
    setArmedEntityIdState(id);
    setArmedImprovementState(null);
  }, []);
  const setArmedImprovement = useCallback((t: TerrainType | null) => {
    setArmedImprovementState(t);
    setArmedEntityIdState(null);
  }, []);
```

Confirm `TerrainType` is imported in `game.tsx` (it is — `handleImproveTile` used it; keep the import when deleting that function).

**7b — hook call.** Add `armedImprovement,` next to `armedEntityId,` in the `useSelectionState({ ... })` argument object (around line 815), and add `validImprovementTiles,` and `improvementAvailability,` to the destructured result (around line 804).

**7c — tap callback.** In the `handleTileTapLogic({ ... })` argument object (around line 1118) add `armedImprovement,`, `validImprovementTiles,` and `setArmedImprovement,`. Add `armedImprovement`, `validImprovementTiles` and `setArmedImprovement` to the `useCallback` dependency array (around line 1162).

**7d — highlight layer.** Add `armedImprovement={armedImprovement}` and `validImprovementTiles={validImprovementTiles}` to the `<MovementHighlightLayer …>` props (around line 1447).

**7e — delete `handleImproveTile`.** Remove the entire `const handleImproveTile = useCallback(...)` block (lines 1060–1103) and the `onImprove={handleImproveTile}` prop on `<EntityPanel>` (line 1621). If `improveCostFor` (imported at line 64) is then unused in `game.tsx`, remove it from the import.

- [ ] **Step 8: Typecheck**

Run (from `/home/jo/Hex-Battles`): `pnpm run typecheck`
Expected: FAIL with errors only in `components/PurchaseRibbon.tsx` and `components/EntityPanel.tsx`, which Tasks 6 and 7 handle. If any other file errors, fix it before continuing.

At this point the improvement can be armed only from code — the ribbon UI arrives in Task 6. Do not commit a red typecheck; Task 6 is the next commit boundary.

---

### Task 6: Improvement cards in the Build ribbon

**Files:**
- Create: `components/ImprovementIcon.tsx`
- Modify: `components/PurchaseRibbon.tsx`
- Modify: `app/gameStyles.ts` (add one style)
- Modify: `app/game.tsx` (pass the new ribbon props)

**Interfaces:**
- Consumes: `IMPROVEMENT_PURCHASABLES` (Task 1), `improvementAvailability` (Task 4), `armedImprovement` / `setArmedImprovement` (Task 5).
- Produces: `ImprovementIcon({ terrain, size }: { terrain: TerrainType; size: number })` — an SVG hexagon filled with `TERRAIN_FILLS[terrain]`.
- `PurchaseRibbonProps` gains: `armedImprovement: TerrainType | null`, `setArmedImprovement: (t: TerrainType | null) => void`, `improvementAvailability: Map<TerrainType, boolean>`.

- [ ] **Step 1: Create the icon component**

Create `components/ImprovementIcon.tsx`:

```tsx
import React from "react";
import Svg, { Polygon } from "react-native-svg";
import { hexCornersString } from "@/utils/hexMath";
import { TERRAIN_FILLS } from "@/constants/colors";
import type { TerrainType } from "@/types";

interface ImprovementIconProps {
  terrain: TerrainType;
  size: number;
}

/**
 * A small hexagon in the improvement's terrain colour, matching the marker
 * ImprovementMarkerLayer draws on the board — so a ribbon card looks like the
 * tile the player is about to create. Improvements have no UnitIcon because
 * they are terrain, not entities.
 */
export function ImprovementIcon({ terrain, size }: ImprovementIconProps) {
  const half = size / 2;
  return (
    <Svg width={size} height={size}>
      <Polygon
        points={hexCornersString(half, half, half - 1)}
        fill={TERRAIN_FILLS[terrain]}
        stroke="#0D0A06"
        strokeWidth={1}
      />
    </Svg>
  );
}
```

- [ ] **Step 2: Add the divider style**

In `app/gameStyles.ts`, add next to the other `ribbon*` styles (near line 62):

```ts
  ribbonDivider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: 12,
    backgroundColor: "#7A6030",
    opacity: 0.6,
  },
```

- [ ] **Step 3: Extend `PurchaseRibbon`**

In `components/PurchaseRibbon.tsx`:

Add to `PurchaseRibbonProps`:

```ts
  armedImprovement: TerrainType | null;
  setArmedImprovement: (t: TerrainType | null) => void;
  improvementAvailability: Map<TerrainType, boolean>;
```

Add them to the destructured props, extend the type import to
`import type { HexTile, TerritoryOwner, EntityType, TerrainType } from "@/types";`,
add `IMPROVEMENT_PURCHASABLES` to the `@/constants/gameConstants` import, add
`View` to the `react-native` import, and add
`import { ImprovementIcon } from "@/components/ImprovementIcon";`.

Insert this block inside the `<ScrollView>`, immediately after the closing `})}` of the existing purchasables `.map(...)` (after line 190) and before `</ScrollView>`:

```tsx
        {ribbonMode === "buildings" && (
          <>
            <View style={styles.ribbonDivider} />
            {IMPROVEMENT_PURCHASABLES.map((imp) => {
              const isArmed = armedImprovement === imp.target;
              const round1Locked = turn === 1;
              const noCity = !territoryHasCity;
              const noTarget = !improvementAvailability.get(imp.target);
              const affordable = imp.cost <= selectedTerritoryBalance;
              const enabled = affordable && !round1Locked && !noCity && !noTarget;
              const statusLabel = round1Locked
                ? "Round 2+"
                : noCity
                  ? "Needs city"
                  : noTarget
                    ? `No ${imp.source}`
                    : null;
              return (
                <TouchableOpacity
                  key={imp.target}
                  style={[
                    styles.ribbonItem,
                    !enabled && styles.ribbonItemDisabled,
                    isArmed && styles.ribbonItemArmed,
                  ]}
                  activeOpacity={enabled ? 0.75 : 1}
                  onPress={() => {
                    if (!enabled) return;
                    setArmedImprovement(isArmed ? null : imp.target);
                  }}
                >
                  <ImprovementIcon terrain={imp.target} size={28} />
                  <Text
                    style={[
                      styles.ribbonName,
                      !enabled && styles.ribbonDim,
                      isArmed && styles.ribbonNameArmed,
                    ]}
                  >
                    {imp.name}
                  </Text>
                  {statusLabel ? (
                    <Text
                      style={[
                        styles.ribbonCost,
                        !enabled && styles.ribbonDim,
                        isArmed && styles.ribbonNameArmed,
                      ]}
                    >
                      {statusLabel}
                    </Text>
                  ) : (
                    <CoinValue
                      value={`${imp.cost}`}
                      size={13}
                      textStyle={[
                        styles.ribbonCost,
                        !enabled && styles.ribbonDim,
                        isArmed && styles.ribbonNameArmed,
                      ]}
                    />
                  )}
                  <CoinValue
                    value={`+${imp.incomeDelta}`}
                    suffix="/turn"
                    size={11}
                    style={{ marginTop: 1 }}
                    textStyle={[
                      styles.ribbonCost,
                      !enabled && styles.ribbonDim,
                      { fontSize: 10 },
                      enabled && { color: "#70C870" },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </>
        )}
```

Also make selecting a building clear any armed improvement and vice versa — this is already guaranteed by the wrapper setters from Task 5, so no extra code is needed here.

- [ ] **Step 4: Pass the props from `game.tsx`**

On the `<PurchaseRibbon …>` element (around line 1488), add:

```tsx
        armedImprovement={armedImprovement}
        setArmedImprovement={setArmedImprovement}
        improvementAvailability={improvementAvailability}
```

- [ ] **Step 5: Typecheck**

Run (from `/home/jo/Hex-Battles`): `pnpm run typecheck`
Expected: FAIL with errors only in `components/EntityPanel.tsx` (Task 7). Continue to Task 7 before committing.

---

### Task 7: Remove the peasant Improve button

**Files:**
- Modify: `components/EntityPanel.tsx`
- Test: full suite

**Interfaces:**
- Consumes: nothing new.
- Produces: `EntityPanelProps` no longer has `onImprove`. Everything else is unchanged.

- [ ] **Step 1: Delete the improve button and its derivations**

In `components/EntityPanel.tsx`:

- Delete the `{improveTarget && (…)}` block (lines 174–193).
- Delete the `improveTarget` / `improveCost` / `improveLabel` / `improveEnabled` declarations (lines 78–93, as amended in Task 2).
- Delete `territoryHasCity` (line 65) — it was only used by `improveEnabled`.
- Delete `onImprove?: (targetTerrain: TerrainType) => void;` from `EntityPanelProps` (line 31) and `onImprove,` from the destructured props (line 49).
- Remove `improveCostFor` and `improveTargetFor` from the `@/utils/hexGrid` import, remove the `import { canImproveTile } from "@/logic/gameLogic";` line, and drop `TerrainType` from the type import if nothing else in the file uses it.
- Keep `entityTerritory` (line 61) — `entityTerritoryId` is derived from it.
- Remove the `cities` prop. Its only two uses in this file are `territoryHasCity` (line 65) and `isCity: cities.has(selectedEntityKey)` (line 91), both of which are being deleted. Remove `cities: Set<string>;` from `EntityPanelProps` (line 22), `cities,` from the destructuring (line 40), and `cities={cities}` from the `<EntityPanel …>` element in `app/game.tsx`. Note that `tsconfig.base.json` sets `noUnusedLocals: false`, so the typecheck will **not** catch a leftover unused prop — remove it deliberately.

- [ ] **Step 2: Typecheck**

Run (from `/home/jo/Hex-Battles`): `pnpm run typecheck`
Expected: PASS — this is the first green typecheck since Task 3.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS. Any remaining failure will be an AI or tap-handler fixture that assumed the old peasant flow; fix the fixture to the new rules, not the assertion's intent.

- [ ] **Step 4: Commit**

```bash
git add artifacts/hex-battles/app/game.tsx artifacts/hex-battles/app/gameStyles.ts artifacts/hex-battles/logic/tileTapHandler.ts artifacts/hex-battles/logic/tileTapHandler.test.ts artifacts/hex-battles/hooks/useSelectionState.ts artifacts/hex-battles/components/PurchaseRibbon.tsx artifacts/hex-battles/components/ImprovementIcon.tsx artifacts/hex-battles/components/MovementHighlightLayer.tsx artifacts/hex-battles/components/EntityPanel.tsx
git commit -m "feat(improvements): build Field/Sawmill/Mine from the Build ribbon"
```

---

### Task 8: Manual verification and AI strength A/B

**Files:** none modified unless a defect is found.

**Interfaces:** none.

- [ ] **Step 1: Run the app**

Run: `pnpm --filter @workspace/hex-battles run dev`

If testing on a phone, use `expo start --tunnel` — plain LAN does not work through this machine's network isolation. Print the QR code in the reply text, not only inside collapsed tool output.

- [ ] **Step 2: Walk the checklist**

Start a game, play to round 2, select a territory that contains a city, and confirm each of these:

1. Build ribbon shows Tower, Castle, Bridge, City, a divider, then Field, Sawmill, Mine.
2. Each improvement card shows its terrain-coloured hexagon, its name, its cost with a coin, and a green `+1/turn` (Field, Sawmill) or `+2/turn` (Mine).
3. Tapping Field highlights only grass tiles of the selected territory — not forest, not desert, not the whole territory.
4. Tapping a highlighted tile changes the terrain immediately, deducts the cost, closes the ribbon and clears the arming.
5. A unit standing on the improved tile can still move afterwards.
6. Undo restores both the terrain and the gold.
7. In round 1 all three cards read "Round 2+".
8. In a territory with no city all three read "Needs city".
9. In a territory with no forest, the Sawmill card reads "No forest".
10. Building a tower on a Field reverts the tile to grass (existing behaviour, must still hold).
11. Selecting a unit shows only Remove and Upgrade — no Improve button anywhere.
12. Arming Field and then tapping the City card clears the Field arming (only one thing armed at a time).

- [ ] **Step 3: Run the AI A/B**

The AI now spends spare gold on improvements with no per-turn cap. Validate strength with the **new-vs-old self-play A/B**, not against Hard — the vs-Hard measurement is saturated and will not show a regression.

Locate the self-play harness (check `scripts/` and any `*.bench.ts` / env-gated suites under `artifacts/hex-battles/logic/`) and run new-vs-old at the Expert difficulty. Report the win rate in the summary.

If Expert regresses materially, do **not** patch it in this plan. Record the result and propose the follow-up named in the spec: an AI-side gold reserve that only improves above the cheapest useful unit cost — a heuristic, not a game rule.

- [ ] **Step 4: Commit any fixes**

If the checklist or the A/B surfaces a defect, fix it and commit with a `fix(improvements):` message. If everything passes, there is nothing to commit — say so explicitly rather than creating an empty commit.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Catalogue, not entities | 1 |
| Rules: terrain, city, cost, occupancy | 2 |
| Rules: round 2+ | 6 (ribbon gate, per the spec's note) |
| Rules: no per-turn cap, nothing spent | 5 (no `setSpentUnits` in the branch), 3 (`dtExecImprove` fix) |
| Rules: graveyard does not block | 2 (predicate has no graveyard clause), 5 (branch does not check it) |
| Rules: building on improved tile reverts terrain | unchanged code; verified in Task 8 step 2.10 |
| Armed state | 5 |
| Shared predicate | 2 |
| Placement path | 5 |
| Selection state | 4 |
| Ribbon | 6 |
| Removals (EntityPanel, handleImproveTile) | 7, 5 (step 7e) |
| AI | 3 |
| AI validation | 8 |
| Tests | 1, 2, 3, 5 |

**Placeholder scan:** no TBD/TODO; every code step carries real code; test bodies are complete. The two judgement calls (`cities` prop in Task 7, AI fixture repairs in Task 3 step 6) are bounded and say explicitly what to do and when to stop and report.

**Type consistency:** `canImproveTile`'s six-field object is identical in Tasks 2, 3, 4 and 5. `dtFindImproveMove` is three-arg in both its definition (Task 3 step 3) and both call sites (step 4) and all tests (step 1). `improvementAvailability` is keyed by target terrain in Task 4 and read by target terrain in Task 6. `armedImprovement` / `setArmedImprovement` have the same types in `game.tsx`, `TileTapParams`, `PurchaseRibbonProps` and `MovementHighlightLayerProps`.

**Commit boundaries:** the tree typechecks green at the end of Tasks 1, 2, 3 and 7. Tasks 4, 5 and 6 are deliberately mid-flight (the ribbon UI and the state that feeds it cannot compile apart) and share Task 7's commit.
