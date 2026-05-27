import { describe, it, expect, vi, beforeEach } from "vitest";
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

function ents(pairs: [string, EntityType][]): Map<string, EntityType> {
  return new Map(pairs);
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
    aiOwners: ["ai1"],
    aiDifficulty: "medium",
    graveyard: new Set(),
    ruins: new Set(),
    mutableTileMap: new Map(map),
    liveOwnerMap: new Map(),
    aiTurnRef: { current: false },
    setMoveHistory: vi.fn(),
    setTerritoryBalances: vi.fn(),
    setEntities: vi.fn(),
    setGraveyard: vi.fn(),
    setRuins: vi.fn(),
    setTurn: vi.fn(),
    setSelectedTileKey: vi.fn(),
    setArmedEntityId: vi.fn(),
    setSelectedEntityKey: vi.fn(),
    setSpentUnits: vi.fn(),
    setCombatSpentUnits: vi.fn(),
    setPartialMoves: vi.fn(),
    setIsAiTurn: vi.fn(),
    checkWinLoss: vi.fn().mockReturnValue(false),
    runAiTurn: vi.fn(),
    closeRibbon: vi.fn(),
    ...overrides,
  };
}

// ─── Guard conditions ─────────────────────────────────────────────────────────

describe("handleEndTurnLogic guard conditions", () => {
  it("does nothing when isAiTurn is true", () => {
    const params = makeParams({ isAiTurn: true });
    handleEndTurnLogic(params);
    expect(params.setTurn).not.toHaveBeenCalled();
  });

  it("does nothing when gameResult is not null", () => {
    const params = makeParams({ gameResult: "victory" });
    handleEndTurnLogic(params);
    expect(params.setTurn).not.toHaveBeenCalled();
  });

  it("increments the turn counter", () => {
    const params = makeParams({ turn: 3 });
    handleEndTurnLogic(params);
    const setter = params.setTurn as ReturnType<typeof vi.fn>;
    const updater = setter.mock.calls[0][0];
    expect(updater(3)).toBe(4);
  });
});

// ─── Round 1 income suspension ────────────────────────────────────────────────

describe("round 1 income suspension", () => {
  it("does not change balances in round 1 (income suspended)", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 1,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      territoryBalances: new Map([["0,0", 5]]),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newBalances.get("0,0")).toBe(5);
  });
});

// ─── Income and upkeep (turn > 1) ────────────────────────────────────────────

describe("income and upkeep", () => {
  it("adds grass tile income (2) to player territory balance", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      territoryBalances: new Map([["0,0", 10]]),
      entities: new Map(),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // balance 10 + grass income 2 - upkeep 0 = 12
    expect(newBalances.get("0,0")).toBe(12);
  });

  it("deducts unit upkeep from player territory balance", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      territoryBalances: new Map([["0,0", 10]]),
      entities: ents([["0,0", "simple_unit"]]),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // balance 10 + grass income 2 - simple_unit upkeep 3 = 9
    expect(newBalances.get("0,0")).toBe(9);
  });

  it("adds city bonus to income", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      territoryBalances: new Map([["0,0", 0]]),
      entities: new Map(),
      cities: new Set(["0,0"]),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // grass 2 + city bonus 2 = 4 income, 0 upkeep → balance = 4
    expect(newBalances.get("0,0")).toBe(4);
  });
});

// ─── Bankruptcy — unit liquidation ───────────────────────────────────────────

describe("bankruptcy — unit liquidation", () => {
  it("kills player units when territory goes bankrupt (balance drains to 0)", () => {
    // Desert tile (income=1) with expert_unit (upkeep=27) — delta is negative
    const tiles = [makeTile(0, 0, "player", "desert")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      territoryBalances: new Map([["0,0", 0]]),
      entities: ents([["0,0", "expert_unit"]]),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newEntities = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newGraveyard = (params.setGraveyard as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newBalances.get("0,0")).toBe(0);
    expect(newEntities.has("0,0")).toBe(false);
    expect(newGraveyard.has("0,0")).toBe(true);
  });

  it("drains player reserves to 0 on bankruptcy", () => {
    // Grass tile (income=2) with advanced_unit (upkeep=9) — delta = -7.
    // Reserve of 5 + income 2 = 7g available, can't cover 9g upkeep → bankrupt,
    // balance lands at 0, unit liquidated.
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      territoryBalances: new Map([["0,0", 5]]),
      entities: ents([["0,0", "advanced_unit"]]),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newEntities = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newBalances.get("0,0")).toBe(0);
    expect(newEntities.has("0,0")).toBe(false);
  });

  it("drains AI reserves to 0 on bankruptcy", () => {
    const tiles = [makeTile(0, 0, "ai1")];
    const params = makeParams({
      turn: 3,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      aiOwners: ["ai1"],
      aiDifficulty: "medium",
      territoryBalances: new Map([["0,0", 5]]),
      entities: ents([["0,0", "advanced_unit"]]),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newEntities = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newBalances.get("0,0")).toBe(0);
    expect(newEntities.has("0,0")).toBe(false);
  });

  it("does not trigger bankruptcy when reserves cover the deficit", () => {
    // Grass (income=2), simple_unit (upkeep=3) → delta = -1. Reserve 100g
    // easily covers → balance drops to 99, no bankruptcy, unit survives.
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      territoryBalances: new Map([["0,0", 100]]),
      entities: ents([["0,0", "simple_unit"]]),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newEntities = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newBalances.get("0,0")).toBe(99);
    expect(newEntities.has("0,0")).toBe(true);
  });

  it("demolishes buildings when units alone cannot cover the deficit", () => {
    // Desert (income=1), castle upkeep for 1 castle = 5 → net -4. No units to kill.
    const tiles = [makeTile(0, 0, "player", "desert")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      territoryBalances: new Map([["0,0", 0]]),
      entities: ents([["0,0", "castle"]]),
    });
    handleEndTurnLogic(params);
    const newEntities = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newRuins = (params.setRuins as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newEntities.has("0,0")).toBe(false);
    expect(newRuins.has("0,0")).toBe(true);
  });

  it("clears UI state on end turn", () => {
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

// ─── AI income (turn !== 1) ──────────────────────────────────────────────────

describe("AI income", () => {
  it("AI earns income from turn 2 onwards (same cadence as player)", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(5, 5, "ai1")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      aiOwners: ["ai1"],
      aiDifficulty: "medium",
      territoryBalances: new Map([["0,0", 0], ["5,5", 0]]),
      entities: new Map(),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // ai1 grass tile income = 2
    expect(newBalances.get("5,5")).toBe(2);
  });

  it("AI does NOT earn income in turn 1 (income suspended for both sides)", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(5, 5, "ai1")];
    const params = makeParams({
      turn: 1,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      aiOwners: ["ai1"],
      aiDifficulty: "medium",
      territoryBalances: new Map([["0,0", 0], ["5,5", 10]]),
      entities: new Map(),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // AI balance unchanged in turn 1
    expect(newBalances.get("5,5")).toBe(10);
  });

  it("super_hard AI gets bonus income equal to landTileCount", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(5, 5, "ai1")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      aiOwners: ["ai1"],
      aiDifficulty: "super_hard",
      territoryBalances: new Map([["0,0", 0], ["5,5", 0]]),
      entities: new Map(),
    });
    handleEndTurnLogic(params);
    const newBalances = (params.setTerritoryBalances as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // grass income 2 + 1 land tile bonus = 3
    expect(newBalances.get("5,5")).toBe(3);
  });
});

// ─── Rebel spawning ───────────────────────────────────────────────────────────

describe("rebel spawning", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 0 < any positive chance → spawns
  });

  it("spawns rebel on graveyard tile when random < 0.75 (mocked to 0)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      graveyard: new Set(["0,0"]),
      entities: new Map(),
    });
    handleEndTurnLogic(params);
    const newEntities = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newEntities.get("0,0")).toBe("rebel");
  });

  it("does NOT spawn rebel on graveyard tile when random >= 0.75 (mocked)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.8);
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 2,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      graveyard: new Set(["0,0"]),
      entities: new Map(),
    });
    handleEndTurnLogic(params);
    const newEntities = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newEntities.get("0,0")).toBeUndefined();
  });

  it("does not spawn rebel in round 1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      turn: 1,
      activeTileMap: tileMap(tiles),
      mutableTileMap: tileMap(tiles),
      graveyard: new Set(["0,0"]),
      entities: new Map(),
    });
    handleEndTurnLogic(params);
    const newEntities = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newEntities.get("0,0")).toBeUndefined();
  });
});

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
