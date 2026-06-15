# Turn Counter → Round Semantics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the turn counter equal the round number — every actor (player + all AIs) acts in round R while the counter reads R — instead of the counter ticking to R+1 mid-round at the player's End Turn press.

**Architecture:** Relocate the single `setTurn((t) => t + 1)` from `handleEndTurnLogic` (which runs at the player's End Turn, *before* the AIs play) to the AI-phase completion point in `runAiTurn` (`aiStrategy.ts`, right before `setIsAiTurn(false)`), via a new `advanceTurn` callback on `AiTurnCallbacks.state`. **The economy is provably unchanged:** the income/upkeep gates (`turn !== 1`, `turn > 2`, free-tower `turn === 1`) are all evaluated at the player's End Turn, where the counter already equals the round number R in BOTH the old and new schemes (in the old code `setTurn` runs *after* those gates); and `runAiTurn` is already passed the local `turn` value (= R) as a parameter, so the AI sees R regardless of when the React state increments. The only observable change is the displayed counter during the AI phase: R instead of R+1.

**Tech Stack:** TypeScript, React (Expo), Vitest.

**Why this is safe to do test-first:** Because the change must NOT alter economy, we lock the income cadence with a characterization test first (Task 1), then relocate the increment (Tasks 2-3), and confirm the cadence test still passes unchanged.

**Run commands (from repo root `/home/jo/Hex-Battles`):**
- A test file: `pnpm --filter @workspace/hex-battles exec vitest run logic/endTurnHandler.test.ts`
- Typecheck: `pnpm run typecheck`
- Full suite: `pnpm test`

**Conventions:** All code English. `pnpm` only. Never `git push`. Work on branch `expert-ai-difficulty` (current) unless told otherwise.

---

## Background: the exact current flow

- `app/game.tsx`: `const [turn, setTurn] = useState(1);`
- `logic/endTurnHandler.ts` `handleEndTurnLogic` runs on the player's End Turn:
  - Guard: `if (isAiTurn || gameResult !== null) return;` (line ~97)
  - Player income/upkeep gated `if (turn !== 1)` (line ~108)
  - AI income/upkeep gated `if (turn > 2)` (line ~181) — comment explains the one-round delay so both sides hold `10 + (R-2)` credits at the start of round R
  - `applySingleHexPenalty` and rebel spawning gated `if (turn !== 1)`
  - **`setTurn((t) => t + 1);`** (line ~327) ← the increment to relocate
  - `if (!checkWinLoss(...)) { setIsAiTurn(true); runAiTurn(mutableTileMap, nextEntities, nextBalances, turn /* local = R */, ...); }`
- `logic/aiStrategy.ts` `runAiTurn` ends (line ~1576-1589): win/loss check, publish final state, `cbs.refs.setAiTurn(false)`, `await cbs.awaitPostAiResume()`, then **`cbs.state.setIsAiTurn(false);`** ← control returns to the player here.
- `logic/tileTapHandler.ts` free first tower gated `turn === 1` (line ~430) — evaluated during the player's turn.
- `app/game.tsx` dev-auto-activate effect: fires on `turn >= 2 && !isAiTurn` (added earlier this session).
- `logic/aiSelfPlay.ts` uses its OWN round-based turn loop (income at `turn >= 3`) — it does NOT use `handleEndTurnLogic` and is unaffected by this change.

---

## File Structure

- `logic/endTurnHandler.ts` — MODIFY: delete the `setTurn((t) => t + 1)` line. Remove `setTurn` from the destructure/params usage IF it becomes entirely unused (see Task 3 — it likely should stay in the params interface only if still referenced; if not, remove from interface too).
- `logic/aiStrategy.ts` — MODIFY: add `advanceTurn(): void;` to `AiTurnCallbacks.state` (interface ~line 951) and call `cbs.state.advanceTurn();` at the completion point (~line 1589).
- `hooks/useAiTurnCallbacks.ts` — MODIFY: wire `advanceTurn` into the `state` object it builds, from a new param.
- `app/game.tsx` — MODIFY: pass `advanceTurn: () => setTurn((t) => t + 1)` into `useAiTurnCallbacks`; update the dev-auto-activate comment.
- `logic/endTurnHandler.test.ts` — MODIFY: remove/relocate the "increments the turn counter" test; repoint the two guard tests off `setTurn`.
- `logic/aiStrategy.test.ts` — MODIFY: add a test that `runAiTurn` calls `advanceTurn` once on normal completion.

---

## Task 1: Lock the income cadence with a characterization test (do this FIRST)

This pins the economy so the relocation in later tasks can't silently change it.

**Files:**
- Test: `logic/endTurnHandler.test.ts`

- [ ] **Step 1: Read the existing test helpers**
Open `logic/endTurnHandler.test.ts` and read the `makeParams(...)` helper (top of file, ~lines 1-61) and the existing `makeTile`/`tileMap` helpers so you reuse them exactly.

- [ ] **Step 2: Add cadence characterization tests**
Add a new describe block. These assert the CURRENT behaviour (which must survive the refactor): the player is credited from round 2 (`turn !== 1`), the AI from round 3 (`turn > 2`). Use a player tile and an AI tile with known income so balances move by a known delta.

```typescript
describe("income cadence (characterization — must survive the turn-counter refactor)", () => {
  it("round 2: player credited, AI not yet", () => {
    // turn === 2 at the player's End Turn (round 2). Player income applies; AI does not (turn > 2 is false).
    const tiles = [makeTile(0, 0, "player"), makeTile(5, 5, "ai1")];
    const setBalances = vi.fn();
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      aiOwners: ["ai1"],
      territoryBalances: new Map(), // both start at 0
      setTerritoryBalances: setBalances,
    });
    handleEndTurnLogic(params);
    const next: Map<string, number> = setBalances.mock.calls[0][0];
    // player territory id gained income (grass = 2); ai1 territory still 0 (not yet credited)
    const playerTid = /* derive via getTerritoryId on the player territory */;
    const aiTid = /* derive via getTerritoryId on the ai1 territory */;
    expect(next.get(playerTid)).toBeGreaterThan(0);
    expect(next.get(aiTid) ?? 0).toBe(0);
  });

  it("round 3: AI now credited too", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(5, 5, "ai1")];
    const setBalances = vi.fn();
    const params = makeParams({
      turn: 3,
      activeTileMap: tileMap(tiles),
      aiOwners: ["ai1"],
      territoryBalances: new Map(),
      setTerritoryBalances: setBalances,
    });
    handleEndTurnLogic(params);
    const next: Map<string, number> = setBalances.mock.calls[0][0];
    const aiTid = /* derive via getTerritoryId on the ai1 territory */;
    expect(next.get(aiTid) ?? 0).toBeGreaterThan(0);
  });
});
```

For the `/* derive ... */` parts: import `getContiguousTerritory` and `getTerritoryId` from `@/utils/hexGrid` (the test file may already import them — check), build the territory from the same `activeTileMap` + an empty entities map, and compute the id, exactly as `handleEndTurnLogic` does. If the single-tile territory gets a single-hex penalty that complicates the assertion, use a 2-tile contiguous territory per owner instead (e.g. player at (0,0),(1,0) and ai1 at (5,5),(6,5)) so they're stable; adjust the expected `> 0` accordingly.

- [ ] **Step 3: Run — must PASS now (characterizing current behaviour)**
`pnpm --filter @workspace/hex-battles exec vitest run logic/endTurnHandler.test.ts`
Expected: PASS. If it does not, your territory-id derivation is off — fix the test, not the source.

- [ ] **Step 4: Commit**
```bash
git add artifacts/hex-battles/logic/endTurnHandler.test.ts
git commit -m "test(turn): characterize income cadence before counter relocation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add `advanceTurn` callback and call it at AI-phase completion

**Files:**
- Modify: `logic/aiStrategy.ts` (interface ~line 951; call site ~line 1589)
- Modify: `hooks/useAiTurnCallbacks.ts`
- Modify: `app/game.tsx`
- Test: `logic/aiStrategy.test.ts`

- [ ] **Step 1: Write the failing test**
In `logic/aiStrategy.test.ts`, find how existing tests build the `AiTurnCallbacks` mock (there is almost certainly a helper that creates a `cbs` with `vi.fn()` state setters). Add `advanceTurn: vi.fn()` to that mock's `state`. Then add a test:

```typescript
it("advances the turn exactly once when the AI phase completes", async () => {
  // Build a minimal ws with one AI owner that can complete a turn, and the cbs mock.
  // Reuse the existing test's setup pattern for runAiTurn.
  const cbs = makeCbs(); // existing helper; ensure its state has advanceTurn: vi.fn()
  await runAiTurn(ws, cbs, ["ai1"], 3, "easy");
  expect(cbs.state.advanceTurn).toHaveBeenCalledTimes(1);
});
```
Mirror the EXACT setup the other `runAiTurn` tests in this file use for `ws`/`cbs` (read them first). If the existing mock helper is shared, add `advanceTurn: vi.fn()` there so all tests keep compiling.

- [ ] **Step 2: Run — confirm it fails**
`pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts -t "advances the turn"`
Expected: FAIL — `advanceTurn` not on the interface / not called.

- [ ] **Step 3: Add `advanceTurn` to the interface and call it**
In `logic/aiStrategy.ts`, add to `AiTurnCallbacks.state` (after `setIsAiTurn(v: boolean): void;` ~line 961):
```typescript
    /** Advance the round counter; called once when the whole AI phase completes. */
    advanceTurn(): void;
```
At the completion point (~line 1587-1589), insert the call so the counter ticks exactly when control returns to the player:
```typescript
  cbs.refs.setAiTurn(false);
  await cbs.awaitPostAiResume();
  cbs.state.advanceTurn();
  cbs.state.setIsAiTurn(false);
```
(Place `advanceTurn()` right before `setIsAiTurn(false)`. It runs once per completed AI phase. Note: if the player already triggered a win/loss at their End Turn, `runAiTurn` is never called, so the counter simply doesn't advance on a finished game — correct.)

- [ ] **Step 4: Wire it through the hook and game.tsx**
In `hooks/useAiTurnCallbacks.ts`, the function builds the `state` object. Add `advanceTurn: p.advanceTurn,` to that `state` object, and add `advanceTurn: () => void;` to the hook's params type (`p`). 
In `app/game.tsx`, where `useAiTurnCallbacks({ ... })` is called (search for the call passing `setIsAiTurn`, `setEntities`, etc.), add:
```typescript
      advanceTurn: () => setTurn((t) => t + 1),
```

- [ ] **Step 5: Run the test — passes**
`pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts`
Expected: PASS (new test + all existing).

- [ ] **Step 6: Typecheck + commit**
```bash
pnpm run typecheck
git add artifacts/hex-battles/logic/aiStrategy.ts artifacts/hex-battles/hooks/useAiTurnCallbacks.ts artifacts/hex-battles/app/game.tsx artifacts/hex-battles/logic/aiStrategy.test.ts
git commit -m "feat(turn): advance counter when AI phase completes (round semantics)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Remove the old mid-round increment from `handleEndTurnLogic`

**Files:**
- Modify: `logic/endTurnHandler.ts`
- Modify: `logic/endTurnHandler.test.ts`

- [ ] **Step 1: Update the tests first (red), then the source (green)**
In `logic/endTurnHandler.test.ts`:
- DELETE the test `it("increments the turn counter", ...)` (lines ~78-84) — the increment no longer lives here; Task 2 already covers it in `aiStrategy.test.ts`.
- The two guard tests (`"does nothing when isAiTurn is true"` and `"does nothing when gameResult is not null"`) currently assert `expect(params.setTurn).not.toHaveBeenCalled();`. Repoint them to a real early-return marker, since `setTurn` will no longer be called at all. The guard returns at the very top (`if (isAiTurn || gameResult !== null) return;`) before `setMoveHistory([])`. Change each assertion to:
```typescript
    expect(params.setMoveHistory).not.toHaveBeenCalled();
```
(Confirm `setMoveHistory` is a `vi.fn()` in `makeParams`; it is in the params. If not, use `params.setEntities`.)

- [ ] **Step 2: Run — the "increments" test is gone; guards now assert setMoveHistory**
`pnpm --filter @workspace/hex-battles exec vitest run logic/endTurnHandler.test.ts`
At this point the guard tests still pass (source unchanged), and the cadence tests from Task 1 pass. Expected: PASS.

- [ ] **Step 3: Remove the increment from the source**
In `logic/endTurnHandler.ts`, delete the line (~327):
```typescript
  setTurn((t) => t + 1);
```
Then check whether `setTurn` is still referenced anywhere in `handleEndTurnLogic`. If it is NOT, remove `setTurn` from the destructured `const { ... } = params;` block AND from the `EndTurnParams` interface (`setTurn: Dispatch<SetStateAction<number>>;`) to avoid an unused-field lint and to make the interface honest. If removing from the interface, also remove `setTurn` from the `makeParams` mock in the test file and from the `app/game.tsx` call site that passes `setTurn` into the end-turn handler params (search for where `handleEndTurnLogic`/the tap+endturn params are assembled). Be thorough: a dangling `setTurn` passed but unused is acceptable to TypeScript but is dead — prefer removing it cleanly. If in doubt, keeping it in the interface is safe; removing the call is the required change.

- [ ] **Step 4: Run the full economy suite — cadence MUST be unchanged**
`pnpm --filter @workspace/hex-battles exec vitest run logic/endTurnHandler.test.ts`
Expected: PASS — especially the Task 1 cadence tests (player credited round 2, AI round 3) prove the economy did not move.

- [ ] **Step 5: Typecheck + commit**
```bash
pnpm run typecheck
git add artifacts/hex-battles/logic/endTurnHandler.ts artifacts/hex-battles/logic/endTurnHandler.test.ts
# include app/game.tsx only if you removed the now-dead setTurn param wiring there
git commit -m "refactor(turn): stop incrementing counter mid-round at player End Turn

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Verify the downstream consumers of `turn`

The counter now reads R during the AI phase (was R+1). Confirm every reader is still correct.

**Files:**
- Modify: `app/game.tsx` (comment only, if needed)
- Inspect: `logic/tileTapHandler.ts`, the undo/AI-step snapshots

- [ ] **Step 1: Free-tower gate (`turn === 1`)**
In `logic/tileTapHandler.ts` (~line 430) the free first tower is gated `turn === 1`. This is evaluated during the PLAYER's turn. Player round 1 is at counter 1 in BOTH schemes (the increment now happens after the AIs of round 1). Confirm by reasoning: nothing to change. Write a one-line note in your report confirming it.

- [ ] **Step 2: Dev-auto-activate effect**
In `app/game.tsx`, the effect `if (turn >= 2 && !isAiTurn) setIsDeveloperModeActive(true)` still fires exactly once when round 1 completes (the counter advances to 2 at the same moment `isAiTurn` flips to false). Update its comment, which currently says "`turn` is incremented at the player's end-of-turn, so it already reads 2 during the AIs' first turn" — that is now FALSE. Replace that comment with:
```typescript
  // Dev builds: auto-enable developer mode once the first full round (the player
  // plus every AI) has completed. The round counter now advances when the AI
  // phase ends, so `turn` becomes 2 exactly as `isAiTurn` flips back to false —
  // this fires once at that boundary. A later manual toggle sticks.
```

- [ ] **Step 3: Undo / AI-step snapshots capture & restore `turn`**
Search for where `turn` is saved into and restored from history (`grep -n "turn" app/game.tsx` around the snapshot save and `setTurn(s.turn)` at ~line 571; and the `MoveHistorySnapshot`/`AiStepSnapshot` types). Confirm the snapshot stores and restores `turn` consistently (it captures whatever the counter currently is and restores it). Because save and restore are symmetric, undo remains correct under the new timing — confirm there is no place that reconstructs `turn` by arithmetic (e.g. `snapshot.turn + 1`). If any such arithmetic exists, report it; otherwise no change. Write the result in your report.

- [ ] **Step 4: Full suite + typecheck**
`pnpm test`
`pnpm run typecheck`
Expected: all pass, clean.

- [ ] **Step 5: Commit (if any comment/code changed in this task)**
```bash
git add artifacts/hex-battles/app/game.tsx
git commit -m "docs(turn): correct dev-auto-activate comment for round-based counter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Manual verification checklist (report only — no code)

- [ ] **Step 1: Reason through one full game on paper and record it in the report:**
  - Start: counter = 1. Player plays round 1 (free tower available, no income). End Turn → income gates see `turn===1` (player income suspended, AI not credited) — unchanged. AIs play (counter still **1** now, was 2 before). AI phase ends → counter advances to **2**.
  - Round 2: counter = 2. Player plays, has income (gate `turn!==1`). End Turn → player credited, AI gate `turn>2` false (AI not yet). AIs play at counter 2. End → counter 3.
  - Round 3: counter = 3. End Turn → AI gate `turn>2` true → AI credited for the first time. Both sides hold `10 + (R-2)` — unchanged from before.
- [ ] **Step 2: Confirm the only observable difference vs. old behaviour is the displayed counter during the AI phase (R, not R+1).** Economy, free tower, rebels, win/loss all identical. State this explicitly.

---

## Self-Review

**Spec coverage:**
- Relocate increment player-End-Turn → AI-completion → Tasks 2 (add+call) + 3 (remove old). ✓
- Economy unchanged → locked by Task 1 cadence test, re-run in Task 3 Step 4. ✓
- Downstream readers (free tower, dev-auto-activate, undo) → Task 4. ✓
- The clean-counter outcome → Task 5 reasoning. ✓

**Placeholder scan:** The only `/* derive ... */` placeholders are in Task 1 with explicit instructions on how to fill them (import `getContiguousTerritory`/`getTerritoryId`, build the territory, compute the id) plus a fallback (2-tile territories) — this is guidance for a value that depends on the helpers' exact output, not an open TODO. Task 2's test references "the existing mock helper" because the exact helper name must be read from `aiStrategy.test.ts` — the instruction says to mirror it exactly.

**Type consistency:** `advanceTurn(): void` is added to `AiTurnCallbacks.state` (Task 2 Step 3), wired through `useAiTurnCallbacks` params (Step 4), provided in `game.tsx` as `() => setTurn((t) => t + 1)` (Step 4), and asserted via `vi.fn()` in `aiStrategy.test.ts` (Step 1). Names match across all four.

**Scope:** Single concern (counter timing). No economy logic touched. Plan B (learning) and the expert-AI work are unrelated and untouched.
