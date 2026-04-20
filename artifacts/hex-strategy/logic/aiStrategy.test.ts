import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAiTurn, runAiTerritoryDecisionLoop } from "@/logic/aiStrategy";
import type { AiWorkingState, AiTurnCallbacks, AiDecisionExec } from "@/logic/aiStrategy";
import type { HexTile, EntityType, TerritoryOwner, AiStepSnapshot } from "@/types";
import type { AiContext } from "@/logic/aiHelpers";

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

/**
 * Deep-partial override type for makeCbs — callers can override individual
 * members of nested groups (state, refs) without losing the other mocks in
 * that group.
 */
type CbsOverrides = Partial<Omit<AiTurnCallbacks, "state" | "refs">> & {
  state?: Partial<AiTurnCallbacks["state"]>;
  refs?: Partial<AiTurnCallbacks["refs"]>;
};

function makeCbs(overrides: CbsOverrides = {}): AiTurnCallbacks {
  const aiStateMapRef: Map<string, import("@/types").AiState> = new Map();
  const { state: stateOverrides, refs: refsOverrides, ...topOverrides } = overrides;
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
      ...stateOverrides,
    },
    refs: {
      getAiStateMap: vi.fn(() => aiStateMapRef),
      setAiStateMap: vi.fn((v) => { aiStateMapRef.clear(); v.forEach((val, k) => aiStateMapRef.set(k, val)); }),
      isTurnActive: vi.fn().mockReturnValue(true),
      isDeveloperMode: vi.fn().mockReturnValue(false),
      setAiTurn: vi.fn(),
      ...refsOverrides,
    },
    initStepHistory: vi.fn(),
    awaitStep: vi.fn().mockResolvedValue(undefined),
    awaitPreAiResume: vi.fn().mockResolvedValue(undefined),
    awaitPostAiResume: vi.fn().mockResolvedValue(undefined),
    triggerUnitAnimation: vi.fn(),
    recalculateTerritoriesForCapture: vi.fn().mockReturnValue(new Map()),
    applySingleHexPenalty: vi.fn(),
    checkWinLoss: vi.fn(),
    ...topOverrides,
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

// ─── runAiTerritoryDecisionLoop tests ────────────────────────────────────────

function makeAiCtx(
  tiles: HexTile[],
  aiOwner: TerritoryOwner,
  entities: Map<string, EntityType> = new Map(),
  balances: Map<string, number> = new Map(),
): AiContext {
  return {
    tileMap: makeTileMap(tiles),
    entities,
    balances,
    cities: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    aiOwner,
  };
}

function makeExec(overrides: Partial<AiDecisionExec> = {}): AiDecisionExec {
  return {
    move: vi.fn(async () => false),
    buy: vi.fn(async () => false),
    upgrade: vi.fn(async () => false),
    build: vi.fn(async () => false),
    remove: vi.fn(async () => false),
    markSpent: vi.fn(),
    setTerritoryState: vi.fn(),
    ...overrides,
  };
}

describe("runAiTerritoryDecisionLoop", () => {
  it("moves a unit to capture an adjacent empty enemy tile", async () => {
    // AI owns (0,0) and (1,0); simple_unit at (0,0).
    // Enemy owns (2,0) with no entity — the unit can reach it in 2 steps.
    // Priority A: capturing (2,0) eliminates the only enemy tile (neg=true) → move fires.
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "player"),
    ];
    const entities = new Map<string, EntityType>([["0,0", "simple_unit"]]);
    // Territory ID = lexicographically smallest key = "0,0"
    const balances = new Map([["0,0", 10]]);
    const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);

    let moved = false;
    const exec = makeExec({
      move: vi.fn(async () => { moved = true; return true; }),
    });

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !moved, "hard");

    expect(exec.move).toHaveBeenCalledTimes(1);
    expect(exec.move).toHaveBeenCalledWith("0,0", "2,0");
  });

  it("buys a unit when the territory income can cover its upkeep", async () => {
    // AI owns (0,0) and (1,0) — income = 4 (2 grass tiles × 2), upkeep = 0, balance = 50.
    // Enemy owns (2,0) with no entity, adjacent to (1,0).
    // canAfford(simple_unit cost=10, upkeep=3): 4 - 3 = 1 ≥ 0 → affordable.
    // No AI units to move, so Priority E fires a buy directly onto the enemy tile.
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "player"),
    ];
    const balances = new Map([["0,0", 50]]);
    const aiCtx = makeAiCtx(tiles, "ai1", new Map(), balances);

    let bought = false;
    const exec = makeExec({
      buy: vi.fn(async () => { bought = true; return true; }),
    });

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !bought, "hard");

    expect(exec.buy).toHaveBeenCalledTimes(1);
    const [unitType, targetKey, , outside] = (exec.buy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(unitType).toBe("simple_unit");
    expect(targetKey).toBe("2,0");
    expect(outside).toBe(true);
  });

  it("skips all purchases when income would go negative", async () => {
    // AI owns only (0,0) — income = 2, upkeep = 0, balance = 50.
    // Enemy owns (1,0) with no entity, adjacent to (0,0).
    // canAfford(simple_unit cost=10, upkeep=3): income(2) - upkeep(0) - 3 = -1 < 0 → blocked.
    // Upkeep for advanced/expert units is even higher, so all buy paths are skipped.
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "player"),
    ];
    const balances = new Map([["0,0", 50]]);
    const aiCtx = makeAiCtx(tiles, "ai1", new Map(), balances);
    const exec = makeExec();

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => true, "hard");

    expect(exec.buy).not.toHaveBeenCalled();
    expect(exec.move).not.toHaveBeenCalled();
    expect(exec.build).not.toHaveBeenCalled();
  });
});
