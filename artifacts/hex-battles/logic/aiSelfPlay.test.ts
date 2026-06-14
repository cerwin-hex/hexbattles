import { describe, it, expect } from "vitest";
import {
  playMatch,
  playSeries,
  playFreeForAll,
  runOneAiTurnHeadless,
} from "@/logic/aiSelfPlay";
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

  it("expert knight captures >=2 open neutral tiles in a single turn", async () => {
    // ai1 base: knight at (0,0) with a backing tile (0,1) so the territory is
    // not a single penalised hex. A straight line of open neutral grass runs
    // east — distances 1..4, all within the knight's movement of 5.
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

    // Plenty of money so economy never blocks; open captures cost nothing, so
    // only the starting territory's balance matters.
    const startTerr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    const startTid = getTerritoryId(startTerr);
    expect(startTid).not.toBeNull();
    ws.balances.set(startTid!, 999);

    const before = countLand(ws, "ai1");
    await runOneAiTurnHeadless(ws, "ai1", 5, "expert");
    const after = countLand(ws, "ai1");

    // The knight must have swept at least two new tiles in the single turn.
    // (runAiTurn replaces ws.entities with fresh maps, so read from ws.)
    expect(after - before).toBeGreaterThanOrEqual(2);
    // And it must have left its start tile (it moved).
    expect(ws.entities.get("0,0")).toBeUndefined();
  });
});
