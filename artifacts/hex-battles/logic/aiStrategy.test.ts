import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAiTurn, runAiTerritoryDecisionLoop } from "@/logic/aiStrategy";
import { applySingleHexPenalty } from "@/logic/gameLogic";
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
    attacksUsed: new Map(),
    combatSpentUnits: new Set(),
    freeTowerUsed: new Map(),
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
      setIsAiTurn: vi.fn(),
      advanceTurn: vi.fn(),
      ...stateOverrides,
    },
    refs: {
      getAiStateMap: vi.fn(() => aiStateMapRef),
      setAiStateMap: vi.fn((v: Map<string, import("@/types").AiState>) => { aiStateMapRef.clear(); v.forEach((val, k) => aiStateMapRef.set(k, val)); }),
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

describe("makeCbs helper — per-member overrides", () => {
  it("overriding one state member leaves all other state mocks as vi.fn()", () => {
    const customSetEntities = vi.fn();
    const cbs = makeCbs({ state: { setEntities: customSetEntities } });

    expect(cbs.state.setEntities).toBe(customSetEntities);

    const siblingKeys: Array<keyof typeof cbs.state> = [
      "setMutableTileMap",
      "setTerritoryBalances",
      "setGraveyard",
      "setRuins",
      "setLiveOwnerMap",
      "setCities",
      "setFreeTowerUsedTiles",
      "setAiStateMap",
      "setIsAiTurn",
      "advanceTurn",
    ];
    for (const key of siblingKeys) {
      expect(vi.isMockFunction(cbs.state[key]), `state.${key} should be vi.fn()`).toBe(true);
      expect(cbs.state[key]).not.toBe(customSetEntities);
    }
  });

  it("advances the turn exactly once when the AI phase completes", async () => {
    const ws = makeEmptyWs(makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")]));
    const cbs = makeCbs();
    await runAiTurn(ws, cbs, ["ai1"], 3, "easy");
    expect(cbs.state.advanceTurn).toHaveBeenCalledTimes(1);
  });

  it("overriding one refs member leaves all other refs mocks as vi.fn()", () => {
    const customIsTurnActive = vi.fn().mockReturnValue(false);
    const cbs = makeCbs({ refs: { isTurnActive: customIsTurnActive } });

    expect(cbs.refs.isTurnActive).toBe(customIsTurnActive);

    const siblingKeys: Array<keyof typeof cbs.refs> = [
      "getAiStateMap",
      "setAiStateMap",
      "isDeveloperMode",
      "setAiTurn",
    ];
    for (const key of siblingKeys) {
      expect(vi.isMockFunction(cbs.refs[key]), `refs.${key} should be vi.fn()`).toBe(true);
      expect(cbs.refs[key]).not.toBe(customIsTurnActive);
    }
  });

  it("overrides do not bleed between separate makeCbs calls", () => {
    const custom = vi.fn();
    const cbsA = makeCbs({ state: { setGraveyard: custom } });
    const cbsB = makeCbs();

    expect(cbsA.state.setGraveyard).toBe(custom);
    expect(cbsB.state.setGraveyard).not.toBe(custom);
    expect(vi.isMockFunction(cbsB.state.setGraveyard)).toBe(true);
  });
});

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
      // 2 grass tiles → income = 4; 2 peasants → upkeep = 6; balance = 0
      // delta = 4 - 6 = -2 → newBalance = -2 → bankruptcy
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      const territoryId = "0,0"; // lexicographically smallest key
      ws.balances.set(territoryId, 0);
      ws.entities.set("0,0", "peasant" as EntityType);
      ws.entities.set("1,0", "peasant" as EntityType);

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

    it("drains the territory balance to 0 on bankruptcy", async () => {
      // Reserve of 5 + income 4 = 9g available, upkeep 18g → bankrupt,
      // reserves are spent paying as much of the bill as possible and the
      // balance lands at 0; units are liquidated.
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      const territoryId = "0,0";
      ws.balances.set(territoryId, 5);
      ws.entities.set("0,0", "warrior" as EntityType);
      ws.entities.set("1,0", "warrior" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 2, "easy");

      expect(ws.entities.has("0,0")).toBe(false);
      expect(ws.entities.has("1,0")).toBe(false);
      expect(ws.balances.get(territoryId)).toBe(0);
    });

    it("does not trigger bankruptcy for a solvent player territory", async () => {
      // 2 grass tiles → income = 4; 1 peasant → upkeep = 3; balance = 10
      // delta = 4 - 3 = 1 → newBalance = 11 → no bankruptcy
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 10);
      ws.entities.set("0,0", "peasant" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 2, "easy");

      expect(ws.entities.has("0,0")).toBe(true);
      expect(ws.graveyard.size).toBe(0);
    });

    it("resets a ruined bridge's lake tile to neutral on deep bankruptcy", async () => {
      // land-bridge-land territory whose buildings outstrip its income, forcing
      // a deep bankruptcy (buildings demolished) during the AI-phase player
      // re-check. The demolished bridge must release its lake tile to neutral so
      // it stops rendering as an owned bridge with a territory border around it.
      const tiles = [
        makeTile(0, 0, "player"),
        makeTile(1, 0, "player"),
        makeTile(2, 0, "player", "lake"),
        makeTile(3, 0, "player"),
      ];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 0);
      ws.entities.set("0,0", "castle" as EntityType);
      ws.entities.set("1,0", "castle" as EntityType);
      ws.entities.set("2,0", "bridge" as EntityType);
      ws.entities.set("3,0", "castle" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 2, "easy");

      // Bridge demolished and turned to ruin like the other buildings…
      expect(ws.entities.has("2,0")).toBe(false);
      expect(ws.ruins.has("2,0")).toBe(true);
      // …and its lake tile released so it no longer renders as an owned bridge.
      expect(ws.tileMap.get("2,0")!.owner).toBe("neutral");
    });

    it("runs the single-hex cleanup sweep after a player bankruptcy", async () => {
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 0);
      ws.entities.set("0,0", "peasant" as EntityType);
      ws.entities.set("1,0", "peasant" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 2, "easy");

      expect(cbs.applySingleHexPenalty).toHaveBeenCalledTimes(1);
    });

    it("does not run the cleanup sweep for a solvent player territory", async () => {
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 10);
      ws.entities.set("0,0", "peasant" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 2, "easy");

      expect(cbs.applySingleHexPenalty).not.toHaveBeenCalled();
    });

    it("feeds the post-bankruptcy board through the real single-hex sweep without disturbing solvent territory", async () => {
      // Drives the genuine applySingleHexPenalty (not a mock) so the wiring —
      // argument order and the pre-demolition snapshot — is exercised end to
      // end. The bankrupt territory is liquidated; a separate, solvent two-hex
      // territory must be left untouched by the sweep.
      const tiles = [
        makeTile(0, 0, "player"),
        makeTile(1, 0, "player"),
        makeTile(5, 5, "player"),
        makeTile(6, 5, "player"),
      ];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 0); // bankrupt territory
      ws.balances.set("5,5", 30); // solvent, untouched territory
      ws.entities.set("0,0", "swordsman" as EntityType);
      ws.entities.set("1,0", "swordsman" as EntityType);

      const cbs = makeCbs({ applySingleHexPenalty });
      await runAiTurn(ws, cbs, [], 2, "easy");

      expect(ws.entities.has("0,0")).toBe(false); // bankrupt units liquidated
      expect(ws.balances.get("5,5")).toBe(30); // solvent territory untouched
    });

    it("does not run the bankruptcy check on round 1", async () => {
      // Would go bankrupt on round 2 but round 1 is exempt
      const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.balances.set("0,0", 0);
      ws.entities.set("0,0", "peasant" as EntityType);
      ws.entities.set("1,0", "peasant" as EntityType);

      const cbs = makeCbs();
      await runAiTurn(ws, cbs, [], 1, "easy");

      // Units should still be alive
      expect(ws.entities.has("0,0")).toBe(true);
      expect(ws.entities.has("1,0")).toBe(true);
    });
  });

  describe("unit move execution (dtExecMove)", () => {
    it("spends the unit after it captures an enemy tile (combat)", async () => {
      // AI owns (0,0)+(1,0) with a peasant at (0,0); enemy owns empty (2,0).
      // On "hard" the loop captures (2,0); the real exec runs dtExecMove, and a
      // combat move must leave the unit spent regardless of remaining movement.
      const tiles = [
        makeTile(0, 0, "ai1"),
        makeTile(1, 0, "ai1"),
        makeTile(2, 0, "player"),
      ];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.entities.set("0,0", "peasant" as EntityType);
      ws.balances.set("0,0", 10);
      // The move animation gates dtExecMove on a callback; invoke it immediately.
      const cbs = makeCbs({
        triggerUnitAnimation: vi.fn(
          (...args: unknown[]) => {
            const done = args[args.length - 1];
            if (typeof done === "function") done();
          },
        ) as AiTurnCallbacks["triggerUnitAnimation"],
      });

      await runAiTurn(ws, cbs, ["ai1"], 2, "hard");

      expect(ws.entities.get("2,0")).toBe("peasant");
      expect(ws.entities.has("0,0")).toBe(false);
      expect(ws.spentUnits.has("2,0")).toBe(true);
    });

    it("a cavalry scout strikes only one of two adjacent rebels (no second strike)", async () => {
      // AI owns a 3-tile row with a scout at (0,0) and rebels on (1,0) and
      // (2,0), and is too poor to buy. The scout may strike a defender only
      // once: it clears the first rebel and is combat-locked, so the second
      // rebel survives (it could only ride on to an OPEN tile, not strike).
      const tiles = [
        makeTile(0, 0, "ai1"),
        makeTile(1, 0, "ai1"),
        makeTile(2, 0, "ai1"),
      ];
      const ws = makeEmptyWs(makeTileMap(tiles));
      ws.entities.set("0,0", "scout" as EntityType);
      ws.entities.set("1,0", "rebel" as EntityType);
      ws.entities.set("2,0", "rebel" as EntityType);
      ws.balances.set("0,0", 0); // too poor to buy anything
      const cbs = makeCbs({
        triggerUnitAnimation: vi.fn((...args: unknown[]) => {
          const done = args[args.length - 1];
          if (typeof done === "function") done();
        }) as AiTurnCallbacks["triggerUnitAnimation"],
      });

      await runAiTurn(ws, cbs, ["ai1"], 2, "hard");

      // First rebel struck and replaced by the scout; it is combat-locked.
      expect(ws.entities.get("1,0")).toBe("scout");
      expect(ws.combatSpentUnits.has("1,0")).toBe(true);
      // Second rebel survives — the scout cannot strike a second defender.
      expect(ws.entities.get("2,0")).toBe("rebel");
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
    combatSpentUnits: new Set(),
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
    improve: vi.fn(async () => false),
    markSpent: vi.fn(),
    setTerritoryState: vi.fn(),
    ...overrides,
  };
}

describe("runAiTerritoryDecisionLoop", () => {
  it("moves a unit to capture an adjacent empty enemy tile", async () => {
    // AI owns (0,0) and (1,0); peasant at (0,0).
    // Enemy owns (2,0) with no entity — the unit can reach it in 2 steps.
    // Priority A: capturing (2,0) eliminates the only enemy tile (neg=true) → move fires.
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "player"),
    ];
    const entities = new Map<string, EntityType>([["0,0", "peasant"]]);
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
    // Cavalry is preferred within a strength tier, so the AI buys a Scout
    // (cost=15, upkeep=6) when affordable: balance 50 ≥ 15 and 50 + 4 − 6 ≥ 0.
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
    expect(unitType).toBe("scout");
    expect(targetKey).toBe("2,0");
    expect(outside).toBe(true);
  });

  it("prefers buying a scout onto a rebel when the territory can afford it", async () => {
    // AI owns a 4-tile row with a rebel squatting on (3,0) and no units to move
    // onto it, so Priority G buys directly. Income = 6 (three non-rebel grass)
    // sustains a scout (upkeep 4) given the rebel tile's own income, and the
    // balance covers the cost — so the AI prefers a Scout over a peasant for
    // the charge tempo.
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
      makeTile(3, 0, "ai1"),
    ];
    const entities = new Map<string, EntityType>([["3,0", "rebel"]]);
    const balances = new Map([["0,0", 20]]);
    const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);

    let bought = false;
    const exec = makeExec({
      buy: vi.fn(async () => { bought = true; return true; }),
    });

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !bought, "hard");

    expect(exec.buy).toHaveBeenCalledTimes(1);
    const [unitType, targetKey, , outside] = (exec.buy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(unitType).toBe("scout");
    expect(targetKey).toBe("3,0");
    expect(outside).toBe(false);
  });

  it("falls back to a peasant on a rebel when a scout is too costly to sustain", async () => {
    // AI owns just (0,0)+(1,0) with a rebel on (1,0) and no units. Income = 2
    // ((0,0) grass) + (1,0)'s 1 (desert) = 3, which cannot sustain a
    // scout (upkeep 4: 3 − 4 < 0) but can sustain a peasant (upkeep 3). Balance
    // 20 covers either cost, so the AI falls back to the affordable peasant.
    const tiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1", "desert")];
    const entities = new Map<string, EntityType>([["1,0", "rebel"]]);
    const balances = new Map([["0,0", 20]]);
    const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);

    let bought = false;
    const exec = makeExec({
      buy: vi.fn(async () => { bought = true; return true; }),
    });

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !bought, "hard");

    expect(exec.buy).toHaveBeenCalledTimes(1);
    const [unitType, targetKey] = (exec.buy as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(unitType).toBe("peasant");
    expect(targetKey).toBe("1,0");
  });

  it("skips all purchases when balance is too low to afford any unit", async () => {
    // AI owns only (0,0) — income = 2, upkeep = 0, balance = 0.
    // Enemy owns (1,0) with no entity, adjacent to (0,0).
    // canAfford(peasant cost=10, ...): 0 >= 10 → false → blocked.
    // All unit types cost at least 10, so all buy paths are skipped.
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "player"),
    ];
    const balances = new Map([["0,0", 0]]);
    const aiCtx = makeAiCtx(tiles, "ai1", new Map(), balances);
    const exec = makeExec();

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => true, "hard");

    expect(exec.buy).not.toHaveBeenCalled();
    expect(exec.move).not.toHaveBeenCalled();
    expect(exec.build).not.toHaveBeenCalled();
  });

  describe("defending mode — upgrades and defensive builds", () => {
    // ── Shared helper ──────────────────────────────────────────────────────────
    // Produces a minimal "defending" map:
    //   AI "ai1" owns a linear strip: (-1,0)–(0,0)–(1,0)–(2,0)–(3,0)  [income 10]
    //   Enemy "player" owns (4,0) adjacent to the AI border at (3,0).
    // Any unit placed at (4,0) with strength > currMaxStr puts the AI into
    // "defending" state.  currMaxStr is determined by AI entities in the map.
    function makeDefendingSetup(
      aiEntities: Map<string, EntityType> = new Map(),
      enemyEntity: EntityType = "warrior",
      aiBalance = 50,
    ) {
      const tiles = [
        makeTile(-1, 0, "ai1"),
        makeTile(0, 0, "ai1"),
        makeTile(1, 0, "ai1"),
        makeTile(2, 0, "ai1"),
        makeTile(3, 0, "ai1"),
        makeTile(4, 0, "player"),
      ];
      const entities = new Map(aiEntities);
      entities.set("4,0", enemyEntity);
      // Territory ID is the lexicographically smallest key in the territory.
      const balances = new Map([["-1,0", aiBalance]]);
      const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);
      return { aiCtx, tiles, entities, balances };
    }

    it("sets territory state to 'defending' when a stronger enemy unit is adjacent", async () => {
      // Enemy warrior (str=2) is adjacent to the AI border tile (3,0).
      // AI has no units → currMaxStr=0 → 2 > 0 → defending state.
      const { aiCtx } = makeDefendingSetup();
      const exec = makeExec();

      await runAiTerritoryDecisionLoop("-1,0", aiCtx, exec, () => true, "hard");

      expect(exec.setTerritoryState).toHaveBeenCalledWith("-1,0", "defending");
    });

    it("Priority 1: exec.move is called to split the stronger enemy's territory", async () => {
      // Set up a deeper enemy strip so capturing the first tile leaves the
      // enemy alive but split — dtCaptureNegatesIncome fires because the
      // remaining 2-tile territory cannot pay upkeep for the swordsman.
      //
      // AI "ai1": (0,0)–(1,0)–(2,0)–(3,0)  [income=8, balance=50]
      // AI entity: warrior (str=2) at (3,0)
      // Enemy "player": (4,0), (5,0), (6,0) — swordsman (str=3) at (6,0)
      //
      // currMaxStr=2, swordsman str=3 > 2 → defending.
      // Priority 1 candidates:
      //   (3,0)→(4,0): ZoC at (4,0) = 0 (no entity at (5,0)), str 2 > 0 ✓
      //   dtCaptureNegatesIncome: remaining income (4) − upkeep (27) < 0 → true
      //   oneHex=false but neg=true → qualifies → exec.move fired.
      // exec.move returns true → actionTaken=true → Priority 2 is skipped.
      const tiles = [
        makeTile(0, 0, "ai1"),
        makeTile(1, 0, "ai1"),
        makeTile(2, 0, "ai1"),
        makeTile(3, 0, "ai1"),
        makeTile(4, 0, "player"),
        makeTile(5, 0, "player"),
        makeTile(6, 0, "player"),
      ];
      const entities = new Map<string, EntityType>([
        ["3,0", "warrior"],
        ["6,0", "swordsman"],
      ]);
      const balances = new Map([["0,0", 50]]);
      const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);

      let moved = false;
      const exec = makeExec({
        move: vi.fn(async () => { moved = true; return true; }),
      });

      await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !moved, "hard");

      expect(exec.move).toHaveBeenCalledTimes(1);
      expect(exec.move).toHaveBeenCalledWith("3,0", "4,0");
      // Priority 2 must NOT have run (move already satisfied actionTaken).
      expect(exec.upgrade).not.toHaveBeenCalled();
      expect(exec.buy).not.toHaveBeenCalled();
    });

    it("Priority 2: upgrades a tower to castle when the upgrade counters the stronger enemy", async () => {
      // AI has a tower (str=1) at (1,0).  Enemy has warrior (str=2) at (4,0).
      // currMaxStr=0 (tower is not a unit) → str 2 > 0 → defending.
      // Priority 1: no availUnits → no split candidates.
      // Priority 2 first loop (non-unit upgrades):
      //   tower → castle: castle str (2) ≥ eStr (2) ✓
      //   upgCost = 30−15 = 15, dUpk = 5−1 = 4
      //   canAfford(15, 4): 50≥15 && income(8) − (upkeep(1)+4)=3≥0 ✓
      //   → exec.upgrade("1,0", "castle", 15)
      const { aiCtx } = makeDefendingSetup(
        new Map<string, EntityType>([["1,0", "tower"]]),
        "warrior",
      );
      let upgraded = false;
      const exec = makeExec({
        upgrade: vi.fn(async () => { upgraded = true; return true; }),
      });

      await runAiTerritoryDecisionLoop("-1,0", aiCtx, exec, () => !upgraded, "hard");

      expect(exec.upgrade).toHaveBeenCalledTimes(1);
      expect(exec.upgrade).toHaveBeenCalledWith("1,0", "castle", 15);
    });

    it("Priority 2: upgrades a nearby unit when the upgrade meets the threat threshold", async () => {
      // AI has a peasant (str=1) at (0,0).  Enemy has warrior (str=2) at (4,0).
      // currMaxStr=1 → str 2 > 1 → defending.
      // Priority 1: peasant at (0,0), 3 movement points → can reach (3,0) but NOT (4,0)
      //   (cost 4 steps along the strip) → no split candidates.
      // Priority 2 first loop: no non-unit entities → skip.
      // Priority 2 second loop (unit upgrades near the enemy):
      //   peasant at (0,0): hexDistance(0,0, 4,0)=4 ≤ 5 ✓
      //   UNIT_UPGRADE[peasant]=warrior, str 2 ≥ eStr 2 ✓
      //   upgCost=10, dUpk=6
      //   canAfford(10, 6): 50≥10 && income(10) − (upkeep(3)+6)=1≥0 ✓
      //   → exec.upgrade("0,0", "warrior", 10)
      const { aiCtx } = makeDefendingSetup(
        new Map<string, EntityType>([["0,0", "peasant"]]),
        "warrior",
      );
      let upgraded = false;
      const exec = makeExec({
        upgrade: vi.fn(async () => { upgraded = true; return true; }),
      });

      await runAiTerritoryDecisionLoop("-1,0", aiCtx, exec, () => !upgraded, "hard");

      expect(exec.upgrade).toHaveBeenCalledTimes(1);
      expect(exec.upgrade).toHaveBeenCalledWith("0,0", "warrior", 10);
    });

    it("Priority 2: buys a defensive unit at a border tile when no upgrades are available", async () => {
      // AI has no entities.  Enemy has warrior (str=2) at (4,0).
      // currMaxStr=0 → str 2 > 0 → defending.
      // Priority 1: no availUnits → no candidates.
      // Priority 2 first/second loops: no entities → skip.
      // Priority 2 third loop (buy unit):
      //   peasant / scout str 1 < eStr 2 → skip.
      //   Within tier 2, cavalry is preferred: knight str 2 ≥ 2 ✓, cost=24, upkeep=12
      //   canAfford(24, 12): 50≥24 && income(10) − (0+12) = −2 → 50 + (−2) = 48 ≥ 0 ✓
      //   borderPlacements: (3,0) is border tile adjacent to (4,0), empty,
      //     hexDistance(3,0, 4,0)=1 ≤ 5 ✓ → sorted closest first → (3,0)
      //   → exec.buy("knight", "3,0", 24, false)
      const { aiCtx } = makeDefendingSetup(
        new Map<string, EntityType>(),
        "warrior",
      );
      let bought = false;
      const exec = makeExec({
        buy: vi.fn(async () => { bought = true; return true; }),
      });

      await runAiTerritoryDecisionLoop("-1,0", aiCtx, exec, () => !bought, "hard");

      expect(exec.buy).toHaveBeenCalledTimes(1);
      const [unitType, targetKey, cost, outside] =
        (exec.buy as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(unitType).toBe("knight");
      expect(targetKey).toBe("3,0");
      expect(cost).toBe(24);
      expect(outside).toBe(false);
    });
  });

  describe("Priority B — bridge-building", () => {
    it("moves a unit across a neutral bridge tile to connect two disconnected AI territories", async () => {
      // Layout (axial coords):
      //   ai1 territory 1: (0,0)–(1,0)  [peasant at (1,0)]
      //   neutral bridge:  (2,0)         [ZoC = 0 — neutral tiles never generate ZoC]
      //   ai1 territory 2: (3,0)–(4,0)  [disconnected from territory 1]
      //
      // No enemy tiles → Priority 0/A are no-ops.
      // Bridge detection: (1,0)'s neighbor (2,0) is neutral and (2,0) touches (3,0)
      //   which is ai1 but NOT in currTerrKeys → directBridge = true.
      // ZoC at (2,0) = 0; peasant str = 1 > 0 → exec.move("1,0", "2,0") fires.
      const tiles = [
        makeTile(0, 0, "ai1"),
        makeTile(1, 0, "ai1"),
        makeTile(2, 0, "neutral"),
        makeTile(3, 0, "ai1"),
        makeTile(4, 0, "ai1"),
      ];
      const entities = new Map<string, EntityType>([["1,0", "peasant"]]);
      const balances = new Map([["0,0", 20]]);
      const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);

      let moved = false;
      const exec = makeExec({
        move: vi.fn(async () => { moved = true; return true; }),
      });

      await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !moved, "hard");

      expect(exec.move).toHaveBeenCalledTimes(1);
      expect(exec.move).toHaveBeenCalledWith("1,0", "2,0");
    });

    it("prefers the larger disconnected territory when two bridges are available", async () => {
      // Layout:
      //   ai1 territory (processed): (0,0)–(1,0)           [peasant at (1,0)]
      //   neutral bridge A: (0,-1) → ai1 fragment sz=1: (0,-2)  [isolated]
      //   neutral bridge B: (2,0)  → ai1 fragment sz=2: (3,0)–(4,0)
      //
      // Both bridge tiles qualify as direct-bridges:
      //   (0,-1): neighbor (0,-2) is ai1, not in currTerrKeys → sz=1
      //   (2,0): neighbor (3,0) is ai1, not in currTerrKeys → sz=2
      // (0,-2) and (3,0) are not adjacent (hexDistance > 1) — separate fragments.
      // Bridges sorted by sz descending: (2,0) sz=2 first.
      // peasant at (1,0) can reach (2,0) in 1 step with ZoC=0 → exec.move fires there.
      const tiles = [
        makeTile(0, 0, "ai1"),
        makeTile(1, 0, "ai1"),
        makeTile(0, -1, "neutral"),
        makeTile(0, -2, "ai1"),
        makeTile(2, 0, "neutral"),
        makeTile(3, 0, "ai1"),
        makeTile(4, 0, "ai1"),
      ];
      const entities = new Map<string, EntityType>([["1,0", "peasant"]]);
      const balances = new Map([["0,0", 20]]);
      const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);

      let moved = false;
      const exec = makeExec({
        move: vi.fn(async () => { moved = true; return true; }),
      });

      await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !moved, "hard");

      expect(exec.move).toHaveBeenCalledTimes(1);
      const firstCall = (exec.move as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(firstCall[1]).toBe("2,0");
    });
  });

  describe("merge-move path", () => {
    it("merges two weak units to overcome ZoC before crossing an enemy bridge tile", async () => {
      // Layout:
      //   ai1 territory 1: (0,0)–(1,0)  [peasant at each]
      //   enemy bridge:    (2,0) player  [peasant at (2,0) → ZoC = 1]
      //   ai1 territory 2: (3,0)–(4,0)  [disconnected]
      //
      // Neither peasant (str=1) can enter (2,0) because 1 ≤ ZoC(1).
      // getValidMoves for each unit excludes (2,0) → Priority A candsA is empty.
      //
      // Priority A merge-move fallback:
      //   allSplitTargets includes "2,0" (dtCaptureNegatesIncome = true: capturing the
      //   sole enemy tile eliminates their territory).
      //   dtFindMergeMove(1, {"2,0"}, units):
      //     uk1="0,0" (str=1) → uk2="1,0" (str=1): mergedStr=2 ≥ 1, ≤ 3.
      //     vm1 includes "1,0" (ally unit tile). stepsUsed=1, remainingAfterMerge=2.
      //     tempEntities: warrior (str=2) at "1,0".
      //     vmMerged: warrior str=2 > ZoC=1 → "2,0" reachable.
      //   → exec.move("0,0", "1,0") (move uk1 onto uk2 to trigger the merge).
      const tiles = [
        makeTile(0, 0, "ai1"),
        makeTile(1, 0, "ai1"),
        makeTile(2, 0, "player"),
        makeTile(3, 0, "ai1"),
        makeTile(4, 0, "ai1"),
      ];
      const entities = new Map<string, EntityType>([
        ["0,0", "peasant"],
        ["1,0", "peasant"],
        ["2,0", "peasant"],
      ]);
      const balances = new Map([["0,0", 50]]);
      const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);

      let moved = false;
      const exec = makeExec({
        move: vi.fn(async () => { moved = true; return true; }),
      });

      await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !moved, "hard");

      expect(exec.move).toHaveBeenCalledTimes(1);
      expect(exec.move).toHaveBeenCalledWith("0,0", "1,0");
    });

    it("does not fire the merge when only one unit is available (cannot form a pair)", async () => {
      // Only one peasant (str=1) at (1,0). ZoC=1 at (2,0) from the enemy
      // peasant. A single unit cannot enter (2,0): 1 ≤ ZoC(1).
      // dtFindMergeMove requires at least 2 units → returns null immediately.
      // The unit at (1,0) is marked spent so availUnits is empty, preventing
      // Priority E neutral-expand or Priority F approach-enemy from firing.
      const tiles = [
        makeTile(0, 0, "ai1"),
        makeTile(1, 0, "ai1"),
        makeTile(2, 0, "player"),
        makeTile(3, 0, "ai1"),
        makeTile(4, 0, "ai1"),
      ];
      const entities = new Map<string, EntityType>([
        ["1,0", "peasant"],
        ["2,0", "peasant"],
      ]);
      const balances = new Map([["0,0", 5]]);
      const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);
      aiCtx.spentUnits.add("1,0");
      const exec = makeExec();

      await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => true, "hard");

      expect(exec.move).not.toHaveBeenCalled();
    });
  });

  it("improves an idle peasant's tile when no combat is available", async () => {
    // Pure AI-only map (no enemy/neutral tiles anywhere) so no attack, expansion,
    // or "move closer to enemy" action can fire. With nothing better to do and
    // spare gold (balance >= the field cost of 2), the loop falls through to its
    // last-resort improve attempt: the idle peasant on a grass tile is improved
    // in place (grass -> "field").
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
    ];
    const entities = new Map<string, EntityType>([["0,0", "peasant"]]);
    // Territory ID = lexicographically smallest key = "0,0".
    const balances = new Map([["0,0", 10]]);
    const aiCtx = makeAiCtx(tiles, "ai1", entities, balances);
    aiCtx.cities = new Set(["1,0"]); // a city in the territory enables improving

    // Recording improve mock. isTurnActive flips to false after the first
    // improve so the loop exits next iteration (mirrors the existing harness's
    // `() => !moved` pattern) — guarantees finite progress / no infinite loop.
    let improved = false;
    const exec = makeExec({
      improve: vi.fn(async () => { improved = true; return true; }),
    });

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !improved, "hard");

    expect(exec.improve).toHaveBeenCalledTimes(1);
    const [target, terrain, cost] = (exec.improve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(target).toBe("0,0");
    expect(terrain).toBe("field");
    expect(cost).toBe(2);
  });
});
