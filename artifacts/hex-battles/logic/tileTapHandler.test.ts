import { describe, it, expect, vi } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { handleTileTapLogic, type TileTapParams } from "@/logic/tileTapHandler";

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

function makeParams(overrides: Partial<TileTapParams> = {}): TileTapParams {
  const tiles = [makeTile(0, 0, "player")];
  const map = tileMap(tiles);
  return {
    key: "0,0",
    lastTileTapMs: { current: 0 },
    isAiTurn: false,
    gameResult: null,
    activeTileMap: map,
    selectedEntityKey: null,
    validMoveTiles: new Set(),
    armedEntityId: null,
    selectedTileKeys: new Set(),
    selectedTerritoryId: null,
    selectedTerritory: [],
    entities: new Map(),
    territoryBalances: new Map(),
    freeTowerUsedTiles: new Map(),
    turn: 2,
    graveyard: new Set(),
    ruins: new Set(),
    liveOwnerMap: new Map(),
    combatSpentUnits: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    validBridgePlacementTiles: new Set(),
    validPlacementAttackTiles: new Set(),
    ribbonOpen: false,
    cities: new Set(),
    setMutableTileMap: vi.fn(),
    setLiveOwnerMap: vi.fn(),
    setEntities: vi.fn(),
    setSpentUnits: vi.fn(),
    setCombatSpentUnits: vi.fn(),
    setPartialMoves: vi.fn(),
    setTerritoryBalances: vi.fn(),
    setSelectedEntityKey: vi.fn(),
    setSelectedTileKey: vi.fn(),
    setGraveyard: vi.fn(),
    setRuins: vi.fn(),
    setArmedEntityId: vi.fn(),
    setFreeTowerUsedTiles: vi.fn(),
    setCities: vi.fn(),
    checkWinLoss: vi.fn(),
    pushHistory: vi.fn(),
    triggerErrorFlash: vi.fn(),
    triggerUnitAnimation: vi.fn(),
    closeRibbon: vi.fn(),
    ...overrides,
  };
}

// ─── Guard conditions ─────────────────────────────────────────────────────────

describe("guard conditions", () => {
  it("does nothing when isAiTurn is true", () => {
    const params = makeParams({ isAiTurn: true });
    handleTileTapLogic(params);
    expect(params.setSelectedTileKey).not.toHaveBeenCalled();
  });

  it("does nothing when gameResult is set", () => {
    const params = makeParams({ gameResult: "victory" });
    handleTileTapLogic(params);
    expect(params.setSelectedTileKey).not.toHaveBeenCalled();
  });

  it("debounces rapid taps (< 50ms apart)", () => {
    const lastTileTapMs = { current: Date.now() }; // just tapped
    const params = makeParams({ lastTileTapMs });
    handleTileTapLogic(params);
    expect(params.setSelectedTileKey).not.toHaveBeenCalled();
  });
});

// ─── Entity selection ─────────────────────────────────────────────────────────

describe("entity selection", () => {
  it("selects a player unit by setting selectedEntityKey", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "0,0",
      activeTileMap: tileMap(tiles),
      entities: ents([["0,0", "simple_unit"]]),
    });
    handleTileTapLogic(params);
    expect(params.setSelectedEntityKey).toHaveBeenCalledWith("0,0");
  });

  it("deselects when tapping the already-selected entity", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "0,0",
      selectedEntityKey: "0,0",
      activeTileMap: tileMap(tiles),
      entities: ents([["0,0", "simple_unit"]]),
    });
    handleTileTapLogic(params);
    expect(params.setSelectedEntityKey).toHaveBeenCalledWith(null);
  });

  it("cannot select a rebel unit (entityKey stays null, not rebel tile)", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "0,0",
      activeTileMap: tileMap(tiles),
      entities: ents([["0,0", "rebel"]]),
    });
    handleTileTapLogic(params);
    // setSelectedEntityKey may be called to clear previous selection (null), but NOT with "0,0"
    const calls = (params.setSelectedEntityKey as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([arg]) => arg !== "0,0")).toBe(true);
  });

  it("cannot select a city (entityKey stays null, not city tile)", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "0,0",
      activeTileMap: tileMap(tiles),
      entities: ents([["0,0", "city"]]),
    });
    handleTileTapLogic(params);
    const calls = (params.setSelectedEntityKey as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([arg]) => arg !== "0,0")).toBe(true);
  });

  it("cannot select an enemy unit (setSelectedEntityKey not called with tile key)", () => {
    const tiles = [makeTile(0, 0, "ai1")];
    const params = makeParams({
      key: "0,0",
      activeTileMap: tileMap(tiles),
      entities: ents([["0,0", "simple_unit"]]),
    });
    handleTileTapLogic(params);
    const calls = (params.setSelectedEntityKey as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([arg]) => arg !== "0,0")).toBe(true);
  });
});

// ─── Unit move ────────────────────────────────────────────────────────────────

describe("unit move", () => {
  it("moves unit when tapping a valid move tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "simple_unit"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
      setMutableTileMap: vi.fn(),
      setEntities: vi.fn(),
    });
    handleTileTapLogic(params);
    expect(params.pushHistory).toHaveBeenCalled();
    expect(params.setEntities).toHaveBeenCalled();
  });

  it("does NOT mark unit spent after a non-combat partial move; records remaining moves", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "simple_unit"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const setSpentUnits = params.setSpentUnits as ReturnType<typeof vi.fn>;
    const spent: Set<string> = setSpentUnits.mock.calls[0][0];
    expect(spent.has("1,0")).toBe(false);
    // simple_unit has 3 movement; a 1-step move leaves 2 remaining at the destination
    const setPartialMoves = params.setPartialMoves as ReturnType<typeof vi.fn>;
    const partial: Map<string, number> = setPartialMoves.mock.calls[0][0];
    expect(partial.get("1,0")).toBe(2);
  });

  it("marks unit spent when a non-combat move exhausts its remaining moves", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "simple_unit"]]),
      // Only 1 move left → a 1-step move exhausts it
      partialMoves: new Map([["0,0", 1]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const setSpentUnits = params.setSpentUnits as ReturnType<typeof vi.fn>;
    const spent: Set<string> = setSpentUnits.mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
    const setPartialMoves = params.setPartialMoves as ReturnType<typeof vi.fn>;
    const partial: Map<string, number> = setPartialMoves.mock.calls[0][0];
    expect(partial.has("1,0")).toBe(false);
  });

  it("marks unit spent when capturing an empty enemy tile (combat)", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "simple_unit"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    const setSpentUnits = params.setSpentUnits as ReturnType<typeof vi.fn>;
    const spent: Set<string> = setSpentUnits.mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
  });

  it("marks move as combat when capturing an enemy tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "simple_unit"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    expect(params.setCombatSpentUnits).toHaveBeenCalled();
    const combatSpent = (params.setCombatSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(combatSpent.has("1,0")).toBe(true);
  });

  it("does NOT mark move as combat when moving to own bridge tile", () => {
    const tiles = [
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "lake"),
    ];
    const map = tileMap(tiles);
    const entityMap = ents([["0,0", "simple_unit"], ["1,0", "bridge"]]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: entityMap,
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const combatSpent = (params.setCombatSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(combatSpent.has("1,0")).toBe(false);
  });

  it("merges two units when moving onto an allied unit with combined strength <= 3", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const map = tileMap(tiles);
    const entityMap = ents([["0,0", "simple_unit"], ["1,0", "simple_unit"]]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: entityMap,
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const setEntities = params.setEntities as ReturnType<typeof vi.fn>;
    // setEntities is called at least once; the merged unit should be in the map
    expect(setEntities).toHaveBeenCalled();
    const newEntities: Map<string, EntityType> = setEntities.mock.calls[0][0];
    // After merge: "0,0" (source) is gone, "1,0" has the merged unit
    expect(newEntities.has("0,0")).toBe(false);
    expect(newEntities.get("1,0")).toBe("advanced_unit");
  });
});

// ─── Armed entity placement (own territory) ───────────────────────────────────

describe("armed entity placement on own territory", () => {
  it("places an entity when affordable", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "simple_unit",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 20]]),
    });
    handleTileTapLogic(params);
    expect(params.pushHistory).toHaveBeenCalled();
    expect(params.setEntities).toHaveBeenCalled();
  });

  it("triggers error flash when placement is not affordable", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "expert_unit",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 0]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
    expect(params.pushHistory).not.toHaveBeenCalled();
  });

  it("triggers error flash when placing on an already occupied tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "simple_unit",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: ents([["1,0", "tower"]]),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
  });

  it("free tower on turn 1 does not deduct cost", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      turn: 1,
      activeTileMap: tileMap(tiles),
      armedEntityId: "tower",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 5]]),
      freeTowerUsedTiles: new Map(),
    });
    handleTileTapLogic(params);
    // With free tower, setTerritoryBalances called with cost=0 deducted
    const setBalances = params.setTerritoryBalances as ReturnType<typeof vi.fn>;
    expect(setBalances).toHaveBeenCalled();
    const updater = setBalances.mock.calls[0][0];
    const prev = new Map([["0,0", 5]]);
    const result = updater(prev);
    expect(result.get("0,0")).toBe(5); // no deduction for free tower
  });

  it("cannot place a tower on a city tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "tower",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      cities: new Set(["1,0"]),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
    expect(params.setEntities).not.toHaveBeenCalled();
  });

  it("cannot place a castle on a city tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "castle",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      cities: new Set(["1,0"]),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
    expect(params.setEntities).not.toHaveBeenCalled();
  });

  it("can still place a unit on an empty city tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "simple_unit",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      cities: new Set(["1,0"]),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).not.toHaveBeenCalled();
    expect(params.setEntities).toHaveBeenCalled();
  });

  it("cannot place on a lake tile without a bridge", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player", "lake")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player", "lake")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "simple_unit",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
  });
});

// ─── Armed entity attack (outside own territory) ──────────────────────────────

describe("armed entity attack outside own territory", () => {
  it("captures enemy tile when affordable", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const territory = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "simple_unit",
      validPlacementAttackTiles: new Set(["1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 20]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    expect(params.pushHistory).toHaveBeenCalled();
    expect(params.setMutableTileMap).toHaveBeenCalled();
  });

  it("triggers error flash when not affordable", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const territory = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "expert_unit",
      validPlacementAttackTiles: new Set(["1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 0]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
  });
});

// ─── Tile selection (own territory, no entity) ────────────────────────────────

describe("tile selection", () => {
  it("selects a player tile with no entity", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "0,0",
      activeTileMap: tileMap(tiles),
      entities: new Map(),
    });
    handleTileTapLogic(params);
    expect(params.setSelectedTileKey).toHaveBeenCalledWith("0,0");
  });

  it("deselects when re-tapping already selected own tile", () => {
    const tiles = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "0,0",
      activeTileMap: tileMap(tiles),
      selectedTileKeys: new Set(["0,0"]),
      entities: new Map(),
    });
    handleTileTapLogic(params);
    expect(params.setSelectedTileKey).toHaveBeenCalledWith(null);
  });

  it("clears selection when tapping a non-player tile", () => {
    const tiles = [makeTile(0, 0, "ai1")];
    const params = makeParams({
      key: "0,0",
      activeTileMap: tileMap(tiles),
      entities: new Map(),
    });
    handleTileTapLogic(params);
    expect(params.setSelectedTileKey).toHaveBeenCalledWith(null);
  });
});
