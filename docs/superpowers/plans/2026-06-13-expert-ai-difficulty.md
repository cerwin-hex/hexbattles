# Expert AI Difficulty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a top-tier `expert` AI difficulty that picks actions by simulating each candidate and scoring the resulting position with an evaluation function (with an avoid-counterattack threat term), and prove it beats `super_hard` via headless self-play.

**Architecture:** A new, isolated brain (`logic/aiExpert.ts`) plugs into the existing `AiContext` / `AiDecisionExec` seam. The orchestrator routes to it only for `difficulty === "expert"`; all other difficulties are byte-for-byte unchanged. Ranking uses a pure eval-only `simulateAction`; real moves still go through the untouched exec layer. A headless self-play harness validates strength.

**Tech Stack:** TypeScript, Vitest, Expo React Native. All work in `artifacts/hex-battles`.

---

## File Structure

- **New** `logic/aiExpert.ts` — `ExpertAction` union, `evaluatePosition`, `simulateAction`, `generateCandidateActions`, `runExpertTerritoryDecisionLoop`.
- **New** `logic/aiExpert.test.ts` — unit tests (TDD) for eval / simulate / candidate gen.
- **New** `logic/aiSelfPlay.ts` — headless AI-vs-AI engine + `playMatch`.
- **New** `logic/aiSelfPlay.test.ts` — expert beats super_hard over N seeded games.
- **Modify** `types.ts` — add `"expert"` to `Difficulty`.
- **Modify** `logic/aiStrategy.ts` — route expert in `runAiTurn`; `skipChance` for expert.
- **Modify** `logic/endTurnHandler.ts` — expert income modifier = 0.
- **Modify** `components/MainMenu.tsx` — Expert pill.
- **Modify** `components/DevModeOverlay.tsx` — Expert label.

Commands (run from repo root `/home/jo/Hex-Battles`):
- Typecheck: `pnpm run typecheck`
- All tests: `pnpm test`
- Single file: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts`

---

## Task 1: Difficulty plumbing (route expert to existing brain as safe baseline)

**Files:** Modify `types.ts`, `logic/aiStrategy.ts`, `logic/endTurnHandler.ts`, `components/MainMenu.tsx`, `components/DevModeOverlay.tsx`.

- [ ] **Step 1:** `types.ts` — change union to `"easy" | "medium" | "hard" | "super_hard" | "expert"`.
- [ ] **Step 2:** `logic/aiStrategy.ts` `runAiTerritoryDecisionLoop` — `skipChance` ternary: expert ⇒ 0 (same as hard). Update comment.
- [ ] **Step 3:** `logic/endTurnHandler.ts:205` — `incomeModifier`: keep `super_hard ? landTileCount : 0` (expert falls through to 0). Add comment noting expert is skill-based, no bonus.
- [ ] **Step 4:** `components/MainMenu.tsx` — add `['expert', null, 'Expert']` to the difficulty pill list.
- [ ] **Step 5:** `components/DevModeOverlay.tsx` — `diffLabel`: `if (d === "expert") return "Expert";` and `if (d === "super_hard") return "S.Hard";`.
- [ ] **Step 6:** `pnpm run typecheck` — expect pass (expert currently behaves like hard since `runAiTurn` passes difficulty straight through and the loop treats unknown like hard).
- [ ] **Step 7:** Commit: `feat(ai): add expert difficulty to type + UI (routes to existing brain)`.

---

## Task 2: `evaluatePosition` (TDD)

**Files:** Create `logic/aiExpert.ts`, `logic/aiExpert.test.ts`.

Signature:
```ts
export interface EvalWeights {
  income: number; reserves: number; reservesCap: number;
  bankruptcyPenalty: number; unitStrength: number; fortification: number;
  borderBonus: number; fragmentation: number; threat: number; leader: number;
}
export const DEFAULT_WEIGHTS: EvalWeights;
export function evaluatePosition(
  owner: TerritoryOwner,
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  balances: Map<string, number>,
  cities: Set<string>,
  w?: EvalWeights,
): number;
```

Algorithm (per owner):
- Iterate owned tiles. `income += TERRAIN_INCOME[terrain] + (cities.has(key)?CITY_BONUS:0)` unless entity is `rebel`.
- For each contiguous owned territory (visited-set BFS via `getContiguousTerritory`): add `balances[tid]` (saturated to `reservesCap`) to reserves; compute `income−upkeep` (`calcTerritoryUpkeep`); if `< 0` add `bankruptcyPenalty`.
- Units: `unitStrength += ENTITY_META[e].strength`; towers/castles ⇒ `fortification += strength`; if the tile borders a non-owned tile add `borderBonus`.
- Fragmentation: `−fragmentation × max(0, dtCountClusters(owner) − ownTerritoryCount_expected)`; simplest: `−fragmentation × (dtCountClusters(owner) − 1)` clamped ≥0... actually use raw cluster count penalty: `−fragmentation × dtCountClusters(owner)`.
- Threat term: for each owned tile adjacent to an enemy unit whose `strength > getMaxEnemyZoC(tile, owner,…)` is false meaning capturable — i.e. enemy strength > own defense at that tile: subtract `threat × tileValue` where `tileValue = income(tile) + (entity? ENTITY_META[entity].strength : 0) + (city?2:0) + 1`.
- Leader term: `−leader × maxOpponentIncome` where opponent income computed same as own income, max over the other owners present.
- Return weighted sum.

- [ ] **Step 1:** Write failing tests: (a) a 3-tile grass territory with no enemies scores > a 1-tile territory; (b) adding an enemy stronger unit adjacent to a valuable owned tile lowers the score (threat); (c) two fragmented single tiles score lower than one 2-tile territory of same terrain.
- [ ] **Step 2:** Run `vitest run logic/aiExpert.test.ts` → FAIL (module/function missing).
- [ ] **Step 3:** Implement `evaluatePosition` + weights per algorithm above.
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(ai): expert evaluatePosition with threat + economy terms`.

---

## Task 3: `simulateAction` (pure, eval-only) (TDD)

**Files:** Modify `logic/aiExpert.ts`, `logic/aiExpert.test.ts`.

```ts
export type ExpertAction =
  | { kind: "move"; from: string; to: string }
  | { kind: "buy"; unitType: EntityType; target: string; cost: number; outside: boolean }
  | { kind: "build"; buildingType: EntityType; target: string; cost: number }
  | { kind: "upgrade"; target: string; to: EntityType; cost: number }
  | { kind: "remove"; target: string };

export interface SimState {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
  cities: Set<string>;
}
export function simulateAction(s: SimState, a: ExpertAction, owner: TerritoryOwner): SimState;
```

Approach — clone the four maps/sets, apply the *ownership + entity + balance* delta only (no animation, no bankruptcy, no charge bookkeeping; those don't change ranking). Reuse `recalculateTerritoriesForCapture` for capture moves and buys/builds that change ownership, and decrement the acting territory balance by `cost`. For:
- **move**: if dest owner !== owner OR dest has a non-bridge entity ⇒ capture: set dest tile owner=owner, recalc balances, move/merge entity (use `mergeResult` if ally-merge), delete source entity. Else reposition: just move entity.
- **buy (inside)**: set entity (or city) at target, subtract cost from territory bal.
- **buy (outside)**: set target tile owner=owner, set entity, recalc, subtract cost.
- **build**: bridge ⇒ lake owner=owner + entity + recalc; city ⇒ cities.add; tower/castle ⇒ entity set; subtract cost.
- **upgrade**: set entity=to, subtract cost.
- **remove**: delete entity; if bridge on lake ⇒ tile owner=neutral.

- [ ] **Step 1:** Failing tests: (a) simulating a capture move flips the dest tile owner and removes the enemy entity; (b) simulating a buy reduces the acting territory's balance by cost; (c) `simulateAction` does not mutate the input `SimState` (input maps unchanged).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ai): expert simulateAction pure transition for ranking`.

---

## Task 4: `generateCandidateActions` (TDD)

**Files:** Modify `logic/aiExpert.ts`, `logic/aiExpert.test.ts`.

```ts
export function generateCandidateActions(
  ctx: AiContext, territory: HexTile[], balanceForTid: number, capPerKind?: number,
): ExpertAction[];
```

Cover every category (A→I checklist): moves (each available unit × `getValidMoves`, skipping lake unless capturable, respecting cavalry-vs-building rule and ZoC for captures), buys (each affordable `ENTITY_META` unit onto empty border/inside tiles and onto outside attackable enemy/neutral tiles), builds (tower/castle with existing preconditions; city when territory ≥6 and none present; bridge onto adjacent lake), upgrades (`UNIT_UPGRADE` for owned units/buildings when affordable), removes (towers/castles with no enemy within 6; bridges surrounded by ≥5 owned). Affordability uses the same `canAfford` rule as the dumb loop (`bal ≥ cost && bal + income − (upkeep+extraUpkeep) ≥ 0`). Apply `capPerKind` (default e.g. 40) to bound the move list.

- [ ] **Step 1:** Failing tests: (a) a unit adjacent to a capturable enemy tile yields a `move` candidate to that tile; (b) with enough balance, at least one `buy` candidate is produced; (c) no candidate targets a mountain/lake illegally.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ai): expert candidate action generation`.

---

## Task 5: `runExpertTerritoryDecisionLoop` + orchestrator routing

**Files:** Modify `logic/aiExpert.ts`, `logic/aiStrategy.ts`, `logic/aiExpert.test.ts`.

```ts
export async function runExpertTerritoryDecisionLoop(
  startTileKey: string, aiCtx: AiContext, exec: AiDecisionExec,
  isTurnActive: () => boolean, weights?: EvalWeights,
): Promise<void>;
```

Loop (≤100 iters): rebuild territory from ground-truth ctx; compute `tid`, `bal`; `generateCandidateActions`; for each candidate build `SimState` from ctx, `simulateAction`, score = `evaluatePosition(after) − evaluatePosition(before)`; pick max; if best ≤ epsilon (e.g. 1e-6) break; dispatch to `exec` by `kind`; if exec returns false break. Set territory state via `exec.setTerritoryState` (reuse defending/attacking heuristic or just "attacking").

In `runAiStrategy.ts` `runAiTurn`: where it currently calls `runAiTerritoryDecisionLoop(...)`, branch: `if (difficulty === "expert") await runExpertTerritoryDecisionLoop(startTile.key, aiCtx, exec, isTurnActive); else await runAiTerritoryDecisionLoop(...)`. Keep the same `exec` object.

- [ ] **Step 1:** Failing test: drive the expert loop with a mocked `AiDecisionExec` (record calls) over a small board where one capture is clearly best; assert the recorded first action is that capture move.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement loop + routing.
- [ ] **Step 4:** Run → PASS; `pnpm run typecheck`.
- [ ] **Step 5:** Commit `feat(ai): expert decision loop + orchestrator routing`.

---

## Task 6: Headless self-play harness + strength validation

**Files:** Create `logic/aiSelfPlay.ts`, `logic/aiSelfPlay.test.ts`.

`logic/aiSelfPlay.ts` exports `playMatch({ seed, tiles, difficultyA, difficultyB, maxTurns }) → { winner: TerritoryOwner | "draw"; turns: number }`:
- Generate a board with `generateHexGrid(tiles, 2, …)`; assign two owners (e.g. `ai1`=A, `ai2`=B) to the seeded starting regions (reuse however `generateHexGrid` seeds owners; if it only marks player+ai, remap `player`→`ai1`).
- Build `AiWorkingState` + a real-callback `AiTurnCallbacks`: `recalculateTerritoriesForCapture` ← hexGrid import, `applySingleHexPenalty` ← gameLogic import, `triggerUnitAnimation` ← immediate `done()`, `isDeveloperMode` ← `true`, all `await*` resolve immediately, state setters write back into a captured holder (or no-op since `runAiTurn` mutates `ws`).
- Each turn: run `runAiTurn(ws, cbs, [ai1], turn, difficultyA)` then `[ai2]` with `difficultyB`; apply end-of-turn economy by calling the relevant parts of `handleEndTurnLogic` (or replicate the income/upkeep/rebel loop already inside `runAiTurn`'s bankruptcy section + `endTurnHandler`). Stop when one owner has no tiles or `maxTurns` reached; winner = owner with more land tiles.
- Use a small seeded RNG (mulberry32) and stub `Math.random` per match for determinism so `skipChance` etc. are reproducible.

- [ ] **Step 1:** Write `playMatch` and a smoke test: `expert` vs `easy` over 1 game completes and expert wins.
- [ ] **Step 2:** Run → iterate until the harness runs a full game without throwing.
- [ ] **Step 3:** Write the strength test: loop N=20 seeds, `expert` vs `super_hard`, assert expert wins ≥ 60% (`>= 12/20`). Mark slow (`it(..., { timeout: 120000 })`).
- [ ] **Step 4:** Run. If expert loses, **tune `DEFAULT_WEIGHTS`** (raise income/threat, adjust fragmentation) and/or reconsider the income lever; document outcome in the spec's Success Criteria. Re-run until passing.
- [ ] **Step 5:** `pnpm test` (full suite green) + `pnpm run typecheck`.
- [ ] **Step 6:** Commit `test(ai): headless self-play proving expert > super_hard`.

---

## Task 7: Final verification

- [ ] `pnpm run typecheck` — pass.
- [ ] `pnpm test` — all suites green (existing 304 + new).
- [ ] Record final self-play win-rate in the spec.
- [ ] Commit any spec updates: `docs: record expert self-play results`.
