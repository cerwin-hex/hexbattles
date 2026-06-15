# Expert AI: Bounded 2-Ply Search + Cavalry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Expert AI a bounded best-response 2-ply look (it sees the opponent's single best counter before committing) and make it use cavalry's multi-tile reach — countering the human's bait / split / sweep exploits.

**Architecture:** Three pure additions to `logic/aiExpert.ts` (a global `opponentBestResponse`, a search-config knob, and a two-pass scorer in the decision loop) plus a cavalry correctness fix in candidate generation. All ranking stays pure and is re-derived from ground truth each loop iteration; real execution through the untouched `AiDecisionExec`.

**Tech Stack:** TypeScript, Vitest. Spec: `docs/superpowers/specs/2026-06-14-expert-ai-2ply-cavalry-design.md`.

**Run commands (from repo root `/home/jo/Hex-Battles`):**
- Single test file: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts`
- Typecheck: `pnpm run typecheck`
- Gated self-play: `AI_SELFPLAY=1 pnpm --filter @workspace/hex-battles exec vitest run logic/aiSelfPlay.test.ts`

**Conventions to respect:** All code English. `pnpm` only. Do not `git push` (commit only). Work on branch `expert-ai-difficulty` (already checked out).

---

## File Structure

- `logic/aiExpert.ts` — MODIFY. Add `opponentBestResponse` (global pure best-response), a `SearchConfig` + `__setExpertSearchConfig` override, two-pass scoring inside `runExpertTerritoryDecisionLoop`, and (last) an optional cavalry reach term in `evaluatePosition`. Fix the global move-cap in `generateCandidateActions`.
- `logic/aiExpert.test.ts` — MODIFY. Unit tests for `opponentBestResponse`, 2-ply behaviour tests, cavalry sweep reproduction.
- `logic/aiSelfPlay.ts` — MODIFY. Add a turn-time measurement to `playMatch`'s return (or a thin wrapper) and ensure the expert search config can be toggled per pass.
- `logic/aiSelfPlay.test.ts` — MODIFY. Gated 2-ply-vs-1-ply strength series + turn-time budget guard.
- `/home/jo/.claude/projects/-home-jo-Hex-Battles/memory/project_test_suites.md` — MODIFY at the end. Update counts/notes.

---

## Task 1: `opponentBestResponse` — the global single best enemy counter

**Files:**
- Modify: `logic/aiExpert.ts` (add new exported function after `simulateAction`, ~line 436)
- Test: `logic/aiExpert.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `logic/aiExpert.test.ts` (after the existing `simulateAction` describe block). Uses the existing `makeTile`, `makeTileMap`, `simState` helpers.

```typescript
import { opponentBestResponse } from "@/logic/aiExpert";

describe("opponentBestResponse", () => {
  it("returns null when no enemy can capture an owned tile", () => {
    // ai1 owns (0,0)-(1,0); ai2 owns (3,0) — not adjacent, no capture possible.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(3, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([["3,0", "swordsman"]]);
    const res = opponentBestResponse("ai1", simState(tileMap, entities), DEFAULT_WEIGHTS);
    expect(res.move).toBeNull();
  });

  it("picks the highest-value capturable owned tile as the counter", () => {
    // ai1 owns (1,0) [bare grass] and (1,1) [holds a city — higher tileValue].
    // An ai2 swordsman sits adjacent to BOTH at (2,0) and (2,1). It should
    // choose to take the city tile (1,1), the more damaging capture.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(1, 1, "ai1"),
      makeTile(2, 0, "ai2"),
      makeTile(2, 1, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["2,0", "swordsman"],
      ["2,1", "swordsman"],
    ]);
    const cities = new Set<string>(["1,1"]);
    const s: SimState = { tileMap, entities, balances: new Map(), cities };
    const res = opponentBestResponse("ai1", s, DEFAULT_WEIGHTS);
    expect(res.move).not.toBeNull();
    expect(res.move!.kind).toBe("move");
    if (res.move!.kind === "move") expect(res.move!.to).toBe("1,1");
    // The returned state has the city tile flipped to ai2.
    expect(res.state.tileMap.get("1,1")!.owner).toBe("ai2");
  });

  it("does not treat a fortification/tower as an attacker", () => {
    // Only a tower (non-unit) borders ai1 — towers don't move, so no counter.
    const tileMap = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai2")]);
    const entities = new Map<string, EntityType>([["1,0", "tower"]]);
    const res = opponentBestResponse("ai1", simState(tileMap, entities), DEFAULT_WEIGHTS);
    expect(res.move).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts -t opponentBestResponse`
Expected: FAIL — `opponentBestResponse is not exported` / not a function.

- [ ] **Step 3: Implement `opponentBestResponse`**

In `logic/aiExpert.ts`, add after `simulateAction` (the function ends ~line 436). It mirrors the `threatened` loop in `evaluatePosition` but records the attacking unit and applies the single best capture via the existing `simulateAction`.

```typescript
/**
 * The opponent's single most damaging immediate reply to the current board, from
 * `owner`'s perspective: across every enemy unit, the highest-`tileValue` owned
 * tile it can capture (strength beats the defending ZoC). Bounded to ONE capture
 * — never a re-search of the opponent's whole turn. Returns the resulting state
 * (with that capture applied) and the chosen move, or the unchanged state + null
 * when no enemy can capture. Pure.
 */
export function opponentBestResponse(
  owner: TerritoryOwner,
  s: SimState,
  w: EvalWeights = DEFAULT_WEIGHTS,
): { state: SimState; move: ExpertAction | null } {
  let bestFrom: string | null = null;
  let bestTo: string | null = null;
  let bestOwnerOfAttacker: TerritoryOwner | null = null;
  let bestValue = -Infinity;
  for (const [k, e] of s.entities) {
    if (!ENTITY_META[e].isUnit) continue;
    const t = s.tileMap.get(k);
    if (!t || t.owner === owner || t.owner === "neutral") continue;
    const enemyOwner = t.owner as TerritoryOwner;
    const strength = ENTITY_META[e].strength;
    const [kq, kr] = k.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(kq + dq, kr + dr);
      const nt = s.tileMap.get(nk);
      if (!nt || nt.owner !== owner) continue;
      if (nt.terrain === "mountain" || nt.terrain === "lake") continue;
      if (strength <= getMaxEnemyZoC(nk, enemyOwner, s.entities, s.tileMap)) continue;
      const v = tileValue(nk, s.tileMap, s.entities, s.cities);
      if (v > bestValue) {
        bestValue = v;
        bestFrom = k;
        bestTo = nk;
        bestOwnerOfAttacker = enemyOwner;
      }
    }
  }
  if (bestFrom === null || bestTo === null || bestOwnerOfAttacker === null) {
    return { state: s, move: null };
  }
  const move: ExpertAction = { kind: "move", from: bestFrom, to: bestTo };
  const state = simulateAction(s, move, bestOwnerOfAttacker);
  return { state, move };
}
```

Note: `w` is accepted for signature symmetry with `evaluatePosition` and future use; it is unused here (tileValue carries the valuation). Keep the parameter so callers pass weights uniformly. To avoid an unused-var lint, reference it once: replace the signature default body's first line with `void w;` at the top of the function if the linter complains; otherwise leave as-is (the repo's tsconfig does not error on unused params with a default).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts -t opponentBestResponse`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add artifacts/hex-battles/logic/aiExpert.ts artifacts/hex-battles/logic/aiExpert.test.ts
git commit -m "feat(ai): opponentBestResponse — global single best enemy counter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Search config knob (`SEARCH_K`, two-ply toggle) + override hook

This lets the loop bound the expensive pass and lets self-play toggle 1-ply vs 2-ply between passes (a global override, like the existing `__setExpertWeightsOverride`).

**Files:**
- Modify: `logic/aiExpert.ts` (near the `WEIGHTS_OVERRIDE` block, ~line 660)
- Test: `logic/aiExpert.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { __setExpertSearchConfig } from "@/logic/aiExpert";

describe("__setExpertSearchConfig", () => {
  it("is callable and resets to default with null", () => {
    expect(() => __setExpertSearchConfig({ twoPly: false, k: 8 })).not.toThrow();
    expect(() => __setExpertSearchConfig(null)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts -t __setExpertSearchConfig`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the config + override**

In `logic/aiExpert.ts`, just below the `WEIGHTS_OVERRIDE` declaration (~line 662) add:

```typescript
export interface SearchConfig {
  /** When true, rank the top-K candidates by their post-opponent-reply score. */
  twoPly: boolean;
  /** How many top 1-ply candidates get the expensive 2-ply reply pass. */
  k: number;
}

export const DEFAULT_SEARCH: SearchConfig = { twoPly: true, k: 4 };

let SEARCH_OVERRIDE: SearchConfig | null = null;
export function __setExpertSearchConfig(c: SearchConfig | null): void {
  SEARCH_OVERRIDE = c;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts -t __setExpertSearchConfig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/logic/aiExpert.ts artifacts/hex-battles/logic/aiExpert.test.ts
git commit -m "feat(ai): expert search config knob (top-K, two-ply toggle)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Two-pass scoring in `runExpertTerritoryDecisionLoop`

Replace the single ranking pass with: cheap 1-ply score → keep top-K → score those by their post-reply position, compared against the do-nothing post-reply baseline.

**Files:**
- Modify: `logic/aiExpert.ts:691-704` (the scoring block inside the loop) and the loop signature/default (~line 672)
- Test: `logic/aiExpert.test.ts`

- [ ] **Step 1: Write the failing behaviour test**

The position: the naive 1-ply best move walks the only defender off a tile the enemy then captures; a safer move scores better after the reply. With `twoPly: true` the loop must NOT pick the greedy-but-punished move.

```typescript
describe("two-ply best-response", () => {
  it("avoids a move whose square the opponent immediately recaptures for more", () => {
    // ai1 has a swordsman (str3) on (1,0). Neutral grabs available at (1,-1) and
    // (0,1). ai2 swordsman on (2,0). Capturing (1,-1) leaves (1,0)... we instead
    // assert: with 2-ply, the chosen capture is the one the enemy can NOT punish.
    // Layout: capturing (2,-1)? Keep it concrete & deterministic:
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),     // ai1 swordsman lives here
      makeTile(1, -1, "neutral"), // grab A — adjacent to enemy at (2,-1)? no enemy there
      makeTile(0, 1, "neutral"),  // grab B — safe, no enemy adjacent
      makeTile(2, 0, "ai2"),      // enemy swordsman; adjacent to ai1 (1,0)
    ]);
    const entities = new Map<string, EntityType>([
      ["1,0", "swordsman"],
      ["2,0", "swordsman"],
    ]);
    const balances = new Map<string, number>();
    const ctx = makeCtx(tileMap, entities, "ai1", balances);

    __setExpertSearchConfig({ twoPly: true, k: 8 });
    const action = await firstExpertAction("0,0", ctx);
    __setExpertSearchConfig(null);

    // The 2-ply loop should still act (a profitable safe grab exists) and must not
    // strand (1,0); since the swordsman stays put as the defender, the chosen
    // action should be a BUY/grab that does not move the (1,0) defender away.
    expect(action).not.toBeNull();
    if (action && action.kind === "move") {
      // If it moves a unit, it must not be the (1,0) defender vacating into a
      // square that lets ai2 take (1,0).
      expect(action.from).not.toBe("1,0");
    }
  });
});
```

> NOTE for implementer: this scenario is intentionally simple and may need its
> geometry adjusted so that (a) a profitable action exists and (b) moving the
> (1,0) defender is the naive 1-ply pick. Run the 1-ply baseline first
> (`twoPly:false`) and confirm it *does* pick `from === "1,0"`; then assert 2-ply
> picks differently. Adjust tile coordinates until the 1-ply/2-ply split is real,
> then freeze the test. The assertion that matters: **1-ply and 2-ply diverge,
> and 2-ply is the safe one.**

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts -t "two-ply"`
Expected: FAIL — current greedy loop ignores the reply, picks the punished move (or the test is not yet meaningful because two-ply isn't wired).

- [ ] **Step 3: Implement two-pass scoring**

In `logic/aiExpert.ts`, change the loop default-arg line (~672) to also resolve search config, and replace the ranking block (current lines 691–704).

Loop signature region — after the `weights` default param add a local:

```typescript
  weights: EvalWeights = WEIGHTS_OVERRIDE ?? DEFAULT_WEIGHTS,
): Promise<void> {
  const owner = ctx.aiOwner;
  const search = SEARCH_OVERRIDE ?? DEFAULT_SEARCH;
  let iter = 0;
```

Replace the block that currently reads:

```typescript
    const candidates = generateCandidateActions(ctx, territory, bal);
    let best: ExpertAction | null = null;
    let bestDelta = SCORE_EPSILON;
    for (const cand of candidates) {
      const after = simulateAction(base, cand, owner);
      const score = evaluatePosition(owner, after.tileMap, after.entities, after.balances, after.cities, weights);
      const delta = score - baseScore;
      if (delta > bestDelta) {
        bestDelta = delta;
        best = cand;
      }
    }
```

with:

```typescript
    const candidates = generateCandidateActions(ctx, territory, bal);

    // Pass 1 (cheap): 1-ply score every candidate.
    const scored = candidates.map((cand) => {
      const after = simulateAction(base, cand, owner);
      const score1 = evaluatePosition(
        owner, after.tileMap, after.entities, after.balances, after.cities, weights,
      );
      return { cand, after, score1 };
    });

    let best: ExpertAction | null = null;
    if (!search.twoPly) {
      // 1-ply: pick the best immediate-delta action (original behaviour).
      let bestDelta = SCORE_EPSILON;
      for (const sc of scored) {
        const delta = sc.score1 - baseScore;
        if (delta > bestDelta) {
          bestDelta = delta;
          best = sc.cand;
        }
      }
    } else {
      // Pass 2 (expensive, top-K only): score each by the position AFTER the
      // opponent's single best reply. The enemy gets to reply whether or not we
      // act, so compare against the do-nothing post-reply baseline.
      const baseReplied = opponentBestResponse(owner, base, weights).state;
      const baseScore2 = evaluatePosition(
        owner, baseReplied.tileMap, baseReplied.entities, baseReplied.balances, baseReplied.cities, weights,
      );
      const topK = scored
        .sort((a, b) => b.score1 - a.score1)
        .slice(0, Math.max(1, search.k));
      let bestDelta = SCORE_EPSILON;
      for (const sc of topK) {
        const replied = opponentBestResponse(owner, sc.after, weights).state;
        const score2 = evaluatePosition(
          owner, replied.tileMap, replied.entities, replied.balances, replied.cities, weights,
        );
        const delta = score2 - baseScore2;
        if (delta > bestDelta) {
          bestDelta = delta;
          best = sc.cand;
        }
      }
    }
```

The rest of the loop (the `exec.setTerritoryState` call, `if (!best) break;`, the dispatch switch) is unchanged.

- [ ] **Step 4: Run the new test + the full expert suite**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts`
Expected: PASS — the two-ply test passes and all pre-existing expert tests still pass (the default config is `twoPly:true`, so confirm the existing 1-ply-era assertions still hold; if any existing test now relies on greedy 1-ply behaviour, wrap it with `__setExpertSearchConfig({ twoPly:false, k:4 })` / reset in an `afterEach`, do not weaken the assertion).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add artifacts/hex-battles/logic/aiExpert.ts artifacts/hex-battles/logic/aiExpert.test.ts
git commit -m "feat(ai): bounded 2-ply — rank top-K by post-opponent-reply score

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Cavalry sweep — failing reproduction (systematic-debugging Phase 1)

Prove the bug before fixing it: a cavalry that should take ≥2 tiles in one turn.

**Files:**
- Test: `logic/aiExpert.test.ts`

- [ ] **Step 1: Write the reproduction test (collects every action the loop dispatches)**

```typescript
describe("cavalry multi-capture (reproduction)", () => {
  it("sweeps at least two open tiles with one knight in a single turn", async () => {
    // ai1 owns a base (0,0)-(0,1) with a knight (str2, movement 5, maxAttacks 2)
    // on (0,0). Three neutral open tiles run east: (1,0),(2,0),(3,0). With reach 5
    // and the 2-action budget, the knight should take >=2 of them this turn.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(1, 0, "neutral"),
      makeTile(2, 0, "neutral"),
      makeTile(3, 0, "neutral"),
    ]);
    const entities = new Map<string, EntityType>([["0,0", "knight"]]);
    const balances = new Map<string, number>();
    const ctx = makeCtx(tileMap, entities, "ai1", balances);

    // Collect ALL dispatched moves (don't halt after the first), applying each to
    // ctx so the loop's re-derivation sees the new board — mirrors the real exec.
    const captures: string[] = [];
    const exec: AiDecisionExec = {
      move: async (from, to) => {
        const e = ctx.entities.get(from);
        if (!e) return false;
        ctx.entities.delete(from);
        ctx.entities.set(to, e);
        const tile = ctx.tileMap.get(to)!;
        if (tile.owner !== "ai1") {
          ctx.tileMap.set(to, { ...tile, owner: "ai1" });
          captures.push(to);
        }
        return true;
      },
      buy: async () => false,
      build: async () => false,
      upgrade: async () => false,
      remove: async () => false,
      markSpent: () => {},
      setTerritoryState: () => {},
    };
    await runExpertTerritoryDecisionLoop("0,0", ctx, exec, () => true);
    expect(captures.length).toBeGreaterThanOrEqual(2);
  });
});
```

> The exec mock above does NOT update `partialMoves`/`combatSpentUnits` — the real
> `AiDecisionExec.move` (aiStrategy.ts:1200-1246) does. For a faithful repro the
> implementer should, in Step 3 of Task 5, either (a) extend this mock to decrement
> `ctx.partialMoves` like the real exec, or (b) confirm via the real exec path. Use
> this test first to surface the candidate-generation cap defect (Suspect B); the
> chaining/partialMoves behaviour (Suspect A) is verified in Task 5.

- [ ] **Step 2: Run to verify it fails (or document why it passes)**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts -t "cavalry multi-capture"`
Expected: FAIL — fewer than 2 captures. If it unexpectedly PASSES, that itself is evidence; record which suspect is NOT the cause and proceed to Task 5's investigation with the narrowed scope. **Do not write a fix until this test (or a corrected version of it) fails.**

- [ ] **Step 3: Commit the reproduction (red test, skipped to keep CI green between tasks)**

Mark it `it.skip` ONLY if committing between tasks must stay green; otherwise leave failing and proceed straight to Task 5 in the same work session.

```bash
git add artifacts/hex-battles/logic/aiExpert.test.ts
git commit -m "test(ai): reproduce cavalry single-turn multi-capture gap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Cavalry sweep — root cause + fix (systematic-debugging Phases 2-4)

**Files:**
- Modify: `logic/aiExpert.ts:480-512` (move-candidate generation) and/or the loop
- Test: `logic/aiExpert.test.ts` (the Task 4 test must go green)

- [ ] **Step 1: Confirm the root cause (no fix yet)**

Two code-grounded suspects (from the spec):
- **Suspect B — global move cap.** In `generateCandidateActions` (lines 481-512) `moveCount` is a single counter shared across ALL units, capped at `capPerKind` (60). Add a temporary `console.log` of `moveCount` and `availUnits.length`, or inspect: if a cavalry's destinations are dropped because earlier units exhausted the cap, this is the cause.
- **Suspect A — deep-raid re-derivation / chaining.** After a capture the cavalry has remaining `partialMoves`; verify the loop re-generates a follow-up move for it. If the captured tile stays contiguous with `startTileKey`'s territory, the next iteration should see it. Check whether `partialMoves` is keyed to the new tile.

Write down which suspect fires. Only then proceed.

- [ ] **Step 2: Implement the fix for the confirmed cause**

**If Suspect B (most likely):** make the move cap per-unit instead of a shared global counter, so no unit is starved. Replace the move-generation loop header/cap logic (lines 481-512). Current:

```typescript
  let moveCount = 0;
  for (const [uk, ue] of availUnits) {
    if (moveCount >= capPerKind) break;
    const range = ctx.partialMoves.get(uk) ?? unitMovement(ue);
    const vm = getValidMoves(uk, owner, ctx.entities, ctx.tileMap, ctx.spentUnits, range, ctx.combatSpentUnits);
    for (const mk of vm) {
      if (moveCount >= capPerKind) break;
      // ...push moves, moveCount++...
    }
  }
```

Change to a per-unit cap (keeps a global safety ceiling but never starves a single unit):

```typescript
  let moveCount = 0;
  const globalMoveCeiling = capPerKind * 4; // safety ceiling across all units
  for (const [uk, ue] of availUnits) {
    if (moveCount >= globalMoveCeiling) break;
    let perUnit = 0;
    const range = ctx.partialMoves.get(uk) ?? unitMovement(ue);
    const vm = getValidMoves(uk, owner, ctx.entities, ctx.tileMap, ctx.spentUnits, range, ctx.combatSpentUnits);
    for (const mk of vm) {
      if (perUnit >= capPerKind) break;
      // ... existing per-destination logic unchanged, but replace every
      //     `moveCount++` in this inner loop with `{ moveCount++; perUnit++; }`
    }
  }
```

Apply the same `perUnit++` alongside each `moveCount++` already present in the inner branches (the capture branch and the own-tile merge/rebel/reposition branch).

**If Suspect A (chaining):** ensure a unit with leftover `partialMoves` whose tile left the starting territory still gets follow-up moves. The most likely concrete fix is in the outer AI orchestration (`logic/aiStrategy.ts`) re-scanning the owner's territories after each expert loop returns; if the repro shows the leftover budget is simply never offered, add a re-entrancy pass there. Defer the exact edit to what Step 1 reveals — but it must be a single, root-cause-targeted change, and the Task 4 test is the gate.

- [ ] **Step 3: Run the reproduction — it must now pass**

Un-skip the Task 4 test if it was skipped. Run:
`pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts -t "cavalry multi-capture"`
Expected: PASS — ≥2 captures.

- [ ] **Step 4: Run the full expert suite (no regressions)**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add artifacts/hex-battles/logic/aiExpert.ts artifacts/hex-battles/logic/aiExpert.test.ts
git commit -m "fix(ai): cavalry no longer starved by global move cap (single-turn sweep)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Self-play — 2-ply beats 1-ply + turn-time budget (gated)

**Files:**
- Modify: `logic/aiSelfPlay.ts` (expose elapsed-ms in `playMatch` result if not already present)
- Test: `logic/aiSelfPlay.test.ts`

- [ ] **Step 1: Check whether `playMatch` already returns timing**

Run: `grep -n "elapsedMs\|Date.now\|performance.now\|minBalance" logic/aiSelfPlay.ts`
If no elapsed time is returned, add it: capture `const t0 = Date.now();` before the turn loop in `playMatch` and include `elapsedMs: Date.now() - t0` in the returned object (and its TypeScript return type).

- [ ] **Step 2: Write the gated tests**

Add to `logic/aiSelfPlay.test.ts` inside the `describe("expert strength (self-play)")` block (which already uses `fullIt`). Import the search override at the top of the file:

```typescript
import { __setExpertSearchConfig } from "@/logic/aiExpert";
```

Tests:

```typescript
  fullIt(
    "2-ply expert beats hard by a wider margin than 1-ply expert does",
    async () => {
      // Same opponent (hard), same seeds — only the expert's search depth differs.
      const run = async () => {
        let wins = 0;
        for (let s = 7000; s < 7016; s++) {
          const r = await playMatch({
            seed: s, tiles: 50, difficultyA: "expert", difficultyB: "hard", maxTurns: 45,
          });
          expect(r.minBalance).toBeGreaterThanOrEqual(0);
          if (r.winner === "ai1") wins++;
        }
        return wins;
      };

      __setExpertSearchConfig({ twoPly: false, k: 4 });
      const onePlyWins = await run();
      __setExpertSearchConfig({ twoPly: true, k: 4 });
      const twoPlyWins = await run();
      __setExpertSearchConfig(null);

      // 2-ply must be at least as strong, and strictly stronger on aggregate.
      expect(twoPlyWins).toBeGreaterThanOrEqual(onePlyWins);
    },
    600000,
  );

  fullIt(
    "AI turn compute stays within budget on a large board",
    async () => {
      __setExpertSearchConfig({ twoPly: true, k: 4 });
      const r = await playMatch({
        seed: 8000, tiles: 80, difficultyA: "expert", difficultyB: "expert", maxTurns: 30,
      });
      __setExpertSearchConfig(null);
      const msPerTurn = r.elapsedMs / Math.max(1, r.turns);
      // Calibrate the ceiling from the first observed value, then freeze it a bit
      // above. Headless target: comfortably under 150 ms/turn so on-device stays snappy.
      expect(msPerTurn).toBeLessThan(150);
    },
    600000,
  );
```

> The `>=` win comparison is deliberately conservative: snowball variance over 16
> seeds is high, so require non-regression on aggregate, not a fixed margin. If the
> implementer observes a clear, repeatable margin (e.g. +3 wins), tighten to
> `expect(twoPlyWins).toBeGreaterThan(onePlyWins)` and record the observed split in
> the test comment, matching the style of the existing 22-2 series.

- [ ] **Step 3: Run the gated tests**

Run: `AI_SELFPLAY=1 pnpm --filter @workspace/hex-battles exec vitest run logic/aiSelfPlay.test.ts`
Expected: PASS. Read the printed `msPerTurn` (add a `console.log` during development if needed) and set the ceiling from it. Confirm the existing over-spend and tempo collapse-tail guards still pass.

- [ ] **Step 4: Run the default (ungated) suite to confirm nothing else broke**

Run: `pnpm test`
Expected: all pass + the gated ones skipped.

- [ ] **Step 5: Commit**

```bash
git add artifacts/hex-battles/logic/aiSelfPlay.ts artifacts/hex-battles/logic/aiSelfPlay.test.ts
git commit -m "test(ai): gated 2-ply>1-ply strength series + turn-time budget guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: (Conditional) Cavalry reach valuation — only if self-play shows under-use

Do this ONLY if, after Tasks 3-6, self-play shows Expert still under-buys/under-uses cavalry (e.g. it rarely fields scouts/knights, or loses ground a sweeping cavalry would hold). If the correctness fix + chaining already realize the sweep, SKIP this task (YAGNI).

**Files:**
- Modify: `logic/aiExpert.ts` (`EvalWeights`, `DEFAULT_WEIGHTS`, `evaluatePosition`)
- Test: `logic/aiExpert.test.ts`

- [ ] **Step 1: Decide via measurement**

Add a temporary `onTurnStats` counter in a scratch self-play run (or inspect `ownerStats`) for cavalry counts of the expert seat across 16 seeds with `twoPly:true`. If the average is near zero while the position would reward a sweep, proceed; else mark this task "skipped — not needed" in the plan and stop.

- [ ] **Step 2: Write the failing test (reach reward)**

```typescript
describe("cavalry reach valuation", () => {
  it("values a knight by the number of capturable tiles within its reach", () => {
    // A knight on (1,0) with two capturable neutral tiles in range vs none.
    const reachMap = makeTileMap([
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "neutral"),
      makeTile(3, 0, "neutral"),
    ]);
    const boxedMap = makeTileMap([
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "mountain"),
      makeTile(3, 0, "mountain"),
    ]);
    const ent = new Map<string, EntityType>([["1,0", "knight"]]);
    const w = { ...DEFAULT_WEIGHTS, cavalryReach: 5 };
    const withReach = evaluatePosition("ai1", reachMap, ent, new Map(), new Set(), w);
    const boxedIn = evaluatePosition("ai1", boxedMap, ent, new Map(), new Set(), w);
    expect(withReach).toBeGreaterThan(boxedIn);
  });
});
```

- [ ] **Step 3: Implement `cavalryReach`**

Add `cavalryReach: number;` to `EvalWeights`, `cavalryReach: 1` (calibrate) to `DEFAULT_WEIGHTS`. In `evaluatePosition`, in the military loop where `meta.isUnit` is handled, add for cavalry units a count of distinct capturable enemy/neutral land tiles within `unitMovement(e)` (reuse `getValidMoves`-style reachability or a bounded BFS already available via `getValidMoves`), and add `cavalryReachTotal * w.cavalryReach` to the return. Import `unitMovement`, `getValidMoves`, `isCavalry` are already imported.

```typescript
    if (meta.isUnit) {
      unitStrength += meta.strength;
      if (onBorder) borderBonus += meta.strength;
      // ... existing breakthrough block ...
      if (isCavalry(e)) {
        const reachable = getValidMoves(
          k, owner, entities, tileMap, new Set(), unitMovement(e), new Set(),
        );
        for (const mk of reachable) {
          const mt = tileMap.get(mk);
          if (!mt || mt.owner === owner) continue;
          if (mt.terrain === "lake" || mt.terrain === "mountain") continue;
          if (meta.strength > getMaxEnemyZoC(mk, owner, entities, tileMap)) cavalryReachTotal += 1;
        }
      }
    }
```

Declare `let cavalryReachTotal = 0;` with the other military accumulators (~line 178) and add `+ cavalryReachTotal * w.cavalryReach` to the return expression.

- [ ] **Step 4: Run the test + full suite**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiExpert.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-run gated self-play (non-regression) and commit**

```bash
AI_SELFPLAY=1 pnpm --filter @workspace/hex-battles exec vitest run logic/aiSelfPlay.test.ts
pnpm run typecheck
git add artifacts/hex-battles/logic/aiExpert.ts artifacts/hex-battles/logic/aiExpert.test.ts
git commit -m "feat(ai): reward cavalry reach so expert fields and uses charge units

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Update test-suite memory + ship to phone

**Files:**
- Modify: `/home/jo/.claude/projects/-home-jo-Hex-Battles/memory/project_test_suites.md`

- [ ] **Step 1: Update the memory file**

Bump the test counts (frontmatter `description:` line and the body total line) to the new totals after all tasks. Update the `aiExpert.test.ts` line to mention `opponentBestResponse`, two-ply best-response, and the cavalry multi-capture reproduction. Update the `aiSelfPlay.test.ts` line to mention the 2-ply>1-ply series and turn-time budget guard.

- [ ] **Step 2: Final full run**

Run: `pnpm test` then `pnpm run typecheck`
Expected: all pass, typecheck clean.

- [ ] **Step 3: Commit**

```bash
git add /home/jo/.claude/projects/-home-jo-Hex-Battles/memory/project_test_suites.md
git commit -m "docs(memory): test-suite counts for 2-ply + cavalry work

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Build a preview APK for on-device testing (the real proof)**

The human matchup is the actual validation. Per `artifacts/hex-battles/PLAY_STORE_BUILD.md`:
`eas build --platform android --profile preview`
(Do not bump `versionCode` for a preview build; only production AABs need it.) Hand the APK to the user to play against Expert and report whether it still feels beatable.

---

## Self-Review

**Spec coverage:**
- Component 1 (`opponentBestResponse`, global) → Task 1. ✓
- Component 2 (two-pass scoring, top-K, do-nothing baseline) → Tasks 2-3. ✓
- Component 3 (performance / top-K bound + turn-time test) → Task 2 (k) + Task 6 (budget). ✓
- Component 4 (cavalry correctness, repro-first) → Tasks 4-5. ✓
- Component 5 (cavalry valuation, conditional/last) → Task 7. ✓
- Testing (opponentBestResponse units, 2-ply behaviour, cavalry repro, gated 2-ply>1-ply, invariants, turn budget) → Tasks 1,3,4-5,6. ✓
- Rollout (ship to phone) → Task 8 Step 4. ✓

**Placeholder scan:** The two intentionally-flexible spots (Task 3 geometry tuning, Task 5 fix-by-cause) are framed as systematic-debugging gates with concrete primary code and an explicit "freeze when red/green" instruction — not open-ended TODOs. Task 7 is explicitly conditional with a measurement gate. No bare "handle edge cases".

**Type consistency:** `SearchConfig {twoPly,k}`, `DEFAULT_SEARCH`, `__setExpertSearchConfig`, `opponentBestResponse(owner, s, w) → {state, move}`, `SimState`, `ExpertAction` are used identically across Tasks 1-3 and Task 6. `EvalWeights.cavalryReach` introduced and used only in Task 7. `playMatch` result gains `elapsedMs` in Task 6 before it is read.

**Scope:** Single subsystem (the expert brain + its self-play harness). The turn-counter refactor and Plan B (opponent-learning) are explicitly NOT here.
