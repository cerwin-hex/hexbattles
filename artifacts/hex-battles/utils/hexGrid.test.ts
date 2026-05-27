import { describe, it, expect } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import {
  ENTITY_META,
  TERRAIN_INCOME,
  CITY_BONUS,
  calcDefenseUpkeep,
  nextDefenseUpkeep,
  getZoCStrength,
  getMaxEnemyZoC,
  getValidMoves,
  getMoveCost,
  getContiguousTerritory,
  getTerritoryId,
} from "@/utils/hexGrid";

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

function entities(pairs: [string, EntityType][]): Map<string, EntityType> {
  return new Map(pairs);
}

// ─── ENTITY_META ──────────────────────────────────────────────────────────────

describe("ENTITY_META", () => {
  it("simple_unit has strength 1", () => expect(ENTITY_META.simple_unit.strength).toBe(1));
  it("advanced_unit has strength 2", () => expect(ENTITY_META.advanced_unit.strength).toBe(2));
  it("expert_unit has strength 3", () => expect(ENTITY_META.expert_unit.strength).toBe(3));
  it("rebel is not a unit", () => expect(ENTITY_META.rebel.isUnit).toBe(false));
  it("city has zero upkeep", () => expect(ENTITY_META.city.upkeep).toBe(0));
  it("bridge has zero strength", () => expect(ENTITY_META.bridge.strength).toBe(0));
});

// ─── TERRAIN_INCOME ───────────────────────────────────────────────────────────

describe("TERRAIN_INCOME", () => {
  it("grass yields 2", () => expect(TERRAIN_INCOME.grass).toBe(2));
  it("desert yields 1", () => expect(TERRAIN_INCOME.desert).toBe(1));
  it("mountain yields 0", () => expect(TERRAIN_INCOME.mountain).toBe(0));
  it("lake yields 0", () => expect(TERRAIN_INCOME.lake).toBe(0));
  it("forest yields 2", () => expect(TERRAIN_INCOME.forest).toBe(2));
  it("CITY_BONUS is 2", () => expect(CITY_BONUS).toBe(2));
});

// ─── calcDefenseUpkeep ────────────────────────────────────────────────────────

describe("calcDefenseUpkeep", () => {
  it("returns 0 when count is 0", () => {
    expect(calcDefenseUpkeep("tower", 0)).toBe(0);
    expect(calcDefenseUpkeep("castle", 0)).toBe(0);
  });

  it("tower: 1 tower costs 1", () => expect(calcDefenseUpkeep("tower", 1)).toBe(1));
  it("tower: 2 towers cost 3 (1+2)", () => expect(calcDefenseUpkeep("tower", 2)).toBe(3));
  it("tower: 3 towers cost 6 (1+2+3)", () => expect(calcDefenseUpkeep("tower", 3)).toBe(6));

  it("castle: 1 castle costs 5", () => expect(calcDefenseUpkeep("castle", 1)).toBe(5));
  it("castle: 2 castles cost 15 (5+10)", () => expect(calcDefenseUpkeep("castle", 2)).toBe(15));
  it("castle: 3 castles cost 30 (5+10+15)", () => expect(calcDefenseUpkeep("castle", 3)).toBe(30));

  it("uses n*(n+1)/2 formula for towers", () => {
    for (let n = 0; n <= 5; n++) {
      expect(calcDefenseUpkeep("tower", n)).toBe((n * (n + 1)) / 2);
    }
  });

  it("uses 5*n*(n+1)/2 formula for castles", () => {
    for (let n = 0; n <= 5; n++) {
      expect(calcDefenseUpkeep("castle", n)).toBe((5 * n * (n + 1)) / 2);
    }
  });
});

// ─── nextDefenseUpkeep ────────────────────────────────────────────────────────

describe("nextDefenseUpkeep", () => {
  it("first tower costs 1", () => expect(nextDefenseUpkeep("tower", 0)).toBe(1));
  it("second tower costs 2", () => expect(nextDefenseUpkeep("tower", 1)).toBe(2));
  it("third tower costs 3", () => expect(nextDefenseUpkeep("tower", 2)).toBe(3));

  it("first castle costs 5", () => expect(nextDefenseUpkeep("castle", 0)).toBe(5));
  it("second castle costs 10", () => expect(nextDefenseUpkeep("castle", 1)).toBe(10));

  it("equals calcDefenseUpkeep(n+1) - calcDefenseUpkeep(n)", () => {
    for (let n = 0; n <= 4; n++) {
      expect(nextDefenseUpkeep("tower", n)).toBe(
        calcDefenseUpkeep("tower", n + 1) - calcDefenseUpkeep("tower", n),
      );
      expect(nextDefenseUpkeep("castle", n)).toBe(
        calcDefenseUpkeep("castle", n + 1) - calcDefenseUpkeep("castle", n),
      );
    }
  });
});

// ─── getZoCStrength ───────────────────────────────────────────────────────────

describe("getZoCStrength", () => {
  it("returns 0 for empty tile", () => {
    const map = tileMap([makeTile(0, 0, "player")]);
    expect(getZoCStrength("0,0", "player", new Map(), map)).toBe(0);
  });

  it("returns strength of entity on the tile itself", () => {
    const map = tileMap([makeTile(0, 0, "player")]);
    const ents = entities([["0,0", "advanced_unit"]]);
    expect(getZoCStrength("0,0", "player", ents, map)).toBe(2);
  });

  it("returns max strength from adjacent ally tiles", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player"),
    ]);
    const ents = entities([["1,0", "expert_unit"]]);
    // "0,0" itself has no entity, but neighbor "1,0" has strength 3
    expect(getZoCStrength("0,0", "player", ents, map)).toBe(3);
  });

  it("ignores entities belonging to other owners", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1"),
    ]);
    const ents = entities([["1,0", "expert_unit"]]);
    expect(getZoCStrength("0,0", "player", ents, map)).toBe(0);
  });
});

// ─── getMaxEnemyZoC ───────────────────────────────────────────────────────────

describe("getMaxEnemyZoC", () => {
  it("returns 0 for neutral target tile", () => {
    const map = tileMap([makeTile(0, 0, "neutral")]);
    expect(getMaxEnemyZoC("0,0", "player", new Map(), map)).toBe(0);
  });

  it("returns 0 for own-territory target tile", () => {
    const map = tileMap([makeTile(0, 0, "player")]);
    expect(getMaxEnemyZoC("0,0", "player", new Map(), map)).toBe(0);
  });

  it("returns defender strength on enemy tile", () => {
    const map = tileMap([makeTile(0, 0, "ai1")]);
    const ents = entities([["0,0", "tower"]]);
    expect(getMaxEnemyZoC("0,0", "player", ents, map)).toBe(1);
  });

  it("returns max strength including adjacent defenders", () => {
    const map = tileMap([
      makeTile(0, 0, "ai1"),
      makeTile(1, 0, "ai1"),
    ]);
    const ents = entities([["1,0", "expert_unit"]]);
    expect(getMaxEnemyZoC("0,0", "player", ents, map)).toBe(3);
  });
});

// ─── getValidMoves ────────────────────────────────────────────────────────────

describe("getValidMoves", () => {
  it("returns empty set for spent unit", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const ents = entities([["0,0", "simple_unit"]]);
    const spent = new Set(["0,0"]);
    expect(getValidMoves("0,0", "player", ents, map, spent)).toEqual(new Set());
  });

  it("can move to adjacent empty player tile", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    const ents = entities([["0,0", "simple_unit"]]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(true);
  });

  it("can move to neutral tile", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "neutral")]);
    const ents = entities([["0,0", "simple_unit"]]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(true);
  });

  it("cannot move through mountain tiles", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "neutral", "mountain"),
      makeTile(2, 0, "neutral"),
    ]);
    const ents = entities([["0,0", "simple_unit"]]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(false);
    expect(moves.has("2,0")).toBe(false);
  });

  it("is blocked by stronger enemy ZoC", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1"),
    ]);
    // AI has expert_unit (strength 3), player unit has strength 1 — cannot capture
    const ents = entities([["0,0", "simple_unit"], ["1,0", "expert_unit"]]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(false);
  });

  it("can capture enemy tile when stronger", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1"),
    ]);
    // Player has expert (strength 3), enemy has simple (strength 1)
    const ents = entities([["0,0", "expert_unit"], ["1,0", "simple_unit"]]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(true);
  });

  it("cannot move to unbridged lake tile", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "neutral", "lake"),
    ]);
    const ents = entities([["0,0", "simple_unit"]]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(false);
  });

  it("can move to bridged lake tile", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "lake"),
    ]);
    const ents = entities([["0,0", "simple_unit"], ["1,0", "bridge"]]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(true);
  });

  it("forest costs 2 move points, limiting range", () => {
    // Unit has 3 range. Forest costs 2. After one forest step, only 1 move left
    // so it cannot enter a second forest tile.
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "neutral", "forest"),
      makeTile(2, 0, "neutral", "forest"),
    ]);
    const ents = entities([["0,0", "simple_unit"]]);
    const moves = getValidMoves("0,0", "player", ents, map, new Set());
    expect(moves.has("1,0")).toBe(true);
    expect(moves.has("2,0")).toBe(false);
  });
});

// ─── getMoveCost ─────────────────────────────────────────────────────────────

describe("getMoveCost", () => {
  it("returns 0 for same tile", () => {
    const map = tileMap([makeTile(0, 0, "player")]);
    expect(getMoveCost("0,0", "0,0", map)).toBe(0);
  });

  it("returns 1 for adjacent grass tiles", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    expect(getMoveCost("0,0", "1,0", map)).toBe(1);
  });

  it("returns 2 for one forest tile step", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "forest"),
    ]);
    expect(getMoveCost("0,0", "1,0", map)).toBe(2);
  });

  it("returns Infinity through mountain", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "mountain"),
    ]);
    expect(getMoveCost("0,0", "1,0", map)).toBe(Infinity);
  });
});

// ─── getContiguousTerritory ───────────────────────────────────────────────────

describe("getContiguousTerritory", () => {
  it("returns empty for mountain tile", () => {
    const map = tileMap([makeTile(0, 0, "player", "mountain")]);
    expect(getContiguousTerritory(map, "0,0", "player")).toHaveLength(0);
  });

  it("returns single tile for isolated tile", () => {
    const map = tileMap([makeTile(0, 0, "player")]);
    const result = getContiguousTerritory(map, "0,0", "player");
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("0,0");
  });

  it("returns connected tiles of same owner", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player"),
      makeTile(2, 0, "player"),
    ]);
    const result = getContiguousTerritory(map, "0,0", "player");
    expect(result).toHaveLength(3);
  });

  it("stops at tiles belonging to another owner", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1"),
      makeTile(2, 0, "player"),
    ]);
    const result = getContiguousTerritory(map, "0,0", "player");
    expect(result).toHaveLength(1);
  });

  it("excludes unbridged lake tiles from territory", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "lake"),
    ]);
    const result = getContiguousTerritory(map, "0,0", "player");
    expect(result.some((t) => t.key === "1,0")).toBe(false);
  });

  it("includes bridged lake tiles in territory", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player", "lake"),
      makeTile(2, 0, "player"),
    ]);
    const ents = entities([["1,0", "bridge"]]);
    const result = getContiguousTerritory(map, "0,0", "player", ents);
    expect(result.some((t) => t.key === "1,0")).toBe(true);
    expect(result.some((t) => t.key === "2,0")).toBe(true);
  });
});

// ─── getTerritoryId ───────────────────────────────────────────────────────────

describe("getTerritoryId", () => {
  it("returns null for empty array", () => {
    expect(getTerritoryId([])).toBeNull();
  });

  it("returns the lexicographically smallest key", () => {
    const tiles = [
      makeTile(3, 0, "player"),
      makeTile(1, 0, "player"),
      makeTile(2, 0, "player"),
    ];
    // "1,0" < "2,0" < "3,0" lexicographically
    expect(getTerritoryId(tiles)).toBe("1,0");
  });

  it("is stable regardless of tile order", () => {
    const a = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const b = [makeTile(1, 0, "player"), makeTile(0, 0, "player")];
    expect(getTerritoryId(a)).toBe(getTerritoryId(b));
  });
});
