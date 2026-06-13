# Expert AI Difficulty — Design

**Date:** 2026-06-13
**Branch:** `expert-ai-difficulty`
**Status:** Approved direction (user AFK; authorized "skriv spec og plan og byg")

## Goal

Add a new top-tier `expert` AI difficulty that plays **measurably stronger** than
the current best (`super_hard`), fixing the two weaknesses the user identified:

1. **Thinks only 1 move ahead** — today the AI takes the *first* action matching a
   fixed priority list (A→I). It never compares the consequences of alternatives.
2. **Weak economy / prioritization** — no holistic notion of "how good is my
   position," so it spends and defends on the wrong things.

Expert also gets an explicit **avoid-counterattack** measure, and must hold up in
the common case of **3–4 AIs in one game**.

## Why not the user's original idea (learn from my play)

Imitation learning caps at the demonstrator's skill — it structurally cannot become
*better* than the user, which is the whole goal. It also needs a data pipeline,
training, and on-device neural inference in React Native: heavy infrastructure for a
hobby game. Rejected. A consequence-computing search/eval AI **can** exceed the user
because it evaluates lines the user does not.

## Approach: evaluation-driven best-action selection ("the eval brain")

Instead of "first rule that matches wins," the expert brain, each decision step:

1. **Enumerates** every legal action for the current territory.
2. **Simulates** each action on a pure copy of the eval-relevant state.
3. **Scores** the resulting position with an evaluation function.
4. **Executes** the highest-scoring action (if it improves the position).

This is shallow (1-ply on the AI's own action) but is genuine lookahead relative to
today's blind first-match loop. It fixes economy/prioritization (the score rewards
sound economy) and "1 move ahead" (it sees each action's consequence before
choosing). The avoid-counterattack measure is a **threat term in the evaluation
applied to the post-action state**: an action that leaves a unit or valuable tile
capturable by any adjacent stronger enemy is penalized. It is a weighted term, not a
hard veto, and it naturally considers *all* enemies (handles 3–4 opponents).

Deep multi-ply minimax is explicitly **out of scope**: a full AI turn is many units ×
many move/buy/build options, so the branching factor is intractable on a phone.

## Key architectural decisions (made autonomously; AFK)

1. **Separate brain, existing AI untouched.** Expert is a new
   `logic/aiExpert.ts` exposing `runExpertTerritoryDecisionLoop(...)` with the *same*
   `AiContext` / `AiDecisionExec` seam as `runAiTerritoryDecisionLoop`. The
   orchestrator (`runAiTurn`) calls the expert loop only when
   `difficulty === "expert"`. easy/medium/hard/super_hard behavior is byte-for-byte
   unchanged → zero regression risk for existing difficulties.

2. **Eval-only simulation for ranking; real execution unchanged.** We do **not**
   refactor the React/animation-entangled exec layer. Candidate ranking uses a pure
   `simulateAction(state, action) → state'` that reuses the codebase's established
   eval-simulation pattern (the same `simMap.set(key, {...tile, owner})` +
   `getContiguousTerritory` approach already used by `dtSplitScore` /
   `dtCaptureNegatesIncome`). Real moves are still performed by the existing
   `exec.move/buy/build/upgrade/remove`. Because candidates are re-enumerated from
   ground-truth `ws` every iteration, any approximation drift is **per-decision and
   never compounds**, and it only affects ranking quality — never game integrity.
   (This is a deliberate, advisor-confirmed deviation from a full `applyAction`
   extraction, which would be a large risky refactor unsuitable for an unsupervised
   build.)

3. **Expert = skill, not extra money.** Unlike `super_hard` (which is "hard + bonus
   income" via `incomeModifier` in `endTurnHandler`), expert gets **no income
   bonus** initially — it wins by playing better. The income lever stays available;
   the self-play harness (below) decides whether expert also needs it to beat
   super_hard's economy.

4. **Validation by headless self-play (the real success signal).** A unit test
   asserting `evaluatePosition` returns a number proves nothing about strength. The
   deliverable's value is "is expert actually stronger than super_hard." So we build
   a **headless self-play harness**: drive `runAiTurn` with real pure callbacks
   (`recalculateTerritoriesForCapture`, `applySingleHexPenalty`) and animation
   skipped (`isDeveloperMode → true`), plus the end-of-turn economy
   (`handleEndTurnLogic`), and play full AI-vs-AI games. Expert must win a clear
   majority vs super_hard. This harness doubles as the eval-weight tuning loop and is
   the gate for declaring the work done.

5. **Phase 2 (pondering / overlap-with-animation) deferred.** The user's "think on my
   turn" instinct is sound but its literal form is impossible (the AI's turn starts
   from a board that doesn't exist until End Turn). The tractable version is
   overlapping each action's search with the previous action's animation. Per-action
   animation already dominates wall-clock and we cannot measure device perf while
   AFK, so this is **not built now** — gated behind a real-device measurement. A hard
   candidate cap bounds worst-case compute in the meantime.

## Evaluation function (own-position, absolute, modest leader term)

`evaluatePosition(state, owner) → number`, summing weighted terms (weights tuned by
the harness):

- **Territory income value** — Σ over owned tiles of `TERRAIN_INCOME + CITY_BONUS`.
  The core economic engine; highest weight.
- **Reserves** — Σ of the owner's territory balances (scaled; saturating so hoarding
  isn't over-rewarded).
- **Net-income health** — per territory, reward positive `income − upkeep`, sharply
  penalize being at/below bankruptcy threshold.
- **Military value** — Σ unit strength + fortification value (tower/castle), with a
  bonus for fortifications/strength sitting on border tiles.
- **Contiguity penalty** — penalize fragmentation (extra clusters / single-hex
  territories), reusing `dtCountClusters`.
- **Threat exposure (avoid-counterattack)** — −Σ value of own tiles adjacent to an
  enemy unit able to capture them next turn (`getMaxEnemyZoC` < enemy strength),
  weighted by tile value and whether the tile carries a unit/building. Evaluated on
  the post-action state, this is the counterattack-avoidance measure.
- **Leader pressure (modest)** — small −weight × strongest *opponent's* territory
  income value, so expert plays to suppress the leader without erratic target
  flipping. Kept small because with 3–4 opponents an absolute own-position eval is
  more stable.

## Candidate generation (must cover every category the dumb AI handles)

`generateCandidateActions(ctx, territory) → Action[]` enumerates, using priorities
A→I as a completeness checklist so expert has no blind spots the dumb AI lacks:

- **Moves** — each available (unspent) unit × each `getValidMoves` target: captures
  (enemy/neutral), territory-splitting attacks, bridge captures, merges, repositions.
- **Buys** — affordable unit types onto valid inside/border/outside spawn tiles.
- **Builds** — tower / castle / city / bridge on valid tiles (respecting existing
  preconditions, e.g. castle needs a strength-≥2 unit, city needs ≥6 tiles).
- **Upgrades** — unit and building upgrades (`UNIT_UPGRADE`).
- **Removes** — obsolete defensive buildings (no nearby enemy) and surrounded
  bridges.

Each candidate's score = `evaluatePosition(after) − evaluatePosition(before)`. Cost
is captured naturally via the reserves / net-income terms. Pick the max; stop the
loop when no candidate strictly improves the position (mirrors today's
`actionTaken = false → break`). A hard **candidate cap** bounds worst-case work.

`Action` is a discriminated union:
`{ kind: "move", from, to } | { kind: "buy", unitType, target, cost, outside } |
 { kind: "build", buildingType, target, cost } | { kind: "upgrade", target, to, cost }
 | { kind: "remove", target }` — matching `AiDecisionExec` 1:1 so the chosen action
maps directly to an `exec` call.

## Difficulty plumbing (exhaustive — every `difficulty ===` branch)

Adding `"expert"` to the `Difficulty` union silently falls through some branches;
each must be made explicit:

- `types.ts` — add `"expert"` to the union.
- `logic/aiStrategy.ts` `runAiTurn` — route to expert loop when
  `difficulty === "expert"`; `skipChance` = 0 for expert.
- `logic/endTurnHandler.ts` — `incomeModifier`: expert = 0 (no bonus), super_hard
  unchanged.
- `components/MainMenu.tsx` — add an `Expert` pill after Super Hard.
- `components/DevModeOverlay.tsx` — add an `Expert` short label.
- The D2b aggressive-bridge gate (`hard || super_hard`) lives inside the *old* loop,
  which expert never runs — no change needed, but verified.

## Files

- **New:** `logic/aiExpert.ts` — `Action` type, `generateCandidateActions`,
  `simulateAction`, `evaluatePosition`, `runExpertTerritoryDecisionLoop`.
- **New:** `logic/aiExpert.test.ts` — unit tests for eval / simulate / candidate
  generation (TDD).
- **New:** `logic/aiSelfPlay.ts` — headless game engine + `playMatch(...)`.
- **New:** `logic/aiSelfPlay.test.ts` — asserts expert beats super_hard over N games.
- **Edit:** `types.ts`, `logic/aiStrategy.ts`, `logic/endTurnHandler.ts`,
  `components/MainMenu.tsx`, `components/DevModeOverlay.tsx`.

## Out of scope

- Pondering / time-slicing / overlap-with-animation (Phase 2, gated on device perf).
- Deep multi-ply adversarial search.
- Imitation / ML learning.
- Any change to easy/medium/hard/super_hard behavior.

## Success criteria

1. `pnpm run typecheck` and `pnpm test` pass (existing 304 tests still green).
2. New unit tests for the eval brain pass.
3. Headless self-play: **expert wins a clear majority vs super_hard** across N seeded
   games. (If it cannot without the income bonus, that result is documented and the
   income lever is reconsidered.)
4. `expert` selectable in the menu; game playable end-to-end against it.
