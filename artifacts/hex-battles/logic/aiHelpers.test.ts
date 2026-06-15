import { describe, it, expect } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import type { AiContext } from "@/logic/aiHelpers";
import {
  dtCountClusters,
  dtSplitScore,
  dtCaptureNegatesIncome,
  dtCaptureCreatesOneHex,
  dtBfsStep,
  dtDefenseMinDist,
  dtSpacedPlacements,
  dtFindMergeMove,
  dtFindDevelopMove,
} from "@/logic/aiHelpers";

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

function makeCtx(
  tiles: HexTile[],
  entityPairs: [string, EntityType][] = [],
  balancePairs: [string, number][] = [],
  aiOwner: TerritoryOwner = "ai1",
): AiContext {
  return {
    tileMap: tileMap(tiles),
    entities: ents(entityPairs),
    balances: new Map(balancePairs),
    cities: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    combatSpentUnits: new Set(),
    aiOwner,
  };
}

// ─── dtCountClusters ─────────────────────────────────────────────────────────

describe("dtCountClusters", () => {
  it("returns 0 when owner has no tiles", () => {
    const map = tileMap([makeTile(0, 0, "player")]);
    expect(dtCountClusters("ai1", map)).toBe(0);
  });

  it("returns 1 for a single connected territory", () => {
    const map = tileMap([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")]);
    expect(dtCountClusters("ai1", map)).toBe(1);
  });

  it("returns 2 for two disconnected clusters", () => {
    // "0,0" and "5,5" are far apart — two clusters
    const map = tileMap([makeTile(0, 0, "ai1"), makeTile(5, 5, "ai1")]);
    expect(dtCountClusters("ai1", map)).toBe(2);
  });

  it("ignores mountain and lake tiles when counting clusters", () => {
    const map = tileMap([
      makeTile(0, 0, "ai1", "mountain"),
      makeTile(1, 0, "ai1", "lake"),
      makeTile(2, 0, "ai1"),
    ]);
    expect(dtCountClusters("ai1", map)).toBe(1);
  });
});

// ─── dtSplitScore ─────────────────────────────────────────────────────────────

describe("dtSplitScore", () => {
  it("returns 0 when tile is not owned by enemyOwner", () => {
    const tiles = [makeTile(0, 0, "player")];
    const ctx = makeCtx(tiles);
    expect(dtSplitScore("0,0", "ai2", ctx)).toBe(0);
  });

  it("returns 0 when capture does not split territory", () => {
    // Linear chain: 0,0 – 1,0 – 2,0. Capturing middle breaks it into two.
    // But capturing an endpoint won't split (only 1 adjacent owner tile)
    const tiles = [
      makeTile(0, 0, "ai2"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
    ];
    const ctx = makeCtx(tiles, [], [], "ai1");
    // Capturing "0,0" — it only has one adjacent ai2 tile ("1,0") → no split
    expect(dtSplitScore("0,0", "ai2", ctx)).toBe(0);
  });

  it("returns 1 when capture splits territory into 2 clusters", () => {
    // Chain: 0,0 – 1,0 – 2,0. "1,0" has 2 adjacent ai2 tiles. Capture splits.
    const tiles = [
      makeTile(0, 0, "ai2"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
    ];
    const ctx = makeCtx(tiles, [], [], "ai1");
    expect(dtSplitScore("1,0", "ai2", ctx)).toBe(1);
  });
});

// ─── dtCaptureNegatesIncome ───────────────────────────────────────────────────

describe("dtCaptureNegatesIncome", () => {
  it("returns false for non-enemy tile", () => {
    const ctx = makeCtx([makeTile(0, 0, "player")]);
    expect(dtCaptureNegatesIncome("0,0", "ai2", ctx)).toBe(false);
  });

  it("returns true when capturing the only enemy tile eliminates the enemy", () => {
    const ctx = makeCtx([makeTile(0, 0, "ai2")], [], [["0,0", 5]], "ai1");
    expect(dtCaptureNegatesIncome("0,0", "ai2", ctx)).toBe(true);
  });

  it("returns false when enemy remains solvent after capture", () => {
    // Enemy has 3 grass tiles = 6 income, 0 units (0 upkeep), balance=20 — very healthy
    const tiles = [
      makeTile(0, 0, "ai2"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
    ];
    const tid = "0,0";
    const ctx: AiContext = {
      tileMap: tileMap(tiles),
      entities: new Map(),
      balances: new Map([[tid, 20]]),
      cities: new Set(),
      spentUnits: new Set(),
      partialMoves: new Map(),
      combatSpentUnits: new Set(),
      aiOwner: "ai1",
    };
    // Capture "0,0": remaining ai2 territory has 2 grass tiles = 4 income, 0 upkeep
    // balance = 20 + (4 - 0) = 24 > 0, so NOT negated
    expect(dtCaptureNegatesIncome("0,0", "ai2", ctx)).toBe(false);
  });
});

// ─── dtCaptureCreatesOneHex ───────────────────────────────────────────────────

describe("dtCaptureCreatesOneHex", () => {
  it("returns false for non-enemy tile", () => {
    const ctx = makeCtx([makeTile(0, 0, "player")]);
    expect(dtCaptureCreatesOneHex("0,0", "ai2", ctx)).toBe(false);
  });

  it("returns true when capture isolates one enemy tile", () => {
    // Enemy chain: 0,0 – 1,0 – 2,0. Capture "1,0" isolates "0,0" (and "2,0").
    const tiles = [
      makeTile(0, 0, "ai2"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
    ];
    const ctx = makeCtx(tiles, [], [], "ai1");
    expect(dtCaptureCreatesOneHex("1,0", "ai2", ctx)).toBe(true);
  });

  it("returns false when capture does not isolate any enemy tile", () => {
    // Enemy: 0,0 – 1,0 – 2,0. Capture endpoint "2,0" — remaining "0,0"–"1,0" has 2 tiles.
    const tiles = [
      makeTile(0, 0, "ai2"),
      makeTile(1, 0, "ai2"),
      makeTile(2, 0, "ai2"),
    ];
    const ctx = makeCtx(tiles, [], [], "ai1");
    expect(dtCaptureCreatesOneHex("2,0", "ai2", ctx)).toBe(false);
  });
});

// ─── dtBfsStep ────────────────────────────────────────────────────────────────

describe("dtBfsStep", () => {
  it("returns null when from === target", () => {
    const ctx = makeCtx([makeTile(0, 0, "ai1")]);
    expect(dtBfsStep("0,0", "0,0", new Set(), ctx)).toBeNull();
  });

  it("returns target when it is directly in validMoves", () => {
    const tiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "neutral")];
    const ctx = makeCtx(tiles);
    const validMoves = new Set(["1,0"]);
    expect(dtBfsStep("0,0", "1,0", validMoves, ctx)).toBe("1,0");
  });

  it("returns null when path is blocked by mountains", () => {
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "neutral", "mountain"),
      makeTile(2, 0, "neutral"),
    ];
    const ctx = makeCtx(tiles);
    // validMoves doesn't include "1,0" (mountain) so no path to "2,0"
    const validMoves = new Set<string>();
    expect(dtBfsStep("0,0", "2,0", validMoves, ctx)).toBeNull();
  });

  it("returns the first step toward target via a valid intermediate", () => {
    // "0,0" → "1,0" → "2,0" where "1,0" is a valid move
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "neutral"),
      makeTile(2, 0, "neutral"),
    ];
    const ctx = makeCtx(tiles);
    // Only "1,0" is in validMoves; target is "2,0"
    const validMoves = new Set(["1,0"]);
    expect(dtBfsStep("0,0", "2,0", validMoves, ctx)).toBe("1,0");
  });
});

// ─── dtDefenseMinDist ────────────────────────────────────────────────────────

describe("dtDefenseMinDist", () => {
  it("returns Infinity when no defense buildings for aiOwner", () => {
    const tiles = [makeTile(0, 0, "ai1"), makeTile(5, 5, "ai1")];
    const ctx = makeCtx(tiles, [["5,5", "tower"]], [], "ai2");
    // ai2 has no towers
    expect(dtDefenseMinDist("0,0", ctx)).toBe(Infinity);
  });

  it("returns 0 when the tile itself has a tower", () => {
    const tiles = [makeTile(0, 0, "ai1")];
    const ctx = makeCtx(tiles, [["0,0", "tower"]]);
    expect(dtDefenseMinDist("0,0", ctx)).toBe(0);
  });

  it("returns 1 for adjacent tower", () => {
    const tiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")];
    const ctx = makeCtx(tiles, [["1,0", "tower"]]);
    expect(dtDefenseMinDist("0,0", ctx)).toBe(1);
  });

  it("returns min distance to closest defense building", () => {
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(3, 0, "ai1"),
      makeTile(5, 0, "ai1"),
    ];
    // Tower at "3,0" (distance 3) and castle at "5,0" (distance 5)
    const ctx = makeCtx(tiles, [["3,0", "tower"], ["5,0", "castle"]]);
    expect(dtDefenseMinDist("0,0", ctx)).toBe(3);
  });
});

// ─── dtSpacedPlacements ──────────────────────────────────────────────────────

describe("dtSpacedPlacements", () => {
  it("returns candidates far from any defense (>= 3)", () => {
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(5, 0, "ai1"),
      makeTile(2, 0, "ai1"),
    ];
    const ctx = makeCtx(tiles, [["2,0", "tower"]]);
    // "0,0": dist to tower at "2,0" = 2 → not >= 3
    // "5,0": dist to tower at "2,0" = 3 → qualifies
    const candidates = [makeTile(0, 0, "ai1"), makeTile(5, 0, "ai1")];
    const result = dtSpacedPlacements(candidates, ctx);
    expect(result.some((t) => t.key === "5,0")).toBe(true);
    expect(result.some((t) => t.key === "0,0")).toBe(false);
  });

  it("falls back to >= 2 when no tile is >= 3 away", () => {
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "ai1"),
    ];
    // Tower at "1,0": "0,0" is dist 1, "2,0" is dist 1, so neither is >= 3
    // Fallback: look for >= 2 — neither qualifies since both are dist 1
    const ctx = makeCtx(tiles, [["1,0", "tower"]]);
    const candidates = [makeTile(0, 0, "ai1"), makeTile(2, 0, "ai1")];
    // None are >= 2 away either, so result should be empty
    const result = dtSpacedPlacements(candidates, ctx);
    expect(result).toHaveLength(0);
  });
});

// ─── dtFindMergeMove ─────────────────────────────────────────────────────────

describe("dtFindMergeMove", () => {
  it("returns null when fewer than 2 units", () => {
    const ctx = makeCtx([makeTile(0, 0, "ai1")]);
    const result = dtFindMergeMove(2, new Set(["1,0"]), [["0,0", "peasant"]], ctx);
    expect(result).toBeNull();
  });

  it("returns null when targetKeys is empty", () => {
    const ctx = makeCtx([makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1")]);
    const units: [string, EntityType][] = [["0,0", "peasant"], ["1,0", "peasant"]];
    expect(dtFindMergeMove(2, new Set(), units, ctx)).toBeNull();
  });

  it("finds a merge move when two simples can reach a target as warrior", () => {
    // Two peasant on adjacent player tiles. Merge produces advanced (str 2).
    // Target "2,0" is adjacent to "1,0" (the merge destination).
    const tiles = [
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "neutral"),
    ];
    const ctx: AiContext = {
      tileMap: tileMap(tiles),
      entities: ents([["0,0", "peasant"], ["1,0", "peasant"]]),
      balances: new Map(),
      cities: new Set(),
      spentUnits: new Set(),
      partialMoves: new Map(),
      combatSpentUnits: new Set(),
      aiOwner: "ai1",
    };
    const result = dtFindMergeMove(2, new Set(["2,0"]), [["0,0", "peasant"], ["1,0", "peasant"]], ctx);
    expect(result).not.toBeNull();
    expect(result?.to).toBe("1,0");
  });

  it("returns null when merged unit would exceed str 3", () => {
    // advanced (str 2) + advanced (str 2) = 4 > 3 — not allowed
    const tiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "ai1"), makeTile(2, 0, "neutral")];
    const ctx: AiContext = {
      tileMap: tileMap(tiles),
      entities: ents([["0,0", "warrior"], ["1,0", "warrior"]]),
      balances: new Map(),
      cities: new Set(),
      spentUnits: new Set(),
      partialMoves: new Map(),
      combatSpentUnits: new Set(),
      aiOwner: "ai1",
    };
    const result = dtFindMergeMove(3, new Set(["2,0"]), [["0,0", "warrior"], ["1,0", "warrior"]], ctx);
    expect(result).toBeNull();
  });
});

// ─── dtFindDevelopMove ─────────────────────────────────────────────────────────

describe("dtFindDevelopMove", () => {
  it("returns null when no own peasant stands on developable terrain", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass")];
    const ctx = makeCtx(tiles, [], [], "ai1");
    expect(dtFindDevelopMove(tiles, ctx, new Set(), 10)).toBeNull();
  });

  it("returns null when balance < DEVELOP_COST (5)", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass")];
    const ctx = makeCtx(tiles, [["0,0", "peasant"]], [], "ai1");
    expect(dtFindDevelopMove(tiles, ctx, new Set(), 4)).toBeNull();
  });

  it("develops a peasant's grass tile into a field", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass")];
    const ctx = makeCtx(tiles, [["0,0", "peasant"]], [], "ai1");
    expect(dtFindDevelopMove(tiles, ctx, new Set(), 10)).toEqual({
      key: "0,0",
      terrain: "field",
    });
  });

  it("prefers a peasant adjacent to an own city", () => {
    // city at 0,0 (own); peasant on forest at 1,0 (adjacent to city);
    // peasant on grass at 5,5 (far from any city).
    const cityTile = makeTile(0, 0, "ai1", "grass");
    const forestTile = makeTile(1, 0, "ai1", "forest");
    const farGrass = makeTile(5, 5, "ai1", "grass");
    const territory = [forestTile, farGrass];
    const ctx: AiContext = {
      tileMap: tileMap([cityTile, forestTile, farGrass]),
      entities: ents([["1,0", "peasant"], ["5,5", "peasant"]]),
      balances: new Map(),
      cities: new Set(["0,0"]),
      spentUnits: new Set(),
      partialMoves: new Map(),
      combatSpentUnits: new Set(),
      aiOwner: "ai1",
    };
    expect(dtFindDevelopMove(territory, ctx, new Set(), 10)).toEqual({
      key: "1,0",
      terrain: "sawmill",
    });
  });

  it("skips spent peasants", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass")];
    const ctx = makeCtx(tiles, [["0,0", "peasant"]], [], "ai1");
    expect(dtFindDevelopMove(tiles, ctx, new Set(["0,0"]), 10)).toBeNull();
  });

  it("skips a peasant standing on an own city tile", () => {
    // Single grass tile at 0,0 that is a CITY, with a peasant on it.
    const tiles = [makeTile(0, 0, "ai1", "grass")];
    const ctx: AiContext = {
      tileMap: tileMap(tiles),
      entities: ents([["0,0", "peasant"]]),
      balances: new Map(),
      cities: new Set(["0,0"]),
      spentUnits: new Set(),
      partialMoves: new Map(),
      combatSpentUnits: new Set(),
      aiOwner: "ai1",
    };
    expect(dtFindDevelopMove(tiles, ctx, new Set(), 10)).toBeNull();
  });
});
