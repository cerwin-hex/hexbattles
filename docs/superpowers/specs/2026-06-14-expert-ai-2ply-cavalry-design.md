# Expert AI: Bounded 2-Ply Search + Cavalry — Design

**Date:** 2026-06-14
**Status:** Design — awaiting user review before plan
**Scope:** Plan A only. Plan B (opponent-learning / "monitor my games") is deferred to a
separate brainstorm after the user has played Plan A on-device (decision: 2026-06-14).

## Problem

The human beats Expert AI ~100% of games (3 AI, 100 tiles). Root cause is **shallow
search**, not a knowledge gap: `runExpertTerritoryDecisionLoop` is greedy 1-ply — it picks
the single highest immediate-eval action, executes, repeats. It cannot see the opponent's
reply, so it walks into counters, fails to value splits the opponent can't repair, and
can't bait. Separately, **cavalry (scout/knight, `maxAttacks: 2`, `movement: 5`) is
under-used**: their value is a multi-tile sweep per turn, which a greedy 1-ply scorer does
not realize and the eval does not reward.

This design adds a **bounded best-response 2-ply** look at the opponent's single best
counter, and fixes cavalry as two independent halves (correctness, then valuation).

## Non-Goals

- Full turn-vs-turn minimax (opponent plays their *entire* turn in reply). Considered and
  rejected for Plan A: far more expensive, architecturally invasive, threatens the
  "instant" on-device feel. Named as the heavier fallback only if bounded best-response
  proves insufficient in self-play.
- Opponent-learning / per-player adaptation. That is Plan B, deferred.
- Re-tuning existing eval weights beyond what the new terms require.

## Key Insight (why this is cheap, not a new engine)

`evaluatePosition` (aiExpert.ts:229–258) **already computes the opponent's best captures** —
the `threatened` map: every owned tile an adjacent enemy unit can capture (`strength >
getMaxEnemyZoC`), keyed to its `tileValue`. Today that is summed into a static `threat`
penalty. The faithful, cheap "see the opponent's reply" is to take the **single
highest-value entry** of that same map, actually apply it via the existing
`simulateAction`, and re-score. No new search machinery — an extension of what is already
there.

## Architecture

Three pure additions to `logic/aiExpert.ts` plus an integration change in the decision
loop. Everything stays pure and re-derived from ground truth each iteration (no drift).

### Component 1 — `opponentBestResponse` (new pure function, global)

```
opponentBestResponse(
  owner: TerritoryOwner,
  s: SimState,
  w: EvalWeights,
): { state: SimState; move: ExpertAction | null }
```

- The opponent's reply is **global**: any enemy unit, against any of `owner`'s tiles. So
  this operates on the whole-board `SimState`, NOT inside the per-territory loop's local
  view. This is the architectural fork — the search lives in a board-level function.
- Enumerate every enemy unit (`t.owner !== owner && !== "neutral"`, `ENTITY_META[e].isUnit`)
  adjacent to an `owner`-owned land tile it can capture (`strength > getMaxEnemyZoC`),
  exactly mirroring the `threatened` loop. Record `{ from: enemyKey, to: ownedKey,
  enemyOwner }` and the captured tile's `tileValue`.
- Pick the single capture with the **highest `tileValue`** (the most damaging counter).
  Ties broken by first-seen (deterministic iteration). Bounded to ONE capture — never a
  re-search of the opponent's whole turn.
- Apply it with the existing `simulateAction(s, { kind: "move", from, to }, enemyOwner)`
  and return the resulting state + the chosen move (or the unchanged state + `null` if the
  opponent has no capture).
- Cavalry/owner-tile subtleties already handled by `simulateAction`'s move case; the
  building-immunity rule (`cavalryMoveKind`) is irrelevant here because a capture target is
  by definition a tile this enemy can take.

### Component 2 — `scoreWithReply` integration in `runExpertTerritoryDecisionLoop`

Replace the current single-pass ranking (aiExpert.ts:693–704) with two passes:

1. **1-ply pass (cheap):** score every candidate with the current
   `evaluatePosition(after)` and keep the **top `SEARCH_K` (default 4)** by that score.
   This bounds the expensive pass.
2. **2-ply pass (top-K only):** for each kept candidate,
   `after = simulateAction(base, cand, owner)` →
   `replied = opponentBestResponse(owner, after, weights).state` →
   `score2 = evaluatePosition(owner, replied, weights)`.
3. **Baseline:** also compute the do-nothing post-reply score
   `baseReplied = opponentBestResponse(owner, base, weights).state` →
   `baseScore2 = evaluatePosition(owner, baseReplied, weights)`. The enemy gets to move
   whether or not `owner` acts, so candidates must beat *this* baseline, not the
   pre-reply base. Pick the candidate maximizing `score2`, requiring
   `score2 - baseScore2 > SCORE_EPSILON`.

`SEARCH_K` is a module constant (default 4) so it is tunable and testable. Everything else
in the loop (territory derivation, exec dispatch, 100-iteration cap, threatened→state
display) is unchanged.

### Component 3 — performance budget

- The expensive reply pass runs only `SEARCH_K` times per loop iteration (not per
  candidate). `opponentBestResponse` is O(enemy units × 6 edges), same order as the
  existing threat loop.
- A gated self-play **turn-time budget test** measures average ms/AI-turn on an 80-tile
  board and asserts it stays under a chosen ceiling (e.g. < 50 ms/turn headless), so the
  on-device "instant" feel is protected by a regression test rather than hoped for. The
  ceiling is calibrated from a first measurement run, not guessed in advance.

### Component 4 — Cavalry, correctness half (independent of the search)

`exec.move` already propagates remaining range into `partialMoves` and `combatSpentUnits`
(aiStrategy.ts:1200–1246), so a cavalry sweep *can* chain through the greedy loop. The bug
is elsewhere. **First task is a failing reproduction** (systematic-debugging): a board with
a knight positioned to capture ≥2 tiles in one turn; run the real expert loop; assert ≥2
captures. Then confirm which suspect fires before writing the fix:

- **Suspect A — deep-raid territory re-derivation.** A range-5 capture can land the cavalry
  on a tile not contiguous with `startTileKey`'s territory, so the loop that re-derives
  `getContiguousTerritory(ctx.tileMap, startTileKey, owner)` no longer contains the
  cavalry, and its remaining `partialMoves` are never spent within that loop.
- **Suspect B — global `capPerKind = 60` move-cap truncation.** `moveCount` is a single
  counter across *all* units (aiExpert.ts:481–512). A cavalry late in `availUnits` with
  many range-5 destinations can have its long-range moves dropped entirely once the cap is
  hit by earlier units.

The fix is whatever the repro proves. Most likely shape (to be confirmed): make the move
cap **per-unit** rather than a shared global counter, and/or ensure a unit with remaining
`partialMoves` that has moved outside the starting territory still gets follow-up moves
generated. The fix is gated on the repro test going green.

### Component 5 — Cavalry, valuation half (last; may be unnecessary)

After correctness is fixed, measure in self-play whether Expert now buys/uses cavalry
appropriately. Only if it still under-invests, add a small **reach reward** to
`evaluatePosition`: e.g. reward an owned cavalry unit by the number of distinct capturable
enemy/neutral tiles within its movement range (a "sweep potential" term), with a new
weight in `EvalWeights`/`DEFAULT_WEIGHTS`. Sequenced last because the correctness fix plus
greedy chaining may already realize the sweep for free — do not add eval weight the data
does not justify (YAGNI).

## Data Flow

```
runExpertTerritoryDecisionLoop (per territory, per iteration)
  ├─ generateCandidateActions(ctx, territory, bal)        [unchanged]
  ├─ 1-ply score each → keep top SEARCH_K
  ├─ for each kept cand:
  │     after   = simulateAction(base, cand, owner)
  │     replied = opponentBestResponse(owner, after).state   ← global reply
  │     score2  = evaluatePosition(owner, replied)
  ├─ baseScore2 = evaluatePosition(owner, opponentBestResponse(owner, base).state)
  └─ execute argmax(score2) if score2 - baseScore2 > ε       [exec unchanged]
```

## Testing

All in `logic/aiExpert.test.ts` and `logic/aiSelfPlay.test.ts`:

1. **`opponentBestResponse` unit tests** — picks the highest-value enemy capture; returns
   `null` when no enemy can capture; ignores buildings-as-attackers correctly; deterministic
   tie-break.
2. **2-ply behaviour tests** — a position where the naive 1-ply best action walks into a
   losing counter and a slightly-worse-looking action is safe; assert the loop picks the
   safe one. A "bait" position: a move that concedes a low-value tile but leaves the
   enemy's high-value tile exposed scores higher post-reply.
3. **Cavalry reproduction → fix** — the failing-then-passing ≥2-tile sweep test from
   Component 4.
4. **Strength series (gated, `AI_SELFPLAY=1`)** — 2-ply expert vs 1-ply expert over a seed
   range; require a clear majority for 2-ply. Re-confirm existing expert-vs-hard and
   super_expert series still hold.
5. **Invariants (must still hold)** — over-spend `minBalance >= 0` and the tempo
   collapse-tail guard, unchanged.
6. **Turn-time budget (gated)** — ms/AI-turn on an 80-tile board under the calibrated
   ceiling.

## Rollout

Plan A ships as one unit to the phone (preview APK) for the real test — the human matchup.
Self-play cannot measure that matchup; it only guards against regressions and proves 2-ply
beats 1-ply head-to-head.

## Open Questions (resolve during planning, not blocking)

- Exact `SEARCH_K` and the turn-time ceiling — calibrated from a first measurement run.
- Whether the cavalry valuation term (Component 5) is needed at all — decided by post-fix
  self-play data.
