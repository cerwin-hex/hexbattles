import { describe, it, expect, vi } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { handleTileTapLogic, type TileTapParams } from "@/logic/tileTapHandler";
import { ALL_GAME_ELEMENTS } from "@/constants/gameElements";

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
    killMarks: new Set(),
    firedUnits: new Set(),
    validRangedTargets: new Set(),
    liveOwnerMap: new Map(),
    combatSpentUnits: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    attacksUsed: new Map(),
    validBridgePlacementTiles: new Set(),
    validImprovementTiles: new Set(),
    armedImprovement: null,
    setArmedImprovement: vi.fn(),
    validPlacementAttackTiles: new Set(),
    ribbonOpen: false,
    cities: new Set(),
    improvedCities: new Set(),
    setImprovedCities: vi.fn(),
    setMutableTileMap: vi.fn(),
    setLiveOwnerMap: vi.fn(),
    setEntities: vi.fn(),
    setSpentUnits: vi.fn(),
    setCombatSpentUnits: vi.fn(),
    setPartialMoves: vi.fn(),
    setAttacksUsed: vi.fn(),
    setTerritoryBalances: vi.fn(),
    setSelectedEntityKey: vi.fn(),
    setSelectedTileKey: vi.fn(),
    setGraveyard: vi.fn(),
    setRuins: vi.fn(),
    setKillMarks: vi.fn(),
    setFiredUnits: vi.fn(),
    setArmedEntityId: vi.fn(),
    setFreeTowerUsedTiles: vi.fn(),
    setCities: vi.fn(),
    checkWinLoss: vi.fn(),
    pushHistory: vi.fn(),
    triggerErrorFlash: vi.fn(),
    // A real move defers its board commit to the slide's onDone callback; invoke
    // it synchronously here so the deferred commit runs within the test.
    triggerUnitAnimation: vi.fn(
      (_from, _to, _entity, _owner, _hideDestination, onDone?: () => void) =>
        onDone?.(),
    ),
    closeRibbon: vi.fn(),
    elements: ALL_GAME_ELEMENTS,
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
      entities: ents([["0,0", "peasant"]]),
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
      entities: ents([["0,0", "peasant"]]),
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
      entities: ents([["0,0", "peasant"]]),
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
      entities: ents([["0,0", "peasant"]]),
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
      entities: ents([["0,0", "peasant"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const setSpentUnits = params.setSpentUnits as ReturnType<typeof vi.fn>;
    const spent: Set<string> = setSpentUnits.mock.calls[0][0];
    expect(spent.has("1,0")).toBe(false);
    // peasant has 3 movement; a 1-step move leaves 2 remaining at the destination
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
      entities: ents([["0,0", "peasant"]]),
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
      entities: ents([["0,0", "peasant"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    const setSpentUnits = params.setSpentUnits as ReturnType<typeof vi.fn>;
    const spent: Set<string> = setSpentUnits.mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
  });

  it("clears grave and ruin markers for good when a unit steps onto the tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "neutral")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "peasant"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "neutral"]]),
      graveyard: new Set(["1,0"]),
      ruins: new Set(["1,0"]),
    });
    handleTileTapLogic(params);
    const newGrave: Set<string> = (params.setGraveyard as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newRuins: Set<string> = (params.setRuins as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(newGrave.has("1,0")).toBe(false);
    expect(newRuins.has("1,0")).toBe(false);
  });

  it("capturing a neutral tile counts as combat and spends an infantry unit", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "neutral")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "peasant"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "neutral"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Previously a neutral capture was a free move; it is now combat → spent.
    expect(spent.has("1,0")).toBe(true);
    const combatSpent: Set<string> = (params.setCombatSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(combatSpent.has("1,0")).toBe(true);
  });

  it("a cavalry unit capturing a neutral tile spends one attack but stays active", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "neutral")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "knight"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "neutral"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(false);
    const attacksUsed: Map<string, number> = (params.setAttacksUsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(attacksUsed.get("1,0")).toBe(1);
  });

  it("marks move as combat when capturing an enemy tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "peasant"]]),
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
    const entityMap = ents([["0,0", "peasant"], ["1,0", "bridge"]]);
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
    const entityMap = ents([["0,0", "peasant"], ["1,0", "peasant"]]);
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
    expect(newEntities.get("1,0")).toBe("warrior");
  });

  // ─── Cavalry charge ability (maxAttacks > 1) ─────────────────────────────────

  it("charge unit is NOT spent after its first attack and records one attack used", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "knight"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    // Knight has 5 movement + 2 attacks. First attack costs 1 step → still active.
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(false);
    const combatSpent = (params.setCombatSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(combatSpent.has("1,0")).toBe(false);
    const attacksUsed: Map<string, number> = (params.setAttacksUsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(attacksUsed.get("1,0")).toBe(1);
    // 1 step used out of 5 → 4 remaining recorded at destination
    const partial: Map<string, number> = (params.setPartialMoves as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(partial.get("1,0")).toBe(4);
  });

  it("a cavalry strike on an enemy unit combat-locks it but does not spend it", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      // (1,0) holds an enemy defender → this move is a strike, not an open capture.
      entities: ents([["0,0", "knight"], ["1,0", "peasant"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(false); // can still ride on to one open tile
    const combatSpent = (params.setCombatSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(combatSpent.has("1,0")).toBe(true); // but no second strike
    const attacksUsed: Map<string, number> = (params.setAttacksUsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(attacksUsed.get("1,0")).toBe(1);
  });

  it("a cavalry open capture does NOT combat-lock it (free to strike later)", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      // (1,0) is an empty enemy tile → an open capture, not a strike.
      entities: ents([["0,0", "knight"]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    const combatSpent = (params.setCombatSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(combatSpent.has("1,0")).toBe(false);
  });

  it("charge unit IS spent on its second attack", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "knight"]]),
      // Already used one attack, plenty of movement left
      attacksUsed: new Map([["0,0", 1]]),
      partialMoves: new Map([["0,0", 4]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
    const combatSpent = (params.setCombatSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(combatSpent.has("1,0")).toBe(true);
  });

  it("charge unit IS spent on its first attack when movement is exhausted reaching the enemy", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const map = tileMap(tiles);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "scout"]]),
      // Only 1 move left → the attack step exhausts the shared budget
      partialMoves: new Map([["0,0", 1]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
  });

  it("does NOT merge a cavalry unit onto an allied unit (overwrite-protection via combat)", () => {
    // A knight moving onto an allied peasant must NOT merge into a Swordsman.
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const map = tileMap(tiles);
    const entityMap = ents([["0,0", "knight"], ["1,0", "peasant"]]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      // validMoveTiles intentionally allows the tap; the handler must treat it as
      // a non-merge move and keep the knight as a distinct entity.
      validMoveTiles: new Set(["1,0"]),
      entities: entityMap,
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const newEntities: Map<string, EntityType> = (params.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // No merge → no Swordsman is ever produced.
    expect([...newEntities.values()]).not.toContain("swordsman");
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
      armedEntityId: "peasant",
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
      armedEntityId: "swordsman",
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

  it("a cavalry unit bought directly onto a rebel is NOT spent and keeps a second attack", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "scout",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: ents([["1,0", "rebel"]]),
      territoryBalances: new Map([["0,0", 60]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(false);
    const attacksUsed: Map<string, number> = (params.setAttacksUsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(attacksUsed.get("1,0")).toBe(1);
  });

  it("a regular infantry unit bought directly onto a rebel is spent immediately", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "peasant",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: ents([["1,0", "rebel"]]),
      territoryBalances: new Map([["0,0", 60]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
  });

  // The armed-placement branch is the fifth and last canCapture gate (the other
  // four live in getValidMoves and getPlacementAttackTiles, covered in
  // utils/hexGrid.test.ts). A ranged unit takes no ground, so buying one onto an
  // occupied tile must never clear the occupant. Each case pairs the ranged
  // assertion with the peasant that DOES overwrite, so the test fails if the
  // flash ever comes from something other than the class gate.
  it("a ranged unit bought onto a rebel does not overwrite it", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const base = {
      key: "1,0",
      activeTileMap: tileMap(tiles),
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: ents([["1,0", "rebel"]]),
      // Ample balance: a ranged unit must be refused by canOverwriteRebel, not
      // by affordability.
      territoryBalances: new Map([["0,0", 100]]),
    };

    const ranged = makeParams({ ...base, armedEntityId: "shortbowman" });
    handleTileTapLogic(ranged);
    expect(ranged.triggerErrorFlash).toHaveBeenCalledWith("1,0");
    expect(ranged.pushHistory).not.toHaveBeenCalled();
    expect(ranged.setEntities).not.toHaveBeenCalled();

    // Contrast: a capturing unit on the same board does clear the rebel.
    const melee = makeParams({ ...base, armedEntityId: "peasant" });
    handleTileTapLogic(melee);
    expect(melee.setEntities).toHaveBeenCalled();
    const after: Map<string, EntityType> = (melee.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(after.get("1,0")).toBe("peasant");
  });

  it("a ranged unit bought onto a non-own building does not overwrite it", () => {
    // A non-player tile inside selectedTileKeys is the only shape in which
    // canOverwriteBuilding can fire at all (an own-territory building is
    // excluded by existingBuildingIsOwn), so the board is constructed rather
    // than reachable in normal play — the gate itself is what is under test.
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const territory = [makeTile(0, 0, "player")];
    const base = {
      key: "1,0",
      activeTileMap: tileMap(tiles),
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: ents([["1,0", "tower"]]),
      territoryBalances: new Map([["0,0", 100]]),
      liveOwnerMap: new Map<string, TerritoryOwner>([["0,0", "player"], ["1,0", "ai1"]]),
    };

    const ranged = makeParams({ ...base, armedEntityId: "shortbowman" });
    handleTileTapLogic(ranged);
    expect(ranged.triggerErrorFlash).toHaveBeenCalledWith("1,0");
    expect(ranged.pushHistory).not.toHaveBeenCalled();
    expect(ranged.setEntities).not.toHaveBeenCalled();

    // Contrast: a peasant (off 1 ≥ tower def 1) does demolish it.
    const melee = makeParams({ ...base, armedEntityId: "peasant" });
    handleTileTapLogic(melee);
    expect(melee.setEntities).toHaveBeenCalled();
    const after: Map<string, EntityType> = (melee.setEntities as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(after.get("1,0")).toBe("peasant");
  });

  it("triggers error flash when placing on an already occupied tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "peasant",
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
      armedEntityId: "peasant",
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
      armedEntityId: "peasant",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
  });

  it("cannot buy a ranged unit onto a rebel in our own territory", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "shortbowman",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: tiles,
      entities: new Map([["1,0", "rebel"]]),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
    expect(params.setEntities).not.toHaveBeenCalled();
  });

  it("founds a city on an improved (field) tile and removes the improvement", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player", "field")];
    const territory = [
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "field"),
    ];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "city",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).not.toHaveBeenCalled();
    expect(params.setCities).toHaveBeenCalled();
    // The field reverts to grass when the city is founded on it.
    expect(params.setMutableTileMap).toHaveBeenCalled();
    const reverted = (params.setMutableTileMap as ReturnType<typeof vi.fn>).mock
      .calls.at(-1)![0] as Map<string, HexTile>;
    expect(reverted.get("1,0")?.terrain).toBe("grass");
  });

  it("founds a tower on an improved (sawmill) tile and removes the improvement", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player", "sawmill")];
    const territory = [
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "sawmill"),
    ];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "tower",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 100]]),
      turn: 5,
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).not.toHaveBeenCalled();
    expect(params.setEntities).toHaveBeenCalled();
    expect(params.setMutableTileMap).toHaveBeenCalled();
    const reverted = (params.setMutableTileMap as ReturnType<typeof vi.fn>).mock
      .calls.at(-1)![0] as Map<string, HexTile>;
    expect(reverted.get("1,0")?.terrain).toBe("forest");
  });

  it("can found a city on a plain grass tile", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const territory = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "city",
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 100]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).not.toHaveBeenCalled();
    expect(params.setCities).toHaveBeenCalled();
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
      armedEntityId: "peasant",
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
      armedEntityId: "swordsman",
      validPlacementAttackTiles: new Set(["1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 0]]),
    });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("1,0");
  });

  it("a cavalry unit bought into an attack is NOT spent and keeps a second attack", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const territory = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "knight",
      validPlacementAttackTiles: new Set(["1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 60]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(false);
    const combatSpent: Set<string> = (params.setCombatSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(combatSpent.has("1,0")).toBe(false);
    const attacksUsed: Map<string, number> = (params.setAttacksUsed as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(attacksUsed.get("1,0")).toBe(1);
  });

  it("a regular infantry unit bought into an attack is spent immediately", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "ai1")];
    const territory = [makeTile(0, 0, "player")];
    const params = makeParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      armedEntityId: "peasant",
      validPlacementAttackTiles: new Set(["1,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: territory,
      entities: new Map(),
      territoryBalances: new Map([["0,0", 60]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (params.setSpentUnits as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
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

// ─── Improvement placement ────────────────────────────────────────────────────

describe("improvement placement", () => {
  function improveParams(overrides: Partial<TileTapParams> = {}): TileTapParams {
    const tiles = [makeTile(0, 0, "player", "grass"), makeTile(1, 0, "player", "grass")];
    const map = tileMap(tiles);
    return makeParams({
      key: "0,0",
      activeTileMap: map,
      selectedTerritory: tiles,
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      territoryBalances: new Map([["0,0", 10]]),
      cities: new Set(["1,0"]),
      armedImprovement: "field",
      validImprovementTiles: new Set(["0,0"]),
      ...overrides,
    });
  }

  it("changes the terrain and debits the cost", () => {
    const params = improveParams();
    handleTileTapLogic(params);
    const written = vi.mocked(params.setMutableTileMap).mock.calls[0][0];
    expect(written.get("0,0")?.terrain).toBe("field");
    const balanceUpdater = vi.mocked(params.setTerritoryBalances).mock.calls[0][0];
    const nextBalances =
      typeof balanceUpdater === "function"
        ? balanceUpdater(params.territoryBalances)
        : balanceUpdater;
    expect(nextBalances.get("0,0")).toBe(8); // 10 − field cost 2
  });

  it("pushes history, clears the armed improvement and closes the ribbon", () => {
    const params = improveParams();
    handleTileTapLogic(params);
    expect(params.pushHistory).toHaveBeenCalled();
    expect(params.setArmedImprovement).toHaveBeenCalledWith(null);
    expect(params.closeRibbon).toHaveBeenCalled();
  });

  it("leaves units and spent units untouched when building under a unit", () => {
    const params = improveParams({ entities: ents([["0,0", "swordsman"]]) });
    handleTileTapLogic(params);
    expect(params.setEntities).not.toHaveBeenCalled();
    expect(params.setSpentUnits).not.toHaveBeenCalled();
    const written = vi.mocked(params.setMutableTileMap).mock.calls[0][0];
    expect(written.get("0,0")?.terrain).toBe("field");
  });

  it("flashes an error and builds nothing when the territory cannot afford it", () => {
    const params = improveParams({ territoryBalances: new Map([["0,0", 1]]) });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("0,0");
  });

  it("flashes an error when the territory has no city", () => {
    const params = improveParams({ cities: new Set() });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("0,0");
  });

  it("does not build on a tile outside validImprovementTiles", () => {
    const params = improveParams({ key: "1,0", validImprovementTiles: new Set(["0,0"]) });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
  });

  it("refuses an improvement when improvements are off", () => {
    const params = improveParams({
      elements: { ...ALL_GAME_ELEMENTS, improvements: false },
    });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.setTerritoryBalances).not.toHaveBeenCalled();
  });

  it("flashes an error when the tile is more than two tiles from any city", () => {
    const tiles = [
      makeTile(0, 0, "player", "grass"),
      makeTile(1, 0, "player", "grass"),
      makeTile(2, 0, "player", "grass"),
      makeTile(3, 0, "player", "grass"),
    ];
    const params = improveParams({
      key: "3,0",
      activeTileMap: tileMap(tiles),
      selectedTerritory: tiles,
      selectedTileKeys: new Set(["0,0", "1,0", "2,0", "3,0"]),
      cities: new Set(["0,0"]),
      validImprovementTiles: new Set(["3,0"]),
    });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("3,0");
  });

  it("flashes an error when the only city in range already built this turn", () => {
    const params = improveParams({ improvedCities: new Set(["1,0"]) });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("0,0");
  });

  it("charges a second improvement to another city in range", () => {
    const tiles = [
      makeTile(0, 0, "player", "grass"),
      makeTile(1, 0, "player", "grass"),
      makeTile(2, 0, "player", "grass"),
    ];
    const params = improveParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      selectedTerritory: tiles,
      selectedTileKeys: new Set(["0,0", "1,0", "2,0"]),
      cities: new Set(["0,0", "2,0"]),
      improvedCities: new Set(["0,0"]),
      validImprovementTiles: new Set(["1,0"]),
    });
    handleTileTapLogic(params);
    const written = vi.mocked(params.setMutableTileMap).mock.calls[0][0];
    expect(written.get("1,0")?.terrain).toBe("field");
    const updater = vi.mocked(params.setImprovedCities).mock.calls[0][0];
    const next =
      typeof updater === "function" ? updater(params.improvedCities) : updater;
    expect(next.has("2,0")).toBe(true);
  });
});

// ─── Founding a building on an improved tile ──────────────────────────────────
// Improvements are now bought from the Build ribbon rather than made by a
// peasant, so this pre-existing rule is far easier to hit: it guards the
// interaction between the two.

describe("building on an improved tile", () => {
  function buildParams(
    terrain: HexTile["terrain"],
    overrides: Partial<TileTapParams> = {},
  ): TileTapParams {
    const tiles = [makeTile(0, 0, "player", terrain), makeTile(1, 0, "player", "grass")];
    const map = tileMap(tiles);
    return makeParams({
      key: "0,0",
      activeTileMap: map,
      selectedTerritory: tiles,
      selectedTileKeys: new Set(["0,0", "1,0"]),
      selectedTerritoryId: "0,0",
      territoryBalances: new Map([["0,0", 50]]),
      armedEntityId: "tower",
      ...overrides,
    });
  }

  it("reverts a field to grass when a tower is founded on it", () => {
    const params = buildParams("field");
    handleTileTapLogic(params);
    const written = vi.mocked(params.setMutableTileMap).mock.calls[0][0];
    expect(written.get("0,0")?.terrain).toBe("grass");
  });

  it("reverts a sawmill to forest and a mine to desert", () => {
    const sawmill = buildParams("sawmill");
    handleTileTapLogic(sawmill);
    expect(
      vi.mocked(sawmill.setMutableTileMap).mock.calls[0][0].get("0,0")?.terrain,
    ).toBe("forest");

    const mine = buildParams("mine");
    handleTileTapLogic(mine);
    expect(
      vi.mocked(mine.setMutableTileMap).mock.calls[0][0].get("0,0")?.terrain,
    ).toBe("desert");
  });

  it("leaves unimproved terrain alone", () => {
    const params = buildParams("grass");
    handleTileTapLogic(params);
    // No terrain rewrite is needed, so the tile map is not republished at all.
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
  });
});

// ─── Ranged firing ────────────────────────────────────────────────────────────

describe("ranged firing", () => {
  // Player crossbowman on 0,0, enemy tile 1,0 held by an ai1 swordsman.
  function shotParams(overrides: Partial<TileTapParams> = {}) {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "ai1")]);
    return makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      entities: ents([["0,0", "crossbowman"], ["1,0", "swordsman"]]),
      validRangedTargets: new Set(["1,0"]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "ai1"]]),
      ...overrides,
    });
  }

  it("kills the target and marks the tile", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    const newEnts: Map<string, EntityType> = (
      params.setEntities as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(newEnts.has("1,0")).toBe(false);
    expect(newEnts.get("0,0")).toBe("crossbowman");
    const marks: Set<string> = (
      params.setKillMarks as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(marks.has("1,0")).toBe(true);
    expect(params.pushHistory).toHaveBeenCalled();
  });

  it("changes no tile ownership", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.setTerritoryBalances).not.toHaveBeenCalled();
  });

  it("spends the shot and clamps the movement, but does not spend the unit", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("0,0")).toBe(true);
    // Not spent: a clamped bowman still has a point to shuffle with, and a
    // bowman with no movement left may still fire next turn.
    expect(params.setSpentUnits).not.toHaveBeenCalled();
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.get("0,0")).toBe(1);
  });

  it("keeps the shooter selected so it can move away", () => {
    const params = shotParams();
    handleTileTapLogic(params);
    expect(params.setSelectedEntityKey).toHaveBeenCalledWith("0,0");
  });

  it("does not fire when the tile is not a legal target", () => {
    // An empty validRangedTargets is how a second shot in one turn is refused:
    // useSelectionState computes it from firedUnits.
    const params = shotParams({ validRangedTargets: new Set() });
    handleTileTapLogic(params);
    expect(params.setKillMarks).not.toHaveBeenCalled();
    expect(params.setFiredUnits).not.toHaveBeenCalled();
  });

  it("does not restore movement the shooter had already spent", () => {
    // Move-then-fire is not punished twice: 3 - 2 = 1 was already left.
    const params = shotParams({ partialMoves: new Map([["0,0", 1]]) });
    handleTileTapLogic(params);
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.get("0,0")).toBe(1);
  });

  it("leaves an exhausted shooter at zero", () => {
    const params = shotParams({ partialMoves: new Map([["0,0", 0]]) });
    handleTileTapLogic(params);
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.get("0,0")).toBe(0);
  });

  it("leaves an exhausted shooter at zero when it has no partialMoves entry at all", () => {
    // This is the state the app actually produces: a unit that spends its full
    // movement is tracked in spentUnits with its partialMoves entry DELETED
    // (see resolveMovedUnitMoves), not left at an explicit 0. Reading a missing
    // entry as "full budget" would hand a spent bowman a phantom point of
    // movement back merely because it fired.
    const params = shotParams({ spentUnits: new Set(["0,0"]) });
    handleTileTapLogic(params);
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.get("0,0")).toBe(0);
  });

  it("cannot refresh the clamped budget by merging into a fresh bowman", () => {
    // The bowman has fired (budget clamped to 1) and now steps onto an unmoved
    // ally. resolveMovedUnitMoves takes min(remainingAfterMove, destRemaining),
    // and the step itself costs the single point — so the merged Longbowman is
    // spent, not restocked with the destination's full 3.
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "shortbowman"], ["1,0", "shortbowman"]]),
      firedUnits: new Set(["0,0"]),
      partialMoves: new Map([["0,0", 1]]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const newEnts: Map<string, EntityType> = (
      params.setEntities as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(newEnts.get("1,0")).toBe("longbowman");
    const spent: Set<string> = (
      params.setSpentUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
    const moves: Map<string, number> = (
      params.setPartialMoves as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(moves.has("1,0")).toBe(false);
  });
});

// ─── Fired flag across moves ──────────────────────────────────────────────────

describe("fired flag across moves", () => {
  it("carries to the destination on a plain move", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "shortbowman"]]),
      firedUnits: new Set(["0,0"]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("1,0")).toBe(true);
    expect(fired.has("0,0")).toBe(false);
  });

  it("survives the move that exhausts the movement budget", () => {
    // Regression guard for the two-shots bug: attacksUsed drops its counter
    // when a unit becomes spent, so the fired flag must not live there.
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "shortbowman"]]),
      partialMoves: new Map([["0,0", 1]]), // this move spends it
      firedUnits: new Set(["0,0"]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const spent: Set<string> = (
      params.setSpentUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(spent.has("1,0")).toBe(true);
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("1,0")).toBe(true);
  });

  it("unions the flag when a fresh bowman merges into a fired one", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "shortbowman"], ["1,0", "shortbowman"]]),
      firedUnits: new Set(["1,0"]), // the destination already fired
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const newEnts: Map<string, EntityType> = (
      params.setEntities as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(newEnts.get("1,0")).toBe("longbowman");
    const fired: Set<string> = (
      params.setFiredUnits as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(fired.has("1,0")).toBe(true);
  });
});

// ─── Kill markers ─────────────────────────────────────────────────────────────

describe("kill markers", () => {
  it("clears when a unit walks onto the tile", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const params = makeParams({
      key: "1,0",
      activeTileMap: map,
      selectedEntityKey: "0,0",
      validMoveTiles: new Set(["1,0"]),
      entities: ents([["0,0", "peasant"]]),
      killMarks: new Set(["1,0"]),
      liveOwnerMap: new Map([["0,0", "player"], ["1,0", "player"]]),
    });
    handleTileTapLogic(params);
    const marks: Set<string> = (
      params.setKillMarks as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(marks.has("1,0")).toBe(false);
  });
});

// ─── Game elements gate purchases ──────────────────────────────────────────────
// Defence in depth: the purchase ribbon already hides disabled buttons, but the
// tap handler must also refuse a stale armed selection for a switched-off part
// of the game.

describe("game elements gate purchases", () => {
  it("refuses to place a scout when mounted units are off", () => {
    const params = makeParams({
      armedEntityId: "scout",
      selectedTileKeys: new Set(["0,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: [makeTile(0, 0, "player")],
      territoryBalances: new Map([["0,0", 100]]),
      elements: { ...ALL_GAME_ELEMENTS, mounted: false },
    });
    handleTileTapLogic(params);
    expect(params.setEntities).not.toHaveBeenCalled();
    expect(params.setTerritoryBalances).not.toHaveBeenCalled();
  });

  it("still places a peasant when mounted units are off", () => {
    const params = makeParams({
      armedEntityId: "peasant",
      selectedTileKeys: new Set(["0,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: [makeTile(0, 0, "player")],
      territoryBalances: new Map([["0,0", 100]]),
      elements: { ...ALL_GAME_ELEMENTS, mounted: false },
    });
    handleTileTapLogic(params);
    expect(params.setEntities).toHaveBeenCalled();
  });

  it("refuses to place a bowman when ranged units are off", () => {
    const params = makeParams({
      armedEntityId: "shortbowman",
      selectedTileKeys: new Set(["0,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: [makeTile(0, 0, "player")],
      territoryBalances: new Map([["0,0", 100]]),
      elements: { ...ALL_GAME_ELEMENTS, ranged: false },
    });
    handleTileTapLogic(params);
    expect(params.setEntities).not.toHaveBeenCalled();
    expect(params.setTerritoryBalances).not.toHaveBeenCalled();
  });

  it("places a bowman when ranged units are on", () => {
    const params = makeParams({
      armedEntityId: "shortbowman",
      selectedTileKeys: new Set(["0,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: [makeTile(0, 0, "player")],
      territoryBalances: new Map([["0,0", 100]]),
      elements: ALL_GAME_ELEMENTS,
    });
    handleTileTapLogic(params);
    expect(params.setEntities).toHaveBeenCalled();
  });

  it("places a scout when mounted units are on", () => {
    const params = makeParams({
      armedEntityId: "scout",
      selectedTileKeys: new Set(["0,0"]),
      selectedTerritoryId: "0,0",
      selectedTerritory: [makeTile(0, 0, "player")],
      territoryBalances: new Map([["0,0", 100]]),
      elements: ALL_GAME_ELEMENTS,
    });
    handleTileTapLogic(params);
    expect(params.setEntities).toHaveBeenCalled();
  });
});
