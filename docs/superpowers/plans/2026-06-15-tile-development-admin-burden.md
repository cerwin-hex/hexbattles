# Tile Development & Administrative Burden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let peasants spend their turn upgrading owned tiles for +1 income (grass→field, forest→sawmill), with a per-territory administrative burden on clusters over 20 tiles that pushes players to develop rather than sprawl.

**Architecture:** First centralize the copy-pasted income calculation into one `calcTerritoryIncome` (so the new income sources land in a single place and the AI cannot mis-evaluate its economy). Then add the two new terrain types (table-driven), the admin burden (folded into the shared `calcTerritoryUpkeep`), the city-adjacency development bonus (inside `calcTerritoryIncome`), the player develop action, rendering, and AI active development.

**Tech Stack:** TypeScript, React Native (Expo), Vitest. Run all commands from repo root `/home/jo/Hex-Battles`. Typecheck: `pnpm run typecheck`. Single test file: `pnpm --filter @workspace/hex-battles exec vitest run <path>`.

**Spec:** `docs/superpowers/specs/2026-06-15-tile-development-admin-burden-design.md`

---

## Phase 1 — New terrain types & economy constants

### Task 1: Add `field` and `sawmill` terrain types

**Files:**
- Modify: `artifacts/hex-battles/types.ts:1`
- Modify: `artifacts/hex-battles/utils/hexGrid.ts:83-97` (TERRAIN_INCOME, TERRAIN_MOVE_COST)

- [ ] **Step 1: Add the two terrain types**

In `types.ts:1`:
```ts
export type TerrainType = 'grass' | 'desert' | 'mountain' | 'lake' | 'forest' | 'field' | 'sawmill';
```

- [ ] **Step 2: Add income & move cost (table-driven)**

In `hexGrid.ts`, extend the two tables:
```ts
export const TERRAIN_INCOME: Record<TerrainType, number> = {
  grass:    2,
  desert:   1,
  mountain: 0,
  lake:     0,
  forest:   2,
  field:    3,
  sawmill:  3,
};

export const TERRAIN_MOVE_COST: Record<TerrainType, number> = {
  grass:    1,
  desert:   1,
  mountain: Infinity,
  lake:     1,
  forest:   2,
  field:    1,
  sawmill:  2,
};
```

- [ ] **Step 3: Typecheck (expect new exhaustiveness errors elsewhere are OK to fix later)**

Run: `pnpm run typecheck`
Expected: PASS for these two files (Record types are now complete). If unrelated files error on the new union members, they are handled in later tasks — note them but proceed.

- [ ] **Step 4: Commit**

```bash
git add artifacts/hex-battles/types.ts artifacts/hex-battles/utils/hexGrid.ts
git commit -m "feat(terrain): add field and sawmill terrain types"
```

---

### Task 2: Development & burden constants/helpers

**Files:**
- Modify: `artifacts/hex-battles/utils/hexGrid.ts` (add near `CITY_BONUS`, ~line 99)
- Test: `artifacts/hex-battles/utils/hexGrid.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write failing tests**

Create/append `artifacts/hex-battles/utils/hexGrid.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  DEVELOP_COST,
  developTargetFor,
  DEVELOPED_TERRAINS,
  calcAdminBurden,
  ADMIN_BURDEN_THRESHOLD,
} from "@/utils/hexGrid";

describe("development constants", () => {
  it("maps developable terrain to its upgrade", () => {
    expect(developTargetFor("grass")).toBe("field");
    expect(developTargetFor("forest")).toBe("sawmill");
  });
  it("returns null for non-developable terrain", () => {
    expect(developTargetFor("desert")).toBeNull();
    expect(developTargetFor("field")).toBeNull();
    expect(developTargetFor("sawmill")).toBeNull();
    expect(developTargetFor("lake")).toBeNull();
    expect(developTargetFor("mountain")).toBeNull();
  });
  it("recognises developed terrains", () => {
    expect(DEVELOPED_TERRAINS.has("field")).toBe(true);
    expect(DEVELOPED_TERRAINS.has("sawmill")).toBe(true);
    expect(DEVELOPED_TERRAINS.has("grass")).toBe(false);
  });
  it("costs 5 to develop", () => {
    expect(DEVELOP_COST).toBe(5);
  });
});

describe("calcAdminBurden", () => {
  it("is zero at or below the threshold", () => {
    expect(ADMIN_BURDEN_THRESHOLD).toBe(20);
    expect(calcAdminBurden(0)).toBe(0);
    expect(calcAdminBurden(20)).toBe(0);
  });
  it("charges ceil((n-20)/2) for the excess only", () => {
    expect(calcAdminBurden(21)).toBe(1);
    expect(calcAdminBurden(22)).toBe(1);
    expect(calcAdminBurden(26)).toBe(3);
    expect(calcAdminBurden(30)).toBe(5);
    expect(calcAdminBurden(40)).toBe(10);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Implement**

In `hexGrid.ts` after `export const CITY_BONUS = 2;`:
```ts
/** Gold cost for a peasant to develop the tile it stands on. */
export const DEVELOP_COST = 5;

/** Tile-count above which a single territory pays administrative burden. */
export const ADMIN_BURDEN_THRESHOLD = 20;

/** Terrain types produced by development (cannot be developed further). */
export const DEVELOPED_TERRAINS: ReadonlySet<TerrainType> = new Set<TerrainType>([
  "field",
  "sawmill",
]);

const DEVELOP_TARGET: Partial<Record<TerrainType, TerrainType>> = {
  grass: "field",
  forest: "sawmill",
};

/** The terrain a peasant would produce by developing `terrain`, or null. */
export function developTargetFor(terrain: TerrainType): TerrainType | null {
  return DEVELOP_TARGET[terrain] ?? null;
}

/**
 * Administrative burden (extra upkeep) for a territory of `tileCount` tiles:
 * ceil(max(0, tileCount - ADMIN_BURDEN_THRESHOLD) / 2). Only the tiles ABOVE
 * the threshold are charged, at half a gold each (rounded up).
 */
export function calcAdminBurden(tileCount: number): number {
  const excess = tileCount - ADMIN_BURDEN_THRESHOLD;
  if (excess <= 0) return 0;
  return Math.ceil(excess / 2);
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/utils/hexGrid.ts artifacts/hex-battles/utils/hexGrid.test.ts
git commit -m "feat(econ): add develop constants and calcAdminBurden helper"
```

---

## Phase 2 — Centralize income (prerequisite refactor)

### Task 3: Create `calcTerritoryIncome` (base income + city bonus only)

**Files:**
- Modify: `artifacts/hex-battles/logic/gameLogic.ts` (add export; extend imports)
- Test: `artifacts/hex-battles/logic/gameLogic.test.ts`

The function takes `tileMap` from the start (the city-adjacency bonus added in Task 7 needs neighbour lookups), even though it is unused until then.

- [ ] **Step 1: Write failing test**

Append to `artifacts/hex-battles/logic/gameLogic.test.ts`:
```ts
import { calcTerritoryIncome } from "@/logic/gameLogic";

describe("calcTerritoryIncome", () => {
  it("sums terrain income and city bonus, skipping rebel tiles", () => {
    const tiles = [
      mkTile(0, 0, "player", "grass"),   // 2
      mkTile(1, 0, "player", "forest"),  // 2
      mkTile(2, 0, "player", "field"),   // 3
      mkTile(3, 0, "player", "grass"),   // city +2, terrain 2
    ];
    const tileMap = new Map(tiles.map((t) => [t.key, t]));
    const entities = new Map<string, any>([["1,0", "rebel"]]); // forest suppressed
    const cities = new Set<string>(["3,0"]);
    // grass 2 + (forest rebel 0) + field 3 + grass 2 + city 2 = 9
    expect(calcTerritoryIncome(tiles, entities, cities, tileMap)).toBe(9);
  });
});
```
(Assumes a `mkTile(q, r, owner, terrain)` helper already exists in this test file — `gameLogic.test.ts` already defines one per the import at its top; reuse it. If its signature differs, adapt the call.)

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: FAIL — `calcTerritoryIncome` not exported.

- [ ] **Step 3: Implement**

In `gameLogic.ts`, add `HEX_EDGES`, `tileKey`, `TERRAIN_INCOME`, `CITY_BONUS`, `DEVELOPED_TERRAINS` to the existing `@/utils/hexGrid` import, then add:
```ts
/**
 * Single source of truth for a territory's per-turn income. Sums each non-rebel
 * tile's terrain income plus CITY_BONUS for city tiles, plus the city-adjacency
 * development bonus (added in a later task). Centralizing this avoids the income
 * formula drifting across the ~8 sites that previously inlined it.
 */
export function calcTerritoryIncome(
  territory: HexTile[],
  entities: Map<string, EntityType>,
  cities: Set<string>,
  tileMap: Map<string, HexTile>,
): number {
  let income = 0;
  for (const t of territory) {
    if (entities.get(t.key) === "rebel") continue;
    income += (TERRAIN_INCOME[t.terrain] ?? 0) + (cities.has(t.key) ? CITY_BONUS : 0);
  }
  return income;
}
```
(`tileMap` is intentionally unused here; it is consumed by the city-adjacency bonus in Task 7. Add a `// eslint-disable-next-line @typescript-eslint/no-unused-vars` above the param only if the project's lint fails the build — typecheck does not.)

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/logic/gameLogic.ts artifacts/hex-battles/logic/gameLogic.test.ts
git commit -m "refactor(econ): add centralized calcTerritoryIncome"
```

---

### Task 4: Replace all territory-level income reduces with `calcTerritoryIncome`

Replace the inlined income reduce at each site below. Each replacement is the same shape: a `territory.reduce(...)` (or equivalent) that sums `TERRAIN_INCOME[t.terrain] + (cities.has(t.key) ? CITY_BONUS : 0)`, skipping rebels. Leave any additional `incomeModifier`/`landTileCount` lines untouched — only the base reduce changes.

**Files & exact replacements:**

- [ ] **Step 1: `endTurnHandler.ts` player loop (lines ~118-125)**

Add `calcTerritoryIncome` to the `@/logic/gameLogic` import. Replace:
```ts
const income = territory.reduce((s, t) => {
  if (nextEntities.get(t.key) === "rebel") return s;
  return s + TERRAIN_INCOME[t.terrain] + (cities.has(t.key) ? CITY_BONUS : 0);
}, 0);
```
with:
```ts
const income = calcTerritoryIncome(territory, nextEntities, cities, activeTileMap);
```

- [ ] **Step 2: `endTurnHandler.ts` AI loop (lines ~194-201)**

Replace the analogous reduce with:
```ts
const income = calcTerritoryIncome(territory, nextEntities, cities, activeTileMap);
```
Leave `const landTileCount = ...` and `incomeModifier` below it unchanged; `delta` still uses `income + incomeModifier - upkeep`.

- [ ] **Step 3: `aiHelpers.ts` (lines ~98-101)**

Add `calcTerritoryIncome` to the `@/logic/gameLogic` import. Replace `const remIncome = remTerr.reduce(...)` with:
```ts
const remIncome = calcTerritoryIncome(remTerr, simEntities, ctx.cities, simMap);
```

- [ ] **Step 4: `aiStrategy.ts` (lines ~84-87)**

Add `calcTerritoryIncome` to the `@/logic/gameLogic` import. Replace `const currIncome = currTerr.reduce(...)` with:
```ts
const currIncome = calcTerritoryIncome(currTerr, aiCtx.entities, aiCtx.cities, aiCtx.tileMap);
```

- [ ] **Step 5: `aiStrategy.ts` AI end-turn sim (lines ~1545-1552)**

Replace `const income = territory.reduce(...)` with:
```ts
const income = calcTerritoryIncome(territory, ws.entities, ws.cities, ws.tileMap);
```

- [ ] **Step 6: `aiExpert.ts` (lines ~203-206)**

Add `calcTerritoryIncome` to the `@/logic/gameLogic` import. Replace `const terrIncome = terr.reduce(...)` with:
```ts
const terrIncome = calcTerritoryIncome(terr, entities, cities, tileMap);
```

- [ ] **Step 7: `aiExpert.ts` (lines ~615-618)**

Replace `const income = territory.reduce(...)` with:
```ts
const income = calcTerritoryIncome(territory, ctx.entities, ctx.cities, ctx.tileMap);
```

- [ ] **Step 8: `aiSelfPlay.ts` (lines ~104-107)**

Add `calcTerritoryIncome` to the `@/logic/gameLogic` import. Replace `const income = territory.reduce(...)` with:
```ts
const income = calcTerritoryIncome(territory, ws.entities, ws.cities, ws.tileMap);
```
Leave the `landTileCount`/`incomeModifier` lines unchanged.

> **NOTE — per-tile sites left intentionally inlined:** `aiStrategy.ts:~880` (`rtIncome`, single rebel tile), `aiExpert.ts:~160` (`tileValue`, single tile), and `aiExpert.ts:~367` (per-owner leader-income loop) are marginal/heuristic per-tile sums, not the bankruptcy-critical end-turn math. They automatically pick up field/sawmill income via `TERRAIN_INCOME` and deliberately omit the (non-local) city-adjacency bonus. Do NOT change them.

- [ ] **Step 9: Typecheck + full test suite**

Run: `pnpm run typecheck && pnpm test`
Expected: PASS, identical numbers (pure refactor — no behaviour change yet).

- [ ] **Step 10: Commit**

```bash
git add artifacts/hex-battles/logic/
git commit -m "refactor(econ): route territory income through calcTerritoryIncome"
```

---

## Phase 3 — Administrative burden

### Task 5: Fold admin burden into `calcTerritoryUpkeep`

Every `calcTerritoryUpkeep` caller passes a full contiguous territory (verified: `endTurnHandler` ×2, `aiHelpers`, `aiExpert` ×2, `aiSelfPlay`, `aiStrategy` ×2), so burden belongs inside it — this applies it everywhere upkeep is computed, including all AI evaluation, with one edit.

**Files:**
- Modify: `artifacts/hex-battles/logic/gameLogic.ts:15-33`
- Test: `artifacts/hex-battles/logic/gameLogic.test.ts`

- [ ] **Step 1: Write failing test**

Append to `gameLogic.test.ts`:
```ts
import { calcTerritoryUpkeep } from "@/logic/gameLogic";

describe("calcTerritoryUpkeep admin burden", () => {
  it("adds ceil((tiles-20)/2) for clusters over 20 tiles", () => {
    // 26 empty tiles, no entities: upkeep is purely burden = ceil(6/2) = 3
    const tiles = Array.from({ length: 26 }, (_, i) => mkTile(i, 0, "player", "grass"));
    const entities = new Map<string, any>();
    expect(calcTerritoryUpkeep(tiles, entities)).toBe(3);
  });
  it("charges no burden at 20 tiles", () => {
    const tiles = Array.from({ length: 20 }, (_, i) => mkTile(i, 0, "player", "grass"));
    expect(calcTerritoryUpkeep(tiles, new Map())).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: FAIL — returns 0 (no burden yet).

- [ ] **Step 3: Implement**

Add `calcAdminBurden` to the `@/utils/hexGrid` import in `gameLogic.ts`, then change the final return of `calcTerritoryUpkeep`:
```ts
  return (
    unitUpkeep +
    calcDefenseUpkeep("tower", towers) +
    calcDefenseUpkeep("castle", castles) +
    bridges * ENTITY_META["bridge"].upkeep +
    calcAdminBurden(territory.length)
  );
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite, fix shifted assertions**

Run: `pnpm test`
Expected: some `endTurnHandler.test.ts` / `aiExpert.test.ts` / `aiSelfPlay.test.ts` tests that use ≥21-tile territories now fail on changed balances. For each failure, confirm the new number equals old upkeep + `calcAdminBurden(territoryLength)` and update the expected value. Do NOT weaken assertions; recompute them.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hex-battles/logic/
git commit -m "feat(econ): apply per-territory administrative burden to upkeep"
```

---

## Phase 4 — City-adjacency development bonus

### Task 6: Add the stacking city-adjacency bonus to `calcTerritoryIncome`

**Files:**
- Modify: `artifacts/hex-battles/logic/gameLogic.ts` (inside `calcTerritoryIncome`)
- Test: `artifacts/hex-battles/logic/gameLogic.test.ts`

- [ ] **Step 1: Write failing test**

Append to `gameLogic.test.ts`:
```ts
describe("calcTerritoryIncome city-adjacency bonus", () => {
  it("grants +1 per developed same-owner tile adjacent to a city, stacking", () => {
    // City at 0,0; two developed neighbours (field + sawmill) -> +2 bonus,
    // plus their own income (3 + 3) and the city tile (grass 2 + city 2).
    const tiles = [
      mkTile(0, 0, "player", "grass"),    // city: 2 + CITY_BONUS 2
      mkTile(1, 0, "player", "field"),    // 3, adjacent to city -> +1
      mkTile(0, 1, "player", "sawmill"),  // 3, adjacent to city -> +1
    ];
    const tileMap = new Map(tiles.map((t) => [t.key, t]));
    const cities = new Set(["0,0"]);
    // 2 + 2 (city) + 3 + 3 + 1 + 1 = 12
    expect(calcTerritoryIncome(tiles, new Map(), cities, tileMap)).toBe(12);
  });
  it("does not grant the bonus for an enemy-owned adjacent city", () => {
    const tiles = [mkTile(1, 0, "player", "field")];
    const enemyCity = mkTile(0, 0, "ai1", "grass");
    const tileMap = new Map([
      ["1,0", tiles[0]],
      ["0,0", enemyCity],
    ]);
    const cities = new Set(["0,0"]);
    // Only the field's own income, no bonus (city owned by ai1).
    expect(calcTerritoryIncome(tiles, new Map(), cities, tileMap)).toBe(3);
  });
});
```
(Confirm the `mkTile`/HEX_EDGES axial directions match: with flat-top axial dirs including `[1,0]` and `[0,1]`, tiles `1,0` and `0,1` are neighbours of `0,0`.)

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: FAIL — bonus not yet applied (returns 10 and 3).

- [ ] **Step 3: Implement**

Inside `calcTerritoryIncome`, within the loop, after the base `income +=` line:
```ts
    if (DEVELOPED_TERRAINS.has(t.terrain)) {
      const [q, r] = t.key.split(",").map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (!cities.has(nk)) continue;
        if (tileMap.get(nk)?.owner === t.owner) income += 1;
      }
    }
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `pnpm test`
Expected: PASS (existing tests rarely place developed tiles next to cities; fix any that now shift by recomputing).

- [ ] **Step 6: Commit**

```bash
git add artifacts/hex-battles/logic/
git commit -m "feat(econ): stacking city-adjacency development income bonus"
```

---

## Phase 5 — Player develop action

### Task 7: Pure eligibility predicate

**Files:**
- Modify: `artifacts/hex-battles/logic/gameLogic.ts`
- Test: `artifacts/hex-battles/logic/gameLogic.test.ts`

- [ ] **Step 1: Write failing test**

Append to `gameLogic.test.ts`:
```ts
import { canDevelopTile } from "@/logic/gameLogic";

describe("canDevelopTile", () => {
  const base = { entityId: "peasant" as const, terrain: "grass" as const, isSpent: false, balance: 5 };
  it("allows a non-spent peasant on grass/forest with >=5 gold", () => {
    expect(canDevelopTile(base)).toBe(true);
    expect(canDevelopTile({ ...base, terrain: "forest" })).toBe(true);
  });
  it("rejects non-peasants", () => {
    expect(canDevelopTile({ ...base, entityId: "warrior" })).toBe(false);
  });
  it("rejects spent peasants", () => {
    expect(canDevelopTile({ ...base, isSpent: true })).toBe(false);
  });
  it("rejects insufficient gold", () => {
    expect(canDevelopTile({ ...base, balance: 4 })).toBe(false);
  });
  it("rejects non-developable terrain", () => {
    expect(canDevelopTile({ ...base, terrain: "desert" })).toBe(false);
    expect(canDevelopTile({ ...base, terrain: "field" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: FAIL — `canDevelopTile` not exported.

- [ ] **Step 3: Implement**

Add `DEVELOP_COST`, `developTargetFor` to the `@/utils/hexGrid` import in `gameLogic.ts`, plus `TerrainType` to its type imports, then add:
```ts
/**
 * Whether a selected unit may develop the tile it stands on: a non-spent peasant
 * on developable terrain (grass/forest) whose territory holds at least
 * DEVELOP_COST gold. Shared by the player UI (EntityPanel) and the AI.
 */
export function canDevelopTile(o: {
  entityId: EntityType | undefined;
  terrain: TerrainType;
  isSpent: boolean;
  balance: number;
}): boolean {
  if (o.entityId !== "peasant") return false;
  if (o.isSpent) return false;
  if (developTargetFor(o.terrain) === null) return false;
  return o.balance >= DEVELOP_COST;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/logic/
git commit -m "feat(develop): add canDevelopTile eligibility predicate"
```

---

### Task 8: Develop button in EntityPanel + wiring in game.tsx

**Files:**
- Modify: `artifacts/hex-battles/components/EntityPanel.tsx`
- Modify: `artifacts/hex-battles/app/game.tsx` (EntityPanel render ~line 1492-1512; add handler)

This action mutates `tile.terrain` (not entities) and never changes ownership/connectivity, so no territory recalculation is needed: the tile keys and owners are unchanged, so the territory id and its balance entry are stable.

- [ ] **Step 1: Add `onDevelop` prop to EntityPanel**

In `EntityPanel.tsx`, add to `EntityPanelProps`:
```ts
  onDevelop?: (targetTerrain: import("@/types").TerrainType) => void;
```
Add to the destructured params: `onDevelop,`.

- [ ] **Step 2: Compute develop eligibility**

In `EntityPanel.tsx`, after the `removeEnabled` line, add (import `canDevelopTile` from `@/logic/gameLogic` and `developTargetFor` from `@/utils/hexGrid`):
```ts
  const developTarget = entityTile ? developTargetFor(entityTile.terrain) : null;
  const developEnabled =
    !!entityTile &&
    !!developTarget &&
    canDevelopTile({
      entityId,
      terrain: entityTile.terrain,
      isSpent,
      balance: entityTerritoryBalance,
    });
```

- [ ] **Step 3: Render the Develop button**

In `EntityPanel.tsx`, add a third `TouchableOpacity` before the closing `</View>` (only when a target exists, so non-peasants never see it):
```tsx
      {developTarget && (
        <TouchableOpacity
          style={[styles.buildBtn, !developEnabled && styles.buildBtnDisabled]}
          activeOpacity={developEnabled ? 0.75 : 1}
          onPress={() => {
            if (isAiTurn || gameResult !== null) return;
            if (!developEnabled || !developTarget) return;
            onDevelop?.(developTarget);
          }}
        >
          <Text
            style={[
              styles.buildBtnText,
              !developEnabled && styles.buildBtnTextDisabled,
            ]}
          >
            ⚒ Develop ({DEVELOP_COST})
          </Text>
        </TouchableOpacity>
      )}
```
Import `DEVELOP_COST` from `@/utils/hexGrid`.

- [ ] **Step 4: Wire the handler in game.tsx**

In `app/game.tsx`, define a handler (near other entity handlers; use the existing state setters `setMutableTileMap`, `setTerritoryBalances`, `setSpentUnits`, and values `activeTileMap`/`entities`/`territoryBalances`/`pushHistory`):
```ts
const handleDevelopTile = useCallback(
  (targetTerrain: TerrainType) => {
    if (isAiTurn || gameResult !== null || !selectedEntityKey) return;
    const tile = activeTileMap.get(selectedEntityKey);
    if (!tile) return;
    const territory = getContiguousTerritory(
      activeTileMap, selectedEntityKey, "player", entities,
    );
    const tid = getTerritoryId(territory);
    if (!tid) return;
    const bal = territoryBalances.get(tid) ?? 0;
    if (bal < DEVELOP_COST) return;
    pushHistory();
    setMutableTileMap((prev) => {
      const next = new Map(prev);
      const tt = next.get(selectedEntityKey);
      if (tt) next.set(selectedEntityKey, { ...tt, terrain: targetTerrain });
      return next;
    });
    setTerritoryBalances((prev) => {
      const next = new Map(prev);
      next.set(tid, bal - DEVELOP_COST);
      return next;
    });
    setSpentUnits((prev) => new Set(prev).add(selectedEntityKey));
  },
  [isAiTurn, gameResult, selectedEntityKey, activeTileMap, entities, territoryBalances, pushHistory],
);
```
Ensure imports include `TerrainType` (from `@/types`), `getContiguousTerritory`, `getTerritoryId`, `DEVELOP_COST` (from `@/utils/hexGrid`). If `activeTileMap` in this scope is a derived map rather than `mutableTileMap`, develop still reads from it for the territory; the write uses `setMutableTileMap`, which is correct (it is the source of `activeTileMap`).

- [ ] **Step 5: Pass the prop**

In the `<EntityPanel ... />` JSX (~line 1493), add:
```tsx
          onDevelop={handleDevelopTile}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/hex-battles/components/EntityPanel.tsx artifacts/hex-battles/app/game.tsx
git commit -m "feat(develop): player develop action via EntityPanel button"
```

---

## Phase 6 — Rendering & economy breakdown

### Task 9: Terrain fills for field & sawmill

**Files:**
- Modify: `artifacts/hex-battles/constants/colors.ts:49-55`

The terrain layer already looks up `TERRAIN_FILLS[tile.terrain]` (HexTileLayer.tsx:22), so adding entries is sufficient; the territory layer paints owned non-lake/mountain tiles in the owner colour, which is the desired behaviour for developed owned tiles. The distinct terrain fills show through where terrain is rendered.

- [ ] **Step 1: Add fills**

In `colors.ts`:
```ts
export const TERRAIN_FILLS: Record<string, string> = {
  grass: '#66985C',
  desert: '#C7A760',
  mountain: '#4A4642',
  lake: '#5BAFD6',
  forest: '#2D6A2D',
  field: '#B8A038',   // golden ploughed field, distinct from grass/desert
  sawmill: '#7A5230',  // cut-timber brown, distinct from forest
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/hex-battles/constants/colors.ts
git commit -m "feat(render): distinct fills for field and sawmill tiles"
```

---

### Task 10: Economy breakdown counts developed tiles

**Files:**
- Modify: `artifacts/hex-battles/hooks/useEconBreakdown.ts`

`useEconBreakdown` drives the player's economy modal. It must count field/sawmill income or the displayed total diverges from the real end-turn math. Simplest correct approach: fold field into the grass income line and sawmill into the forest line (they share the same +base, +1 semantics), and add an admin-burden line.

- [ ] **Step 1: Count developed tiles with their base group and use the table for income**

In the tile loop (lines 56-58), extend:
```ts
      if (t.terrain === "grass" || t.terrain === "field") grassCount++;
      else if (t.terrain === "forest" || t.terrain === "sawmill") forestCount++;
      else if (t.terrain === "desert") desertCount++;
```

- [ ] **Step 2: Compute income from the terrain table (not hard-coded ×2)**

Replace the income lines (99-103). Because field/sawmill income (3) differs from grass/forest (2), sum from `TERRAIN_INCOME` per tile rather than `count * 2`:
```ts
    let grassIncome = 0;
    let forestIncome = 0;
    let desertIncome = 0;
    for (const t of selectedTerritory) {
      if (entities.get(t.key) === "rebel") continue;
      if (t.terrain === "grass" || t.terrain === "field") grassIncome += TERRAIN_INCOME[t.terrain];
      else if (t.terrain === "forest" || t.terrain === "sawmill") forestIncome += TERRAIN_INCOME[t.terrain];
      else if (t.terrain === "desert") desertIncome += TERRAIN_INCOME[t.terrain];
    }
    const cityIncome = cityCount * CITY_BONUS;
    const totalIncome = grassIncome + forestIncome + desertIncome + cityIncome;
```

- [ ] **Step 3: Include admin burden in displayed upkeep**

Import `calcAdminBurden` from `@/utils/hexGrid`. After `const totalUpkeep = upkeepGroups.reduce(...)`, add the burden and include it in `net`:
```ts
    const adminBurden = calcAdminBurden(selectedTerritory.length);
    // ... existing rebel loss loop ...
    const net = totalIncome - totalUpkeep - adminBurden - rebelTotalLoss;
```
Add `adminBurden` to the `EconBreakdownResult` interface and the returned object so the modal can show it.

> **NOTE:** The breakdown does not separately surface the city-adjacency bonus (it is part of the real income but not a per-terrain line here). If the modal must reconcile exactly, replace the per-group income display with a single `calcTerritoryIncome(selectedTerritory, entities, cities, activeTileMap)` total — but that requires passing `activeTileMap` into the hook. Keep the simpler per-group display unless the discrepancy is visible/undesired; record this as a known minor display gap.

- [ ] **Step 4: Typecheck + test**

Run: `pnpm run typecheck && pnpm --filter @workspace/hex-battles exec vitest run`
Expected: PASS (update any `useEconBreakdown` test expectations if present).

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/hooks/useEconBreakdown.ts
git commit -m "feat(ui): economy breakdown accounts for developed tiles and admin burden"
```

---

## Phase 7 — AI active development

### Task 11: AI develop helper `dtFindDevelopMove`

**Files:**
- Modify: `artifacts/hex-battles/logic/aiHelpers.ts`
- Test: `artifacts/hex-battles/logic/aiHelpers.test.ts`

The helper finds the best in-place develop for a territory: a non-spent peasant standing on developable terrain, preferring tiles adjacent to an own city (for the stacking bonus). v1 scope: the AI develops only with peasants already standing on a developable tile — it does not reposition peasants to optimal tiles (a future refinement).

- [ ] **Step 1: Write failing test**

Append to `aiHelpers.test.ts` (reuse the file's existing `mkTile`/context builders; adapt to the real `AiContext` shape used by the other tests in this file):
```ts
import { dtFindDevelopMove } from "@/logic/aiHelpers";

describe("dtFindDevelopMove", () => {
  it("returns null when no own peasant stands on developable terrain", () => {
    const tiles = [mkTile(0, 0, "ai1", "grass")]; // no peasant
    const ctx = makeCtx(tiles, new Map(), new Set(), "ai1"); // adapt to file helper
    expect(dtFindDevelopMove(tiles, ctx, new Set(), 10)).toBeNull();
  });
  it("returns null when balance < DEVELOP_COST", () => {
    const tiles = [mkTile(0, 0, "ai1", "grass")];
    const entities = new Map([["0,0", "peasant"]]);
    const ctx = makeCtx(tiles, entities, new Set(), "ai1");
    expect(dtFindDevelopMove(tiles, ctx, new Set(), 4)).toBeNull();
  });
  it("develops a peasant's grass tile into a field", () => {
    const tiles = [mkTile(0, 0, "ai1", "grass")];
    const entities = new Map([["0,0", "peasant"]]);
    const ctx = makeCtx(tiles, entities, new Set(), "ai1");
    expect(dtFindDevelopMove(tiles, ctx, new Set(), 10)).toEqual({ key: "0,0", terrain: "field" });
  });
  it("prefers a peasant adjacent to an own city", () => {
    const tiles = [
      mkTile(5, 5, "ai1", "grass"),  // far peasant
      mkTile(1, 0, "ai1", "forest"), // peasant next to own city at 0,0
      mkTile(0, 0, "ai1", "grass"),  // own city
    ];
    const entities = new Map([["5,5", "peasant"], ["1,0", "peasant"]]);
    const ctx = makeCtx(tiles, entities, new Set(["0,0"]), "ai1");
    expect(dtFindDevelopMove(tiles, ctx, new Set(), 10)).toEqual({ key: "1,0", terrain: "sawmill" });
  });
  it("skips spent peasants", () => {
    const tiles = [mkTile(0, 0, "ai1", "grass")];
    const entities = new Map([["0,0", "peasant"]]);
    const ctx = makeCtx(tiles, entities, new Set(), "ai1");
    expect(dtFindDevelopMove(tiles, ctx, new Set(["0,0"]), 10)).toBeNull();
  });
});
```
(`makeCtx` is a stand-in for however this test file constructs an `AiContext` — match the existing pattern in `aiHelpers.test.ts`. The context needs `entities`, `cities`, `tileMap`, `aiOwner` populated.)

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiHelpers.test.ts`
Expected: FAIL — `dtFindDevelopMove` not exported.

- [ ] **Step 3: Implement**

In `aiHelpers.ts` add imports `DEVELOP_COST`, `developTargetFor`, `HEX_EDGES`, `tileKey` from `@/utils/hexGrid` and `TerrainType` from `@/types` (match existing import style), then:
```ts
/**
 * Best in-place tile development for an AI territory: a non-spent peasant on
 * developable terrain (grass/forest), preferring a peasant adjacent to one of
 * the owner's own cities (the income bonus stacks there). Returns the tile key
 * and the terrain it becomes, or null when nothing is worth/possible. The AI
 * develops only peasants already standing on a developable tile.
 */
export function dtFindDevelopMove(
  territory: HexTile[],
  ctx: AiContext,
  spentUnits: Set<string>,
  balance: number,
): { key: string; terrain: TerrainType } | null {
  if (balance < DEVELOP_COST) return null;
  let best: { key: string; terrain: TerrainType } | null = null;
  let bestPrio = -1;
  for (const t of territory) {
    const target = developTargetFor(t.terrain);
    if (!target) continue;
    if (ctx.entities.get(t.key) !== "peasant") continue;
    if (spentUnits.has(t.key)) continue;
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
(If `HexTile`/`AiContext` are not already imported in `aiHelpers.ts`, add them — check the file's existing imports first.)

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/logic/aiHelpers.ts artifacts/hex-battles/logic/aiHelpers.test.ts
git commit -m "feat(ai): dtFindDevelopMove helper for in-place tile development"
```

---

### Task 12: `develop` on the AI exec interface

**Files:**
- Modify: `artifacts/hex-battles/logic/aiStrategy.ts:49-57` (interface), `~1416-1510` (impl + exec object)

- [ ] **Step 1: Extend the interface**

In `aiStrategy.ts` `AiDecisionExec` (line 49), add:
```ts
  develop(target: string, terrain: TerrainType, cost: number): Promise<boolean>;
```
Ensure `TerrainType` is imported in this file (it imports from `@/types`).

- [ ] **Step 2: Implement `dtExecDevelop`**

In `aiStrategy.ts`, alongside `dtExecBuild`/`dtExecRemove` (before the `exec` object, ~line 1490), add (it mirrors `dtExecBuild` but mutates terrain, deducts cost, and marks the peasant spent; no recalculation needed since ownership is unchanged):
```ts
      const dtExecDevelop = async (
        target: string,
        terrain: TerrainType,
        cost: number,
      ): Promise<boolean> => {
        if (!cbs.refs.isTurnActive()) return false;
        if (!canPay(cost)) return false;
        const tt = ws.tileMap.get(target);
        if (!tt) return false;
        ws.tileMap = new Map(ws.tileMap);
        ws.tileMap.set(target, { ...tt, terrain });
        cache.clear();
        const terr = getContiguousTerritory(ws.tileMap, target, aiOwner, ws.entities);
        const tid = getTerritoryId(terr);
        ws.balances = new Map(ws.balances);
        if (tid) ws.balances.set(tid, (ws.balances.get(tid) ?? 0) - cost);
        ws.spentUnits = new Set(ws.spentUnits);
        ws.spentUnits.add(target);
        cbs.state.setMutableTileMap(new Map(ws.tileMap));
        cbs.state.setTerritoryBalances(new Map(ws.balances));
        await dtAwait();
        return true;
      };
```
(Verify `canPay`, `cache`, `dtAwait`, `ws`, `aiOwner`, `cbs` are in scope here — they are the same identifiers `dtExecBuild` uses.)

- [ ] **Step 3: Register in the exec object**

In the `exec: AiDecisionExec = { ... }` literal (~line 1503), add:
```ts
        develop: dtExecDevelop,
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS (all `AiDecisionExec` constructors now satisfy the new member — there should be only this one; if a test builds a mock exec, add `develop: async () => true` to it).

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/logic/aiStrategy.ts
git commit -m "feat(ai): add develop method to AiDecisionExec"
```

---

### Task 13: Wire development into the AI decision loop

**Files:**
- Modify: `artifacts/hex-battles/logic/aiStrategy.ts` (inside `runAiTerritoryDecisionLoop`)
- Test: `artifacts/hex-battles/logic/aiStrategy.test.ts`

Development is a low-priority "spend spare gold" action: attempt it only when no higher-priority action (attack/defend/buy/build) was taken this iteration, so the AI never skips combat to farm. The loop already has `currTerr`, `aiCtx`, `currBal`, `exec`, and an `actionTaken` flag.

- [ ] **Step 1: Locate the loop's spent-units set**

Read `runAiTerritoryDecisionLoop` and find the set used to filter available/idle units (the same membership `markSpent` writes to). Call it `<spentSet>` below. If the loop reads spent state via `ws.spentUnits`, use that; confirm by reading the function body once.

- [ ] **Step 2: Write failing test**

Append to `aiStrategy.test.ts` a test that builds a single AI territory (≥2 tiles, no adjacent enemies, a peasant on a grass tile, balance ≥ 5) and runs the loop with a recording exec, asserting `exec.develop` was called with `(peasantKey, "field", 5)`. Mirror the existing test harness in this file (it already constructs `aiCtx` and a mock/real `exec`). Example skeleton:
```ts
it("develops an idle peasant's tile when no combat is available", async () => {
  // ...build tiles/entities/balances with a peasant on grass, no enemies...
  const calls: any[] = [];
  const exec = makeRecordingExec(calls); // include develop: async (...a) => (calls.push(["develop", ...a]), true)
  await runAiTerritoryDecisionLoop(/* ...ctx..., */ exec, /* ... */);
  expect(calls.some((c) => c[0] === "develop")).toBe(true);
});
```

- [ ] **Step 3: Run, verify FAIL**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts`
Expected: FAIL — develop never called.

- [ ] **Step 4: Implement the develop attempt**

Add `dtFindDevelopMove` and `DEVELOP_COST` to the imports. Near the end of one loop iteration, after the final building/buy `if (!actionTaken)` block and before the iteration's tail, insert:
```ts
      if (!actionTaken) {
        const dev = dtFindDevelopMove(currTerr, aiCtx, <spentSet>, currBal);
        if (dev) actionTaken = await exec.develop(dev.key, dev.terrain, DEVELOP_COST);
      }
```
Replace `<spentSet>` with the set identified in Step 1.

- [ ] **Step 5: Run, verify PASS**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `pnpm test`
Expected: PASS. If any existing aiStrategy self-play/economy test now diverges because the AI develops, confirm the divergence is the intended new behaviour and update expectations.

- [ ] **Step 7: Commit**

```bash
git add artifacts/hex-battles/logic/aiStrategy.ts artifacts/hex-battles/logic/aiStrategy.test.ts
git commit -m "feat(ai): develop idle-peasant tiles as a spare-gold action"
```

---

### Task 14: Expert AI development

**Files:**
- Modify: `artifacts/hex-battles/logic/aiExpert.ts`
- Test: `artifacts/hex-battles/logic/aiExpert.test.ts`

The expert path generates a scored list of `ExpertAction`s rather than acting inline. Development must appear as a candidate action so expert/super_expert also develop.

- [ ] **Step 1: Read the action model**

Read `aiExpert.ts` to find the `ExpertAction` type, the per-territory action generator (the function containing the `income`/`canAfford` at ~line 615), and how actions are executed against the exec (search for `exec.build`/`exec.buy` in the expert apply path). Note the exact shape needed to add a develop action and how it is dispatched to `exec.develop`.

- [ ] **Step 2: Write failing test**

In `aiExpert.test.ts`, mirroring the file's existing harness, build a territory with an idle peasant on grass, no profitable combat, and assert the generated actions include a develop action (or that applying the expert turn calls `exec.develop`). Use the same context/exec construction the other expert tests use.

- [ ] **Step 3: Run, verify FAIL**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

In the per-territory action generator, after the existing build/buy candidate generation, add a develop candidate using the shared helper:
```ts
const dev = dtFindDevelopMove(territory, ctx, /* expert spent set */, balanceForTid);
if (dev && canAfford(DEVELOP_COST)) {
  out.push(/* ExpertAction: kind "develop", target dev.key, terrain dev.terrain,
              cost DEVELOP_COST, with a modest positive score below combat/expansion
              (e.g. score = 0.5) so it is chosen only when nothing better exists */);
}
```
Match the real `ExpertAction` shape found in Step 1 (import `dtFindDevelopMove` from `@/logic/aiHelpers` and `DEVELOP_COST` from `@/utils/hexGrid`). In the expert apply/dispatch switch, add a branch that calls `await exec.develop(action.target, action.terrain, action.cost)`.

- [ ] **Step 5: Run, verify PASS**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite**

Run: `pnpm test`
Expected: PASS (recompute any shifted expert-economy expectations).

- [ ] **Step 7: Commit**

```bash
git add artifacts/hex-battles/logic/aiExpert.ts artifacts/hex-battles/logic/aiExpert.test.ts
git commit -m "feat(ai): expert AI develops tiles as a low-priority action"
```

---

## Phase 8 — Polish & full verification

### Task 15: Neutral-capture priority awareness

**Files:**
- Modify: `artifacts/hex-battles/logic/aiStrategy.ts:764`

- [ ] **Step 1: Treat developed terrain like its base for capture priority**

At line 764, extend the terrain check so developed tiles rank with grass/forest:
```ts
const neutralPrio = (t: HexTile): number =>
  aiCtx.cities.has(t.key)
    ? 3
    : (t.terrain === "grass" || t.terrain === "forest" ||
       t.terrain === "field" || t.terrain === "sawmill")
      ? 2
      : 1;
```
(Neutral tiles are never developed, so this is defensive consistency.)

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/hex-battles/logic/aiStrategy.ts
git commit -m "chore(ai): rank developed terrain with base terrain for captures"
```

---

### Task 16: Final verification

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS — all suites green, including the new development/burden tests.

- [ ] **Step 3: Build**

Run: `pnpm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional, via `/run`)**

Launch the app, take a peasant onto a grass tile, confirm the "⚒ Develop (5)" button appears and applies (tile recolours, 5 gold deducted, peasant spent). Grow a territory past 20 tiles and confirm the economy modal shows the admin-burden line and net drops.

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A
git commit -m "test: tile development & administrative burden full verification"
```

---

## Self-Review notes

- **Spec coverage:** new terrain types (T1), develop constants (T2), income centralization (T3–T4), admin burden (T5), city-adjacency bonus (T6), player develop action + UI (T7–T8), rendering (T9), econ breakdown (T10), AI economy correctness (T4–T5 shared fns) + AI active development (T11–T14), neutral-priority/string-compare fixes (T10, T15). All spec sections map to tasks.
- **Known deliberate simplifications:** per-tile AI heuristics (`aiStrategy:880`, `aiExpert:160/367`) omit the non-local city-adjacency bonus; AI develops only peasants already standing on developable tiles (no repositioning) in v1; econ-breakdown shows burden as its own line but folds the city-adjacency bonus into the territory total only if upgraded (Task 10 note). None affect the bankruptcy-critical end-turn math, which is exact via `calcTerritoryIncome` + burden-aware `calcTerritoryUpkeep`.
- **Type consistency:** `calcTerritoryIncome(territory, entities, cities, tileMap)`, `calcTerritoryUpkeep(territory, entities)`, `canDevelopTile({entityId, terrain, isSpent, balance})`, `dtFindDevelopMove(territory, ctx, spentUnits, balance) -> {key, terrain} | null`, `exec.develop(target, terrain, cost)`, `developTargetFor(terrain) -> TerrainType | null`, `calcAdminBurden(tileCount) -> number` are used consistently across tasks.
