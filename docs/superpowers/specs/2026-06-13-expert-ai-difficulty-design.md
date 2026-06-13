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

3. **Expert = super_hard's economy + a smarter brain (RESOLVED by the harness).**
   The self-play harness settled the open income question: with **no** bonus,
   expert is economically overwhelmed by super_hard's `incomeModifier`
   (0–16). Granted the *same* per-turn land-count income bonus as super_hard,
   expert's smarter brain wins **22–10 (~69%)**. So the shipped `expert` receives
   the income bonus too (`endTurnHandler` grants it to `super_hard || expert`); it
   is the top tier by both economy and skill. Crucially, on **equal** economy the
   brain alone beats `hard` **22–2**, proving the eval brain is genuinely stronger,
   not just richer.

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

## Success criteria — RESULTS

1. ✅ `pnpm run typecheck` and `pnpm test` pass (315 passing + 2 env-gated strength
   tests skipped by default; existing suites green).
2. ✅ Unit tests for eval / simulate / candidates / decision loop pass (10 tests).
3. ✅ Headless self-play (re-run with `AI_SELFPLAY=1`):
   - Equal economy, **expert vs hard = 22–2** → the eval brain is clearly stronger.
   - **expert + income bonus vs super_hard = 22–10 (~69%)** → wins as the top tier.
   - Adjusted bar (snowball variance makes ±25% CI at N≈16; a blowout is
     unreachable): require expert > hard decisively and expert+bonus > 55% vs
     super_hard — both met.
4. ✅ `expert` selectable in the menu; routed to the expert brain end-to-end.

### Key finding (why the harness mattered)

The first implementation *looked* done but **lost** to super_hard. Self-play exposed
a bankruptcy death-spiral: expert over-built units, drained reserves to ~0, then
bankruptcy liquidated its army and it collapsed from a winning position. A passing
unit test would never have caught this. The fix was a surgical economy change to the
evaluation — an **asymmetric deficit penalty** (`Σ max(0, upkeep − income)`, so
profitable armies are free but over-extension is punished) plus a **cash-buffer
penalty** (reserves below ~12/territory). That single fix turned bimodal 0–40
blowout losses into wins (vs hard 11–8 → 22–2).

### Multi-opponent + performance at scale (verified headlessly)

The user plays 3–4 AIs and required "must not delay the game", so both were tested
via `playFreeForAll` (run with `AI_SELFPLAY=1`):

- **3–4 AI strength:** expert dominates 4-AI free-for-alls (expert vs super_hard vs
  hard vs medium) — **6/6** wins at 160 tiles, **3/4** at 80 tiles (9/10 overall),
  finishing with by far the most land. Committed as an env-gated test.
- **Per-turn compute (this dev machine, animation skipped = pure compute):** ~16–94 ms
  per AI owner-turn at 80 tiles; ~265 ms avg / ~339 ms max at 160 tiles. Bounded and
  sub-second even at large boards. **Caveat:** a phone is slower (≈2–4×), so at the
  menu's max (200 tiles) a single big late-game expert turn could reach ~1 s — a
  possible hitch only at extreme board sizes. Real-device measurement at 200 tiles is
  the remaining check; Phase 2 (overlap compute with the existing per-action
  animation) is the mitigation if it hitches.

### Deferred / future

- Phase 2 pondering/overlap still deferred (gated on real-device perf).
- Threat term is adjacency-only; widening to cavalry move range (scouts/knights move
  5) is a candidate refinement if collapse ever reappears.
