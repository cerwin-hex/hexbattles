import { describe, it, expect, vi } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { handleEndTurnLogic, type EndTurnParams } from "@/logic/endTurnHandler";
import { runOneAiTurnHeadless } from "@/logic/aiSelfPlay";
import type { AiWorkingState } from "@/logic/aiStrategy";

// ─────────────────────────────────────────────────────────────────────────────
// Regression: a player territory must be charged its upkeep EXACTLY ONCE per
// round. The reported bug: a {2 grass + 1 lake/warrior} territory (income 4,
// upkeep 10 → net −6) with a 6g balance went bankrupt and lost its warrior at
// the start of the next turn, even though 6 + (4 − 10) = 0 should survive.
//
// Root cause: the player's economy was applied twice — once in endTurnHandler
// (6 → 0, survives) and again at the end of the AI phase in runAiTurn
// (0 → −6, bankrupt). This test drives the REAL flow end-to-end: the player's
// end-turn economy, then the genuine headless AI phase, and asserts the warrior
// survives the round its reserves cover.
// ─────────────────────────────────────────────────────────────────────────────

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

interface RoundState {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
  graveyard: Set<string>;
  ruins: Set<string>;
  cities: Set<string>;
}

/** Run the player's end-turn economy and return the committed state. The AI
 *  hand-off is stubbed here; the AI phase is driven separately below so the test
 *  can read the working state directly. */
function runPlayerEndTurn(state: RoundState, turn: number): RoundState {
  const setMutableTileMap = vi.fn();
  const setTerritoryBalances = vi.fn();
  const setEntities = vi.fn();
  const setGraveyard = vi.fn();
  const setRuins = vi.fn();

  const params: EndTurnParams = {
    isAiTurn: false,
    gameResult: null,
    territoryBalances: state.balances,
    entities: state.entities,
    turn,
    activeTileMap: state.tileMap,
    cities: state.cities,
    graveyard: state.graveyard,
    ruins: state.ruins,
    armedGraveyard: new Set(),
    armedRuins: new Set(),
    mutableTileMap: new Map(state.tileMap),
    liveOwnerMap: new Map(),
    aiTurnRef: { current: false },
    setMoveHistory: vi.fn(),
    setMutableTileMap,
    setTerritoryBalances,
    setEntities,
    setGraveyard,
    setRuins,
    setSelectedTileKey: vi.fn(),
    setArmedEntityId: vi.fn(),
    setSelectedEntityKey: vi.fn(),
    setSpentUnits: vi.fn(),
    setCombatSpentUnits: vi.fn(),
    setPartialMoves: vi.fn(),
    setAttacksUsed: vi.fn(),
    setIsAiTurn: vi.fn(),
    checkWinLoss: vi.fn().mockReturnValue(false),
    runAiTurn: vi.fn(),
    closeRibbon: vi.fn(),
  };

  handleEndTurnLogic(params);

  const last = <T>(fn: ReturnType<typeof vi.fn>, fallback: T): T => {
    const calls = fn.mock.calls;
    return calls.length > 0 ? (calls[calls.length - 1][0] as T) : fallback;
  };

  return {
    tileMap: last(setMutableTileMap, state.tileMap),
    balances: last(setTerritoryBalances, state.balances),
    entities: last(setEntities, state.entities),
    graveyard: last(setGraveyard, state.graveyard),
    ruins: last(setRuins, state.ruins),
    cities: state.cities,
  };
}

/** Drive the genuine AI phase (including the end-of-AI-phase player bankruptcy
 *  check) over a no-tile AI owner, mutating and returning the working state. */
async function runAiPhase(state: RoundState, turn: number): Promise<RoundState> {
  const ws: AiWorkingState = {
    tileMap: new Map(state.tileMap),
    entities: new Map(state.entities),
    balances: new Map(state.balances),
    liveOwnerMap: new Map(),
    graveyard: new Set(state.graveyard),
    ruins: new Set(state.ruins),
    cities: new Set(state.cities),
    spentUnits: new Set(),
    partialMoves: new Map(),
    attacksUsed: new Map(),
    combatSpentUnits: new Set(),
    freeTowerUsed: new Map(),
  };
  // "ai1" owns no tiles on this board, so the AI does nothing — but the
  // end-of-AI-phase player economy/bankruptcy check still runs.
  await runOneAiTurnHeadless(ws, "ai1", turn, "medium");
  return {
    tileMap: ws.tileMap,
    entities: ws.entities,
    balances: ws.balances,
    graveyard: ws.graveyard,
    ruins: ws.ruins,
    cities: ws.cities,
  };
}

/** One full round: player end-turn economy followed by the AI phase. */
async function runFullRound(state: RoundState, turn: number): Promise<RoundState> {
  const afterPlayer = runPlayerEndTurn(state, turn);
  return runAiPhase(afterPlayer, turn);
}

// Territory: grass(0,0), grass(1,0), lake(0,1) — all player-owned, warrior on
// the lake (= unit on a bridge). Territory ID = min key = "0,0".
function makeScenario(balance: number): RoundState {
  return {
    tileMap: new Map([
      ["0,0", makeTile(0, 0, "player", "grass")],
      ["1,0", makeTile(1, 0, "player", "grass")],
      ["0,1", makeTile(0, 1, "player", "lake")],
    ]),
    entities: new Map<string, EntityType>([["0,1", "warrior"]]),
    balances: new Map([["0,0", balance]]),
    graveyard: new Set(),
    ruins: new Set(),
    cities: new Set(),
  };
}

describe("player economy is charged exactly once per round", () => {
  it("warrior survives the round its 6g reserve covers (6 → 0, not bankrupt)", async () => {
    const after = await runFullRound(makeScenario(6), 2);
    // After one round: 6 + (4 − 10) = 0. The warrior must still be standing and
    // the lake tile must NOT have collapsed to a bare bridge / gained a skull.
    expect(after.balances.get("0,0")).toBe(0);
    expect(after.entities.get("0,1")).toBe("warrior");
    expect(after.graveyard.has("0,1")).toBe(false);
  });

  it("warrior dies the FOLLOWING round, once the reserve is gone (0 → −6)", async () => {
    const afterRound1 = await runFullRound(makeScenario(6), 2);
    const afterRound2 = await runFullRound(
      { ...afterRound1, graveyard: new Set(), ruins: new Set() },
      3,
    );
    // Now there are no reserves: 0 + (4 − 10) = −6 < 0 → genuine bankruptcy.
    expect(afterRound2.balances.get("0,0")).toBe(0);
    expect(afterRound2.entities.get("0,1")).toBe("bridge"); // warrior liquidated
    // The grave at the lake tile is created by bankruptcy but immediately consumed
    // by the round-end rebel spawn (lake tiles clear the skull without spawning a
    // rebel), so graveyard is empty at round end.
    expect(afterRound2.graveyard.has("0,1")).toBe(false);
  });
});

// ─── Income cadence ───────────────────────────────────────────────────────────
// Each owner's economy runs at the start of its own turn inside `runAiTurn`: the
// player at the end of the AI phase (currentTurn !== 1), each AI at the start of
// its turn (currentTurn > 2). The one-round AI delay keeps both sides at
// 10 + (R-2) income credits at the start of round R — the balance-locking
// characterization that previously lived in endTurnHandler.test.ts.

describe("income cadence", () => {
  // Player + ai1, each a sparse 2-tile grass territory with no neighbours to
  // capture and 0 gold (so neither can buy) — balances change ONLY via economy.
  function makeBoard() {
    const tiles: HexTile[] = [
      makeTile(0, 0, "player", "grass"),
      makeTile(1, 0, "player", "grass"),
      makeTile(10, 10, "ai1", "grass"),
      makeTile(11, 10, "ai1", "grass"),
    ];
    return {
      tileMap: new Map(tiles.map((t) => [t.key, t])),
      entities: new Map<string, EntityType>(),
      balances: new Map<string, number>([["0,0", 0], ["10,10", 0]]),
      graveyard: new Set<string>(),
      ruins: new Set<string>(),
      cities: new Set<string>(),
    };
  }
  const PLAYER_TID = "0,0";
  const AI_TID = "10,10";

  it("round 2: player credited, AI not yet", async () => {
    const after = await runAiPhase(makeBoard(), 2);
    expect(after.balances.get(PLAYER_TID)).toBe(4); // 2 grass credited
    expect(after.balances.get(AI_TID)).toBe(0); // AI gated until round 3
  });

  it("round 3: AI now credited too", async () => {
    const after = await runAiPhase(makeBoard(), 3);
    expect(after.balances.get(AI_TID)).toBe(4); // AI credited from round 3
  });

  it("round 1: income suspended for everyone", async () => {
    const after = await runAiPhase(makeBoard(), 1);
    expect(after.balances.get(PLAYER_TID)).toBe(0);
    expect(after.balances.get(AI_TID)).toBe(0);
  });
});
