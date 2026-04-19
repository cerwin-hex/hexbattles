import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAiTurn } from "@/logic/aiStrategy";
import type { AiWorkingState, AiTurnCallbacks } from "@/logic/aiStrategy";
import type { HexTile, EntityType, TerritoryOwner, AiStepSnapshot } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTile(q: number, r: number, owner: TerritoryOwner, terrain: HexTile["terrain"] = "grass"): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

function makeTileMap(tiles: HexTile[]): Map<string, HexTile> {
  return new Map(tiles.map((t) => [t.key, t]));
}

function makeEmptyWs(tileMap: Map<string, HexTile>): AiWorkingState {
  return {
    tileMap,
    entities: new Map(),
    balances: new Map(),
    liveOwnerMap: new Map(),
    graveyard: new Set(),
    ruins: new Set(),
    cities: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    freeTowerUsed: new Map(),
    lakeFunds: new Map(),
  };
}

function makeCbs(overrides: Partial<AiTurnCallbacks> = {}): AiTurnCallbacks {
  const aiStateMapRef: Map<string, import("@/types").AiState> = new Map();
  return {
    state: {
      setEntities: vi.fn(),
      setMutableTileMap: vi.fn(),
      setTerritoryBalances: vi.fn(),
      setGraveyard: vi.fn(),
      setRuins: vi.fn(),
      setLiveOwnerMap: vi.fn(),
      setCities: vi.fn(),
      setFreeTowerUsedTiles: vi.fn(),
      setAiStateMap: vi.fn(),
      setLakeUnitFunds: vi.fn(),
      setIsAiTurn: vi.fn(),
    },
    refs: {
      getAiStateMap: vi.fn(() => aiStateMapRef),
      setAiStateMap: vi.fn((v) => { aiStateMapRef.clear(); v.forEach((val, k) => aiStateMapRef.set(k, val)); }),
      isTurnActive: vi.fn().mockReturnValue(true),
      isDeveloperMode: vi.fn().mockReturnValue(false),
      setAiTurn: vi.fn(),
    },
    initStepHistory: vi.fn(),
    awaitStep: vi.fn().mockResolvedValue(undefined),
    awaitPreAiResume: vi.fn().mockResolvedValue(undefined),
    awaitPostAiResume: vi.fn().mockResolvedValue(undefined),
    triggerUnitAnimation: vi.fn(),
    recalculateTerritoriesForCapture: vi.fn().mockReturnValue(new Map()),
    applySingleHexPenalty: vi.fn(),
    checkWinLoss: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runAiTurn", () => {
  describe("round 1 — free tower placement", () => {
    it("places a tower in an AI territory with ≥2 tiles", async () => {
      const tiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      const cbs = makeCbs();

      await runAiTurn(ws, cbs, ["ai1"], 1, "easy");

      const entityValues = Array.from(ws.entities.values());
      expect(entityValues).toContain("tower");
      expect(cbs.state.setFreeTowerUsedTiles).toHaveBeenCalled();
    });

    it("places the tower on a non-mountain, non-lake tile without an existing entity", async () => {
      const tiles = [
        makeTile(0, 0, "ai1", "mountain"),
        makeTile(1, 0, "ai1", "grass"),
        makeTile(2, 0, "ai1", "grass"),
      ];
      const ws = makeEmptyWs(makeTileMap(tiles));
      const cbs = makeCbs();

      await runAiTurn(ws, cbs, ["ai1"], 1, "easy");

      const mountainEntity = ws.entities.get("0,0");
      expect(mountainEntity).toBeUndefined();

      const entityValues = Array.from(ws.entities.values());
      expect(entityValues).toContain("tower");
    });

    it("does not place a tower when the territory has only 1 tile", async () => {
      const tiles = [makeTile(0, 0, "ai1")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      const cbs = makeCbs();

      await runAiTurn(ws, cbs, ["ai1"], 1, "easy");

      expect(ws.entities.size).toBe(0);
    });

    it("does not place a second free tower in the same territory on round 1", async () => {
      const tiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.freeTowerUsed.set("ai1", new Set(["0,0", "1,0"]));
      const cbs = makeCbs();

      await runAiTurn(ws, cbs, ["ai1"], 1, "easy");

      expect(ws.entities.size).toBe(0);
    });
  });

  describe("player bankruptcy check", () => {
    it("removes player units when the territory goes bankrupt", async () => {
      // 2 grass tiles → income = 4; 2 simple_units → upkeep = 6; balance = 0
      // delta = 4 - 6 = -2 → newBalance = -2 → bankruptcy
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      const territoryId = "0,0"; // lexicographically smallest key
      ws.balances.set(territoryId, 0);
      ws.entities.set("0,0", "simple_unit" as EntityType);
      ws.entities.set("1,0", "simple_unit" as EntityType);

      const cbs = makeCbs();

      // No AI owners — only the player bankruptcy check runs
      await runAiTurn(ws, cbs, [], 2, "easy");

      // Both units should have been removed
      expect(ws.entities.has("0,0")).toBe(false);
      expect(ws.entities.has("1,0")).toBe(false);

      // Both tiles should be in the graveyard
      expect(ws.graveyard.has("0,0")).toBe(true);
      expect(ws.graveyard.has("1,0")).toBe(true);
    });

    it("clamps the territory balance to 0 after bankruptcy", async () => {
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      const territoryId = "0,0";
      ws.balances.set(territoryId, 0);
      ws.entities.set("0,0", "simple_unit" as EntityType);
      ws.entities.set("1,0", "simple_unit" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 2, "easy");

      expect(ws.balances.get(territoryId)).toBe(0);
    });

    it("does not trigger bankruptcy for a solvent player territory", async () => {
      // 2 grass tiles → income = 4; 1 simple_unit → upkeep = 3; balance = 10
      // delta = 4 - 3 = 1 → newBalance = 11 → no bankruptcy
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 10);
      ws.entities.set("0,0", "simple_unit" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 2, "easy");

      expect(ws.entities.has("0,0")).toBe(true);
      expect(ws.graveyard.size).toBe(0);
    });

    it("does not run the bankruptcy check on round 1", async () => {
      // Would go bankrupt on round 2 but round 1 is exempt
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 0);
      ws.entities.set("0,0", "simple_unit" as EntityType);
      ws.entities.set("1,0", "simple_unit" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 1, "easy");

      // Units should still be alive
      expect(ws.entities.has("0,0")).toBe(true);
      expect(ws.entities.has("1,0")).toBe(true);
    });
  });

  describe("checkWinLoss", () => {
    it("is called at the end of every turn regardless of what happened", async () => {
      const tiles = [makeTile(0, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      const cbs = makeCbs();

      await runAiTurn(ws, cbs, [], 2, "easy");

      expect(cbs.checkWinLoss).toHaveBeenCalledTimes(1);
      expect(cbs.checkWinLoss).toHaveBeenCalledWith(ws.tileMap);
    });

    it("is called even when no AI owners are provided", async () => {
      const ws = makeEmptyWs(new Map());
      const cbs = makeCbs();

      await runAiTurn(ws, cbs, [], 3, "hard");

      expect(cbs.checkWinLoss).toHaveBeenCalledTimes(1);
    });

    it("is called after the AI processes multiple owners", async () => {
      const tiles = [
        makeTile(0, 0, "ai1"),
        makeTile(10, 0, "ai2"),
      ];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 0);
      ws.balances.set("10,0", 0);
      const cbs = makeCbs();

      await runAiTurn(ws, cbs, ["ai1", "ai2"], 2, "easy");

      expect(cbs.checkWinLoss).toHaveBeenCalledTimes(1);
    });
  });
});
