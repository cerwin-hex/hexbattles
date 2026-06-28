# Rebel Spawn Per-Owner at Turn Start — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single end-of-round global rebel spawn with a per-owner spawn that fires at the start of each owner's turn, restricted to that owner's territory.

**Architecture:** A new `spawnRebelsForOwner` function handles both grave/ruin spawning and background spread, filtered to the active owner's tiles. A global armed snapshot (taken once at round end, after all moves and player economy) is threaded across the turn boundary via refs in `game.tsx` and explicit parameters on `runAiTurn`. The player's spawn fires at the end of `runAiTurn` (just before returning control), so the player always sees rebels at the start of their turn.

**Tech Stack:** TypeScript, React (refs), Vitest.

## Global Constraints

- All code in English (variable names, comments, strings).
- Run typechecks from repo root: `pnpm run typecheck`.
- Run tests: `pnpm --filter @workspace/hex-battles exec vitest run`.
- No new external dependencies.
- Warrior upkeep = 9 (from `ENTITY_META` in `utils/hexGrid.ts`). Grass income = 2/tile.

---

## File Map

| File | Change |
|---|---|
| `artifacts/hex-battles/logic/gameLogic.ts` | Add `spawnRebelsForOwner`; keep `spawnRebels` until Task 7 |
| `artifacts/hex-battles/logic/aiStrategy.ts` | Update `AiTurnCallbacks` interface; update `runAiTurn` signature and body |
| `artifacts/hex-battles/hooks/useAiTurnCallbacks.ts` | Add `setArmedGraves` to params + factory |
| `artifacts/hex-battles/app/game.tsx` | Add `armedGraveyardRef`/`armedRuinsRef`; wire callback; update `runAiTurnOrchestration` call |
| `artifacts/hex-battles/logic/endTurnHandler.ts` | Add `armedGraveyard`/`armedRuins` to `EndTurnParams`; pass to `runAiTurn` |
| `artifacts/hex-battles/logic/aiSelfPlay.ts` | Update `makeHeadlessCbs`; update `runOneAiTurnHeadless`; update both round loops |
| `artifacts/hex-battles/logic/rebelSpawn.test.ts` | Rewrite all tests for per-owner semantics |

---

### Task 1: Add `spawnRebelsForOwner` to `gameLogic.ts`

**Files:**
- Modify: `artifacts/hex-battles/logic/gameLogic.ts` (after the existing `spawnRebels` function, ~line 275)

**Interfaces:**
- Produces: `export function spawnRebelsForOwner(owner, tileMap, entities, graveyard, ruins, armedGraves, armedRuins, rng?): void`
  - Mutates `entities`, `graveyard`, `ruins`, `armedGraves`, `armedRuins` in place. Callers must clone before passing.

- [ ] **Step 1: Add `spawnRebelsForOwner` after `spawnRebels` in `gameLogic.ts`**

Add the following export immediately after the closing brace of `spawnRebels`:

```ts
/**
 * Per-owner variant of rebel spawning. Fires at the start of each owner's
 * turn. Both grave/ruin spawn (75%) and background/spread (2/7.5/10%) are
 * restricted to tiles where tile.owner === owner. Neighbour-rebel counts for
 * spread still read the full global entities map (enemy rebels count).
 *
 * armedGraves / armedRuins are the shared round-start armed sets; this
 * function consumes (deletes) the owner's entries — both from the armed sets
 * and from graveyard/ruins — so each site rolls exactly once and skull markers
 * are cleared after processing.
 *
 * Callers must clone entities/graveyard/ruins before passing.
 */
export function spawnRebelsForOwner(
  owner: TerritoryOwner,
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  graveyard: Set<string>,
  ruins: Set<string>,
  armedGraves: Set<string>,
  armedRuins: Set<string>,
  rng: () => number = Math.random,
): void {
  const preSpread = new Map(entities);

  for (const key of [...armedGraves]) {
    if (tileMap.get(key)?.owner !== owner) continue;
    armedGraves.delete(key);
    if (!graveyard.has(key)) continue;
    graveyard.delete(key);
    if (tileMap.get(key)?.terrain === "lake") continue;
    if (entities.has(key)) continue;
    if (rng() < 0.75) entities.set(key, "rebel");
  }
  for (const key of [...armedRuins]) {
    if (tileMap.get(key)?.owner !== owner) continue;
    armedRuins.delete(key);
    if (!ruins.has(key)) continue;
    ruins.delete(key);
    if (tileMap.get(key)?.terrain === "lake") continue;
    if (entities.has(key)) continue;
    if (rng() < 0.75) entities.set(key, "rebel");
  }

  for (const tile of tileMap.values()) {
    if (tile.owner !== owner) continue;
    if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
    if (entities.has(tile.key)) continue;
    const [tq, tr] = tile.key.split(",").map(Number);
    const neighborRebelCount = HEX_EDGES.filter(({ dir: [dq, dr] }) => {
      const nk = tileKey(tq + dq, tr + dr);
      return preSpread.get(nk) === "rebel";
    }).length;
    const chance =
      neighborRebelCount >= 2 ? 0.1 : neighborRebelCount === 1 ? 0.075 : 0.02;
    if (rng() < chance) entities.set(tile.key, "rebel");
  }
}
```

`TerritoryOwner`, `HexTile`, `EntityType`, `HEX_EDGES`, and `tileKey` are already in scope in this file (used by `spawnRebels`). No new imports needed.

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/hex-battles/logic/gameLogic.ts
git commit -m "feat(rebels): add spawnRebelsForOwner — per-owner territory-scoped spawn"
```

---

### Task 2: Add `setArmedGraves` to `AiTurnCallbacks` and wire it

**Files:**
- Modify: `artifacts/hex-battles/logic/aiStrategy.ts` (interface at ~line 965)
- Modify: `artifacts/hex-battles/hooks/useAiTurnCallbacks.ts`
- Modify: `artifacts/hex-battles/logic/aiSelfPlay.ts` (`makeHeadlessCbs` only)

**Interfaces:**
- Produces: `AiTurnCallbacks.state.setArmedGraves(graves: Set<string>, ruins: Set<string>): void`

- [ ] **Step 1: Add `setArmedGraves` to `AiTurnCallbacks.state` in `aiStrategy.ts`**

In the `state` block of the `AiTurnCallbacks` interface (~line 978, after `advanceTurn`), add:

```ts
/** Store the next-round armed graves/ruins snapshot (called once at round end). */
setArmedGraves(graves: Set<string>, ruins: Set<string>): void;
```

- [ ] **Step 2: Add `setArmedGraves` to `AiTurnCallbacksParams` in `useAiTurnCallbacks.ts`**

After `advanceTurn: () => void;` (~line 22), add:

```ts
setArmedGraves: (graves: Set<string>, ruins: Set<string>) => void;
```

- [ ] **Step 3: Wire it in `makeAiTurnCallbacks` in `useAiTurnCallbacks.ts`**

After `advanceTurn: p.advanceTurn,` (~line 54), add:

```ts
setArmedGraves: p.setArmedGraves,
```

- [ ] **Step 4: Add `setArmedGraves: noop` to `makeHeadlessCbs` in `aiSelfPlay.ts`**

In the `state` block of `makeHeadlessCbs` (~line 87), after `advanceTurn: noop,`, add:

```ts
setArmedGraves: noop,
```

- [ ] **Step 5: Typecheck**

```bash
pnpm run typecheck
```
Expected: type errors from `game.tsx` not yet passing `setArmedGraves` — that's fine, Task 4 fixes that.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hex-battles/logic/aiStrategy.ts \
        artifacts/hex-battles/hooks/useAiTurnCallbacks.ts \
        artifacts/hex-battles/logic/aiSelfPlay.ts
git commit -m "feat(rebels): add setArmedGraves to AiTurnCallbacks interface"
```

---

### Task 3: Rewrite `runAiTurn` in `aiStrategy.ts`

**Files:**
- Modify: `artifacts/hex-battles/logic/aiStrategy.ts` (~lines 1036–1694)

**Interfaces:**
- Consumes: `spawnRebelsForOwner` from Task 1
- Produces: `runAiTurn(ws, cbs, aiOwners, currentTurn, difficulty, armedGraves?, armedRuins?)` — last two params replace `spawnRebelsAtRoundEnd`

- [ ] **Step 1: Add `spawnRebelsForOwner` to the import from `@/logic/gameLogic` in `aiStrategy.ts`**

Find:
```ts
import { ..., spawnRebels, ... } from "@/logic/gameLogic";
```
Add `spawnRebelsForOwner` to that same import line.

- [ ] **Step 2: Replace the `runAiTurn` signature (lines 1036–1047)**

Replace:
```ts
export async function runAiTurn(
  ws: AiWorkingState,
  cbs: AiTurnCallbacks,
  aiOwners: TerritoryOwner[],
  currentTurn: number,
  difficulty: Difficulty,
  // True only for the React flow's single full-round AI phase (all AI owners in
  // one call): it owns the once-per-round, after-everyone-moved rebel spawn.
  // Self-play calls runAiTurn once PER owner, so it passes false and runs the
  // shared spawn itself in its round loop — otherwise rebels would spawn N times.
  spawnRebelsAtRoundEnd = false,
): Promise<void> {
  // Snapshot the graves/ruins that have stood since the start of this round; they
  // are the ones eligible to breed rebels at the end of it. Deaths created DURING
  // this round's economy/combat are added afterwards and wait until next round —
  // preserving the one-round "skull warning" delay.
  const armedGraves = spawnRebelsAtRoundEnd ? new Set(ws.graveyard) : null;
  const armedRuins = spawnRebelsAtRoundEnd ? new Set(ws.ruins) : null;
```

With:
```ts
export async function runAiTurn(
  ws: AiWorkingState,
  cbs: AiTurnCallbacks,
  aiOwners: TerritoryOwner[],
  currentTurn: number,
  difficulty: Difficulty,
  // The round-start armed snapshot from the previous round, passed in by the
  // caller (game.tsx or self-play loop). Each AI owner spawns from their share
  // at turn start; the player spawn fires at the end of this phase.
  // Defaults to empty Sets (round 1, or self-play calls that manage arming
  // externally).
  armedGraves: Set<string> = new Set(),
  armedRuins: Set<string> = new Set(),
): Promise<void> {
```

- [ ] **Step 3: Add per-owner rebel spawn at the top of the AI owner loop**

Inside `for (const aiOwner of aiOwners) {`, after `if (aiTiles.length === 0) continue;` (~line 1065) and BEFORE the `if (currentTurn > 2) {` economy block, insert:

```ts
    // Rebel spawn for this AI owner at the start of their turn.
    // Suspended in round 1 (armedGraves is empty by default, but guard
    // explicitly). Clone ws state first since spawnRebelsForOwner mutates.
    if (currentTurn !== 1 && armedGraves.size > 0) {
      ws.entities = new Map(ws.entities);
      ws.graveyard = new Set(ws.graveyard);
      ws.ruins = new Set(ws.ruins);
      spawnRebelsForOwner(
        aiOwner,
        ws.tileMap,
        ws.entities,
        ws.graveyard,
        ws.ruins,
        armedGraves,
        armedRuins,
      );
      cbs.state.setEntities(new Map(ws.entities));
      cbs.state.setGraveyard(new Set(ws.graveyard));
      cbs.state.setRuins(new Set(ws.ruins));
    }
```

- [ ] **Step 4: Replace the old rebel spawn block with the player spawn**

Find and delete the entire old block (lines ~1654–1674):
```ts
  // ── Rebel spawn at the round boundary (after everyone has moved) ────────────
  // Once per round, the armed graves/ruins (snapshotted at round start) breed
  // rebels and unrest spreads across the map; then those sites are consumed.
  // Suspended in round 1. Only the full-round React call does this (see the flag).
  if (spawnRebelsAtRoundEnd && currentTurn !== 1 && armedGraves && armedRuins) {
    ws.entities = new Map(ws.entities);
    spawnRebels({
      tileMap: ws.tileMap,
      entities: ws.entities,
      graveyard: ws.graveyard,
      ruins: ws.ruins,
      armedGraves,
      armedRuins,
    });
    // Each armed site rolls once, then is consumed (whether or not it spawned),
    // leaving only deaths created THIS round to arm the next one.
    ws.graveyard = new Set(ws.graveyard);
    ws.ruins = new Set(ws.ruins);
    for (const k of armedGraves) ws.graveyard.delete(k);
    for (const k of armedRuins) ws.ruins.delete(k);
  }
```

Replace with (insert in the same location, between player economy and the win/loss check):

```ts
  // ── Rebel spawn for the player at round end ─────────────────────────────────
  // Snapshot all graves/ruins present at the end of this AI phase (after all AI
  // moves and player economy). These arm the next round: AI owners spawn from
  // them at the start of their turns (passed in as armedGraves next call), and
  // the player spawn below makes rebels visible at the start of the player's
  // next turn. Suspended in round 1.
  if (currentTurn !== 1) {
    const nextArmedGraves = new Set(ws.graveyard);
    const nextArmedRuins  = new Set(ws.ruins);
    ws.entities = new Map(ws.entities);
    // ws.graveyard / ws.ruins are already clones from the player economy block
    // above, so mutations inside spawnRebelsForOwner are safe.
    spawnRebelsForOwner(
      "player",
      ws.tileMap,
      ws.entities,
      ws.graveyard,
      ws.ruins,
      nextArmedGraves,
      nextArmedRuins,
    );
    cbs.state.setArmedGraves(nextArmedGraves, nextArmedRuins);
  }
```

- [ ] **Step 5: Typecheck**

```bash
pnpm run typecheck
```
Expected: errors from callers still passing the old boolean `true` — fixed in Tasks 4 and 5.

- [ ] **Step 6: Commit**

```bash
git add artifacts/hex-battles/logic/aiStrategy.ts
git commit -m "feat(rebels): per-owner spawn in runAiTurn — before each AI turn + player at round end"
```

---

### Task 4: Wire `armedGraves` through `game.tsx` and `endTurnHandler.ts`

**Files:**
- Modify: `artifacts/hex-battles/app/game.tsx`
- Modify: `artifacts/hex-battles/logic/endTurnHandler.ts`

**Interfaces:**
- Consumes: `setArmedGraves` callback (Task 2); updated `runAiTurn` (Task 3)

- [ ] **Step 1: Add refs in `game.tsx`**

Near the other refs (e.g. `graveyardRef`, `ruinsRef`), add:

```ts
const armedGraveyardRef = useRef<Set<string>>(new Set());
const armedRuinsRef     = useRef<Set<string>>(new Set());
```

- [ ] **Step 2: Pass `setArmedGraves` to `makeAiTurnCallbacks` in `game.tsx`**

In the `makeAiTurnCallbacks({...})` call (~line 678), add after `advanceTurn: () => setTurn((t) => t + 1),`:

```ts
setArmedGraves: (graves, ruins) => {
  armedGraveyardRef.current = graves;
  armedRuinsRef.current     = ruins;
},
```

- [ ] **Step 3: Update the `runAiTurn` useCallback signature in `game.tsx`**

The `runAiTurn` useCallback (~line 653) is the wrapper that `endTurnHandler.ts` calls. Extend its parameter list with two optional trailing params:

```ts
const runAiTurn = useCallback(
  async (
    currentTileMap: Map<string, HexTile>,
    currentEntities: Map<string, EntityType>,
    currentBalances: Map<string, number>,
    currentTurn?: number,
    initialGraveyard?: Set<string>,
    initialRuins?: Set<string>,
    initialCities?: Set<string>,
    passedArmedGraves?: Set<string>,
    passedArmedRuins?: Set<string>,
  ) => {
    const ws: AiWorkingState = {
      // ... existing fields unchanged ...
    };
    const cbs = makeAiTurnCallbacks({ /* ... unchanged ... */ });
    await runAiTurnOrchestration(
      ws, cbs, aiOwners, currentTurn ?? 0, aiDifficultyRef.current,
      new Set(passedArmedGraves ?? armedGraveyardRef.current),
      new Set(passedArmedRuins  ?? armedRuinsRef.current),
    );
  },
  [aiOwners, checkWinLoss, awaitStep, triggerUnitAnimation],
);
```

The `new Set(...)` copy-on-call is important: `runAiTurn` mutates the passed sets as it consumes per-owner entries.

- [ ] **Step 4: Update the `EndTurnParams` type in `endTurnHandler.ts`**

Add two fields to `EndTurnParams` (alongside `graveyard`/`ruins`):

```ts
armedGraveyard: Set<string>;
armedRuins: Set<string>;
```

Also update the `runAiTurn` field's type signature in `EndTurnParams` to add the two new optional trailing params:

```ts
runAiTurn: (
  currentTileMap: Map<string, HexTile>,
  currentEntities: Map<string, EntityType>,
  currentBalances: Map<string, number>,
  currentTurn?: number,
  initialGraveyard?: Set<string>,
  initialRuins?: Set<string>,
  initialCities?: Set<string>,
  armedGraves?: Set<string>,
  armedRuins?: Set<string>,
) => void;
```

- [ ] **Step 5: Thread `armedGraveyard`/`armedRuins` through `handleEndTurnLogic`**

Destructure them:
```ts
const { ..., armedGraveyard, armedRuins, ... } = params;
```

Pass them to `runAiTurn` at the bottom of `handleEndTurnLogic`:
```ts
runAiTurn(
  nextTileMap,
  nextEntities,
  nextBalances,
  turn,
  nextGraveyard,
  nextRuins,
  cities,
  armedGraveyard,
  armedRuins,
);
```

- [ ] **Step 6: Pass `armedGraveyardRef.current` and `armedRuinsRef.current` from `handleEndTurn` in `game.tsx`**

In the `handleEndTurn` useCallback (~line 1151), add the two new fields to the `handleEndTurnLogic({...})` call:

```ts
handleEndTurnLogic({
  // ... existing fields unchanged ...
  armedGraveyard: armedGraveyardRef.current,
  armedRuins:     armedRuinsRef.current,
});
```

- [ ] **Step 7: Update stale comment in `endTurnHandler.ts`**

Find the comment that mentions rebel spawning at the end of the AI phase and replace it:

```ts
// Rebel spawning no longer happens here. It runs per-owner at the START of
// each owner's turn inside runAiTurn (territory-scoped), with the round-start
// armed snapshot threaded across the turn boundary via armedGraveyard/armedRuins.
```

- [ ] **Step 8: Typecheck**

```bash
pnpm run typecheck
```
Expected: no errors (or only aiSelfPlay.ts errors — Task 5 handles those).

- [ ] **Step 9: Commit**

```bash
git add artifacts/hex-battles/app/game.tsx \
        artifacts/hex-battles/logic/endTurnHandler.ts
git commit -m "feat(rebels): wire armedGraves refs through game.tsx and endTurnHandler"
```

---

### Task 5: Update `aiSelfPlay.ts`

**Files:**
- Modify: `artifacts/hex-battles/logic/aiSelfPlay.ts`

**Interfaces:**
- Consumes: `spawnRebelsForOwner` (Task 1); updated `runAiTurn` (Task 3)

- [ ] **Step 1: Add `spawnRebelsForOwner` to imports in `aiSelfPlay.ts`**

Find:
```ts
import { applySingleHexPenalty, spawnRebels } from "@/logic/gameLogic";
```
Change to:
```ts
import { applySingleHexPenalty, spawnRebels, spawnRebelsForOwner } from "@/logic/gameLogic";
```

- [ ] **Step 2: Update `runOneAiTurnHeadless` signature**

Replace:
```ts
export async function runOneAiTurnHeadless(
  ws: AiWorkingState,
  owner: TerritoryOwner,
  turn: number,
  difficulty: Difficulty,
  spawnRebelsAtRoundEnd = false,
): Promise<void> {
  ws.spentUnits = new Set();
  ws.partialMoves = new Map();
  ws.attacksUsed = new Map();
  ws.combatSpentUnits = new Set();
  await runAiTurn(ws, makeHeadlessCbs(), [owner], turn, difficulty, spawnRebelsAtRoundEnd);
}
```
With:
```ts
export async function runOneAiTurnHeadless(
  ws: AiWorkingState,
  owner: TerritoryOwner,
  turn: number,
  difficulty: Difficulty,
  armedGraves: Set<string> = new Set(),
  armedRuins: Set<string> = new Set(),
): Promise<void> {
  ws.spentUnits = new Set();
  ws.partialMoves = new Map();
  ws.attacksUsed = new Map();
  ws.combatSpentUnits = new Set();
  await runAiTurn(ws, makeHeadlessCbs(), [owner], turn, difficulty, armedGraves, armedRuins);
}
```

- [ ] **Step 3: Update the `runMatch` round loop (~line 220)**

Find the block starting with `const armedGraves = new Set(ws.graveyard);` inside the `for (; turn <= cfg.maxTurns; turn++)` loop and replace the entire owner-loop + post-loop rebel spawn:

```ts
    // Arm from end of previous round. Round 1: sets are empty, guard below.
    const armedGraves = new Set(ws.graveyard);
    const armedRuins  = new Set(ws.ruins);
    for (const owner of COMPETITORS) {
      if (landTiles(ws, owner) === 0) continue;
      ws.spentUnits = new Set();
      ws.partialMoves = new Map();
      ws.attacksUsed = new Map();
      ws.combatSpentUnits = new Set();
      // Per-owner spawn at start of turn (suspended round 1).
      if (turn !== 1) {
        ws.entities = new Map(ws.entities);
        ws.graveyard = new Set(ws.graveyard);
        ws.ruins = new Set(ws.ruins);
        spawnRebelsForOwner(
          owner, ws.tileMap, ws.entities, ws.graveyard, ws.ruins,
          armedGraves, armedRuins, rng,
        );
      }
      cfg.onBeforeOwnerTurn?.(owner);
      await runAiTurn(ws, cbs, [owner], turn, diffByOwner[owner]);
      for (const bal of ws.balances.values()) {
        if (bal < minBalance) minBalance = bal;
      }
    }
    // armedGraves/armedRuins are now fully consumed. Next round's snapshot is
    // taken at the top of the next iteration.
```

- [ ] **Step 4: Update the `runSeriesMatch` round loop (~line 359)**

Find and replace the equivalent block in `runSeriesMatch` with the same pattern:

```ts
    const armedGraves = new Set(ws.graveyard);
    const armedRuins  = new Set(ws.ruins);
    for (const owner of seats) {
      if (landTiles(ws, owner) === 0) continue;
      ws.spentUnits = new Set();
      ws.partialMoves = new Map();
      ws.attacksUsed = new Map();
      ws.combatSpentUnits = new Set();
      if (turn !== 1) {
        ws.entities = new Map(ws.entities);
        ws.graveyard = new Set(ws.graveyard);
        ws.ruins = new Set(ws.ruins);
        spawnRebelsForOwner(
          owner, ws.tileMap, ws.entities, ws.graveyard, ws.ruins,
          armedGraves, armedRuins, rng,
        );
      }
      cfg.onBeforeOwnerTurn?.(owner);
      const t0 = performance.now();
      await runAiTurn(ws, cbs, [owner], turn, diffByOwner[owner]);
      computeMs += performance.now() - t0;
      ownerTurns++;
      for (const bal of ws.balances.values()) {
        if (bal < minBalance) minBalance = bal;
      }
      cfg.onAfterOwnerTurn?.(owner, ws);
    }
```

- [ ] **Step 5: Remove `spawnRebels` from imports if now unused**

```bash
grep -n "spawnRebels[^F]" artifacts/hex-battles/logic/aiSelfPlay.ts
```
If only the import line appears, remove `spawnRebels` from it:
```ts
import { applySingleHexPenalty, spawnRebelsForOwner } from "@/logic/gameLogic";
```

- [ ] **Step 6: Typecheck**

```bash
pnpm run typecheck
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add artifacts/hex-battles/logic/aiSelfPlay.ts
git commit -m "feat(rebels): per-owner spawn in self-play loops; update runOneAiTurnHeadless"
```

---

### Task 6: Rewrite `rebelSpawn.test.ts`

**Files:**
- Modify: `artifacts/hex-battles/logic/rebelSpawn.test.ts`

**Interfaces:**
- Consumes: `runOneAiTurnHeadless(ws, owner, turn, difficulty, armedGraves, armedRuins)` (Task 5); `spawnRebelsForOwner` (Task 1)

- [ ] **Step 1: Rewrite the entire file**

Replace `artifacts/hex-battles/logic/rebelSpawn.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { runOneAiTurnHeadless } from "@/logic/aiSelfPlay";
import { spawnRebelsForOwner } from "@/logic/gameLogic";
import type { AiWorkingState } from "@/logic/aiStrategy";

// ─────────────────────────────────────────────────────────────────────────────
// Rebel spawning runs per-owner at the START of each owner's turn, from a
// global armed snapshot taken at the END of the previous round. Only tiles
// owned by the active owner are eligible for spawn and spread.
// ─────────────────────────────────────────────────────────────────────────────

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

function makeWs(tiles: HexTile[], overrides: Partial<AiWorkingState> = {}): AiWorkingState {
  return {
    tileMap: new Map(tiles.map((t) => [t.key, t])),
    entities: new Map(),
    balances: new Map(),
    liveOwnerMap: new Map(),
    graveyard: new Set(),
    ruins: new Set(),
    cities: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    attacksUsed: new Map(),
    combatSpentUnits: new Set(),
    freeTowerUsed: new Map(),
    ...overrides,
  };
}

// ── Unit tests for spawnRebelsForOwner ───────────────────────────────────────

describe("spawnRebelsForOwner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("armed grave in owner territory spawns rebel (75% roll hits) and is consumed", () => {
    const tileMap = new Map([["5,5", makeTile(5, 5, "player")]]);
    const entities = new Map<string, EntityType>();
    const graveyard = new Set(["5,5"]);
    const armedGraves = new Set(["5,5"]);

    spawnRebelsForOwner(
      "player", tileMap, entities, graveyard, new Set(),
      armedGraves, new Set(), () => 0.5, // 0.5 < 0.75 → spawn
    );

    expect(entities.get("5,5")).toBe("rebel");
    expect(armedGraves.has("5,5")).toBe(false); // consumed from armed set
    expect(graveyard.has("5,5")).toBe(false);   // skull marker cleared
  });

  it("armed grave in a different owner's territory is NOT consumed or spawned", () => {
    const tileMap = new Map([["5,5", makeTile(5, 5, "ai1")]]);
    const entities = new Map<string, EntityType>();
    const graveyard = new Set(["5,5"]);
    const armedGraves = new Set(["5,5"]);

    spawnRebelsForOwner(
      "player", tileMap, entities, graveyard, new Set(),
      armedGraves, new Set(), () => 0.5,
    );

    expect(entities.get("5,5")).toBeUndefined();
    expect(armedGraves.has("5,5")).toBe(true); // untouched
    expect(graveyard.has("5,5")).toBe(true);   // untouched
  });

  it("grave is consumed from graveyard even when the 75% roll misses", () => {
    const tileMap = new Map([["5,5", makeTile(5, 5, "player")]]);
    const entities = new Map<string, EntityType>();
    const graveyard = new Set(["5,5"]);
    const armedGraves = new Set(["5,5"]);

    spawnRebelsForOwner(
      "player", tileMap, entities, graveyard, new Set(),
      armedGraves, new Set(), () => 0.99, // 0.99 > 0.75 → miss
    );

    expect(entities.get("5,5")).toBeUndefined(); // no rebel
    expect(armedGraves.has("5,5")).toBe(false);  // still consumed
    expect(graveyard.has("5,5")).toBe(false);    // still cleared
  });

  it("background spawn (2%) fires only on owner tiles, not neighbour owner tiles", () => {
    const tileMap = new Map([
      ["0,0", makeTile(0, 0, "player")],
      ["1,0", makeTile(1, 0, "ai1")],
    ]);
    const entities = new Map<string, EntityType>();

    spawnRebelsForOwner(
      "player", tileMap, entities, new Set(), new Set(),
      new Set(), new Set(), () => 0.01, // 0.01 < 0.02 → background fires
    );

    expect(entities.get("0,0")).toBe("rebel");   // player tile spawned
    expect(entities.get("1,0")).toBeUndefined(); // ai1 tile untouched
  });
});

// ── Integration tests via runOneAiTurnHeadless ────────────────────────────────

describe("rebel spawn — integration via runOneAiTurnHeadless", () => {
  afterEach(() => vi.restoreAllMocks());

  it("armed grave in player territory rises at end of AI phase (player sees rebel next turn)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // < 0.75 → spawn
    // ai1 owns no tiles → does nothing. Grave at 5,5 is armed (from prev round).
    const state = makeWs([makeTile(5, 5, "player")], {
      graveyard: new Set(["5,5"]),
    });
    await runOneAiTurnHeadless(
      state, "ai1", 2, "medium",
      new Set(["5,5"]) /* armedGraves */, new Set(),
    );

    expect(state.entities.get("5,5")).toBe("rebel");
    expect(state.graveyard.has("5,5")).toBe(false); // consumed
  });

  it("is suspended in round 1 — no spawn even with armed grave", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = makeWs([makeTile(5, 5, "player")], {
      graveyard: new Set(["5,5"]),
    });
    await runOneAiTurnHeadless(
      state, "ai1", 1, "medium",
      new Set(["5,5"]), new Set(),
    );

    expect(state.entities.get("5,5")).toBeUndefined(); // round 1 guard
    expect(state.graveyard.has("5,5")).toBe(true);     // untouched
  });

  it("grave created THIS round by player bankruptcy is in nextArmedGraves and spawns rebel immediately", async () => {
    // Player territory: (0,0) grass + (1,0) grass. Warrior at (0,0).
    // income = 4 (2 × grass), warrior upkeep = 9 → net −5 → bankrupt.
    // warrior on grass → deleted from entities, graveyard.add("0,0").
    // After player economy, nextArmedGraves = ws.graveyard = {"5,5", "0,0"}.
    // Player spawn fires both: rebel at 5,5 (pre-armed) + rebel at 0,0 (new).
    vi.spyOn(Math, "random").mockReturnValue(0.5); // < 0.75 → spawn for all rolls
    const state = makeWs(
      [
        makeTile(0, 0, "player", "grass"),
        makeTile(1, 0, "player", "grass"),
        makeTile(5, 5, "player", "grass"), // isolated — separate territory
      ],
      {
        entities: new Map<string, EntityType>([["0,0", "warrior"]]),
        balances: new Map([["0,0", 0]]), // territory ID "0,0" → balance 0 → bankrupt
        graveyard: new Set(["5,5"]),     // pre-existing armed grave
      },
    );
    await runOneAiTurnHeadless(
      state, "ai1", 2, "medium",
      new Set(["5,5"]) /* armedGraves */, new Set(),
    );

    // Pre-existing grave at 5,5 rose.
    expect(state.entities.get("5,5")).toBe("rebel");
    expect(state.graveyard.has("5,5")).toBe(false);

    // Bankruptcy grave at 0,0 also rose — same-round arming is the new behaviour.
    expect(state.entities.get("0,0")).toBe("rebel");
    expect(state.graveyard.has("0,0")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new tests**

```bash
pnpm --filter @workspace/hex-battles exec vitest run logic/rebelSpawn.test.ts
```
Expected: all 7 tests pass.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm --filter @workspace/hex-battles exec vitest run
```
Expected: all pass (or only pre-existing failures unrelated to rebels).

- [ ] **Step 4: Commit**

```bash
git add artifacts/hex-battles/logic/rebelSpawn.test.ts
git commit -m "test(rebels): rewrite rebelSpawn tests for per-owner turn-start semantics"
```

---

### Task 7: Final cleanup and verification

**Files:**
- Possibly modify: `artifacts/hex-battles/logic/gameLogic.ts` (remove `spawnRebels`)
- Possibly modify: `artifacts/hex-battles/logic/aiStrategy.ts` (remove `spawnRebels` import)

- [ ] **Step 1: Check if `spawnRebels` is still referenced anywhere**

```bash
grep -rn "\bspawnRebels\b" artifacts/hex-battles/
```
Expected hits: only the function definition in `gameLogic.ts` and possibly its import in `aiStrategy.ts`. If `aiSelfPlay.ts` no longer uses it (Task 5 removed its call), remove it from both files.

- [ ] **Step 2: Full typecheck**

```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Full test suite**

```bash
pnpm --filter @workspace/hex-battles exec vitest run
```
Expected: all pass.

- [ ] **Step 4: Commit cleanup**

```bash
git add artifacts/hex-battles/logic/gameLogic.ts \
        artifacts/hex-battles/logic/aiStrategy.ts
git commit -m "chore(rebels): remove unused global spawnRebels after per-owner migration"
```
