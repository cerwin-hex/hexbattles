import { describe, it, expect, vi, afterEach } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { runOneAiTurnHeadless } from "@/logic/aiSelfPlay";
import type { AiWorkingState } from "@/logic/aiStrategy";

// ─────────────────────────────────────────────────────────────────────────────
// Rebel spawning runs ONCE per round, at the END of the AI phase (after every
// owner has moved), from the graves/ruins armed at the start of the round. This
// exercises that wiring end-to-end through the real `runAiTurn` (flag = true),
// and the one-round "skull warning" delay: a grave created DURING the round is
// not eligible until the NEXT round.
// ─────────────────────────────────────────────────────────────────────────────

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

function ws(tiles: HexTile[], overrides: Partial<AiWorkingState> = {}): AiWorkingState {
  return {
    tileMap: new Map(tiles.map((t) => [t.key, t])),
    entities: new Map(),
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
    ...overrides,
  };
}

describe("rebel spawn at the round boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("an armed grave rises at the end of the AI phase and is consumed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // < 0.75 grave roll, ≥ 0.02 spread
    const state = ws([makeTile(5, 5, "player")], { graveyard: new Set(["5,5"]) });
    // "ai1" owns no tiles, so the AI does nothing — but the round-end rebel spawn
    // (flag = true) still runs after the AI phase.
    await runOneAiTurnHeadless(state, "ai1", 2, "medium", true);
    expect(state.entities.get("5,5")).toBe("rebel"); // armed grave rose
    expect(state.graveyard.has("5,5")).toBe(false); // and was consumed
  });

  it("is suspended in round 1", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = ws([makeTile(5, 5, "player")], { graveyard: new Set(["5,5"]) });
    await runOneAiTurnHeadless(state, "ai1", 1, "medium", true);
    expect(state.entities.get("5,5")).toBeUndefined(); // no spawn in round 1
    expect(state.graveyard.has("5,5")).toBe(true); // grave untouched
  });

  it("one-round delay: a grave created THIS round waits until next round", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    // Territory {2 grass + lake/warrior}, balance 0 → player economy nets −6 →
    // bankrupt → the warrior dies, creating a NEW grave at (0,1) during the round.
    // Separately, (5,5) carries an armed grave from a previous round.
    const state = ws(
      [
        makeTile(0, 0, "player", "grass"),
        makeTile(1, 0, "player", "grass"),
        makeTile(0, 1, "player", "lake"),
        makeTile(5, 5, "player", "grass"),
      ],
      {
        entities: new Map<string, EntityType>([["0,1", "warrior"]]),
        balances: new Map([["0,0", 0]]),
        graveyard: new Set(["5,5"]), // armed at round start
      },
    );
    await runOneAiTurnHeadless(state, "ai1", 2, "medium", true);

    // The pre-existing armed grave rises and is consumed…
    expect(state.entities.get("5,5")).toBe("rebel");
    expect(state.graveyard.has("5,5")).toBe(false);
    // …while the grave the bankruptcy created THIS round survives, armed next round.
    expect(state.entities.get("0,1")).toBe("bridge"); // warrior liquidated to bridge
    expect(state.graveyard.has("0,1")).toBe(true);
  });
});
