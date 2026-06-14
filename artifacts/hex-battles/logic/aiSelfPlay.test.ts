import { describe, it, expect } from "vitest";
import { playMatch, playSeries, playFreeForAll } from "@/logic/aiSelfPlay";
import type { TerritoryOwner, Difficulty } from "@/types";

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
});

describe("expert strength (self-play)", () => {
  fullIt(
    "clearly beats hard on equal economy (proves the brain)",
    async () => {
      const r = await playSeries(24, "expert", "hard", { tiles: 50, maxTurns: 45 });
      // Observed 22-2; require a clear majority.
      expect(r.winsA).toBeGreaterThanOrEqual(18);
      expect(r.winsA).toBeGreaterThan(r.winsB);
    },
    600000,
  );

  fullIt(
    "super_expert (smart brain + bonus economy) beats super_hard",
    async () => {
      const r = await playSeries(32, "super_expert", "super_hard", {
        tiles: 50,
        maxTurns: 45,
      });
      // Observed ~69%; require > 55% over 32 games.
      expect(r.winsA / r.games).toBeGreaterThan(0.55);
      expect(r.winsA).toBeGreaterThan(r.winsB);
    },
    600000,
  );

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
});
