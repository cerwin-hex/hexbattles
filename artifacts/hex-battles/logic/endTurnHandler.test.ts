import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { handleEndTurnLogic, type EndTurnParams } from "@/logic/endTurnHandler";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

function tileMap(tiles: HexTile[]): Map<string, HexTile> {
  return new Map(tiles.map((t) => [t.key, t]));
}

function makeParams(overrides: Partial<EndTurnParams> = {}): EndTurnParams {
  const tiles = [makeTile(0, 0, "player")];
  const map = tileMap(tiles);
  return {
    isAiTurn: false,
    gameResult: null,
    territoryBalances: new Map([["0,0", 10]]),
    entities: new Map(),
    turn: 2,
    activeTileMap: map,
    cities: new Set(),
    graveyard: new Set(),
    ruins: new Set(),
    armedGraveyard: new Set(),
    armedRuins: new Set(),
    mutableTileMap: new Map(map),
    liveOwnerMap: new Map(),
    aiTurnRef: { current: false },
    setMoveHistory: vi.fn(),
    setMutableTileMap: vi.fn(),
    setTerritoryBalances: vi.fn(),
    setEntities: vi.fn(),
    setGraveyard: vi.fn(),
    setRuins: vi.fn(),
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
    ...overrides,
  };
}

// NOTE: the per-owner economy (income / upkeep / bankruptcy) is no longer applied
// in `handleEndTurnLogic`. It now runs once per owner at the start of that
// owner's turn, inside `runAiTurn` via `applyOwnerEconomy`. The economy itself is
// unit-tested in gameLogic.test.ts (`applyOwnerEconomy`) and end-to-end in
// economyBankruptcy.test.ts (the full player round + income cadence). This file
// covers only what `handleEndTurnLogic` still owns: guard conditions, rebel
// spawning, UI-state reset, and the AI hand-off.

// ─── Guard conditions ─────────────────────────────────────────────────────────

describe("handleEndTurnLogic guard conditions", () => {
  it("does nothing when isAiTurn is true", () => {
    const params = makeParams({ isAiTurn: true });
    handleEndTurnLogic(params);
    expect(params.setMoveHistory).not.toHaveBeenCalled();
  });

  it("does nothing when gameResult is not null", () => {
    const params = makeParams({ gameResult: "victory" });
    handleEndTurnLogic(params);
    expect(params.setMoveHistory).not.toHaveBeenCalled();
  });

  // Note: the round counter is no longer advanced here — it advances when the AI
  // phase completes (see aiStrategy.runAiTurn → cbs.state.advanceTurn). That
  // behaviour is covered in logic/aiStrategy.test.ts.
});

// ─── UI-state reset ───────────────────────────────────────────────────────────

describe("UI-state reset", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // suppress rebel spawning
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears selection / spent / partial-move state on end turn", () => {
    const params = makeParams({ turn: 2 });
    handleEndTurnLogic(params);
    expect(params.setSelectedTileKey).toHaveBeenCalledWith(null);
    expect(params.setArmedEntityId).toHaveBeenCalledWith(null);
    expect(params.setSelectedEntityKey).toHaveBeenCalledWith(null);
    expect(params.setSpentUnits).toHaveBeenCalledWith(new Set());
    expect(params.setCombatSpentUnits).toHaveBeenCalledWith(new Set());
    expect(params.setPartialMoves).toHaveBeenCalledWith(new Map());
  });
});

// Rebel spawning moved out of handleEndTurnLogic — it now runs once per round at
// the END of the AI phase (after every owner has moved), inside runAiTurn via
// `spawnRebelsForOwner`. The spawn logic is unit-tested in rebelSpawn.test.ts.

// ─── AI turn hand-off ─────────────────────────────────────────────────────────

describe("AI turn hand-off", () => {
  it("calls runAiTurn after a normal end-turn", () => {
    const params = makeParams({ turn: 2, checkWinLoss: vi.fn().mockReturnValue(false) });
    handleEndTurnLogic(params);
    expect(params.setIsAiTurn).toHaveBeenCalledWith(true);
    expect(params.runAiTurn).toHaveBeenCalled();
  });

  it("does NOT call runAiTurn when checkWinLoss returns true (game over)", () => {
    const params = makeParams({ turn: 2, checkWinLoss: vi.fn().mockReturnValue(true) });
    handleEndTurnLogic(params);
    expect(params.runAiTurn).not.toHaveBeenCalled();
  });
});
