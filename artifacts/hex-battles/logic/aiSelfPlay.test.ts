import { describe, it, expect } from "vitest";
import { playMatch, playSeries, playFreeForAll } from "@/logic/aiSelfPlay";
import type { TerritoryOwner } from "@/types";

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
