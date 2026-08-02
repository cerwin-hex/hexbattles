# Ranged Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a player-only ranged unit track (Shortbowman → Longbowman → Crossbowman) that cannot capture ground but kills adjacent enemy units by shooting, on top of a split of every entity's single `strength` into offensive and defensive strength.

**Architecture:** Four layers, built bottom-up. (1) The data model splits `strength` into `offStrength`/`defStrength`/`tier` and gains a `unitClass`; merging becomes tier-based. (2) A single `canCapture` predicate closes every ground-taking path to ranged units. (3) A pure `logic/rangedAttack.ts` computes legal targets and resolves a shot. (4) Game state gains `firedUnits` (one shot per turn) and `killMarks` (the 🎯 marker), and the tap handler plus the highlight layers wire it to the player.

**Tech Stack:** TypeScript, Expo React Native, react-native-svg, Vitest, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-31-ranged-units-design.md` — read it before Task 1.

## Global Constraints

- All game code is English — identifiers, comments, string literals. The user writes Danish; the code never does.
- Always typecheck from the repo root: `pnpm run typecheck`. Running `tsc` inside a single package fails on unbuilt dependencies.
- Full suite: `pnpm test`. Single file: `pnpm --filter @workspace/hex-battles exec vitest run <path>` with paths relative to `artifacts/hex-battles/`.
- Baseline before any change: **18 test files, 465 passed, 9 skipped.** Test counts only ever go up.
- Never `git push`. Commit freely; the user pushes manually.
- Costs and upkeep are fixed by the spec: Shortbowman 12/4, Longbowman 24/12, Crossbowman 36/36.
- Ranged strengths are fixed by the spec: attack 2/3/4, defense 0/1/2, tiers 1/2/3, movement 3 (the default; no `movement` field).
- The AI must not buy ranged units in this branch.
- `ENTITY_META` in `artifacts/hex-battles/utils/hexGrid.ts` is the single source of truth for unit cost, upkeep, strength and class. Do not hardcode those numbers anywhere else.
- All paths below are relative to `artifacts/hex-battles/` unless stated otherwise.

---

### Task 1: Split strength into offense, defense and tier

Pure refactor. No new units, no behaviour change anywhere. Every existing entity gets `offStrength === defStrength === ` its old `strength`, so this task must leave every existing test passing untouched and must leave seeded self-play results bit-identical.

**Files:**
- Modify: `types.ts:27-37` (`EntityMeta`), add `UnitClass`
- Modify: `utils/hexGrid.ts:19-32` (`ENTITY_META`), `:49-51` (`isCavalry`), and every `.strength` read in the file
- Modify: `constants/gameConstants.ts:23-36` (merge tables), `:65` (`INFO_TABLE_ROWS`)
- Modify: `logic/gameLogic.ts:361-368` (`mergeResult`)
- Modify: `logic/aiStrategy.ts`, `logic/aiExpert.ts` (every `.strength` read)
- Modify: `logic/tileTapHandler.ts:464-465`
- Modify: `components/UnitToken.tsx:53`
- Modify: `components/WelcomeModal.tsx:164`, `components/MainMenu.tsx:120`
- Test: `utils/hexGrid.test.ts`, `logic/gameLogic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `UnitClass`, `EntityMeta.offStrength`, `EntityMeta.defStrength`, `EntityMeta.tier`, `EntityMeta.unitClass`; `unitClassOf(e)`, `isCavalry(e)`, `isRanged(e)`, `canCapture(e)`, `militaryValue(e)` all exported from `utils/hexGrid.ts`; `TIER_TO_UNIT` exported from `constants/gameConstants.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `logic/gameLogic.test.ts` (inside the existing `describe("mergeResult", ...)` block if there is one, otherwise a new block):

```ts
describe("mergeResult tier parity", () => {
  it("preserves every infantry and cavalry merge outcome", () => {
    expect(mergeResult("peasant", "peasant")).toBe("warrior");
    expect(mergeResult("peasant", "warrior")).toBe("swordsman");
    expect(mergeResult("warrior", "peasant")).toBe("swordsman");
    expect(mergeResult("warrior", "warrior")).toBeNull();
    expect(mergeResult("swordsman", "peasant")).toBeNull();
    expect(mergeResult("scout", "scout")).toBe("knight");
    expect(mergeResult("scout", "knight")).toBeNull();
    expect(mergeResult("knight", "knight")).toBeNull();
  });

  it("never merges across tracks", () => {
    expect(mergeResult("peasant", "scout")).toBeNull();
    expect(mergeResult("scout", "peasant")).toBeNull();
    expect(mergeResult("warrior", "knight")).toBeNull();
  });

  it("never merges non-units", () => {
    expect(mergeResult("tower", "tower")).toBeNull();
    expect(mergeResult("peasant", "tower")).toBeNull();
    expect(mergeResult("peasant", "rebel")).toBeNull();
  });
});
```

Add to `utils/hexGrid.test.ts`:

```ts
describe("offense/defense split", () => {
  // Every entity that existed before the ranged track must keep a single
  // effective strength: the split is a refactor for them, not a rule change.
  const PRE_RANGED = [
    "peasant", "warrior", "swordsman", "scout", "knight",
    "tower", "castle", "bridge", "rebel", "city",
  ] as const;

  it("keeps offense equal to defense for every pre-ranged entity", () => {
    for (const id of PRE_RANGED) {
      expect(ENTITY_META[id].offStrength).toBe(ENTITY_META[id].defStrength);
    }
  });

  it("tags each unit with its class", () => {
    expect(ENTITY_META.peasant.unitClass).toBe("infantry");
    expect(ENTITY_META.scout.unitClass).toBe("cavalry");
    expect(ENTITY_META.tower.unitClass).toBeUndefined();
    expect(isCavalry("knight")).toBe(true);
    expect(isCavalry("swordsman")).toBe(false);
    expect(canCapture("swordsman")).toBe(true);
  });

  it("gives every unit a tier matching its old strength", () => {
    expect(ENTITY_META.peasant.tier).toBe(1);
    expect(ENTITY_META.warrior.tier).toBe(2);
    expect(ENTITY_META.swordsman.tier).toBe(3);
    expect(ENTITY_META.scout.tier).toBe(1);
    expect(ENTITY_META.knight.tier).toBe(2);
  });

  it("reports military value as the larger of the two strengths", () => {
    expect(militaryValue("swordsman")).toBe(3);
    expect(militaryValue("bridge")).toBe(0);
  });
});
```

Add `isCavalry`, `canCapture` and `militaryValue` to the import list at the top of `utils/hexGrid.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts logic/gameLogic.test.ts`
Expected: FAIL — `offStrength`, `tier`, `unitClass`, `canCapture` and `militaryValue` do not exist.

- [ ] **Step 3: Change the type**

In `types.ts`, add above `EntityMeta`:

```ts
/**
 * Which track a unit belongs to. The track decides what a unit may merge with
 * and which tile-entry rules apply to it. Buildings and markers have no class.
 */
export type UnitClass = 'infantry' | 'cavalry' | 'ranged';
```

Replace the `EntityMeta` interface with:

```ts
export interface EntityMeta {
  name: string;
  cost: number;
  upkeep: number;
  isUnit: boolean;
  /** Strength used when this entity attacks, captures or shoots. */
  offStrength: number;
  /** Strength this entity projects in defense — the value ZoC is built from. */
  defStrength: number;
  /**
   * Merge/upgrade rank inside the unit's own track. Two units merge into the
   * unit whose tier is the sum of theirs. 0 for non-combat entities.
   */
  tier: number;
  /** Units only; drives the merge track and the tile-entry rules. */
  unitClass?: UnitClass;
  /** Max movement budget per turn. Defaults to DEFAULT_MOVEMENT (3) when absent. */
  movement?: number;
  /** Max combat actions per turn. Defaults to 1 when absent; >1 enables the charge ability. */
  maxAttacks?: number;
}
```

Export `UnitClass` from `utils/hexGrid.ts` alongside the other re-exported types (the `import type` block at `:1-8` and the `export type` block at `:10-17`).

- [ ] **Step 4: Rewrite ENTITY_META and the class helpers**

Replace `utils/hexGrid.ts:19-32` with:

```ts
export const ENTITY_META: Record<EntityType, EntityMeta> = {
  peasant:   { name: 'Peasant',   cost: 10, upkeep: 3,  isUnit: true,  offStrength: 1, defStrength: 1, tier: 1, unitClass: 'infantry' },
  warrior:   { name: 'Warrior',   cost: 20, upkeep: 9,  isUnit: true,  offStrength: 2, defStrength: 2, tier: 2, unitClass: 'infantry' },
  swordsman: { name: 'Swordsman', cost: 30, upkeep: 27, isUnit: true,  offStrength: 3, defStrength: 3, tier: 3, unitClass: 'infantry' },
  scout:     { name: 'Scout',     cost: 12, upkeep: 4,  isUnit: true,  offStrength: 1, defStrength: 1, tier: 1, unitClass: 'cavalry', movement: 5, maxAttacks: 2 },
  knight:    { name: 'Knight',    cost: 24, upkeep: 12, isUnit: true,  offStrength: 2, defStrength: 2, tier: 2, unitClass: 'cavalry', movement: 5, maxAttacks: 2 },
  // NOTE: tower/castle upkeep here is the per-building BASE rate only.
  // Actual territory upkeep is LINEAR (n-th building costs n×base); use calcDefenseUpkeep/nextDefenseUpkeep.
  tower:     { name: 'Tower',     cost: 15, upkeep: 1,  isUnit: false, offStrength: 1, defStrength: 1, tier: 1 },
  castle:    { name: 'Castle',    cost: 30, upkeep: 5,  isUnit: false, offStrength: 2, defStrength: 2, tier: 2 },
  bridge:    { name: 'Bridge',    cost: 5,  upkeep: 1,  isUnit: false, offStrength: 0, defStrength: 0, tier: 0 },
  rebel:     { name: 'Rebel',     cost: 0,  upkeep: 0,  isUnit: false, offStrength: 0, defStrength: 0, tier: 0 },
  city:      { name: 'City',      cost: 5,  upkeep: 0,  isUnit: false, offStrength: 0, defStrength: 0, tier: 0 },
};
```

Replace `isCavalry` (`utils/hexGrid.ts:47-51`) and add the new helpers next to it:

```ts
/** The unit track this entity belongs to, or undefined for buildings/markers. */
export function unitClassOf(entity: EntityType): UnitClass | undefined {
  return ENTITY_META[entity].unitClass;
}

/** Cavalry (charge units) follow special combat rules: a free 2-action budget,
 * at most one strike against a unit/rebel, and they can never assault buildings. */
export function isCavalry(entity: EntityType): boolean {
  return ENTITY_META[entity].unitClass === 'cavalry';
}

/** Ranged units shoot adjacent enemies but can never take ground. */
export function isRanged(entity: EntityType): boolean {
  return ENTITY_META[entity].unitClass === 'ranged';
}

/**
 * Whether this entity may take ground — capture a neutral or enemy tile, clear
 * a rebel by stepping on it, or be bought directly into an attack. False only
 * for ranged units. This is the single gate for the ranged no-capture rule.
 */
export function canCapture(entity: EntityType): boolean {
  return !isRanged(entity);
}

/**
 * How much military weight an entity carries, for AI valuation sums that care
 * about "how strong is this side" rather than about a specific attack or
 * defense roll. Equals the old `strength` for every non-ranged entity.
 */
export function militaryValue(entity: EntityType): number {
  const m = ENTITY_META[entity];
  return Math.max(m.offStrength, m.defStrength);
}
```

- [ ] **Step 5: Rewrite the merge tables and mergeResult**

Replace `constants/gameConstants.ts:23-36` (both `STRENGTH_TO_*` tables) with:

```ts
/**
 * Merge tables, one per unit track. Two units of the same track merge into the
 * unit whose tier equals the sum of theirs; a missing entry means the merge is
 * illegal. Keyed by tier rather than by strength so a track whose strengths do
 * not equal its tiers (ranged) merges correctly.
 */
export const TIER_TO_UNIT: Record<UnitClass, Record<number, EntityType>> = {
  infantry: { 1: "peasant", 2: "warrior", 3: "swordsman" },
  cavalry:  { 1: "scout",   2: "knight" },
  ranged:   {},
};
```

Import `UnitClass` from `@/utils/hexGrid` at the top of the file. The `ranged` entry stays empty until Task 3.

Replace `mergeResult` in `logic/gameLogic.ts:361-368`:

```ts
export function mergeResult(a: EntityType, b: EntityType): EntityType | null {
  const ca = ENTITY_META[a].unitClass;
  const cb = ENTITY_META[b].unitClass;
  if (!ca || ca !== cb) return null;
  const total = ENTITY_META[a].tier + ENTITY_META[b].tier;
  return TIER_TO_UNIT[ca][total] ?? null;
}
```

Update its docstring to say tier instead of strength, and keep the invariant note (the result's tier equals tierA + tierB). Update the import at `logic/gameLogic.ts:21` to `import { TIER_TO_UNIT } from "@/constants/gameConstants";`. The `isCavalry` import there is now unused in `mergeResult` — remove it only if nothing else in the file uses it.

- [ ] **Step 6: Update the non-AI strength readers**

Apply these exact substitutions:

| File:line | Old | New |
|---|---|---|
| `utils/hexGrid.ts:248` (`getZoCStrength`) | `ENTITY_META[e].strength` | `ENTITY_META[e].defStrength` |
| `utils/hexGrid.ts:274` (`getMaxEnemyZoC`) | `ENTITY_META[e].strength` | `ENTITY_META[e].defStrength` |
| `utils/hexGrid.ts:307` (`getValidMoves`) | `const unitStrength = ENTITY_META[unitEntity].strength` | `const unitStrength = ENTITY_META[unitEntity].offStrength` |
| `utils/hexGrid.ts:421` (`getPlacementAttackTiles`) | `meta.strength < ENTITY_META[existingEntity].strength` | `meta.offStrength < ENTITY_META[existingEntity].defStrength` |
| `utils/hexGrid.ts:426` | `meta.strength > enemyZoC` | `meta.offStrength > enemyZoC` |
| `logic/tileTapHandler.ts:464-465` | `ENTITY_META[armedEntityId].strength >= ENTITY_META[existingOnTile as EntityType].strength` | `ENTITY_META[armedEntityId].offStrength >= ENTITY_META[existingOnTile as EntityType].defStrength` |
| `components/UnitToken.tsx:53` | `0.5 + meta.strength * 0.5` | `0.5 + meta.tier * 0.5` |

In `components/UnitToken.tsx`, update the `ringOutlineWidth` docstring to say tier.

- [ ] **Step 7: Update the AI strength readers**

`logic/aiStrategy.ts` and `logic/aiExpert.ts` hold ~50 reads. Let `pnpm run typecheck` enumerate them, and resolve each by this rule — in this order, first match wins:

1. **Sorting or ranking purchase/upgrade options** → `tier`.
   Sites: `aiStrategy.ts:45` (inside `aiUnitBuyOrder`), `aiStrategy.ts:868`.
2. **Compared against a zone-of-control value** (a variable named `zoc`, or a `getMaxEnemyZoC`/`getZoCStrength` result) → the mover's `offStrength`. The ZoC side is already defensive.
   Sites include `aiStrategy.ts:165, 203, 343, 431, 616, 641, 716, 777`; `aiExpert.ts:410, 879, 960`.
3. **"Could this enemy unit take one of my tiles"** — threat detection walking enemy units and testing their neighbours → the enemy's `offStrength`.
   Sites: `aiStrategy.ts:133-135, 1235, 1252`; `aiExpert.ts:469, 738, 1090`; `aiExpert.ts:1020-1021` (`sFrom`/`sTo` in `upgradeUnlocksCapture` — both `offStrength`).
4. **"Does this entity defend/garrison this tile"** — including `=== 0` inertness checks, `>= 2` garrison checks, and picking a unit able to hold against a known enemy strength → `defStrength`.
   Sites: `aiExpert.ts:113, 266, 430-432, 971, 1239`; `aiStrategy.ts:192, 214, 228, 236, 248, 258, 283, 289, 309, 315, 498, 646` (`eStr`, the defender), `aiStrategy.ts:96`.
5. **Summing "how much military does this side have"** → `militaryValue(e)`.
   Sites: `aiExpert.ts:261, 362, 387, 389-390, 540`.

Anything the rule leaves ambiguous: pick `militaryValue(e)`. It equals the old value for every entity the AI can buy, so it cannot regress AI-vs-AI play; note the choice in a comment.

In `aiStrategy.ts:646-647`, `eStr` is the defender (→ `defStrength`) and `aStr` is the attacker (→ `offStrength`).

In the buy loops (`aiStrategy.ts:443, 680, 742, 798`), `const str = ENTITY_META[uType].strength` is the strength of a unit the AI is about to buy in order to act; use `offStrength` when the value is compared to a ZoC or an enemy strength it must beat, `defStrength` when it is compared to a strength it must hold against. The surrounding comparison decides.

- [ ] **Step 8: Update the info tables**

`constants/gameConstants.ts:65` — replace `strength: p.strength,` with:

```ts
    offStrength: p.offStrength,
    defStrength: p.defStrength,
```

`components/WelcomeModal.tsx:164` and `components/MainMenu.tsx:120` each render one strength cell. Replace each with two cells and add a matching header column, so the table reads `Name | Cost | Upkeep | Atk | Def`:

```tsx
<Text style={[styles.tableCell, styles.tableCellNum, styles.tableBodyText]}>{row.offStrength === 0 ? '—' : row.offStrength}</Text>
<Text style={[styles.tableCell, styles.tableCellNum, styles.tableBodyText]}>{row.defStrength === 0 ? '—' : row.defStrength}</Text>
```

Find the header row in each file (the row of `styles.tableHeader` cells above the body) and split its single strength header into `Atk` and `Def`.

- [ ] **Step 9: Typecheck and fix the remaining call sites**

Run: `pnpm run typecheck`
Expected: initially a list of `Property 'strength' does not exist on type 'EntityMeta'` errors. Resolve each with Step 6/7's rules until it passes clean.

- [ ] **Step 10: Run the full suite**

Run: `pnpm test`
Expected: 18 files, all pass, **465 + the new tests** passing, 9 skipped. No existing test may be edited to make it pass — if one fails, the refactor changed behaviour and the mapping for that call site is wrong.

- [ ] **Step 11: Verify seeded self-play is unchanged**

Create `logic/tmpBaseline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { playMatch } from "@/logic/aiSelfPlay";

describe("self-play determinism", () => {
  it("reproduces the pre-refactor results", async () => {
    const out: string[] = [];
    for (const seed of [1, 7, 42, 101]) {
      const r = await playMatch({
        seed, tiles: 50, difficultyA: "expert", difficultyB: "hard", maxTurns: 30,
      });
      out.push(`seed=${seed} winner=${r.winner} turns=${r.turns} landA=${r.landA} landB=${r.landB}`);
    }
    expect(out).toEqual([
      "seed=1 winner=ai1 turns=30 landA=40 landB=1",
      "seed=7 winner=ai1 turns=30 landA=41 landB=1",
      "seed=42 winner=ai2 turns=21 landA=0 landB=44",
      "seed=101 winner=ai1 turns=30 landA=44 landB=1",
    ]);
  }, 120000);
});
```

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tmpBaseline.test.ts`
Expected: PASS. These four lines were captured from the pre-refactor code on this branch. A mismatch means an AI strength site was mapped wrongly — fix it rather than updating the expectation.

Then delete the file: `rm artifacts/hex-battles/logic/tmpBaseline.test.ts` (it costs ~14s and the plan re-runs it in Task 8).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(units): split strength into offense, defense and tier

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Close every capture path to ranged units

Still no ranged units exist, so this task changes nothing observable. It installs the gate they will fall through, and renames `cavalryMoveKind` to `moveKind` (it is already class-agnostic and is called for non-cavalry reasons).

**Files:**
- Modify: `utils/hexGrid.ts:53-81` (`cavalryMoveKind` → `moveKind`), `:291-381` (`getValidMoves`), `:392-430` (`getPlacementAttackTiles`)
- Modify: `logic/tileTapHandler.ts:17` (import), `:253`, `:448-465`, `:614`
- Test: `utils/hexGrid.test.ts`

**Interfaces:**
- Consumes: `canCapture`, `isRanged` from Task 1.
- Produces: `moveKind(destEntity)` exported from `utils/hexGrid.ts`, replacing `cavalryMoveKind`. `cavalryMayEnter` keeps its name and signature.

- [ ] **Step 1: Write the failing test**

Add to `utils/hexGrid.test.ts`:

```ts
describe("moveKind", () => {
  it("classifies destinations independently of the mover", () => {
    expect(moveKind(undefined)).toBe("empty");
    expect(moveKind("bridge")).toBe("empty");
    expect(moveKind("city")).toBe("empty");
    expect(moveKind("rebel")).toBe("entity");
    expect(moveKind("peasant")).toBe("entity");
    expect(moveKind("tower")).toBe("building");
  });
});
```

Add `moveKind` to the import list.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts`
Expected: FAIL — `moveKind` is not exported.

- [ ] **Step 3: Rename cavalryMoveKind**

In `utils/hexGrid.ts`, rename `cavalryMoveKind` to `moveKind` and rewrite its docstring so it no longer reads as cavalry-only:

```ts
/**
 * Classify what entering a tile holding `destEntity` would be: striking a
 * defender ("entity"), assaulting a fortification ("building"), or taking an
 * open tile ("empty", which includes cities and bridges that hold no
 * defender). Independent of who is moving; callers apply their own class rules.
 */
export function moveKind(destEntity: EntityType | undefined): "empty" | "entity" | "building" {
```

Update its two internal uses in `cavalryMayEnter` (`utils/hexGrid.ts:77`) and `getPlacementAttackTiles` (`:415`), and the two in `logic/tileTapHandler.ts:253` and `:614`, plus the import at `logic/tileTapHandler.ts:17`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the capture gate in getValidMoves**

In `utils/hexGrid.ts:291-381`, add after `const cavHasStruck = ...` (`:312`):

```ts
  // Ranged units never take ground: no neutral or enemy tile, and no stepping
  // onto a rebel (clearing a rebel is a strike). They may still move freely
  // inside their own territory, including onto an ally to merge.
  const takesGround = canCapture(unitEntity);
```

In the own-territory rebel branch (`:351-354`), replace the body with:

```ts
        } else if (allyIsRebel) {
          // Can move ONTO a rebel tile to clear it, but cannot pass THROUGH it.
          // A cavalry that has already struck this turn may not strike again,
          // and a ranged unit may never strike at all.
          if (!cavHasStruck && takesGround) result.add(nk);
```

In the neutral branch (`:364-367`), replace the body with:

```ts
      } else if (neighbor.owner === 'neutral') {
        // Neutral tiles are open captures; cavalry building/strike limits never
        // apply (a neutral tile holds no enemy defender or fortification).
        if (takesGround) result.add(nk);
```

In the enemy branch (`:368-376`), add the guard first:

```ts
      } else {
        if (!takesGround) continue;
        // Enemy tile: cavalry cannot assault buildings, nor strike a defender
        // once it has already struck this turn.
        if (cav && !cavalryMayEnter(entities.get(nk), cavHasStruck)) continue;
```

- [ ] **Step 6: Add the capture gate in getPlacementAttackTiles**

In `utils/hexGrid.ts:399-401`, extend the early return:

```ts
  const meta = ENTITY_META[armedEntityId];
  const result = new Set<string>();
  if (!meta.isUnit) return result;
  // A ranged unit can never be bought straight into an attack — it takes no ground.
  if (!canCapture(armedEntityId)) return result;
```

- [ ] **Step 7: Add the capture gate in the armed-placement branch**

In `logic/tileTapHandler.ts`, import `canCapture` from `@/utils/hexGrid` and change two flags:

```ts
    const canOverwriteRebel =
      armedIsUnit && canCapture(armedEntityId) && existingOnTile === "rebel";
```

```ts
    const canOverwriteBuilding =
      armedIsUnit &&
      canCapture(armedEntityId) &&
      existingIsBuilding &&
      !existingBuildingIsOwn &&
      ENTITY_META[armedEntityId].offStrength >=
        ENTITY_META[existingOnTile as EntityType].defStrength;
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm run typecheck && pnpm test`
Expected: everything passes with the same counts as after Task 1. No behaviour changed — `canCapture` is `true` for every entity that exists so far.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(units): route ground-taking through a canCapture gate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Add the three ranged units

After this task the units are buyable from the ribbon, move only on friendly ground, merge with each other, and show up in the reference tables with emoji art. They cannot shoot yet.

**Files:**
- Modify: `types.ts:3` (`EntityType`)
- Modify: `utils/hexGrid.ts` (`ENTITY_META`, `UNIT_UPGRADE`)
- Modify: `constants/gameConstants.ts` (`TIER_TO_UNIT.ranged`)
- Modify: `components/UnitIcon.tsx:138` (`UNIT_ICON_SVG` type), `:206-213` (AST map), the `UnitIcon` component
- Modify: `logic/aiStrategy.ts:40-48` (`aiUnitBuyOrder`), `logic/aiExpert.ts:770-772` (`UNIT_TYPES`)
- Test: `utils/hexGrid.test.ts`, `logic/gameLogic.test.ts`, `logic/aiStrategy.test.ts`

**Interfaces:**
- Consumes: `TIER_TO_UNIT`, `isRanged`, `canCapture` from Tasks 1–2.
- Produces: `EntityType` values `shortbowman`, `longbowman`, `crossbowman`; `EMOJI_ICON` and `EmojiGlyph` exported from `components/UnitIcon.tsx`.

- [ ] **Step 1: Write the failing tests**

Add to `utils/hexGrid.test.ts`:

```ts
describe("ranged units", () => {
  it("prices them like cavalry, extrapolated to tier 3", () => {
    expect(ENTITY_META.shortbowman.cost).toBe(12);
    expect(ENTITY_META.shortbowman.upkeep).toBe(4);
    expect(ENTITY_META.longbowman.cost).toBe(24);
    expect(ENTITY_META.longbowman.upkeep).toBe(12);
    expect(ENTITY_META.crossbowman.cost).toBe(36);
    expect(ENTITY_META.crossbowman.upkeep).toBe(36);
  });

  it("gives them high offense and low defense", () => {
    expect(ENTITY_META.shortbowman.offStrength).toBe(2);
    expect(ENTITY_META.shortbowman.defStrength).toBe(0);
    expect(ENTITY_META.longbowman.offStrength).toBe(3);
    expect(ENTITY_META.longbowman.defStrength).toBe(1);
    expect(ENTITY_META.crossbowman.offStrength).toBe(4);
    expect(ENTITY_META.crossbowman.defStrength).toBe(2);
  });

  it("moves at the infantry default", () => {
    expect(unitMovement("shortbowman")).toBe(3);
    expect(unitMovement("crossbowman")).toBe(3);
  });

  it("cannot take ground", () => {
    expect(canCapture("shortbowman")).toBe(false);
    expect(canCapture("longbowman")).toBe(false);
    expect(canCapture("crossbowman")).toBe(false);
    expect(isRanged("peasant")).toBe(false);
  });

  it("upgrades along its own track", () => {
    expect(UNIT_UPGRADE.shortbowman).toBe("longbowman");
    expect(UNIT_UPGRADE.longbowman).toBe("crossbowman");
    expect(UNIT_UPGRADE.crossbowman).toBeUndefined();
  });

  it("projects no zone of control at tier 1", () => {
    // A Shortbowman has 0 defense, so it neither holds its own tile nor
    // supports a neighbour: any strength-1 attacker can walk in.
    const map = tileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")]);
    const ents = new Map<string, EntityType>([["0,0", "shortbowman"]]);
    expect(getMaxEnemyZoC("0,0", "player", ents, map)).toBe(0);
    expect(getMaxEnemyZoC("1,0", "player", ents, map)).toBe(0);
  });
});

describe("ranged movement", () => {
  it("offers friendly ground but no neutral, enemy or rebel tile", () => {
    // 0,0 owned bowman; 1,0 own empty; 0,1 neutral; -1,0 enemy; 1,-1 own rebel
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player"),
      makeTile(0, 1, "neutral"),
      makeTile(-1, 0, "ai1"),
      makeTile(1, -1, "player"),
    ]);
    const ents = new Map<string, EntityType>([
      ["0,0", "crossbowman"],
      ["1,-1", "rebel"],
    ]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(true);
    expect(moves.has("0,1")).toBe(false);
    expect(moves.has("-1,0")).toBe(false);
    expect(moves.has("1,-1")).toBe(false);
  });

  it("is never buyable straight into an attack", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "neutral")]);
    const tiles = [map.get("0,0")!];
    const own = new Set(["0,0"]);
    expect(
      getPlacementAttackTiles("crossbowman", tiles, own, map, new Map()).size,
    ).toBe(0);
    expect(
      getPlacementAttackTiles("peasant", tiles, own, map, new Map()).size,
    ).toBe(1);
  });
});
```

Add `unitMovement`, `isRanged` and `UNIT_UPGRADE` to the import list if missing.

Add to `logic/gameLogic.test.ts`:

```ts
describe("ranged merging", () => {
  it("merges along the ranged track by tier", () => {
    expect(mergeResult("shortbowman", "shortbowman")).toBe("longbowman");
    expect(mergeResult("shortbowman", "longbowman")).toBe("crossbowman");
    expect(mergeResult("longbowman", "longbowman")).toBeNull();
    expect(mergeResult("crossbowman", "shortbowman")).toBeNull();
  });

  it("never merges with another track", () => {
    expect(mergeResult("shortbowman", "peasant")).toBeNull();
    expect(mergeResult("shortbowman", "scout")).toBeNull();
  });
});
```

Add to `logic/aiStrategy.test.ts`:

```ts
describe("AI purchase candidates", () => {
  it("never offers a ranged unit to the AI", () => {
    for (const id of ["shortbowman", "longbowman", "crossbowman"] as const) {
      expect(AI_UNIT_BUY_ORDER_ASC).not.toContain(id);
    }
    expect(AI_UNIT_BUY_ORDER_ASC).toContain("peasant");
  });
});
```

Export `AI_UNIT_BUY_ORDER_ASC` from `logic/aiStrategy.ts` (it is currently module-private) and import it in the test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts logic/gameLogic.test.ts logic/aiStrategy.test.ts`
Expected: FAIL — the three entity names are not valid `EntityType` values.

- [ ] **Step 3: Add the entity types and metadata**

`types.ts:3`:

```ts
export type EntityType = 'peasant' | 'warrior' | 'swordsman' | 'scout' | 'knight' | 'shortbowman' | 'longbowman' | 'crossbowman' | 'tower' | 'castle' | 'city' | 'rebel' | 'bridge';
```

Add to `ENTITY_META` in `utils/hexGrid.ts`, directly after the `knight` row so the purchase ribbon orders units by track:

```ts
  // Ranged track: priced exactly like cavalry (+12 cost, ×3 upkeep per tier).
  // High offense, low defense — a Shortbowman projects no zone of control at
  // all, so it must stand behind infantry.
  shortbowman: { name: 'Shortbowman', cost: 12, upkeep: 4,  isUnit: true, offStrength: 2, defStrength: 0, tier: 1, unitClass: 'ranged' },
  longbowman:  { name: 'Longbowman',  cost: 24, upkeep: 12, isUnit: true, offStrength: 3, defStrength: 1, tier: 2, unitClass: 'ranged' },
  crossbowman: { name: 'Crossbowman', cost: 36, upkeep: 36, isUnit: true, offStrength: 4, defStrength: 2, tier: 3, unitClass: 'ranged' },
```

Add to `UNIT_UPGRADE` in `utils/hexGrid.ts`:

```ts
  shortbowman: 'longbowman',
  longbowman: 'crossbowman',
```

Fill in the ranged merge table in `constants/gameConstants.ts`:

```ts
  ranged:   { 1: "shortbowman", 2: "longbowman", 3: "crossbowman" },
```

- [ ] **Step 4: Add the emoji icon branch**

In `components/UnitIcon.tsx`, change the icon map's type at `:138`:

```ts
/** Inline SVG art, for entities that have it. Entities without an entry fall
 *  back to EMOJI_ICON — see the UnitIcon component. */
export const UNIT_ICON_SVG: Partial<Record<EntityType, string>> = {
```

Add below the icon map:

```ts
/**
 * Placeholder emoji art for entities with no SVG icon yet. Swapping in real
 * art later means moving an entry from here into UNIT_ICON_SVG — nothing else
 * changes, because UnitIcon picks the source per entity.
 */
export const EMOJI_ICON: Partial<Record<EntityType, string>> = {
  shortbowman: "🏹",
  longbowman: "🪃",
  crossbowman: "✴️",
};

/** Marker left where a ranged shot killed a unit. */
export const KILL_MARK_EMOJI = "🎯";
```

Change the AST map at `:206-213` to skip missing art:

```ts
const UNIT_ICON_AST: Partial<Record<EntityType, ReturnType<typeof parse>>> =
  Object.fromEntries(
    (Object.keys(UNIT_ICON_SVG) as EntityType[]).map((id) => [
      id,
      parse(UNIT_ICON_SVG[id]!),
    ]),
  );
```

Add the glyph component and reroute `UnitIcon`:

```tsx
/** Renders a single emoji glyph sized to fill an icon box. */
export const EmojiGlyph = React.memo(function EmojiGlyph({
  glyph,
  size,
}: {
  glyph: string;
  size: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.72, lineHeight: size }}>{glyph}</Text>
    </View>
  );
});

/** Renders a unit/building icon at the given pixel size. */
export const UnitIcon = React.memo(function UnitIcon({
  entityId,
  size,
}: {
  entityId: EntityType;
  size: number;
}) {
  const ast = UNIT_ICON_AST[entityId];
  if (!ast) {
    const glyph = EMOJI_ICON[entityId];
    return glyph ? <EmojiGlyph glyph={glyph} size={size} /> : null;
  }
  return <SvgAst ast={ast} override={{ width: size, height: size }} />;
});
```

`EmojiGlyph` must be declared above `UnitIcon` in the file.

- [ ] **Step 5: Exclude ranged from the AI's purchase lists**

`logic/aiStrategy.ts:40-48` — filter and sort:

Replace the whole block from the `aiUnitBuyOrder` comment through the `AI_UNIT_BUY_ORDER_DESC` line — both derived constants must survive, `_DESC` is used at `aiStrategy.ts:678`:

```ts
// Unit purchase candidates for the AI, derived from ENTITY_META so new units are
// picked up automatically. The buy loops take the first affordable type meeting
// the strength threshold. Within a tier, cavalry (more attacks) is preferred
// over plain infantry, so the AI buys a Scout/Knight when it can afford one and
// falls back to cheaper infantry otherwise.
//
// Ranged units are excluded: they are player-only for now, and the AI has no
// ranged behaviour, so buying one would just burn gold on a unit it never fires.
const aiUnitBuyOrder = (tierDir: 1 | -1): EntityType[] =>
  (Object.keys(ENTITY_META) as EntityType[])
    .filter((e) => ENTITY_META[e].isUnit && !isRanged(e))
    .sort(
      (a, b) =>
        tierDir * (ENTITY_META[a].tier - ENTITY_META[b].tier) ||
        unitMaxAttacks(b) - unitMaxAttacks(a) || // cavalry first within a tier
        ENTITY_META[a].cost - ENTITY_META[b].cost,
    );
export const AI_UNIT_BUY_ORDER_ASC: EntityType[] = aiUnitBuyOrder(1);
const AI_UNIT_BUY_ORDER_DESC: EntityType[] = aiUnitBuyOrder(-1);
```

Only `_ASC` becomes exported (Step 1's test imports it); `_DESC` stays module-private.

Import `isRanged` from `@/utils/hexGrid`.

`logic/aiExpert.ts:770-772`:

```ts
// Ranged units are player-only for now — see aiUnitBuyOrder in aiStrategy.ts.
const UNIT_TYPES: EntityType[] = (Object.keys(ENTITY_META) as EntityType[]).filter(
  (e) => ENTITY_META[e].isUnit && !isRanged(e),
);
```

Import `isRanged` there too.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm run typecheck && pnpm test`
Expected: all pass. `components/renderLayers.test.ts` may assert icon coverage over `EntityType` — if it fails, extend it to accept an emoji-backed entity rather than weakening the assertion.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ranged): add the Shortbowman/Longbowman/Crossbowman track

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The ranged attack module

A pure module with no React and no game state. Fully tested in isolation.

**Files:**
- Create: `logic/rangedAttack.ts`
- Test: `logic/rangedAttack.test.ts`

**Interfaces:**
- Consumes: `ENTITY_META`, `isRanged` from `utils/hexGrid`; `HEX_EDGES`, `tileKey` from `utils/hexMath`.
- Produces:
  - `rangedTargets(o: { shooterKey: string; owner: TerritoryOwner; entities: Map<string, EntityType>; tileMap: Map<string, HexTile>; firedUnits: Set<string> }): Set<string>`
  - `resolveRangedShot(o: { shooterKey: string; targetKey: string; entities: Map<string, EntityType>; tileMap: Map<string, HexTile>; killMarks: Set<string>; firedUnits: Set<string> }): { entities: Map<string, EntityType>; killMarks: Set<string>; firedUnits: Set<string> }`

- [ ] **Step 1: Write the failing test**

Create `logic/rangedAttack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { EntityType, HexTile, TerritoryOwner } from "@/types";
import { rangedTargets, resolveRangedShot } from "@/logic/rangedAttack";

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

function tileMap(tiles: HexTile[]): Map<string, HexTile> {
  return new Map(tiles.map((t) => [t.key, t]));
}

// A shooter on 0,0 (player) with all six neighbours owned by ai1.
function board(): Map<string, HexTile> {
  return tileMap([
    makeTile(0, 0, "player"),
    makeTile(1, 0, "ai1"),
    makeTile(0, 1, "ai1"),
    makeTile(-1, 1, "ai1"),
    makeTile(-1, 0, "ai1"),
    makeTile(0, -1, "ai1"),
    makeTile(1, -1, "ai1"),
    makeTile(2, 0, "ai1"), // two tiles away
  ]);
}

function targets(
  shooter: EntityType,
  others: Array<[string, EntityType]>,
  opts: { fired?: boolean; map?: Map<string, HexTile> } = {},
): Set<string> {
  return rangedTargets({
    shooterKey: "0,0",
    owner: "player",
    entities: new Map<string, EntityType>([["0,0", shooter], ...others]),
    tileMap: opts.map ?? board(),
    firedUnits: new Set(opts.fired ? ["0,0"] : []),
  });
}

describe("rangedTargets", () => {
  it("kills what its offense beats and nothing else", () => {
    // Shortbowman: offense 2 — beats defense 1, not defense 2.
    const t = targets("shortbowman", [
      ["1,0", "peasant"],   // def 1 → killable
      ["0,1", "warrior"],   // def 2 → not killable
      ["-1,0", "scout"],    // def 1 → killable
    ]);
    expect([...t].sort()).toEqual(["-1,0", "1,0"]);
  });

  it("lets a Crossbowman kill the strongest unit in the game", () => {
    const t = targets("crossbowman", [["1,0", "swordsman"]]); // off 4 > def 3
    expect(t.has("1,0")).toBe(true);
  });

  it("never targets fortifications, cities or bridges", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(-1, 0, "ai1", "lake"),
    ]);
    const t = targets(
      "crossbowman",
      [["1,0", "tower"], ["0,1", "castle"], ["-1,0", "bridge"]],
      { map },
    );
    expect(t.size).toBe(0);
  });

  it("never targets a friendly unit", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    expect(targets("crossbowman", [["1,0", "peasant"]], { map }).size).toBe(0);
  });

  it("targets a rebel on either side's ground", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player"),
      makeTile(0, 1, "ai1"),
    ]);
    const t = targets("shortbowman", [["1,0", "rebel"], ["0,1", "rebel"]], { map });
    expect([...t].sort()).toEqual(["0,1", "1,0"]);
  });

  it("has range 1 only", () => {
    expect(targets("crossbowman", [["2,0", "peasant"]]).size).toBe(0);
  });

  it("offers nothing once the unit has fired", () => {
    expect(targets("crossbowman", [["1,0", "peasant"]], { fired: true }).size).toBe(0);
  });

  it("offers nothing for a non-ranged unit", () => {
    expect(targets("swordsman", [["1,0", "peasant"]]).size).toBe(0);
  });
});

describe("resolveRangedShot", () => {
  it("removes the victim, marks the tile and spends the shot", () => {
    const map = board();
    const before = new Map<string, EntityType>([
      ["0,0", "crossbowman"],
      ["1,0", "swordsman"],
    ]);
    const r = resolveRangedShot({
      shooterKey: "0,0",
      targetKey: "1,0",
      entities: before,
      tileMap: map,
      killMarks: new Set(),
      firedUnits: new Set(),
    });
    expect(r.entities.has("1,0")).toBe(false);
    expect(r.entities.get("0,0")).toBe("crossbowman");
    expect(r.killMarks.has("1,0")).toBe(true);
    expect(r.firedUnits.has("0,0")).toBe(true);
    // Inputs are not mutated.
    expect(before.has("1,0")).toBe(true);
  });

  it("leaves the bridge standing when the victim was on a lake", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "ai1", "lake")]);
    const r = resolveRangedShot({
      shooterKey: "0,0",
      targetKey: "1,0",
      entities: new Map<string, EntityType>([
        ["0,0", "crossbowman"],
        ["1,0", "peasant"],
      ]),
      tileMap: map,
      killMarks: new Set(),
      firedUnits: new Set(),
    });
    expect(r.entities.get("1,0")).toBe("bridge");
  });

  it("does not change tile ownership", () => {
    const map = board();
    resolveRangedShot({
      shooterKey: "0,0",
      targetKey: "1,0",
      entities: new Map<string, EntityType>([
        ["0,0", "crossbowman"],
        ["1,0", "peasant"],
      ]),
      tileMap: map,
      killMarks: new Set(),
      firedUnits: new Set(),
    });
    expect(map.get("1,0")!.owner).toBe("ai1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/rangedAttack.test.ts`
Expected: FAIL — cannot resolve `@/logic/rangedAttack`.

- [ ] **Step 3: Write the module**

Create `logic/rangedAttack.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/rangedAttack.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ranged): pure targeting and shot resolution

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: firedUnits and killMarks state

Adds the two new pieces of game state and threads them through history, persistence and the AI hand-off. Nothing writes to them yet; after this task the game behaves exactly as before, with two empty collections riding along.

**Files:**
- Modify: `types.ts:60-74` (`MoveHistorySnapshot`)
- Modify: `app/game.tsx` — new state next to `graveyard` (`:357`), and every place `graveyard` is passed or reset (`:535`, `:582`, `:605-608`, `:711`, `:954`, `:1122`, `:1192`)
- Modify: `hooks/useMoveHistory.ts:39, 74, 134, 157`
- Modify: `hooks/useAiTurnCallbacks.ts:16, 49`
- Modify: `logic/aiStrategy.ts:971` (`AiDecisionExec.state`), `:1717` (player turn-start block)
- Modify: `logic/aiSelfPlay.ts:92` (no-op setter)
- Modify: `utils/savedGame.ts`
- Test: `utils/savedGame.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `killMarks: Set<string>` and `firedUnits: Set<string>` in `app/game.tsx` state, in `MoveHistorySnapshot`, and in `SavedGameState`; `AiDecisionExec.state.setKillMarks(s: Set<string>): void`.

- [ ] **Step 1: Write the failing test**

Add to `utils/savedGame.test.ts`:

```ts
describe("ranged state persistence", () => {
  it("round-trips kill marks and fired units", () => {
    const g = makeSavedGame(); // the existing helper in this file
    g.state.entities.set("0,0", "crossbowman");
    g.state.killMarks = new Set(["1,0"]);
    g.state.firedUnits = new Set(["0,0"]);
    const back = deserializeSavedGame(serializeSavedGame(g))!;
    expect(back.state.entities.get("0,0")).toBe("crossbowman");
    expect([...back.state.killMarks]).toEqual(["1,0"]);
    expect([...back.state.firedUnits]).toEqual(["0,0"]);
  });

  it("loads a save written before the ranged branch", () => {
    const g = makeSavedGame();
    const json = serializeSavedGame(g);
    const stripped = JSON.parse(json);
    delete stripped.state.killMarks;
    delete stripped.state.firedUnits;
    const back = deserializeSavedGame(JSON.stringify(stripped))!;
    expect(back.state.killMarks.size).toBe(0);
    expect(back.state.firedUnits.size).toBe(0);
  });
});
```

If `utils/savedGame.test.ts` has no `makeSavedGame` helper, reuse whatever fixture the existing tests build and extend it the same way.

Add to `logic/aiStrategy.test.ts` (the file already imports `runAiTurn` and has `makeCbs` / `makeEmptyWs` / `makeTileMap` / `makeTile` helpers):

```ts
describe("ranged kill markers", () => {
  it("clears them at the start of the player's turn", async () => {
    const setKillMarks = vi.fn();
    const ws = makeEmptyWs(makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")]));
    const cbs = makeCbs({ state: { setKillMarks } });
    await runAiTurn(ws, cbs, ["ai1"], 3, "easy");
    // The AI phase ends by handing the turn back to the player; last round's
    // markers must be gone by then.
    expect(setKillMarks).toHaveBeenCalledWith(new Set());
  });
});
```

Add to `logic/endTurnHandler.test.ts` — the counterpart guard, so nobody "fixes" the lifetime by clearing too early:

```ts
it("does not clear ranged kill markers at end of turn", () => {
  // The marker must survive the AI phase and disappear at the start of the
  // player's NEXT turn, which is runAiTurn's job, not this handler's.
  const params = makeParams(); // the file's existing builder
  handleEndTurnLogic(params);
  expect((params as { setKillMarks?: unknown }).setKillMarks).toBeUndefined();
});
```

If `handleEndTurnLogic` ends up with no `setKillMarks` param at all (the expected outcome), keep this test as the assertion that the param was never added.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/savedGame.test.ts`
Expected: FAIL — `killMarks` is not a property of `SavedGameState`.

- [ ] **Step 3: Extend persistence**

In `utils/savedGame.ts`, add to `SavedGameState`:

```ts
  /** Tiles marked by a ranged kill this round; purely visual. */
  killMarks: Set<string>;
  /** Ranged units that have already fired this turn. */
  firedUnits: Set<string>;
```

Add to the `Serialized["state"]` shape, next to the existing optional fields:

```ts
    // Added with the ranged track; absent in older saves, loaded as empty.
    killMarks?: string[];
    firedUnits?: string[];
```

Add to `serializeSavedGame`:

```ts
      killMarks: [...g.state.killMarks],
      firedUnits: [...g.state.firedUnits],
```

Add to `deserializeSavedGame`:

```ts
        killMarks: new Set(parsed.state.killMarks ?? []),
        firedUnits: new Set(parsed.state.firedUnits ?? []),
```

- [ ] **Step 4: Add the state and thread it**

`types.ts` — add to `MoveHistorySnapshot`:

```ts
  killMarks: Set<string>;
  firedUnits: Set<string>;
```

`app/game.tsx` — declare next to `graveyard`:

```tsx
  const [killMarks, setKillMarks] = useState<Set<string>>(new Set());
  const [firedUnits, setFiredUnits] = useState<Set<string>>(new Set());
```

Then follow `graveyard` through the file and give the two new sets the same treatment at every site: the new-game reset (`:605-608`), the saved-game load (`:582`), the snapshot restore (`:535`), the history snapshot builder (`:711`), and each params object that already receives `graveyard`/`setGraveyard` (`:954`, `:1122`, `:1192`). `firedUnits` additionally resets to an empty set wherever `setAttacksUsed(new Map())` appears.

`hooks/useMoveHistory.ts` — mirror the `setGraveyard` prop and the `snapshot.graveyard ?? new Set()` restore for both new sets.

`logic/endTurnHandler.ts` — next to `setAttacksUsed(new Map())` (`:158`), add `setFiredUnits(new Set())` and add the setter to the handler's params interface. **Do not** clear `killMarks` here: end-of-turn is too early, the marker must survive the AI phase.

`hooks/useAiTurnCallbacks.ts` and `logic/aiStrategy.ts` — add `setKillMarks` to `AiDecisionExec.state` (`aiStrategy.ts:971`) and pass it through the hook. In `runAiTurn`'s player block (`aiStrategy.ts:1717`, right after the player's `armedGraves.set("player", ...)` re-arm), add:

```ts
    // Start of the player's turn: clear last round's ranged kill markers. In
    // this version only the player can create one, and only during the player's
    // own turn, so a single wholesale clear here gives every marker exactly one
    // full round on screen — the same lifetime a grave gets. When the AI learns
    // to fire, this must become an owner-scoped sweep like spawnRebelsForOwner.
    cbs.state.setKillMarks(new Set());
```

`logic/aiSelfPlay.ts:92` — add `setKillMarks: noop,` alongside the other no-op setters.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm run typecheck && pnpm test`
Expected: all pass, savedGame gains 2 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ranged): add killMarks and firedUnits game state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Firing from the tap handler

Wires the shot to player input, carries the fired flag across moves and merges, and clears the marker when a unit steps on it.

**Files:**
- Modify: `logic/gameLogic.ts` — new `advanceFired` helper
- Modify: `hooks/useSelectionState.ts` — new `validRangedTargets` memo and return field
- Modify: `app/game.tsx` — pass `firedUnits` into the selection hook, destructure `validRangedTargets`, pass it to the tap handler
- Modify: `logic/tileTapHandler.ts` — params, the new fire branch, the move commit
- Test: `logic/gameLogic.test.ts`, `logic/tileTapHandler.test.ts`

**Interfaces:**
- Consumes: `rangedTargets`, `resolveRangedShot` (Task 4); `killMarks`, `firedUnits`, their setters (Task 5).
- Produces: `advanceFired(o: { firedUnits: Set<string>; fromKey: string; toKey: string; isMerge: boolean }): Set<string>` exported from `logic/gameLogic.ts`; `validRangedTargets: Set<string>` from `useSelectionState`; `TileTapParams` gains `killMarks`, `firedUnits`, `validRangedTargets`, `setKillMarks`, `setFiredUnits`.

Firing works end to end when this task lands — the targets are just not drawn yet, so the tap is invisible until Task 7. That is deliberate: it keeps the typecheck green at the task boundary and lets a reviewer reject the visuals without losing working mechanics.

- [ ] **Step 1: Write the failing test for the carry helper**

Add to `logic/gameLogic.test.ts`:

```ts
describe("advanceFired", () => {
  it("carries the fired flag to the destination", () => {
    const r = advanceFired({
      firedUnits: new Set(["0,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: false,
    });
    expect(r.has("0,0")).toBe(false);
    expect(r.has("1,0")).toBe(true);
  });

  it("keeps the flag even when the unit runs out of movement", () => {
    // Unlike advanceAttacksUsed, becoming spent must NOT clear it: a ranged
    // unit can fire with zero movement left, so a dropped flag would hand it a
    // second shot.
    const r = advanceFired({
      firedUnits: new Set(["0,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: false,
    });
    expect(r.has("1,0")).toBe(true);
  });

  it("unions the flag on a merge", () => {
    const fromFired = advanceFired({
      firedUnits: new Set(["0,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: true,
    });
    expect(fromFired.has("1,0")).toBe(true);

    const destFired = advanceFired({
      firedUnits: new Set(["1,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: true,
    });
    expect(destFired.has("1,0")).toBe(true);
  });

  it("clears the destination when neither unit had fired", () => {
    const r = advanceFired({
      firedUnits: new Set(),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: false,
    });
    expect(r.has("1,0")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: FAIL — `advanceFired` is not exported.

- [ ] **Step 3: Implement the carry helper**

Add to `logic/gameLogic.ts`, next to `advanceAttacksUsed`:

```ts
/**
 * Move the "has fired this turn" flag from `fromKey` to `toKey`.
 *
 * Deliberately NOT folded into advanceAttacksUsed: that helper drops a unit's
 * counter when the unit becomes spent, which is harmless for cavalry (a spent
 * cavalry unit cannot act) but would hand a ranged unit a second shot, since
 * firing costs no movement and a spent bowman may still fire. The flag survives
 * moving and spending, and a merge unions it — otherwise a used shot could be
 * refreshed by merging in a fresh bowman.
 */
export function advanceFired(o: {
  firedUnits: Set<string>;
  fromKey: string;
  toKey: string;
  isMerge: boolean;
}): Set<string> {
  const next = new Set(o.firedUnits);
  const moverFired = next.has(o.fromKey);
  const destFired = o.isMerge && next.has(o.toKey);
  next.delete(o.fromKey);
  if (moverFired || destFired) next.add(o.toKey);
  else next.delete(o.toKey);
  return next;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tap-handler tests**

Add to `logic/tileTapHandler.test.ts`, following the existing harness in that file for building params and capturing setter calls:

```ts
describe("ranged firing", () => {
  // Player crossbowman on 0,0, enemy tile 1,0 held by an ai1 swordsman.
  function shotParams(overrides: Partial<TileTapParams> = {}) {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "ai1")]);
    return makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      entities: ents([["0,0", "crossbowman"], ["1,0", "swordsman"]]),
      validRangedTargets: new Set(["1,0"]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
      ...overrides,
    });
  }

  it("kills the target and marks the tile", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    const newEnts: Map<string, EntityType> = (
      params.setEntities as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(newEnts.has("1,0")).toBe(false);
    expect(newEnts.get("0,0")).toBe("crossbowman");
    const marks: Set<string> = (
      params.setKillMarks as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(marks.has("1,0")).toBe(true);
    expect(params.pushHistory).toHaveBeenCalled();
  });

  it("changes no tile ownership", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.setTerritoryBalances).not.toHaveBeenCalled();
  });

  it("spends the shot but neither the movement nor the unit", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("0,0")).toBe(true);
    expect(params.setSpentUnits).not.toHaveBeenCalled();
    expect(params.setPartialMoves).not.toHaveBeenCalled();
  });

  it("keeps the shooter selected so it can move away", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    expect(params.setSelectedEntityKey).toHaveBeenCalledWith("0,0");
  });

  it("does not fire when the tile is not a legal target", () => {
    // An empty validRangedTargets is how a second shot in one turn is refused:
    // useSelectionState computes it from firedUnits.
    const params = shotParams({ validRangedTargets: new Set() });
    handleTileTapLogic(params);
    expect(params.setKillMarks).not.toHaveBeenCalled();
    expect(params.setFiredUnits).not.toHaveBeenCalled();
  });
});

describe("fired flag across moves", () => {
  it("carries to the destination on a plain move", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "shortbowman"]]),
      firedUnits: new Set(["0,0"]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("1,0")).toBe(true);
    expect(fired.has("0,0")).toBe(false);
  });

  it("survives the move that exhausts the movement budget", () => {
    // Regression guard for the two-shots bug: attacksUsed drops its counter
    // when a unit becomes spent, so the fired flag must not live there.
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "shortbowman"]]),
      partialMoves: new Map([["0,0", 1]]), // this move spends it
      firedUnits: new Set(["0,0"]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (
      params.setSpentUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("1,0")).toBe(true);
  });

  it("unions the flag when a fresh bowman merges into a fired one", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "shortbowman"], ["1,0", "shortbowman"]]),
      firedUnits: new Set(["1,0"]), // the destination already fired
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const newEnts: Map<string, EntityType> = (
      params.setEntities as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(newEnts.get("1,0")).toBe("longbowman");
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("1,0")).toBe(true);
  });
});

describe("kill markers", () => {
  it("clears when a unit walks onto the tile", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "peasant"]]),
      killMarks: new Set(["1,0"]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const marks: Set<string> = (
      params.setKillMarks as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(marks.has("1,0")).toBe(false);
  });
});
```

Add `killMarks: new Set()`, `firedUnits: new Set()`, `validRangedTargets: new Set()`, `setKillMarks: vi.fn()` and `setFiredUnits: vi.fn()` to the defaults inside `makeParams` at the top of the file, next to `graveyard` and `setGraveyard`.

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`
Expected: FAIL — `validRangedTargets` is not a `TileTapParams` field.

- [ ] **Step 7: Compute the target set**

`validRangedTargets` must exist before it can become a required tap-handler param, or `app/game.tsx` stops compiling.

In `hooks/useSelectionState.ts`, next to the `validMoveTiles` memo:

```ts
  const validRangedTargets = useMemo<Set<string>>(() => {
    if (!selectedEntityKey) return new Set();
    if (activeTileMap.get(selectedEntityKey)?.owner !== "player") return new Set();
    return rangedTargets({
      shooterKey: selectedEntityKey,
      owner: "player",
      entities,
      tileMap: activeTileMap,
      firedUnits,
    });
  }, [selectedEntityKey, entities, activeTileMap, firedUnits]);
```

Add `firedUnits: Set<string>` to the hook's params interface and to its destructured parameters, import `rangedTargets` from `@/logic/rangedAttack`, and add `validRangedTargets` to the object the hook returns. In `app/game.tsx`, pass `firedUnits` into the `useSelectionState` call and destructure `validRangedTargets` alongside `validMoveTiles`.

- [ ] **Step 8: Extend TileTapParams**

Add to the interface in `logic/tileTapHandler.ts`:

```ts
  killMarks: Set<string>;
  firedUnits: Set<string>;
  validRangedTargets: Set<string>;
  setKillMarks: (s: Set<string>) => void;
  setFiredUnits: (s: Set<string>) => void;
```

Destructure all five at the top of `handleTileTapLogic`.

- [ ] **Step 9: Add the fire branch**

Insert immediately after the `if (isAiTurn || gameResult !== null) return;` guard and the `const tile = ...` line, **before** the unit-move branch:

```ts
  // ─── Ranged shot ─────────────────────────────────────────────────────────────
  // A ranged unit's targets are never valid move tiles (it cannot take ground),
  // so this branch and the move branch below can never both match the same tap.
  // A shot changes no ownership and no passability, so it needs none of the
  // territory recalculation the move branch does.
  if (selectedEntityKey && validRangedTargets.has(key)) {
    pushHistory();
    const shot = resolveRangedShot({
      shooterKey: selectedEntityKey,
      targetKey: key,
      entities,
      tileMap: activeTileMap,
      killMarks,
      firedUnits,
      partialMoves,
    });
    unstable_batchedUpdates(() => {
      setEntities(shot.entities);
      setKillMarks(shot.killMarks);
      setFiredUnits(shot.firedUnits);
      setPartialMoves(shot.partialMoves);
      // Firing clamps the shooter's movement but does not spend it, so leave it
      // selected: it may still shuffle one cheap tile.
      setSelectedEntityKey(selectedEntityKey);
      setSelectedTileKey(selectedEntityKey);
      if (ribbonOpen) closeRibbon();
    });
    return;
  }
```

Import `resolveRangedShot` from `@/logic/rangedAttack`.

- [ ] **Step 10: Carry the flag and clear the marker on a move**

In the move branch's `commitMove`, add the marker clear next to the existing grave/ruin clears:

```ts
      const newKillMarks = new Set(killMarks);
      newKillMarks.delete(key);
```

and set it in the batched update: `setKillMarks(newKillMarks);`

Next to `advanceAttacksUsed` in the same branch, add:

```ts
    const newFiredUnits = advanceFired({
      firedUnits,
      fromKey: selectedEntityKey,
      toKey: key,
      isMerge,
    });
```

and `setFiredUnits(newFiredUnits);` in the batched update. Import `advanceFired` from `@/logic/gameLogic`.

The buy-merge path (the `if (canMerge)` block in the armed-placement branch) needs **no change**: the merged unit keeps the destination key, a freshly bought unit has never fired, so the union is exactly the flag already sitting on that key. Do not add a `setFiredUnits` call there — leaving the state untouched is the correct union.

In the buy-into-attack branch, add `newKillMarks.delete(key)` alongside the existing `newGraveyard2.delete(key)` when `meta.isUnit`.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `pnpm run typecheck && pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`
Expected: PASS, and the typecheck is clean — firing now works end to end, with no visuals yet.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(ranged): fire from the tap handler, carry the fired flag

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Targeting UI

**Files:**
- Modify: `app/game.tsx` — pass `validRangedTargets` and `killMarks` to the layers, `firedUnits` to the panel
- Modify: `components/MovementHighlightLayer.tsx`, `components/MovementHighlightTapTargets.tsx`
- Modify: `components/GraveyardLayer.tsx` — render kill marks
- Modify: `components/EntityPanel.tsx` — attack/defense and the fired indicator
- Modify: `components/layerEquality.ts` — include the new props in the equality checks
- Test: `components/renderLayers.test.ts`

**Interfaces:**
- Consumes: `validRangedTargets` (Task 6), `killMarks`/`firedUnits` (Task 5), `KILL_MARK_EMOJI`/`EmojiGlyph` (Task 3).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Render the targeting rings**

In `components/MovementHighlightLayer.tsx`, add `validRangedTargets: Set<string>` to the props and render after the move dots:

```tsx
        {Array.from(validRangedTargets).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          // A stroked ring, not a filled dot: a shot is not a move, and the two
          // must never be confused at a glance.
          return (
            <Circle
              key={`shot-ring-${key}`}
              cx={pos.cx}
              cy={pos.cy}
              r={HEX_SIZE * 0.34}
              fill="none"
              stroke="rgba(220,40,40,0.95)"
              strokeWidth={HEX_SIZE * 0.09}
            />
          );
        })}
```

In `components/MovementHighlightTapTargets.tsx`, add the same prop and a matching transparent polygon block keyed `shot-tap-${key}`, copying the `move-tap` block verbatim apart from the key and the set it iterates.

Add `validRangedTargets` to whichever equality functions in `components/layerEquality.ts` cover these two components, comparing it the same way `validMoveTiles` is compared.

- [ ] **Step 2: Render the kill marker**

In `components/GraveyardLayer.tsx`, add `killMarks: Set<string>` to the props and a third block after the ruins block, copying the ruin block's positioning and `entities.has(key)` skip, rendering `<EmojiGlyph glyph={KILL_MARK_EMOJI} size={size} />`. Import both from `@/components/UnitIcon`. Pass `killMarks` from `app/game.tsx` and add it to the layer's equality function.

- [ ] **Step 3: Show attack and defense in the entity panel**

`EntityPanel` currently renders only the Remove and Upgrade buttons — there is no strength readout to replace, so add one. Add `firedUnits: Set<string>` to `EntityPanelProps`, destructure it, and add above the two buttons inside the returned `<View>`:

```tsx
      {entityId && (
        <View style={{ justifyContent: "center", paddingHorizontal: 8 }}>
          <Text style={[styles.buildBtnText, { fontSize: 12 }]}>
            {`Atk ${ENTITY_META[entityId].offStrength} · Def ${ENTITY_META[entityId].defStrength}`}
          </Text>
          {isRanged(entityId) && (
            <Text
              style={[
                styles.buildBtnText,
                { fontSize: 11 },
                !firedUnits.has(selectedEntityKey) && styles.buildBtnTextDisabled,
              ]}
            >
              {firedUnits.has(selectedEntityKey) ? "Shot used" : "Shot ready"}
            </Text>
          )}
        </View>
      )}
```

Import `isRanged` from `@/utils/hexGrid`. Pass `firedUnits` from `app/game.tsx` where `EntityPanel` is rendered.

- [ ] **Step 4: Verify the layers still render**

Run: `pnpm run typecheck && pnpm --filter @workspace/hex-battles exec vitest run components/renderLayers.test.ts`
Expected: PASS. Extend that test with a case that renders `MovementHighlightLayer` with a non-empty `validRangedTargets` and `GraveyardLayer` with a non-empty `killMarks`, following its existing per-layer pattern.

- [ ] **Step 5: Run the full suite and commit**

Run: `pnpm test`
Expected: all pass.

```bash
git add -A
git commit -m "feat(ranged): targeting rings, kill markers and panel readouts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Whole-branch verification

**Files:**
- Create (temporarily): `logic/tmpBaseline.test.ts`
- Modify: `CLAUDE.md` if the economy/units section needs the new track mentioned

- [ ] **Step 1: Typecheck and full suite**

Run: `pnpm run typecheck && pnpm test`
Expected: clean typecheck; every test passes; the count is 465 plus everything this plan added; still 9 skipped.

- [ ] **Step 2: Re-run the self-play determinism check**

Recreate `logic/tmpBaseline.test.ts` exactly as in Task 1 Step 11 and run it.
Expected: the same four lines. The AI never buys a ranged unit, so AI-vs-AI play must be bit-identical to the pre-branch baseline. A mismatch means something in Tasks 1–7 changed shared logic; find it before shipping.
Then `rm artifacts/hex-battles/logic/tmpBaseline.test.ts`.

- [ ] **Step 3: Run the env-gated AI strength series**

Run: `AI_SELFPLAY=1 pnpm --filter @workspace/hex-battles exec vitest run logic/aiSelfPlay.test.ts`
Expected: PASS, including the previously skipped tests.

- [ ] **Step 4: Manual smoke test on device**

Run: `pnpm --filter @workspace/hex-battles run dev -- --tunnel` (plain LAN does not reach the phone from this environment).

Walk this checklist in a real game:
1. Buy a Shortbowman — it appears in the ribbon between Knight and Tower with cost 12.
2. Select it: friendly tiles highlight, no neutral or enemy tile does.
3. Stand it next to an enemy Peasant: a red ring appears on that tile. Tap it — the Peasant vanishes, a 🎯 appears, the tile stays enemy-owned.
4. Move the bowman away afterwards; the ring does not come back this turn.
5. End the turn, let the AI play, start your next turn — the 🎯 is gone.
6. Merge two Shortbowmen into a Longbowman; fire with one first and confirm the merged unit cannot fire.
7. Confirm the AI never buys a bowman across several turns.

- [ ] **Step 5: Update CLAUDE.md**

The architecture section lists the economy model and the logic modules. Add `logic/rangedAttack.ts` to the "Pure logic is extracted into" list with a one-line description, and note in the economy section that units carry separate offensive and defensive strength.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: note the ranged track in CLAUDE.md

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the reviewer

- Tasks 1 and 2 must not change behaviour. The strongest evidence is the untouched existing test suite plus the four seeded self-play lines. If a task in that pair needed an existing test edited, treat it as a defect, not as a test that was wrong.
- The one subtle rule in the whole branch is why `firedUnits` is not `attacksUsed` — see the docstring on `advanceFired`. The regression test is "fire, exhaust movement, try to fire again".
- Emoji art is a placeholder. 🪃 for the Longbowman is the weakest of the three and is the first thing to replace when real art lands.
