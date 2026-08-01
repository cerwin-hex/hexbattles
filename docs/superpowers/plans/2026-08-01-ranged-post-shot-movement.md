# Ranged Post-Shot Movement Clamp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firing cuts a ranged unit's remaining movement to at most 1 point, so a bowman can kill an adjacent enemy but not retreat out of reach in the same turn.

**Architecture:** The clamp lives in the pure shot resolver `resolveRangedShot`, which gains `partialMoves` as an input and returns a clamped copy alongside the collections it already returns. The tap handler threads the new map through to `setPartialMoves`. Nothing else changes: movement highlights already derive from `partialMoves`, the map is already persisted in saved games, and the AI never fires in v1.

**Tech Stack:** TypeScript, React Native (Expo), Vitest. Spec: `docs/superpowers/specs/2026-08-01-ranged-post-shot-movement-design.md`.

## Global Constraints

- Branch: `feat/ranged-units`. Work inside the worktree at `.claude/worktrees/ranged-move`. **Never `git push`** (CLAUDE.md).
- All code, comments and identifiers in English.
- Typecheck from the repo root only: `pnpm run typecheck`. Running `tsc` inside a single package fails.
- Test command: `pnpm --filter @workspace/hex-battles exec vitest run <file>` for one file, `pnpm test` for all.
- Baseline before this plan: 19 files, 542 passed, 9 skipped.
- `POST_SHOT_MOVEMENT = 1` is the single source of truth for the clamp value; no other file hardcodes `1` for this rule.
- `partialMoves` is sparse: **a missing key means "full budget"**. The clamp must always `set` the shooter's key, never leave it absent.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `artifacts/hex-battles/logic/rangedAttack.ts` | Modify | Owns the clamp. Exports `POST_SHOT_MOVEMENT`; `resolveRangedShot` takes and returns `partialMoves`. |
| `artifacts/hex-battles/logic/rangedAttack.test.ts` | Modify | Unit tests for the clamp arithmetic; existing calls updated for the new required input. |
| `artifacts/hex-battles/logic/tileTapHandler.ts` | Modify | Threads `partialMoves` into the shot branch and `shot.partialMoves` into `setPartialMoves`. |
| `artifacts/hex-battles/logic/tileTapHandler.test.ts` | Modify | Replaces the "neither the movement" assertion; adds fire-then-move and merge-loophole coverage. |
| `artifacts/hex-battles/utils/hexGrid.test.ts` | Modify | Proves a 1-point budget excludes forest (cost 2) but allows 1-cost terrain. |
| `artifacts/hex-battles/app/game.tsx` | Modify | Calls `setPartialMoves(shot.partialMoves)` in the shot's batched update. |
| `docs/superpowers/plans/2026-07-31-ranged-units.md` | Modify | Stale code comment restating the old rule. |

---

## Task 1: Clamp the shooter's budget in the pure resolver

**Files:**
- Modify: `artifacts/hex-battles/logic/rangedAttack.ts:51-91`
- Test: `artifacts/hex-battles/logic/rangedAttack.test.ts`

**Interfaces:**
- Consumes: `unitMovement(entity: EntityType): number` and `ENTITY_META` from `@/utils/hexGrid` (`unitMovement` is a new import in this file).
- Produces:
  - `export const POST_SHOT_MOVEMENT = 1;`
  - `resolveRangedShot(o: { shooterKey, targetKey, entities, tileMap, killMarks, firedUnits, partialMoves: Map<string, number> }): { entities: Map<string, EntityType>; killMarks: Set<string>; firedUnits: Set<string>; partialMoves: Map<string, number> }` — `partialMoves` is **required**, so every existing call site becomes a typecheck error until updated. That is intentional: it is the worklist.

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to the end of `artifacts/hex-battles/logic/rangedAttack.test.ts`. It uses the file's existing `board()` and `tileMap`/`makeTile` helpers.

```ts
describe("post-shot movement clamp", () => {
  function fire(partialMoves: Map<string, number>) {
    return resolveRangedShot({
      shooterKey: "0,0",
      targetKey: "1,0",
      entities: new Map<string, EntityType>([
        ["0,0", "shortbowman"],
        ["1,0", "peasant"],
      ]),
      tileMap: board(),
      killMarks: new Set(),
      firedUnits: new Set(),
      partialMoves,
    });
  }

  it("writes the clamp for a shooter that has not moved yet", () => {
    // No entry at all means "full budget" (3 for a bowman). Leaving it absent
    // would hand the shooter all 3 points back, so the value must be written.
    const r = fire(new Map());
    expect(r.partialMoves.get("0,0")).toBe(POST_SHOT_MOVEMENT);
  });

  it("cuts a budget that is above the clamp", () => {
    const r = fire(new Map([["0,0", 2]]));
    expect(r.partialMoves.get("0,0")).toBe(1);
  });

  it("leaves a budget already at the clamp alone", () => {
    const r = fire(new Map([["0,0", 1]]));
    expect(r.partialMoves.get("0,0")).toBe(1);
  });

  it("never raises an exhausted budget", () => {
    const r = fire(new Map([["0,0", 0]]));
    expect(r.partialMoves.get("0,0")).toBe(0);
  });

  it("touches no other unit and does not mutate the input", () => {
    const input = new Map([["0,0", 3], ["5,5", 3]]);
    const r = fire(input);
    expect(r.partialMoves.get("5,5")).toBe(3);
    expect(input.get("0,0")).toBe(3);
  });
});
```

Update the import at the top of the file to pull in the new constant:

```ts
import { rangedTargets, resolveRangedShot, POST_SHOT_MOVEMENT } from "@/logic/rangedAttack";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/rangedAttack.test.ts`

Expected: FAIL. The whole file errors on the missing export `POST_SHOT_MOVEMENT`.

- [ ] **Step 3: Implement the clamp**

In `artifacts/hex-battles/logic/rangedAttack.ts`, extend the `@/utils/hexGrid` import:

```ts
import { ENTITY_META, isRanged, unitMovement } from "@/utils/hexGrid";
```

Add the constant below the existing file docstring:

```ts
/**
 * Movement a ranged unit keeps after firing. Enough to shuffle one cheap tile,
 * not enough to kill and retreat out of reach in the same turn. Forest costs 2,
 * so it is closed off after a shot.
 */
export const POST_SHOT_MOVEMENT = 1;
```

Replace the `resolveRangedShot` docstring's first line and signature, and add the clamp. The full function after the change:

```ts
/**
 * Apply one shot. Returns fresh copies of the four collections it touches and
 * mutates nothing.
 *
 * Ownership and passability are deliberately untouched, which is what lets the
 * caller skip the territory recalculation, the single-hex penalty pass and the
 * win/loss check. Restoring the bridge under a victim killed on a lake tile is
 * part of that guarantee: without it the tile would stop counting as territory
 * and could split the victim's land.
 *
 * Firing also clamps the shooter's remaining movement to POST_SHOT_MOVEMENT.
 * The clamp lives here rather than in the tap handler so the AI inherits the
 * rule for free when a later branch teaches it to shoot.
 */
export function resolveRangedShot(o: {
  shooterKey: string;
  targetKey: string;
  entities: Map<string, EntityType>;
  tileMap: Map<string, HexTile>;
  killMarks: Set<string>;
  firedUnits: Set<string>;
  partialMoves: Map<string, number>;
}): {
  entities: Map<string, EntityType>;
  killMarks: Set<string>;
  firedUnits: Set<string>;
  partialMoves: Map<string, number>;
} {
  const entities = new Map(o.entities);
  const killMarks = new Set(o.killMarks);
  const firedUnits = new Set(o.firedUnits);
  const partialMoves = new Map(o.partialMoves);

  const victim = o.entities.get(o.targetKey);
  entities.delete(o.targetKey);
  // Only a unit can have been standing on a bridge, so only a unit leaves one
  // behind. The guard is currently a no-op — no other lake occupant is a legal
  // target (rebels never spawn on lake, and bridges cannot be shot) — but it
  // keeps that invariant stated here instead of resting on a rule enforced in
  // gameLogic's rebel spawner.
  if (victim && ENTITY_META[victim].isUnit && o.tileMap.get(o.targetKey)?.terrain === "lake") {
    entities.set(o.targetKey, "bridge");
  }
  killMarks.add(o.targetKey);
  firedUnits.add(o.shooterKey);

  // partialMoves is sparse: a missing key means the unit still has its full
  // budget, so the clamped value must be written rather than left absent.
  const shooter = o.entities.get(o.shooterKey);
  const remaining = o.partialMoves.get(o.shooterKey) ?? (shooter ? unitMovement(shooter) : 0);
  partialMoves.set(o.shooterKey, Math.min(remaining, POST_SHOT_MOVEMENT));

  return { entities, killMarks, firedUnits, partialMoves };
}
```

- [ ] **Step 4: Fix the existing call sites in this test file**

The four earlier `resolveRangedShot(...)` calls in `rangedAttack.test.ts` now fail to typecheck. Add `partialMoves: new Map(),` to each object literal, next to `firedUnits: new Set(),`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/rangedAttack.test.ts`

Expected: PASS, including the five new tests.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hex-battles/logic/rangedAttack.ts artifacts/hex-battles/logic/rangedAttack.test.ts
git commit -m "feat(ranged): clamp the shooter's movement when it fires"
```

(The tap handler still does not compile at this point — Task 2 fixes it. Commit anyway; the branch is not pushed and Task 2 follows immediately.)

---

## Task 2: Thread the clamped budget through the tap handler and game screen

**Files:**
- Modify: `artifacts/hex-battles/logic/tileTapHandler.ts:173-198` (the ranged-shot branch)
- Modify: `artifacts/hex-battles/app/game.tsx` (the `handleTileTap` argument list — it already passes `partialMoves`; verify only)
- Test: `artifacts/hex-battles/logic/tileTapHandler.test.ts`

**Interfaces:**
- Consumes: `resolveRangedShot` with the Task 1 signature, `POST_SHOT_MOVEMENT`.
- Produces: no new exports. `TileTapParams` is unchanged — it already carries both `partialMoves` and `setPartialMoves`.

- [ ] **Step 1: Update the stale test and write the failing ones**

In `artifacts/hex-battles/logic/tileTapHandler.test.ts`, inside `describe("ranged firing", ...)`, **replace** the test named `"spends the shot but neither the movement nor the unit"` with:

```ts
  it("spends the shot and clamps the movement, but does not spend the unit", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("0,0")).toBe(true);
    // Not spent: a clamped bowman still has a point to shuffle with, and a
    // bowman with no movement left may still fire next turn.
    expect(params.setSpentUnits).not.toHaveBeenCalled();
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.get("0,0")).toBe(1);
  });

  it("does not restore movement the shooter had already spent", () => {
    // Move-then-fire is not punished twice: 3 - 2 = 1 was already left.
    const params = shotParams({ partialMoves: new Map([["0,0", 1]]) });
    handleTileTapLogic(params);
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.get("0,0")).toBe(1);
  });

  it("leaves an exhausted shooter at zero", () => {
    const params = shotParams({ partialMoves: new Map([["0,0", 0]]) });
    handleTileTapLogic(params);
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.get("0,0")).toBe(0);
  });
```

Do **not** add a separate "fires, then moves one tile, then is spent" test: the existing test `"survives the move that exhausts the movement budget"` (in `describe("fired flag across moves", ...)`) already sets up exactly that state — a fired bowman with a 1-point budget — and asserts it lands spent. It must keep passing untouched.

Then append this block at the end of the same `describe("ranged firing", ...)`, covering the merge loophole:

```ts
  it("cannot refresh the clamped budget by merging into a fresh bowman", () => {
    // The bowman has fired (budget clamped to 1) and now steps onto an unmoved
    // ally. resolveMovedUnitMoves takes min(remainingAfterMove, destRemaining),
    // and the step itself costs the single point — so the merged Longbowman is
    // spent, not restocked with the destination's full 3.
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "shortbowman"], ["1,0", "shortbowman"]]),
      firedUnits: new Set(["0,0"]),
      partialMoves: new Map([["0,0", 1]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const newEnts: Map<string, EntityType> = (
      params.setEntities as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(newEnts.get("1,0")).toBe("longbowman");
    const spent: Set<string> = (
      params.setSpentUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.has("1,0")).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`

Expected: FAIL. The shot branch does not yet call `setPartialMoves`, so `.mock.calls[0]` is `undefined` in the three clamp tests. (The merge test should already pass — it asserts existing behaviour that must not regress.)

- [ ] **Step 3: Thread the map through the shot branch**

In `artifacts/hex-battles/logic/tileTapHandler.ts`, the ranged-shot branch becomes:

```ts
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

`partialMoves` and `setPartialMoves` are already destructured from `params` at the top of `handleTileTapLogic` — no change to the destructuring or to `TileTapParams` is needed. Verify before adding anything.

- [ ] **Step 4: Verify the game screen needs no change**

Run: `grep -n "partialMoves" artifacts/hex-battles/app/game.tsx`

`game.tsx` passes both `partialMoves` and `setPartialMoves` into the tap-handler params object already, so the clamp reaches React state through the existing wiring. Confirm both appear in that params object and make no edit if they do.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`

Expected: PASS.

- [ ] **Step 6: Typecheck the workspace**

Run: `pnpm run typecheck` (from the repo root — never inside a package)

Expected: clean. This is what proves no other `resolveRangedShot` call site was left behind.

- [ ] **Step 7: Commit**

```bash
git add artifacts/hex-battles/logic/tileTapHandler.ts artifacts/hex-battles/logic/tileTapHandler.test.ts
git commit -m "feat(ranged): apply the post-shot movement clamp from the tap handler"
```

---

## Task 3: Prove the clamp closes forest, and correct the stale docs

**Files:**
- Test: `artifacts/hex-battles/utils/hexGrid.test.ts`
- Modify: `docs/superpowers/plans/2026-07-31-ranged-units.md:1636`

**Interfaces:**
- Consumes: `getValidMoves(unitKey, owner, entities, tileMap, spentUnits, maxRange?, combatSpentUnits?)` from `@/utils/hexGrid`. The `maxRange` argument is the remaining budget; `useSelectionState` passes `partialMoves.get(key) ?? unitMovement(entity)` into it, which is how the clamp reaches the movement highlights.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `artifacts/hex-battles/utils/hexGrid.test.ts`. It reuses that file's existing helpers `makeTile(q, r, owner, terrain?)`, `tileMap(tiles)` and `entities(pairs)`, and `getValidMoves` is already imported there — no new imports or helpers.

```ts
describe("a clamped ranged budget", () => {
  // Bowman on 0,0 with a grass neighbour (cost 1) and a forest neighbour
  // (cost 2), all inside its own territory so capture rules do not interfere.
  function moves(budget: number): Set<string> {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "grass"),
      makeTile(0, 1, "player", "forest"),
    ]);
    return getValidMoves(
      "0,0",
      "player",
      entities([["0,0", "shortbowman"]]),
      map,
      new Set<string>(),
      budget,
    );
  }

  it("reaches both neighbours on a full budget", () => {
    const m = moves(3);
    expect(m.has("1,0")).toBe(true);
    expect(m.has("0,1")).toBe(true);
  });

  it("reaches only the cheap neighbour after a shot", () => {
    // POST_SHOT_MOVEMENT is 1 and forest costs 2, so forest closes off.
    const m = moves(1);
    expect(m.has("1,0")).toBe(true);
    expect(m.has("0,1")).toBe(false);
  });

  it("reaches nothing once the clamped point is spent", () => {
    expect(moves(0).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes immediately**

Run: `pnpm --filter @workspace/hex-battles exec vitest run utils/hexGrid.test.ts`

Expected: PASS on the first run. This is a **characterisation test**, not a TDD cycle: `getValidMoves` already honours a budget, and the test pins down the player-visible consequence of the clamp (forest closes) so a later change to `TERRAIN_MOVE_COST` or to `POST_SHOT_MOVEMENT` cannot silently alter the rule. If it fails, stop — the clamp is not reaching the movement search and Task 2 is wrong.

- [ ] **Step 3: Correct the stale comment in the old plan document**

`docs/superpowers/plans/2026-07-31-ranged-units.md:1636` contains a code sample with the comment `// The shooter keeps its movement, so leave it selected to move away.` Replace that line with the comment now in the shipped code:

```
      // Firing clamps the shooter's movement but does not spend it, so leave it
      // selected: it may still shuffle one cheap tile.
```

Also add `partialMoves,` to the `resolveRangedShot` call in that same code sample and `setPartialMoves(shot.partialMoves);` below `setFiredUnits(shot.firedUnits);`, so the historical plan does not read as a working recipe for the superseded rule.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`

Expected: all files pass. Compare against the baseline of 542 passed / 9 skipped: the count should be 542 + 11 new tests = 553 passed, 9 skipped, with no file failing. If any unrelated suite fails, stop and report rather than adjusting it.

- [ ] **Step 5: Typecheck**

Run: `pnpm run typecheck`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hex-battles/utils/hexGrid.test.ts docs/superpowers/plans/2026-07-31-ranged-units.md
git commit -m "test(ranged): pin the post-shot budget to cheap terrain only"
```

---

## Verification Checklist

Run at the end, before reporting completion. Evidence before assertions.

- [ ] `pnpm test` — 553 passed, 9 skipped, 19 files, 0 failures
- [ ] `pnpm run typecheck` — clean from the repo root
- [ ] `grep -rn "resolveRangedShot" artifacts/hex-battles` — every call site passes `partialMoves`
- [ ] `grep -rniE "keeps its movement|not the movement" docs artifacts` — no hits left
- [ ] `git log --oneline` — three new commits, nothing pushed

## Out of Scope

- Teaching the AI to buy or fire ranged units (deferred by the ranged spec to a later branch).
- Any change to `utils/savedGame.ts`: `partialMoves` is already serialised, and the clamp introduces no new state.
- Any UI, layer or equality-function change: the reachable-tile highlight derives from `partialMoves` and updates itself.
