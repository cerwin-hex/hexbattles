import { describe, it, expect, afterEach } from "vitest";
import {
  evaluatePosition,
  simulateAction,
  generateCandidateActions,
  runExpertTerritoryDecisionLoop,
  opponentBestResponse,
  DEFAULT_WEIGHTS,
  __setExpertSearchConfig,
  type SimState,
  type ExpertAction,
} from "@/logic/aiExpert";
import type { AiDecisionExec } from "@/logic/aiStrategy";
import type { AiContext } from "@/logic/aiHelpers";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { getContiguousTerritory, getTerritoryId } from "@/utils/hexGrid";

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
});

// ─── runExpertTerritoryDecisionLoop ─────────────────────────────────────────

describe("runExpertTerritoryDecisionLoop", () => {
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
  //   Verified divergence (DEFAULT_WEIGHTS, balances empty so no buy/build
  //   candidates exist): base has no capturable ai1 tile, so
  //   baseScore == baseScore2. The grab move (1,0)->(2,0) is the ONLY candidate
  //   with a positive 1-ply delta (+0.2), but its post-opponent-reply delta is
  //   ~-115; the safe interior step (1,0)->(0,0) is ~-1.5. Hence 1-ply picks the
  //   grab and 2-ply refuses it (doing nothing keeps the defender on station).
  function buildTrapCtx(): AiContext {
    const tiles = [
      makeTile(0, 0, "ai1"), // city connector (empty)
      makeTile(-1, 0, "ai1"), // left lobe
      makeTile(-2, 0, "ai1"),
      makeTile(-1, 1, "ai1"),
      makeTile(1, 0, "ai1"), // right lobe, holds the lone defender
      makeTile(2, 0, "ai2"), // grab target (ai2 peasant)
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
    // ...and concretely, here it does nothing rather than expose the city
    // (every candidate has a negative post-reply delta).
    expect(first).toBeNull();
  });
});
