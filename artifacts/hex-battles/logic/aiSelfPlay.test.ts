import { describe, it, expect } from "vitest";
import {
  playMatch,
  playFreeForAll,
  mirrorAbFFA,
  runOneAiTurnHeadless,
} from "@/logic/aiSelfPlay";
import { __setExpertSearchConfig, __setExpertCandidateMode, __setExpertMaxIters } from "@/logic/aiExpert";
import type { TerritoryOwner, Difficulty, HexTile, EntityType } from "@/types";
import type { AiWorkingState } from "@/logic/aiStrategy";
import {
  getContiguousTerritory,
  getTerritoryId,
} from "@/utils/hexGrid";

// The strength series are real games (~1.3s each), too slow for the default
// suite. They run only when AI_SELFPLAY is set; the headline results are
// recorded in docs/superpowers/specs/2026-06-13-expert-ai-difficulty-design.md.
// Re-run with:  AI_SELFPLAY=1 pnpm --filter @workspace/hex-battles exec \
//                 vitest run logic/aiSelfPlay.test.ts
const FULL = !!process.env.AI_SELFPLAY;
const fullIt = FULL ? it : it.skip;

describe("playMatch (smoke)", () => {
  it("plays a full headless game to completion without throwing", async () => {
    const r = await playMatch({
      seed: 1,
      tiles: 50,
      difficultyA: "expert",
      difficultyB: "easy",
      maxTurns: 30,
    });
    expect(r.turns).toBeGreaterThan(0);
    expect(["ai1", "ai2", "draw"]).toContain(r.winner);
    expect(r.landA + r.landB).toBeGreaterThan(0);
    // Per-seed land outcome is high-variance in this snowball game; expert's
    // overall edge is asserted by the env-gated strength series below.
  });
});

describe("no over-spend invariant", () => {
  it("never lets a territory balance go negative (regression: D2a multi-bridge)", async () => {
    // Seeds 5005/5011 (hard) and 5034 (super_hard) previously over-spent by
    // building several consolidation bridges on a single canAfford check.
    const cases: Array<["hard" | "super_hard", number]> = [
      ["hard", 5005],
      ["hard", 5011],
      ["super_hard", 5034],
    ];
    for (const [diff, seed] of cases) {
      const r = await playMatch({
        seed,
        tiles: 60,
        difficultyA: diff,
        difficultyB: diff,
        maxTurns: 12,
      });
      expect(r.minBalance).toBeGreaterThanOrEqual(0);
    }
  });

  fullIt(
    "stays non-negative across many games and all difficulties",
    async () => {
      const diffs: Difficulty[] = ["easy", "medium", "hard", "super_hard", "expert", "super_expert"];
      for (const d of diffs) {
        for (let s = 5000; s < 5030; s++) {
          const r = await playMatch({ seed: s, tiles: 60, difficultyA: d, difficultyB: d, maxTurns: 40 });
          expect(r.minBalance).toBeGreaterThanOrEqual(0);
        }
      }
    },
    900000,
  );

  // The reserve-gated tempo term lets expert run deliberate short deficits. An
  // aggregate win-rate can hide a collapse *tail* — a few games where the AI
  // over-invests and bankrupts itself. A weaker opponent surfaces it: if tempo
  // ever self-destructs, expert drops games it should never lose. Guard both the
  // win floor and the no-negative-balance invariant.
  fullIt(
    "expert never throws games to a weaker AI (tempo collapse-tail guard)",
    async () => {
      let wins = 0;
      let games = 0;
      for (let s = 6000; s < 6020; s++) {
        const r = await playMatch({
          seed: s,
          tiles: 50,
          difficultyA: "expert",
          difficultyB: "medium",
          maxTurns: 45,
        });
        expect(r.minBalance).toBeGreaterThanOrEqual(0);
        games++;
        if (r.winner === "ai1") wins++;
      }
      expect(wins / games).toBeGreaterThan(0.8);
    },
    600000,
  );
});

describe("expert strength (self-play)", () => {
  // Expert tiers are NOT tested against the Hard tiers: those match-ups are
  // saturated (Expert ~92% vs hard; super_expert ~69% vs super_hard) and so blind
  // to the small deltas that matter when tuning Expert. Changes to the Expert brain
  // are judged new-vs-old instead (see `mirrorAbFFA` / the perf-neutrality A/B).
  fullIt(
    "super_expert is the dominant seat in 4-AI free-for-alls (3-4 opponents)",
    async () => {
      // super_expert(ai1) vs super_hard, hard, medium across seeded maps.
      const wins: Record<string, number> = {};
      const N = 4;
      for (let s = 0; s < N; s++) {
        const r = await playFreeForAll({
          seed: 3000 + s,
          tiles: 80,
          difficulties: ["super_expert", "super_hard", "hard", "medium"],
          maxTurns: 35,
        });
        if (r.winner !== "draw") wins[r.winner] = (wins[r.winner] ?? 0) + 1;
      }
      const expertWins = wins["ai1" as TerritoryOwner] ?? 0;
      const bestOther = Math.max(
        0,
        ...(["ai2", "ai3", "ai4"] as TerritoryOwner[]).map((s) => wins[s] ?? 0),
      );
      // Observed expert 3 / others ≤1. Require expert the strict top winner.
      expect(expertWins).toBeGreaterThan(bestOther);
      expect(expertWins).toBeGreaterThanOrEqual(Math.ceil(N / 2));
    },
    600000,
  );

  fullIt(
    "2-ply expert beats hard at least as well as 1-ply expert (same opponent/seeds)",
    async () => {
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
      // High variance over 16 snowball games — require non-regression on aggregate.
      // Observed: 1-ply 15/16, 2-ply 16/16.
      expect(twoPlyWins).toBeGreaterThanOrEqual(onePlyWins);
    },
    600000,
  );

  fullIt(
    "expert is robust with 1-4 AI opponents on 100-tile boards (incl. the 3-opponent config)",
    async () => {
      // Covers every opponent count the game ships (1-4 AI ⇒ 2-5 all-Expert seats),
      // on the 100-tile boards the game is most often played on, with extra weight
      // on the most-played setup: 100 tiles + 3 Expert opponents (4 seats). Equal-
      // difficulty FFAs are highly seat/seed dependent, so this asserts ROBUSTNESS,
      // not a win rate: every game must run to a clean terminal state with a valid
      // winner and sane land totals — and, the key invariant, no territory ever
      // over-spends (minBalance >= 0), even with several AIs grinding a big board.
      const configs: Array<{ seats: number; seeds: number }> = [
        { seats: 2, seeds: 1 }, // 1 AI opponent (1v1 is covered in depth above)
        { seats: 3, seeds: 2 }, // 2 AI opponents
        { seats: 4, seeds: 3 }, // 3 AI opponents — the most-played setup
        { seats: 5, seeds: 2 }, // 4 AI opponents
      ];
      for (const { seats, seeds } of configs) {
        const seatIds = (["ai1", "ai2", "ai3", "ai4", "ai5"] as TerritoryOwner[]).slice(0, seats);
        for (let s = 0; s < seeds; s++) {
          const r = await playFreeForAll({
            seed: 2400 + seats * 10 + s,
            tiles: 100,
            difficulties: new Array(seats).fill("expert" as Difficulty),
            maxTurns: 32,
          });
          expect(r.minBalance).toBeGreaterThanOrEqual(0); // no over-spend
          expect(r.ownerTurns).toBeGreaterThan(0);
          const total = seatIds.reduce((acc, sd) => acc + (r.land[sd] ?? 0), 0);
          expect(total).toBeGreaterThan(0);
          expect([...seatIds, "draw"]).toContain(r.winner);
        }
      }
    },
    900000,
  );

  fullIt(
    "new-vs-old mirror A/B harness is wired and unbiased (tool for future Expert tuning)",
    async () => {
      // `mirrorAbFFA` is the reusable harness for judging a FUTURE Expert change:
      // one rotating "new" seat vs the rest "current", all Expert, on the multi-AI
      // boards the game is actually played on. Real use sets a toggle inside
      // apply("new") (e.g. __setExpertWeightsOverride) and runs 30+ seeds. Here the
      // apply is a no-op, so "new" === "current": this only proves the plumbing —
      // seat rotation, win attribution, and the neutral baseline — is correct, so a
      // real tuning run can be trusted. (Kept small; it tests the tool, not strength.)
      const r = await mirrorAbFFA(() => {}, { seats: 3, tiles: 50, seeds: 3, maxTurns: 25 });
      expect(r.games).toBe(3);
      expect(r.newWins + r.otherWins + r.draws).toBe(r.games);
      expect(r.neutral).toBeCloseTo(1); // 3 games / 3 seats
      expect(r.newWins).toBeGreaterThanOrEqual(0);
    },
    600000,
  );

  fullIt(
    "AI turn compute stays within budget on a large board",
    async () => {
      __setExpertSearchConfig({ twoPly: true, k: 4 });
      // Track the single most expensive turn too — the average is dominated by
      // cheap collapsed-endgame turns and hides the worst-case spike, which is the
      // latency a player (especially on mobile) actually feels between moves.
      let peakTurnMs = 0;
      let lastT = Date.now();
      const r = await playMatch({
        seed: 8000, tiles: 80, difficultyA: "expert", difficultyB: "expert", maxTurns: 30,
        onTurnStats: () => {
          const now = Date.now();
          peakTurnMs = Math.max(peakTurnMs, now - lastT);
          lastT = now;
        },
      });
      __setExpertSearchConfig(null);
      const msPerTurn = r.elapsedMs / Math.max(1, r.turns);
      // Ceiling calibrated from first observed value: observed ~144 ms/turn on 80-tile board.
      // Ceiling set to 300 ms/turn for comfortable headroom — guards gross regressions only.
      expect(msPerTurn).toBeLessThan(300);
      // Peak single-turn ceiling: observed ~430 ms post-optimisation (was ~930 ms
      // before candidate pruning + the per-territory iteration cap). 900 ms leaves
      // ~2x headroom for slow CI while still catching a regression back to baseline.
      expect(peakTurnMs).toBeLessThan(900);
    },
    600000,
  );

  fullIt(
    "candidate pruning + iteration cap are strength-neutral (perf opts cost no wins)",
    async () => {
      // The performance work (front-relevant placement pruning, single-best
      // advance, per-territory iteration cap) must only drop candidates/actions the
      // eval would never choose. Head-to-head — the shipping brain (pruned + capped,
      // via null overrides) vs the exhaustive pre-optimisation brain (full + iter
      // 100) — on mirrored seats it should be a wash, NOT a regression. (vs-hard is
      // saturated and cannot detect a small loss here; this A/B can.)
      let optWins = 0, oldWins = 0;
      const N = 24;
      for (let i = 0; i < N; i++) {
        const optOwner: TerritoryOwner = i % 2 === 0 ? "ai1" : "ai2";
        const r = await playMatch({
          seed: 9300 + i, tiles: 50, difficultyA: "expert", difficultyB: "expert", maxTurns: 45,
          onBeforeOwnerTurn: (owner) => {
            if (owner === optOwner) { __setExpertCandidateMode(null); __setExpertMaxIters(null); }
            else { __setExpertCandidateMode("full"); __setExpertMaxIters(100); }
          },
        });
        __setExpertCandidateMode(null);
        __setExpertMaxIters(null);
        if (r.winner === optOwner) optWins++;
        else if (r.winner !== "draw") oldWins++;
      }
      // Neutral within noise over 24 games: require the optimised brain is not
      // meaningfully worse (observed ~even). Guards against a prune that silently
      // removes a winning line.
      expect(optWins).toBeGreaterThanOrEqual(oldWins - 4);
    },
    600000,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// Cavalry single-turn sweep — end-to-end through the REAL `runAiTurn`.
//
// A knight (movement 5, maxAttacks 2, strength 2) standing next to a line of
// open neutral grass tiles must capture at least TWO of them in ONE turn by
// chaining moves: the AI exec updates partialMoves/combatSpentUnits between
// hops and the expert loop re-derives valid moves under the unit's new tile.
// This guards the chaining mechanic (a prior fix stopped a shared cap from
// dropping the cavalry's extra move-candidates).
// ════════════════════════════════════════════════════════════════════════════
describe("cavalry single-turn sweep (end-to-end)", () => {
  function grass(q: number, r: number, owner: TerritoryOwner): HexTile {
    return {
      q,
      r,
      terrain: "grass",
      owner,
      key: `${q},${r}`,
      cityBuffer: false,
      isCity: false,
    };
  }

  function countLand(ws: AiWorkingState, owner: TerritoryOwner): number {
    let n = 0;
    for (const t of ws.tileMap.values()) {
      if (t.owner === owner && t.terrain !== "lake" && t.terrain !== "mountain") n++;
    }
    return n;
  }

  it("expert knight captures exactly 2 tiles (the charge cap) and is then spent", async () => {
    // ai1 base: knight at (0,0) with a backing tile (0,1) so the territory is
    // not a single penalised hex. A straight line of FOUR open neutral grass
    // tiles runs east — distances 1..4, all within the knight's movement of 5.
    //
    // The point of the test: a cavalry unit may make at most 2 combat captures
    // per turn (maxAttacks: 2 → isChargeAttack stops after the 2nd), even though
    // its movement of 5 could physically reach all four tiles. With NO money the
    // AI cannot buy units onto the other tiles, so the territory gain measures
    // ONLY the knight's own sweep. It must capture exactly 2 (1,0)+(2,0), end on
    // (2,0) spent, and leave (3,0)+(4,0) neutral — the charge cap, not reach.
    const tiles: HexTile[] = [
      grass(0, 0, "ai1"), // knight start
      grass(0, 1, "ai1"), // backing tile (real contiguous territory)
      grass(1, 0, "neutral"),
      grass(2, 0, "neutral"),
      grass(3, 0, "neutral"),
      grass(4, 0, "neutral"),
    ];
    const tileMap = new Map<string, HexTile>(tiles.map((t) => [t.key, t]));

    const entities = new Map<string, EntityType>([["0,0", "knight"]]);

    const ws: AiWorkingState = {
      tileMap,
      entities,
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
    };

    // Zero balance: open captures cost nothing, but NO unit can be bought, so the
    // only way ai1 can gain ground is the knight's own movement-and-capture chain.
    const startTerr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    const startTid = getTerritoryId(startTerr);
    expect(startTid).not.toBeNull();
    ws.balances.set(startTid!, 0);

    const before = countLand(ws, "ai1");
    await runOneAiTurnHeadless(ws, "ai1", 5, "expert");
    const after = countLand(ws, "ai1");

    // Exactly two new tiles — the charge cap, isolated from any buying.
    // (runAiTurn replaces ws.entities/tileMap with fresh maps, so read from ws.)
    expect(after - before).toBe(2);
    // The knight swept (1,0) then (2,0) and is now spent on (2,0).
    expect(ws.entities.get("0,0")).toBeUndefined();
    expect(ws.entities.get("2,0")).toBe("knight");
    expect(ws.tileMap.get("1,0")?.owner).toBe("ai1");
    expect(ws.tileMap.get("2,0")?.owner).toBe("ai1");
    // The tiles beyond the 2-capture cap remain neutral, even though movement (5)
    // could have physically reached them — proving the cap is on captures, not reach.
    expect(ws.tileMap.get("3,0")?.owner).toBe("neutral");
    expect(ws.tileMap.get("4,0")?.owner).toBe("neutral");
  });
});
