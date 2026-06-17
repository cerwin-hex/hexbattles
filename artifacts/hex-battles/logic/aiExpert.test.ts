import { describe, it, expect, afterEach } from "vitest";
import {
  evaluatePosition,
  simulateAction,
  generateCandidateActions,
  runExpertTerritoryDecisionLoop,
  opponentBestResponse,
  DEFAULT_WEIGHTS,
  __setExpertSearchConfig,
  __setExpertCandidateMode,
  type SimState,
  type ExpertAction,
} from "@/logic/aiExpert";
import type { AiDecisionExec, AiWorkingState } from "@/logic/aiStrategy";
import { runOneAiTurnHeadless } from "@/logic/aiSelfPlay";
import type { AiContext } from "@/logic/aiHelpers";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { getContiguousTerritory, getTerritoryId, getValidMoves } from "@/utils/hexGrid";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

function makeTileMap(tiles: HexTile[]): Map<string, HexTile> {
  return new Map(tiles.map((t) => [t.key, t]));
}

function simState(tileMap: Map<string, HexTile>, entities: Map<string, EntityType>): SimState {
  return { tileMap, entities, balances: new Map(), cities: new Set() };
}

function makeCtx(
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  owner: TerritoryOwner,
  balances: Map<string, number>,
): AiContext {
  return {
    tileMap,
    entities,
    balances,
    cities: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    combatSpentUnits: new Set(),
    aiOwner: owner,
  };
}

/** Run the expert loop and return the first action it dispatches (or null). */
async function firstExpertAction(
  start: string,
  ctx: AiContext,
): Promise<ExpertAction | null> {
  let first: ExpertAction | null = null;
  const stop = (a: ExpertAction): boolean => {
    if (!first) first = a;
    return false; // halt the loop after the first action
  };
  const exec: AiDecisionExec = {
    move: async (from, to) => stop({ kind: "move", from, to }),
    buy: async (unitType, target, cost, outside) =>
      stop({ kind: "buy", unitType, target, cost, outside }),
    build: async (buildingType, target, cost) =>
      stop({ kind: "build", buildingType, target, cost }),
    upgrade: async (target, to, cost) => stop({ kind: "upgrade", target, to, cost }),
    remove: async (target) => stop({ kind: "remove", target }),
    improve: async () => false,
    markSpent: () => {},
    setTerritoryState: () => {},
  };
  await runExpertTerritoryDecisionLoop(start, ctx, exec, () => true);
  return first;
}

// ─── evaluatePosition ───────────────────────────────────────────────────────

describe("evaluatePosition", () => {
  it("scores a larger territory higher than a smaller one", () => {
    const big = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
    ]);
    const small = makeTileMap([makeTile(0, 0, "ai1")]);
    const sBig = evaluatePosition("ai1", big, new Map(), new Map(), new Set());
    const sSmall = evaluatePosition("ai1", small, new Map(), new Map(), new Set());
    expect(sBig).toBeGreaterThan(sSmall);
  });

  it("penalises a tile capturable by an adjacent stronger enemy (threat term)", () => {
    // ai1 owns a 2-tile strip; one tile borders an enemy.
    const tiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")];
    const safeMap = makeTileMap(tiles);
    const safe = evaluatePosition("ai1", safeMap, new Map(), new Map(), new Set());

    // Now place a strong enemy unit on the tile adjacent to (1,0).
    const threatMap = makeTileMap([...tiles, makeTile(2, 0, "ai2")]);
    const enemyEntities = new Map<string, EntityType>([["2,0", "swordsman"]]);
    const threatened = evaluatePosition("ai1", threatMap, enemyEntities, new Map(), new Set());
    expect(threatened).toBeLessThan(safe);
  });

  it("prefers contiguous territory over the same tiles fragmented", () => {
    // One connected 2-tile territory vs two disconnected single tiles.
    const connected = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")]);
    const fragmented = makeTileMap([makeTile(0, 0, "ai1"), makeTile(5, 5, "ai1")]);
    const sConnected = evaluatePosition("ai1", connected, new Map(), new Map(), new Set());
    const sFragmented = evaluatePosition("ai1", fragmented, new Map(), new Map(), new Set());
    expect(sConnected).toBeGreaterThan(sFragmented);
  });

  it("values an edge facing the enemy (frontier term)", () => {
    // ai1 tile adjacent to an (empty) enemy tile. Frontier weight should add value.
    const map = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai2")]);
    const withFrontier = evaluatePosition("ai1", map, new Map(), new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      frontier: 5,
    });
    const noFrontier = evaluatePosition("ai1", map, new Map(), new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      frontier: 0,
    });
    expect(withFrontier).toBeGreaterThan(noFrontier);
  });

  it("values an edge backed against the void (secured term)", () => {
    // A lone tile is surrounded by void; secured weight should add value.
    const map = makeTileMap([makeTile(0, 0, "ai1")]);
    const withSecured = evaluatePosition("ai1", map, new Map(), new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      secured: 2,
    });
    const noSecured = evaluatePosition("ai1", map, new Map(), new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      secured: 0,
    });
    expect(withSecured).toBeGreaterThan(noSecured);
  });

  it("penalises leaving an own city capturable by an adjacent enemy (assetThreat)", () => {
    // ai1 owns (0,0)-(1,0) with a city on the exposed border tile (1,0); an enemy
    // swordsman on (2,0) can take it (a city has no defensive ZoC of its own).
    const map = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([["2,0", "swordsman"]]);
    const cities = new Set<string>(["1,0"]);
    const withAsset = evaluatePosition("ai1", map, entities, new Map(), cities, {
      ...DEFAULT_WEIGHTS,
      assetThreat: 30,
    });
    const noAsset = evaluatePosition("ai1", map, entities, new Map(), cities, {
      ...DEFAULT_WEIGHTS,
      assetThreat: 0,
    });
    expect(withAsset).toBeLessThan(noAsset);
  });

  it("rewards a capture that splits the strongest enemy (enemyFragmentation, through the sim)", () => {
    // ai2 holds a 5-tile line; (2,0) is its sole connector. ai1 has a swordsman
    // adjacent to the connector (2,-1) and one adjacent to an end tile (4,-1).
    // Capturing the connector must leave ai2 in two clusters; capturing the end
    // leaves it in one. We assert the enemyFragmentation term's *contribution* is
    // strictly larger for the connector capture — proving the sim actually split
    // the enemy (the term is not dead).
    const tiles = [
      makeTile(0, 0, "ai2"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
      makeTile(3, 0, "ai2"),
      makeTile(4, 0, "ai2"),
      makeTile(2, -1, "ai1"),
      makeTile(4, -1, "ai1"),
    ];
    const s0: SimState = {
      tileMap: makeTileMap(tiles),
      entities: new Map<string, EntityType>([
        ["2,-1", "swordsman"],
        ["4,-1", "swordsman"],
      ]),
      balances: new Map(),
      cities: new Set(),
    };
    const afterConnector = simulateAction(s0, { kind: "move", from: "2,-1", to: "2,0" }, "ai1");
    const afterEnd = simulateAction(s0, { kind: "move", from: "4,-1", to: "4,0" }, "ai1");

    const contribution = (s: SimState) =>
      evaluatePosition("ai1", s.tileMap, s.entities, s.balances, s.cities, {
        ...DEFAULT_WEIGHTS,
        enemyFragmentation: 50,
      }) -
      evaluatePosition("ai1", s.tileMap, s.entities, s.balances, s.cities, {
        ...DEFAULT_WEIGHTS,
        enemyFragmentation: 0,
      });

    expect(contribution(afterConnector)).toBeGreaterThan(contribution(afterEnd));
  });

  it("penalises standing enemy units and forts (enemyMilitary term)", () => {
    // Identical board; the only difference is the weight, so the penalty is
    // isolated. An enemy warrior on the board lowers the score — making its
    // removal (a capture) a score gain.
    const map = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai2")]);
    const entities = new Map<string, EntityType>([["1,0", "warrior"]]);
    const withTerm = evaluatePosition("ai1", map, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      enemyMilitary: 10,
    });
    const without = evaluatePosition("ai1", map, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      enemyMilitary: 0,
    });
    expect(withTerm).toBeLessThan(without);
  });

  it("rewards a unit positioned to break a defended tile (assault term)", () => {
    // ai1 warrior (str 2) is adjacent to ai2 (1,0), which a peasant on (2,0)
    // defends with ZoC 1. The warrior beats that ZoC, so it can assault — a free
    // grab would not count. Isolated by varying only the assault weight.
    const map = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "warrior"],
      ["2,0", "peasant"],
    ]);
    const withTerm = evaluatePosition("ai1", map, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      assault: 10,
    });
    const without = evaluatePosition("ai1", map, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      assault: 0,
    });
    expect(withTerm).toBeGreaterThan(without);
  });

  it("rewards an enemy-facing unit but not a neutral-facing one (frontline term)", () => {
    const enemyMap = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai2")]);
    const entities = new Map<string, EntityType>([["0,0", "warrior"]]);
    const enemyWith = evaluatePosition("ai1", enemyMap, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      frontline: 10,
    });
    const enemyWithout = evaluatePosition("ai1", enemyMap, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      frontline: 0,
    });
    expect(enemyWith).toBeGreaterThan(enemyWithout);

    // Facing only neutral territory earns no frontline reward.
    const neutralMap = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "neutral")]);
    const neutralWith = evaluatePosition("ai1", neutralMap, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      frontline: 10,
    });
    const neutralWithout = evaluatePosition("ai1", neutralMap, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      frontline: 0,
    });
    expect(neutralWith).toBe(neutralWithout);
  });

  it("draws an idle unit toward the enemy (advance gradient)", () => {
    // Same 6-tile line with an enemy at (6,0). The unit's only difference is its
    // owned tile: (3,0) is closer to the enemy than (1,0). Both are interior
    // (non-adjacent to the enemy), so border/frontline are equal — the advance
    // gradient alone makes the closer position score higher.
    const line = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
      makeTile(3, 0, "ai1"),
      makeTile(4, 0, "ai1"),
      makeTile(5, 0, "ai1"),
      makeTile(6, 0, "ai2"),
    ];
    const w = { ...DEFAULT_WEIGHTS, advance: 10 };
    const closer = evaluatePosition(
      "ai1",
      makeTileMap(line),
      new Map<string, EntityType>([["3,0", "peasant"]]),
      new Map(),
      new Set(),
      w,
    );
    const farther = evaluatePosition(
      "ai1",
      makeTileMap(line),
      new Map<string, EntityType>([["1,0", "peasant"]]),
      new Map(),
      new Set(),
      w,
    );
    expect(closer).toBeGreaterThan(farther);
  });

  it("rewards cutting an enemy 3-strip in the middle, stranding units on single hexes (enemyIsolation)", () => {
    // ai2 holds a 3-in-a-row strip with a peasant on each END tile; an ai1
    // swordsman sits adjacent to the MIDDLE (1,-1). Capturing the middle (1,0)
    // splits ai2 into two single hexes (0,0) and (2,0), each holding a peasant
    // that the end-of-turn single-hex penalty will destroy. The enemyIsolation
    // term must credit that cut — its contribution after the middle capture must
    // exceed its contribution to the untouched strip (which has no isolated hex).
    const tiles = [
      makeTile(0, 0, "ai2"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
      makeTile(1, -1, "ai1"),
    ];
    const s0: SimState = {
      tileMap: makeTileMap(tiles),
      entities: new Map<string, EntityType>([
        ["0,0", "peasant"],
        ["2,0", "peasant"],
        ["1,-1", "swordsman"],
      ]),
      balances: new Map(),
      cities: new Set(),
    };
    const afterMid = simulateAction(s0, { kind: "move", from: "1,-1", to: "1,0" }, "ai1");
    const contribution = (s: SimState) =>
      evaluatePosition("ai1", s.tileMap, s.entities, s.balances, s.cities, {
        ...DEFAULT_WEIGHTS,
        enemyIsolation: 50,
      }) -
      evaluatePosition("ai1", s.tileMap, s.entities, s.balances, s.cities, {
        ...DEFAULT_WEIGHTS,
        enemyIsolation: 0,
      });
    expect(contribution(afterMid)).toBeGreaterThan(contribution(s0));
  });

  it("counts breakthrough per target tile, not per attacker (no overkill on one tile)", () => {
    // Two ai1 units both border the SAME lone capturable neutral tile (1,0).
    // (0,0) and (1,-1) are mutually adjacent and each adjacent to (1,0), with no
    // other non-owned neighbour. The breakthrough reward must credit the single
    // takeable target once — not once per adjacent attacker — so the eval stops
    // paying to pile 2-3 units onto one tile.
    const map = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, -1, "ai1"),
      makeTile(1, 0, "neutral"),
    ]);
    const w = { ...DEFAULT_WEIGHTS, breakthrough: 10 };
    const w0 = { ...DEFAULT_WEIGHTS, breakthrough: 0 };
    const contribution = (entities: Map<string, EntityType>) =>
      evaluatePosition("ai1", map, entities, new Map(), new Set(), w) -
      evaluatePosition("ai1", map, entities, new Map(), new Set(), w0);
    const one = contribution(new Map<string, EntityType>([["0,0", "swordsman"]]));
    const two = contribution(
      new Map<string, EntityType>([["0,0", "swordsman"], ["1,-1", "swordsman"]]),
    );
    expect(two).toBe(one);
  });

  it("does not treat a lake/mountain neighbour as a real front (no drift toward water)", () => {
    // A warrior whose only non-owned neighbour is a lake earns no border reward —
    // water can never be captured, so it is not a front worth advancing toward.
    const lakeMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "neutral", "lake"),
    ]);
    const entities = new Map<string, EntityType>([["0,0", "warrior"]]);
    const withBorder = evaluatePosition("ai1", lakeMap, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      borderBonus: 10,
    });
    const noBorder = evaluatePosition("ai1", lakeMap, entities, new Map(), new Set(), {
      ...DEFAULT_WEIGHTS,
      borderBonus: 0,
    });
    expect(withBorder).toBe(noBorder);
  });

  it("values a scout's mobility over an equal-strength peasant (mobility term)", () => {
    // 3 grass tiles (income 6) sustain a scout's upkeep (4) just as a peasant's
    // (3), and a 20g reserve clears the buffer for both — so the deficit/buffer
    // terms are equal and only mobility distinguishes the two.
    const map = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(0, 2, "ai1"),
    ]);
    const scoutEnts = new Map<string, EntityType>([["0,0", "scout"]]);
    const peasantEnts = new Map<string, EntityType>([["0,0", "peasant"]]);
    const balances = new Map<string, number>();
    balances.set(getTerritoryId(getContiguousTerritory(map, "0,0", "ai1"))!, 20);
    const withTerm = { ...DEFAULT_WEIGHTS, mobility: 10 };
    const noTerm = { ...DEFAULT_WEIGHTS, mobility: 0 };
    // With the term, the scout (movement 5 / 2 attacks) outscores the peasant…
    expect(
      evaluatePosition("ai1", map, scoutEnts, balances, new Set(), withTerm),
    ).toBeGreaterThan(
      evaluatePosition("ai1", map, peasantEnts, balances, new Set(), withTerm),
    );
    // …and without it they score identically (proves only mobility differs).
    expect(
      evaluatePosition("ai1", map, scoutEnts, balances, new Set(), noTerm),
    ).toBe(evaluatePosition("ai1", map, peasantEnts, balances, new Set(), noTerm));
  });
});

// ─── simulateAction ─────────────────────────────────────────────────────────

describe("simulateAction", () => {
  it("flips ownership and removes the enemy entity on a capture move", () => {
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "swordsman"],
      ["1,0", "peasant"],
    ]);
    const s = simState(tileMap, entities);
    const after = simulateAction(s, { kind: "move", from: "0,0", to: "1,0" }, "ai1");
    expect(after.tileMap.get("1,0")!.owner).toBe("ai1");
    expect(after.entities.get("1,0")).toBe("swordsman");
    expect(after.entities.has("0,0")).toBe(false);
  });

  it("reduces the acting territory balance by the buy cost", () => {
    const tileMap = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")]);
    const entities = new Map<string, EntityType>();
    const balances = new Map<string, number>();
    // discover the territory id the same way the eval does
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    const tid = getTerritoryId(terr)!;
    balances.set(tid, 50);
    const s: SimState = { tileMap, entities, balances, cities: new Set() };
    const after = simulateAction(
      s,
      { kind: "buy", unitType: "peasant", target: "1,0", cost: 10, outside: false },
      "ai1",
    );
    expect(after.balances.get(tid)).toBe(40);
    expect(after.entities.get("1,0")).toBe("peasant");
  });

  it("does not mutate the input state", () => {
    const tileMap = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai2")]);
    const entities = new Map<string, EntityType>([["0,0", "swordsman"]]);
    const s = simState(tileMap, entities);
    simulateAction(s, { kind: "move", from: "0,0", to: "1,0" }, "ai1");
    expect(s.tileMap.get("1,0")!.owner).toBe("ai2");
    expect(s.entities.get("0,0")).toBe("swordsman");
  });
});

// ─── generateCandidateActions ───────────────────────────────────────────────

describe("generateCandidateActions", () => {
  it("yields a capture move for a unit adjacent to a capturable enemy tile", () => {
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([["0,0", "swordsman"]]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());
    const terr = [tileMap.get("0,0")!];
    const cands = generateCandidateActions(ctx, terr, 0);
    const hasCapture = cands.some(
      (c: ExpertAction) => c.kind === "move" && c.from === "0,0" && c.to === "1,0",
    );
    expect(hasCapture).toBe(true);
  });

  it("produces at least one buy candidate when the territory can afford it", () => {
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(0, 1, "ai2"),
    ]);
    const entities = new Map<string, EntityType>();
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());
    const terr = [tileMap.get("0,0")!, tileMap.get("1,0")!];
    const cands = generateCandidateActions(ctx, terr, 100);
    expect(cands.some((c: ExpertAction) => c.kind === "buy")).toBe(true);
  });

  it("never targets a mountain or lake tile for placement", () => {
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1", "mountain"),
      makeTile(0, 1, "ai1", "lake"),
    ]);
    const entities = new Map<string, EntityType>();
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());
    const terr = Array.from(tileMap.values());
    const cands = generateCandidateActions(ctx, terr, 100);
    for (const c of cands) {
      if (c.kind === "buy" || c.kind === "build") {
        const t = tileMap.get(c.target)!;
        // builds may target lake only for bridges
        if (c.kind === "build" && c.buildingType === "bridge") continue;
        expect(t.terrain).not.toBe("mountain");
        expect(t.terrain).not.toBe("lake");
      }
    }
  });

  it("does not offer an upgrade for an idle unit that cannot attack and is unthreatened", () => {
    // 5-tile all-grass line (income 10 sustains a warrior's upkeep 9) with a lone
    // peasant interior and no enemy anywhere. Upgrading to a warrior buys strength
    // the unit cannot use this turn, with nothing to defend — the generator must
    // not even offer the upgrade (the premature-upgrade bug).
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
      makeTile(3, 0, "ai1"),
      makeTile(4, 0, "ai1"),
    ]);
    const entities = new Map<string, EntityType>([["2,0", "peasant"]]);
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 50);
    const ctx = makeCtx(tileMap, entities, "ai1", balances);
    const cands = generateCandidateActions(ctx, terr, 50);
    expect(cands.some((c: ExpertAction) => c.kind === "upgrade")).toBe(false);
  });

  it("still offers an upgrade that unlocks a capture the un-upgraded unit cannot make", () => {
    // Peasant (str1) next to an enemy tower (str1, ZoC1): it cannot take the tower,
    // but a warrior (str2) can. The upgrade is the only route to that capture, so
    // the gate must still offer it.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(0, 2, "ai1"),
      makeTile(0, 3, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["1,0", "peasant"],
      ["2,0", "tower"],
    ]);
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 50);
    const ctx = makeCtx(tileMap, entities, "ai1", balances);
    const cands = generateCandidateActions(ctx, terr, 50);
    expect(
      cands.some(
        (c: ExpertAction) =>
          c.kind === "upgrade" && c.target === "1,0" && c.to === "warrior",
      ),
    ).toBe(true);
  });

  it("still generates cavalry sweep moves when an earlier unit fills the move cap", () => {
    // Repro for Suspect B: generateCandidateActions caps total move candidates
    // with a SINGLE shared counter across all units. A filler unit listed before
    // the cavalry can fill that cap, after which the cavalry — whose entire value
    // is a multi-tile sweep — produces ZERO move candidates.
    //
    // Board:
    //  - Filler peasant at (0,0) owned by ai1, surrounded by 6 neutral grass
    //    tiles → 6 pushable open captures (strength 1 > ZoC 0).
    //  - Cavalry scout at (10,10) owned by ai1, with neutral grass tiles within
    //    its movement (5) → many open sweep captures, all independent of the
    //    peasant's neighbours.
    // With an explicit cap of 6, the peasant's 6 captures exhaust the shared
    // counter and the cavalry never gets a single move candidate.
    const tiles: HexTile[] = [
      makeTile(0, 0, "ai1"), // filler peasant tile (listed FIRST)
    ];
    // Six neutral grass neighbours of the peasant → six pushable captures.
    for (const [dq, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, -1],
      [-1, 1],
    ] as const) {
      tiles.push(makeTile(0 + dq, 0 + dr, "neutral"));
    }
    // Cavalry tile (listed LAST) plus a patch of neutral grass within range 5.
    const cavTiles: HexTile[] = [];
    for (let q = 10; q <= 13; q++) {
      for (let r = 10; r <= 13; r++) {
        if (q === 10 && r === 10) continue;
        cavTiles.push(makeTile(q, r, "neutral"));
      }
    }
    tiles.push(...cavTiles);
    tiles.push(makeTile(10, 10, "ai1")); // cavalry tile, LAST in territory order

    const tileMap = makeTileMap(tiles);
    const entities = new Map<string, EntityType>([
      ["0,0", "peasant"],
      ["10,10", "scout"],
    ]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());
    // Territory passed in deterministic order: peasant first, cavalry last.
    const terr = [tileMap.get("0,0")!, tileMap.get("10,10")!];

    // Independent existence check: the cavalry genuinely HAS open sweep moves.
    const cavMoves = getValidMoves(
      "10,10",
      "ai1",
      entities,
      tileMap,
      ctx.spentUnits,
      5,
      ctx.combatSpentUnits,
    );
    expect(cavMoves.size).toBeGreaterThan(0);

    // Cap = 6 → peasant's six neutral captures fill the shared counter.
    const cands = generateCandidateActions(ctx, terr, 0, 6);
    const cavalryMoves = cands.filter(
      (c: ExpertAction) => c.kind === "move" && c.from === "10,10",
    );
    expect(cavalryMoves.length).toBeGreaterThan(0);
  });
});

// ─── runExpertTerritoryDecisionLoop ─────────────────────────────────────────

describe("runExpertTerritoryDecisionLoop", () => {
  it("prefers capturing a free enemy tile over clearing a lone (non-city) rebel", async () => {
    // peasant on (1,0) can clear a rebel on owned (2,0) OR capture an empty enemy
    // tile. Clearing the rebel restores +2 income but pulls the unit off the
    // front; capturing expands and keeps the unit forward. The expert should
    // capture (move onto an ai2 tile), not retreat to clear the rebel.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(1, 1, "ai1"),
      makeTile(2, 0, "ai1"),
      makeTile(0, 1, "ai2"),
      makeTile(-1, 1, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "tower"],
      ["1,0", "peasant"],
      ["2,0", "rebel"],
    ]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());

    const first = await firstExpertAction("0,0", ctx);
    expect(first?.kind).toBe("move");
    if (first?.kind === "move") {
      expect(first.from).toBe("1,0");
      expect(tileMap.get(first.to)?.owner).toBe("ai2"); // a capture, not the rebel
    }
  });

  it("does not merge this turn unless it also attacks this turn (no premature upkeep)", async () => {
    // Peasant A (0,0) must travel its full movement (3) to merge with peasant B
    // on (3,0); the resulting warrior is then spent and cannot attack the same
    // turn. It would sit adjacent to a ZoC-1 enemy tile (4,0) — breakable only by
    // a str-2 unit. No enemy threatens us. Merging now just pays a turn of warrior
    // upkeep (6->9) for an attack that can only happen next turn; the expert
    // should defer the merge. Discriminating check (full turn): a merge is only
    // acceptable if a capture also happened this turn.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
      makeTile(3, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(4, 0, "ai2"),
      makeTile(5, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "peasant"],
      ["3,0", "peasant"],
      ["5,0", "peasant"],
    ]);
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
    const tid = getTerritoryId(getContiguousTerritory(tileMap, "0,0", "ai1", entities))!;
    ws.balances.set(tid, 0); // no buys — isolate the merge decision

    const landBefore = [...ws.tileMap.values()].filter((t) => t.owner === "ai1").length;
    await runOneAiTurnHeadless(ws, "ai1", 5, "expert");
    const landAfter = [...ws.tileMap.values()].filter((t) => t.owner === "ai1").length;

    const merged = [...ws.entities.values()].includes("warrior");
    const captured = landAfter > landBefore;
    // A merge that produced an attack is fine; a merge with no attack is the bug.
    expect(merged && !captured).toBe(false);
  });

  it("picks an available capture as its first action", async () => {
    // ai1 swordsman next to an undefended enemy peasant tile worth capturing.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "swordsman"],
      ["1,0", "peasant"],
    ]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());

    const calls: ExpertAction[] = [];
    const exec: AiDecisionExec = {
      // record then stop the loop so we inspect only the first decision
      move: async (from, to) => {
        calls.push({ kind: "move", from, to });
        return false;
      },
      buy: async (unitType, target, cost, outside) => {
        calls.push({ kind: "buy", unitType, target, cost, outside });
        return false;
      },
      build: async (buildingType, target, cost) => {
        calls.push({ kind: "build", buildingType, target, cost });
        return false;
      },
      upgrade: async (target, to, cost) => {
        calls.push({ kind: "upgrade", target, to, cost });
        return false;
      },
      remove: async (target) => {
        calls.push({ kind: "remove", target });
        return false;
      },
      improve: async () => false,
      markSpent: () => {},
      setTerritoryState: () => {},
    };

    await runExpertTerritoryDecisionLoop("0,0", ctx, exec, () => true);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ kind: "move", from: "0,0", to: "1,0" });
  });

  it("clears a rebel sitting on its own territory", async () => {
    // ai1 unit next to a rebel occupying an owned tile (which yields no income
    // until cleared). Expert should move onto the rebel to clear it.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "swordsman"],
      ["1,0", "rebel"],
    ]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());

    const first = await firstExpertAction("0,0", ctx);
    expect(first).toEqual({ kind: "move", from: "0,0", to: "1,0" });
  });

  it("merges two idle peasants so the result can break through a defense", async () => {
    // Two peasants (str 1) cannot capture (2,0) — it is defended by ZoC 1 from
    // an enemy unit at (3,0). Merged into a warrior (str 2) they can. Expert
    // should choose the merge rather than leaving both peasants idle.
    // Territory is large enough (income 10) to sustain a warrior (upkeep 9),
    // so the merge is not blocked by a deficit penalty. Only (1,0) borders the
    // enemy; (2,0) is defended by ZoC 1 from the enemy peasant at (3,0).
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(0, 2, "ai1"),
      makeTile(0, 3, "ai1"),
      makeTile(2, 0, "ai2"),
      makeTile(3, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "peasant"],
      ["1,0", "peasant"],
      ["3,0", "peasant"],
    ]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());

    const first = await firstExpertAction("0,0", ctx);
    expect(first?.kind).toBe("move");
    if (first?.kind === "move") {
      expect(new Set([first.from, first.to])).toEqual(new Set(["0,0", "1,0"]));
    }
  });

  it("upgrades a peasant to a warrior so it can capture an adjacent enemy tower", async () => {
    // A peasant (str 1) on (1,0) sits next to an enemy tower (str 1) on (2,0).
    // It cannot take the tower (needs str > 1). A fresh warrior is unaffordable
    // (balance 19 < cost 20), so the ONLY path to a str-2 unit on the front is to
    // upgrade the peasant. The 5-tile territory already holds a city (income 11)
    // and so sustains the warrior (upkeep 9), so the deficit term does not block
    // it — the upgrade is the cheapest route to capturing the tower next turn.
    // The pre-existing city also keeps the now-5-tile city threshold from adding
    // a competing build-city candidate.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(0, 2, "ai1"),
      makeTile(0, 3, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["1,0", "peasant"],
      ["2,0", "tower"],
    ]);
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 19);
    const ctx = makeCtx(tileMap, entities, "ai1", balances);
    ctx.cities = new Set(["0,3"]);

    const first = await firstExpertAction("0,0", ctx);
    expect(first).toEqual({ kind: "upgrade", target: "1,0", to: "warrior", cost: 10 });
  });

  it("upgrades a threatened tower to a castle rather than buying a unit to defend", async () => {
    // A tower (str 1) on the front tile (1,0) is threatened by an adjacent enemy
    // warrior (str 2): it can capture the tower (ZoC 1 < 2). Upgrading to a castle
    // (str 2) raises (1,0)'s ZoC to 2, neutralising the threat — and a castle's
    // upkeep (5) is far cheaper than a defending warrior's (9). With funds for
    // either (balance 30), the expert should pick the cheaper, equally-strong
    // castle upgrade over buying a str-2 unit purely to defend.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(0, 2, "ai1"),
      makeTile(0, 3, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["1,0", "tower"],
      ["2,0", "warrior"],
    ]);
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 30);
    const ctx = makeCtx(tileMap, entities, "ai1", balances);

    const first = await firstExpertAction("0,0", ctx);
    expect(first).toEqual({ kind: "upgrade", target: "1,0", to: "castle", cost: 15 });
  });

  it("advances an idle rear unit toward the enemy front", async () => {
    // ai1 owns a 5-tile line (0,0)..(4,0); an enemy sits at (5,0), so (4,0) is the
    // front. A lone peasant idles at the far-rear (0,0), facing only void — it
    // defends nothing and cannot reach the front in one move. With nothing to
    // capture or build (no funds), the expert should still march it forward
    // instead of leaving it stranded on an irrelevant edge.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
      makeTile(3, 0, "ai1"),
      makeTile(4, 0, "ai1"),
      makeTile(5, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([["0,0", "peasant"]]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());

    const first = await firstExpertAction("0,0", ctx);
    expect(first?.kind).toBe("move");
    if (first?.kind === "move") {
      expect(first.from).toBe("0,0");
      // Destination must be strictly closer to the enemy at (5,0) than the start.
      const dist = (k: string) => Math.abs(Number(k.split(",")[0]) - 5);
      expect(dist(first.to)).toBeLessThan(dist("0,0"));
    }
  });

  it("buys a mobile scout over a cheaper peasant when the territory can sustain it", async () => {
    // ai1 (income 6) can grab the neutral (1,0). With a healthy reserve (30) a
    // scout (cost 12, upkeep 4) neither drains the cash buffer nor runs a deficit,
    // so it is the sustainable choice — and its movement 5 / 2 attacks grab far
    // more ground per turn than the cheaper peasant. The expert should prefer it
    // rather than spamming peasants. (At tight cash the buffer penalty correctly
    // still favours the cheaper peasant — this is the "saved enough" case.)
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(0, 2, "ai1"),
      makeTile(1, 0, "neutral"),
    ]);
    const entities = new Map<string, EntityType>();
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 30);
    const ctx = makeCtx(tileMap, entities, "ai1", balances);

    const first = await firstExpertAction("0,0", ctx);
    expect(first?.kind).toBe("buy");
    if (first?.kind === "buy") expect(first.unitType).toBe("scout");
  });

  it("cuts the middle of an enemy 3-strip rather than nibbling an end (single-hex play)", async () => {
    // ai2 holds a 3-in-a-row strip with a peasant on each END (0,0)/(2,0); the
    // middle (1,0) is empty. An ai1 swordsman at (1,-1) can take the middle OR the
    // (0,0) end. Cutting the middle strands BOTH end peasants on single hexes (the
    // end-of-turn penalty then destroys them); taking the end kills one now but
    // leaves the other two tiles contiguous. The expert should choose the middle.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai2"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
      makeTile(1, -1, "ai1"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "peasant"],
      ["2,0", "peasant"],
      ["1,-1", "swordsman"],
    ]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());

    const first = await firstExpertAction("1,-1", ctx);
    expect(first).toEqual({ kind: "move", from: "1,-1", to: "1,0" });
  });

  it("does not crowd a second unit onto a lone tile one unit can already take", async () => {
    // Two ai1 peasants at the rear; a single capturable neutral tile (3,0) sits one
    // sweep away. One peasant should take it — the other has no reason to pile onto
    // the same tile. After the turn, no ai1 unit other than the capturer (which
    // ends ON (3,0)) should sit adjacent to (3,0).
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
      makeTile(3, 0, "neutral"),
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "peasant"],
      ["1,0", "peasant"],
    ]);
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
    const tid = getTerritoryId(getContiguousTerritory(tileMap, "0,0", "ai1", entities))!;
    ws.balances.set(tid, 0); // no buys — isolate the movement decision

    await runOneAiTurnHeadless(ws, "ai1", 5, "expert");

    const adj = (a: string, b: string) => {
      const [aq, ar] = a.split(",").map(Number);
      const [bq, br] = b.split(",").map(Number);
      return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(-aq - ar + bq + br)) === 1;
    };
    const ai1Units = [...ws.entities.entries()].filter(
      ([k, e]) => ws.tileMap.get(k)?.owner === "ai1" && e === "peasant",
    );
    const crowding = ai1Units.filter(([k]) => adj(k, "3,0")).length;
    // At most the capturer's neighbours — i.e. no SECOND peasant parked next to (3,0).
    expect(crowding).toBeLessThanOrEqual(1);
  });

  it("captures toward the enemy before capturing toward the void", async () => {
    // A unit can capture either of two neutral tiles: (1,0) points at an enemy
    // tile (2,0); (-1,0) backs onto void. The enemy-facing tile is worth more.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "neutral"),
      makeTile(2, 0, "ai2"),
      makeTile(-1, 0, "neutral"),
    ]);
    const entities = new Map<string, EntityType>([["0,0", "peasant"]]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());

    const first = await firstExpertAction("0,0", ctx);
    expect(first).toEqual({ kind: "move", from: "0,0", to: "1,0" });
  });
});

// ─── opponentBestResponse ────────────────────────────────────────────────────

describe("opponentBestResponse", () => {
  it("returns null when no enemy can capture an owned tile", () => {
    // ai1 owns (0,0)-(1,0); ai2 owns (3,0) — not adjacent, no capture possible.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(3, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([["3,0", "swordsman"]]);
    const res = opponentBestResponse("ai1", simState(tileMap, entities), DEFAULT_WEIGHTS);
    expect(res.move).toBeNull();
  });

  it("picks the highest-value capturable owned tile as the counter", () => {
    // ai1 owns (1,0) [bare grass] and (1,1) [holds a city — higher tileValue].
    // An ai2 swordsman sits adjacent to BOTH at (2,0) and (2,1). It should
    // choose to take the city tile (1,1), the more damaging capture.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(1, 1, "ai1"),
      makeTile(2, 0, "ai2"),
      makeTile(2, 1, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["2,0", "swordsman"],
      ["2,1", "swordsman"],
    ]);
    const cities = new Set<string>(["1,1"]);
    const s: SimState = { tileMap, entities, balances: new Map(), cities };
    const res = opponentBestResponse("ai1", s, DEFAULT_WEIGHTS);
    expect(res.move).not.toBeNull();
    expect(res.move).toMatchObject({ kind: "move", to: "1,1" });
    // The returned state has the city tile flipped to ai2.
    expect(res.state.tileMap.get("1,1")!.owner).toBe("ai2");
  });

  it("does not treat a fortification/tower as an attacker", () => {
    // Only a tower (non-unit) borders ai1 — towers don't move, so no counter.
    const tileMap = makeTileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai2")]);
    const entities = new Map<string, EntityType>([["1,0", "tower"]]);
    const res = opponentBestResponse("ai1", simState(tileMap, entities), DEFAULT_WEIGHTS);
    expect(res.move).toBeNull();
  });

  it("does not let enemy cavalry 'capture' a fortified owned tile", () => {
    // ai1 owns (1,0) holding a tower; an ai2 knight (cavalry) on (2,0) is adjacent
    // but cavalry cannot assault buildings, so there is no valid counter.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai2"),
    ]);
    const entities = new Map<string, EntityType>([
      ["1,0", "tower"],
      ["2,0", "knight"],
    ]);
    const res = opponentBestResponse("ai1", simState(tileMap, entities), DEFAULT_WEIGHTS);
    expect(res.move).toBeNull();
  });
});

describe("__setExpertSearchConfig", () => {
  it("is callable and resets to default with null", () => {
    expect(() => __setExpertSearchConfig({ twoPly: false, k: 8 })).not.toThrow();
    expect(() => __setExpertSearchConfig(null)).not.toThrow();
  });
});

// ─── two-ply best-response ───────────────────────────────────────────────────

describe("two-ply best-response", () => {
  afterEach(() => __setExpertSearchConfig(null));

  // Board geometry (flat-top axial; neighbours of (q,r):
  //   (q±1,r),(q,r±1),(q+1,r-1),(q-1,r+1)).
  //
  //   ai1 owns an empty CITY at (0,0) that connects a left lobe
  //   {(-1,0),(-2,0),(-1,1)} to a right lobe {(1,0)}. The lone ai1 swordsman sits
  //   on the right lobe (1,0); from there its ZoC (strength 3) defends BOTH the
  //   city (0,0) and its own tile against the ai2 swordsman parked at (1,-1).
  //   An ai2 peasant on (2,0) is a tempting grab for the ai1 swordsman.
  //
  //   The trap: capturing (2,0) requires the swordsman to vacate (1,0). It still
  //   covers (1,0) from (2,0), but the city (0,0) is no longer adjacent to any
  //   ai1 unit — so the ai2 swordsman on (1,-1) walks straight onto the city,
  //   slicing ai1's territory in two. The 1-ply threat term charges only the
  //   city tile's flat value and so undervalues the loss; the realised
  //   post-reply position is catastrophic (the cut fragments the territory and
  //   strands the left lobe's income).
  //
  //   An empty ai2 tile at (3,0) sits beyond the grab target so that capturing
  //   (2,0) keeps the swordsman enemy-adjacent (it now borders (3,0)). This
  //   isolates the test on the *threat-lookahead* difference: the positional
  //   terms (frontline/borderBonus) score the before/after front position
  //   equally, so the only thing that condemns the grab is the 2-ply city-cut
  //   reply — not a positional shuffle.
  //
  //   Verified divergence (DEFAULT_WEIGHTS, balances empty so no buy/build
  //   candidates exist): base has no capturable ai1 tile, so
  //   baseScore == baseScore2. The grab move (1,0)->(2,0) is the dominant
  //   positive 1-ply candidate (it also kills the peasant), but its
  //   post-opponent-reply delta is deeply negative (the city cut fragments the
  //   territory); the safe interior step (1,0)->(0,0) is mildly negative. Hence
  //   1-ply picks the grab and 2-ply refuses it (keeping the defender on station).
  function buildTrapCtx(): AiContext {
    const tiles = [
      makeTile(0, 0, "ai1"), // city connector (empty)
      makeTile(-1, 0, "ai1"), // left lobe
      makeTile(-2, 0, "ai1"),
      makeTile(-1, 1, "ai1"),
      makeTile(1, 0, "ai1"), // right lobe, holds the lone defender
      makeTile(2, 0, "ai2"), // grab target (ai2 peasant)
      makeTile(3, 0, "ai2"), // empty — keeps the swordsman enemy-adjacent post-grab
      makeTile(1, -1, "ai2"), // city attacker
    ];
    const tileMap = makeTileMap(tiles);
    const entities = new Map<string, EntityType>([
      ["1,0", "swordsman"],
      ["1,-1", "swordsman"],
      ["2,0", "peasant"],
    ]);
    const ctx = makeCtx(tileMap, entities, "ai1", new Map());
    ctx.cities = new Set<string>(["0,0"]);
    return ctx;
  }

  it("greedy 1-ply walks into the punished capture (grab that vacates the city defender)", async () => {
    __setExpertSearchConfig({ twoPly: false, k: 8 });
    const first = await firstExpertAction("0,0", buildTrapCtx());
    // The defender abandons (1,0) to grab the peasant on (2,0).
    expect(first).toEqual({ kind: "move", from: "1,0", to: "2,0" });
  });

  it("2-ply rejects the punished capture and keeps the defender on station", async () => {
    __setExpertSearchConfig({ twoPly: true, k: 8 });
    const first = await firstExpertAction("0,0", buildTrapCtx());
    // It must NOT vacate the defender into the trap...
    expect(first).not.toEqual({ kind: "move", from: "1,0", to: "2,0" });
  });
});

// ─── improve as a last-resort action ─────────────────────────────────────────

describe("expert improve (last-resort)", () => {
  it("improves an idle peasant's grass tile when no better action exists", async () => {
    // A fully interior, all-grass territory surrounded by void: no enemies, no
    // border tiles, nothing to capture. One idle peasant sits on grass. The
    // balance (5) covers the field cost (2) but is too little for any unit/building
    // buy (cheapest unit is 10), so the candidate generator emits no score-improving
    // action and the expert loop's `best` is null. With nothing better to do, the
    // expert should fall back to improving the peasant's tile (grass→field).
    // Improving requires a city in the territory (here at 1,1).
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(1, 1, "ai1"),
    ]);
    const entities = new Map<string, EntityType>([["0,0", "peasant"]]);
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 5);
    const ctx = makeCtx(tileMap, entities, "ai1", balances);
    ctx.cities = new Set(["1,1"]);

    const calls: Array<{ target: string; terrain: string; cost: number }> = [];
    const exec: AiDecisionExec = {
      move: async () => false,
      buy: async () => false,
      build: async () => false,
      upgrade: async () => false,
      remove: async () => false,
      improve: async (target, terrain, cost) => {
        calls.push({ target, terrain, cost });
        // Mirror production: mark the peasant spent so the loop never re-picks it
        // (otherwise it would re-improve the same tile until iter<100 ends).
        ctx.spentUnits.add(target);
        return true;
      },
      markSpent: () => {},
      setTerritoryState: () => {},
    };

    await runExpertTerritoryDecisionLoop("0,0", ctx, exec, () => true);

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ target: "0,0", terrain: "field", cost: 2 });
  });

  it("prefers a capture over improving (improve is strictly last-resort)", async () => {
    // Same idle peasant, but now an undefended enemy grass tile sits adjacent.
    // Capturing it is a real positive-score action, so it must be chosen over
    // improving — improve only fires when nothing better exists.
    const tileMap = makeTileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai2"), // capturable: ai1 peasant on (1,0) is adjacent
    ]);
    const entities = new Map<string, EntityType>([
      ["0,0", "peasant"],
      ["1,0", "peasant"],
    ]);
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 5);
    const ctx = makeCtx(tileMap, entities, "ai1", balances);

    let firstKind: string | null = null;
    const record = (kind: string): boolean => {
      if (!firstKind) firstKind = kind;
      return false; // halt the loop after the first decision
    };
    const exec: AiDecisionExec = {
      move: async () => record("move"),
      buy: async () => record("buy"),
      build: async () => record("build"),
      upgrade: async () => record("upgrade"),
      remove: async () => record("remove"),
      improve: async () => record("improve"),
      markSpent: () => {},
      setTerritoryState: () => {},
    };

    await runExpertTerritoryDecisionLoop("0,0", ctx, exec, () => true);

    expect(firstKind).toBe("move");
  });
});

// ── Candidate pruning (#1 perf): front-relevant placements + single advance ─────
describe("generateCandidateActions pruning (CANDIDATE_MODE)", () => {
  afterEach(() => __setExpertCandidateMode(null));

  function buildTargets(cands: ExpertAction[]): Set<string> {
    return new Set(
      cands
        .filter((c) => c.kind === "build" && (c.buildingType === "tower" || c.buildingType === "castle"))
        .map((c) => (c as Extract<ExpertAction, { kind: "build" }>).target),
    );
  }

  it("pruned: offers no fort build deep in the rear, only near the substantial front", () => {
    // A 6-tile corridor; a substantial (2-hex) enemy sits past the east end. Tiles
    // more than FRONT_BUILD_REACH (2) from it are deep rear — a fort there defends
    // nothing, so pruned mode must not even offer it; full mode still does.
    const tiles = [
      ...[0, 1, 2, 3, 4, 5].map((q) => makeTile(q, 0, "ai1")),
      makeTile(6, 0, "ai2"),
      makeTile(6, 1, "ai2"),
    ];
    const tileMap = makeTileMap(tiles);
    const entities = new Map<string, EntityType>();
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "0,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 30);
    const ctx = makeCtx(tileMap, entities, "ai1", balances);

    __setExpertCandidateMode("pruned");
    const prunedT = buildTargets(generateCandidateActions(ctx, terr, 30));
    __setExpertCandidateMode("full");
    const fullT = buildTargets(generateCandidateActions(ctx, terr, 30));

    // Deep-rear tiles (>2 from the enemy) are pruned; the front-proximal tile is kept.
    expect(prunedT.has("0,0")).toBe(false);
    expect(prunedT.has("1,0")).toBe(false);
    expect(prunedT.has("4,0")).toBe(true);
    // Full mode still offers the deep placement (proving the prune, not a board quirk).
    expect(fullT.has("0,0")).toBe(true);
  });

  it("pruned: emits at most one forward (advance) reposition per idle unit", () => {
    // Idle peasant in a corridor; a substantial enemy lies past a neutral gap (so no
    // owned tile is a border tile — every forward step is a pure advance reposition).
    // Pruned keeps only the single closest-to-front step; full emits every closer tile.
    const tiles = [
      ...[0, 1, 2, 3, 4, 5].map((q) => makeTile(q, 0, "ai1")),
      makeTile(6, 0, "neutral"),
      makeTile(7, 0, "neutral"),
      makeTile(8, 0, "ai2"),
      makeTile(8, 1, "ai2"),
    ];
    const tileMap = makeTileMap(tiles);
    const entities = new Map<string, EntityType>([["1,0", "peasant"]]);
    const balances = new Map<string, number>();
    const terr = getContiguousTerritory(tileMap, "1,0", "ai1", entities);
    balances.set(getTerritoryId(terr)!, 0); // no buys, isolate move candidates
    const ctx = makeCtx(tileMap, entities, "ai1", balances);

    const forward = (cands: ExpertAction[]): ExpertAction[] =>
      cands.filter(
        (c) =>
          c.kind === "move" &&
          c.from === "1,0" &&
          tileMap.get((c as Extract<ExpertAction, { kind: "move" }>).to)?.owner === "ai1" &&
          !entities.has((c as Extract<ExpertAction, { kind: "move" }>).to),
      );

    __setExpertCandidateMode("pruned");
    const prunedFwd = forward(generateCandidateActions(ctx, terr, 30));
    __setExpertCandidateMode("full");
    const fullFwd = forward(generateCandidateActions(ctx, terr, 30));

    expect(prunedFwd.length).toBeLessThanOrEqual(1);
    expect(fullFwd.length).toBeGreaterThan(prunedFwd.length);
  });
});
