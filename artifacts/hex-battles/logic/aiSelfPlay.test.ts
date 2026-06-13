import { describe, it, expect } from "vitest";
import { playMatch, playSeries } from "@/logic/aiSelfPlay";

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
    // expert should not lose to easy on land control
    expect(r.landA).toBeGreaterThanOrEqual(r.landB);
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
    "beats super_hard when granted the same income bonus (smarter brain edge)",
    async () => {
      const r = await playSeries(32, "expert", "super_hard", {
        tiles: 50,
        maxTurns: 45,
        expertIncomeBonus: true,
      });
      // Observed 22-10 (~69%); require > 55% over 32 games.
      expect(r.winsA / r.games).toBeGreaterThan(0.55);
      expect(r.winsA).toBeGreaterThan(r.winsB);
    },
    600000,
  );
});
