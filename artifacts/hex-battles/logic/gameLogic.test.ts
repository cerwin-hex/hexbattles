import { describe, it, expect } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import {
  calcTerritoryUpkeep,
  applySingleHexPenalty,
  initTerritoryBalances,
  mergeResult,
  resolveMovedUnitMoves,
  effectiveRemaining,
  isChargeAttack,
  advanceAttacksUsed,
  advanceCombatSpent,
  calcTerritoryIncome,
  canDevelopTile,
} from "@/logic/gameLogic";

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

// ─── calcTerritoryUpkeep ──────────────────────────────────────────────────────

describe("calcTerritoryUpkeep", () => {
  it("returns 0 for empty territory", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, new Map())).toBe(0);
  });

  it("counts peasant upkeep (3)", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "peasant"]]))).toBe(3);
  });

  it("counts warrior upkeep (9)", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "warrior"]]))).toBe(9);
  });

  it("counts swordsman upkeep (27)", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "swordsman"]]))).toBe(27);
  });

  it("counts single tower upkeep as 1 (linear: n=1)", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "tower"]]))).toBe(1);
  });

  it("counts two towers as 3 (1+2)", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    expect(
      calcTerritoryUpkeep(tiles, ents([["0,0", "tower"], ["1,0", "tower"]])),
    ).toBe(3);
  });

  it("counts single castle upkeep as 5", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "castle"]]))).toBe(5);
  });

  it("counts two castles as 15 (5+10)", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    expect(
      calcTerritoryUpkeep(tiles, ents([["0,0", "castle"], ["1,0", "castle"]])),
    ).toBe(15);
  });

  it("sums unit + tower + bridge", () => {
    const tiles = [
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player"),
      makeTile(2, 0, "player"),
    ];
    // peasant=3, tower(1st)=1, bridge=1
    expect(
      calcTerritoryUpkeep(
        tiles,
        ents([["0,0", "peasant"], ["1,0", "tower"], ["2,0", "bridge"]]),
      ),
    ).toBe(3 + 1 + 1);
  });

  it("unit on lake tile counts bridge upkeep too", () => {
    const tiles = [makeTile(0, 0, "player", "lake")];
    // peasant=3, implied bridge=1
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "peasant"]]))).toBe(4);
  });

  it("rebel entity has zero upkeep", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "rebel"]]))).toBe(0);
  });
});

// ─── mergeResult ────────────────────────────────────────────────────────────

describe("mergeResult", () => {
  it("infantry: peasant + peasant = warrior (strength 2)", () => {
    expect(mergeResult("peasant", "peasant")).toBe("warrior");
  });

  it("infantry: peasant + warrior = swordsman (strength 3)", () => {
    expect(mergeResult("peasant", "warrior")).toBe("swordsman");
    expect(mergeResult("warrior", "peasant")).toBe("swordsman");
  });

  it("infantry: warrior + warrior is illegal (no strength-4 unit)", () => {
    expect(mergeResult("warrior", "warrior")).toBeNull();
  });

  it("cavalry: scout + scout = knight (own upgrade track, strength 2)", () => {
    expect(mergeResult("scout", "scout")).toBe("knight");
  });

  it("cavalry: scout + knight is illegal (no strength-3 cavalry)", () => {
    expect(mergeResult("scout", "knight")).toBeNull();
    expect(mergeResult("knight", "knight")).toBeNull();
  });

  it("cross-track merges are illegal (cavalry never mixes with infantry)", () => {
    expect(mergeResult("scout", "peasant")).toBeNull();
    expect(mergeResult("peasant", "scout")).toBeNull();
    expect(mergeResult("knight", "warrior")).toBeNull();
  });

  it("buildings never merge", () => {
    expect(mergeResult("tower", "tower")).toBeNull();
    expect(mergeResult("peasant", "tower")).toBeNull();
  });

  it("two scout merges in sequence: scout+scout = knight (str 2), then knight cannot merge further", () => {
    const step1 = mergeResult("scout", "scout");
    expect(step1).toBe("knight");
    expect(mergeResult("knight", "scout")).toBeNull();
  });
});

// ─── initTerritoryBalances ────────────────────────────────────────────────────

describe("initTerritoryBalances", () => {
  it("single-tile territories start with balance 0", () => {
    const tiles = [makeTile(0, 0, "player")];
    const map = tileMap(tiles);
    const balances = initTerritoryBalances(tiles, map);
    expect(balances.get("0,0")).toBe(0);
  });

  it("multi-tile territories start with balance 10", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const map = tileMap(tiles);
    const balances = initTerritoryBalances(tiles, map);
    // Territory id is the smallest key "0,0"
    expect(balances.get("0,0")).toBe(10);
  });

  it("two separate territories each have their own balance", () => {
    // "0,0" and "5,5" are not adjacent — two separate territories
    const tiles = [makeTile(0, 0, "player"), makeTile(5, 5, "ai1")];
    const map = tileMap(tiles);
    const balances = initTerritoryBalances(tiles, map);
    expect(balances.has("0,0")).toBe(true);
    expect(balances.has("5,5")).toBe(true);
    expect(balances.get("0,0")).toBe(0);
    expect(balances.get("5,5")).toBe(0);
  });

  it("neutral tiles are ignored", () => {
    const tiles = [makeTile(0, 0, "neutral")];
    const map = tileMap(tiles);
    const balances = initTerritoryBalances(tiles, map);
    expect(balances.size).toBe(0);
  });
});

// ─── applySingleHexPenalty ────────────────────────────────────────────────────

describe("applySingleHexPenalty", () => {
  it("penalises a newly isolated single-hex territory (resets balance to 0)", () => {
    // Previously connected: two player tiles. Now isolated: "1,0" broken off.
    // We simulate the "after" state where "0,0" is now ai1 and "1,0" is alone.
    const prevTiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const prevMap = tileMap(prevTiles);
    // After capture of "0,0" by ai1, "1,0" becomes isolated
    const nowTiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "player")];
    const nowMap = tileMap(nowTiles);

    const balances = new Map([["1,0", 20]]);
    const entities2 = new Map<string, EntityType>();
    const graveyard = new Set<string>();
    const ruins = new Set<string>();

    applySingleHexPenalty(prevMap, nowMap, balances, entities2, graveyard, ruins);

    expect(balances.get("1,0")).toBe(0);
  });

  it("does not penalise a territory that was already isolated in previous turn", () => {
    // "1,0" was already alone before and after
    const prevTiles = [makeTile(1, 0, "player")];
    const prevMap = tileMap(prevTiles);
    const nowTiles = [makeTile(1, 0, "player")];
    const nowMap = tileMap(nowTiles);

    const balances = new Map([["1,0", 15]]);
    const entities2 = new Map<string, EntityType>();
    const graveyard = new Set<string>();
    const ruins = new Set<string>();

    applySingleHexPenalty(prevMap, nowMap, balances, entities2, graveyard, ruins);

    // Balance unchanged because it was already isolated
    expect(balances.get("1,0")).toBe(15);
  });

  it("adds unit to graveyard when isolated tile loses its unit", () => {
    const prevTiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const prevMap = tileMap(prevTiles);
    const nowTiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "player")];
    const nowMap = tileMap(nowTiles);

    const balances = new Map([["1,0", 20]]);
    const entities2 = new Map<string, EntityType>([["1,0", "peasant"]]);
    const graveyard = new Set<string>();
    const ruins = new Set<string>();

    applySingleHexPenalty(prevMap, nowMap, balances, entities2, graveyard, ruins);

    expect(graveyard.has("1,0")).toBe(true);
    expect(entities2.has("1,0")).toBe(false);
  });

  it("adds building to ruins when isolated tile loses its building", () => {
    const prevTiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const prevMap = tileMap(prevTiles);
    const nowTiles = [makeTile(0, 0, "ai1"), makeTile(1, 0, "player")];
    const nowMap = tileMap(nowTiles);

    const balances = new Map([["1,0", 20]]);
    const entities2 = new Map<string, EntityType>([["1,0", "tower"]]);
    const graveyard = new Set<string>();
    const ruins = new Set<string>();

    applySingleHexPenalty(prevMap, nowMap, balances, entities2, graveyard, ruins);

    expect(ruins.has("1,0")).toBe(true);
    expect(entities2.has("1,0")).toBe(false);
  });

  it("does not touch multi-tile territories", () => {
    const tiles = [makeTile(0, 0, "player"), makeTile(1, 0, "player")];
    const map = tileMap(tiles);
    const balances = new Map([["0,0", 30]]);
    const entities2 = new Map<string, EntityType>();
    const graveyard = new Set<string>();
    const ruins = new Set<string>();

    applySingleHexPenalty(map, map, balances, entities2, graveyard, ruins);

    expect(balances.get("0,0")).toBe(30);
  });
});

// ─── effectiveRemaining ───────────────────────────────────────────────────────

describe("effectiveRemaining", () => {
  it("returns the stored partial-move count when present", () => {
    expect(effectiveRemaining("0,0", new Map([["0,0", 2]]), new Set(), 3)).toBe(2);
  });

  it("returns the full range for a fresh unit (no partial entry, not spent)", () => {
    expect(effectiveRemaining("0,0", new Map(), new Set(), 3)).toBe(3);
  });

  it("returns 0 for a spent unit with no partial entry (the merge-into-spent bug)", () => {
    // A spent unit is tracked in spentUnits with no partialMoves entry. Merging
    // into it must NOT grant the merged unit a fresh movement budget, or a unit
    // bought into an attack (spent) could merge and act again.
    expect(effectiveRemaining("0,0", new Map(), new Set(["0,0"]), 3)).toBe(0);
  });
});

// ─── resolveMovedUnitMoves ────────────────────────────────────────────────────

describe("resolveMovedUnitMoves", () => {
  it("plain move with moves left: not spent, stores the remaining moves", () => {
    const r = resolveMovedUnitMoves({
      isMerge: false,
      isCombat: false,
      remainingAfterMove: 2,
      destRemaining: 3,
      maxRange: 3,
    });
    expect(r).toEqual({ spent: false, remaining: 2 });
  });

  it("plain move at full range: not spent, no partial entry needed (remaining null)", () => {
    const r = resolveMovedUnitMoves({
      isMerge: false,
      isCombat: false,
      remainingAfterMove: 3,
      destRemaining: 3,
      maxRange: 3,
    });
    expect(r).toEqual({ spent: false, remaining: null });
  });

  it("plain move that exhausts all moves: spent", () => {
    const r = resolveMovedUnitMoves({
      isMerge: false,
      isCombat: false,
      remainingAfterMove: 0,
      destRemaining: 3,
      maxRange: 3,
    });
    expect(r).toEqual({ spent: true, remaining: null });
  });

  it("combat move always spends, even with moves left", () => {
    const r = resolveMovedUnitMoves({
      isMerge: false,
      isCombat: true,
      remainingAfterMove: 2,
      destRemaining: 3,
      maxRange: 3,
    });
    expect(r).toEqual({ spent: true, remaining: null });
  });

  it("merge keeps the lower of the two units' remaining moves", () => {
    const r = resolveMovedUnitMoves({
      isMerge: true,
      isCombat: false,
      remainingAfterMove: 2,
      destRemaining: 1,
      maxRange: 3,
    });
    expect(r).toEqual({ spent: false, remaining: 1 });
  });

  it("merge is not spent even when both are at full range", () => {
    const r = resolveMovedUnitMoves({
      isMerge: true,
      isCombat: false,
      remainingAfterMove: 3,
      destRemaining: 3,
      maxRange: 3,
    });
    expect(r).toEqual({ spent: false, remaining: null });
  });

  it("merge becomes spent only when the lower remaining hits zero", () => {
    const r = resolveMovedUnitMoves({
      isMerge: true,
      isCombat: false,
      remainingAfterMove: 0,
      destRemaining: 2,
      maxRange: 3,
    });
    expect(r).toEqual({ spent: true, remaining: null });
  });
});

// ─── isChargeAttack ───────────────────────────────────────────────────────────

describe("isChargeAttack", () => {
  it("charges: cavalry combat move with an attack and movement to spare", () => {
    expect(
      isChargeAttack({
        isCombatMove: true,
        entity: "scout",
        attacksUsedSoFar: 0,
        remainingAfterMove: 4,
      }),
    ).toBe(true);
  });

  it("does NOT charge when movement is exhausted reaching the target", () => {
    expect(
      isChargeAttack({
        isCombatMove: true,
        entity: "scout",
        attacksUsedSoFar: 0,
        remainingAfterMove: 0,
      }),
    ).toBe(false);
  });

  it("does NOT charge on the final (second) attack", () => {
    expect(
      isChargeAttack({
        isCombatMove: true,
        entity: "scout",
        attacksUsedSoFar: 1,
        remainingAfterMove: 4,
      }),
    ).toBe(false);
  });

  it("does NOT charge on a non-combat move", () => {
    expect(
      isChargeAttack({
        isCombatMove: false,
        entity: "scout",
        attacksUsedSoFar: 0,
        remainingAfterMove: 4,
      }),
    ).toBe(false);
  });

  it("does NOT charge for a single-attack infantry unit", () => {
    expect(
      isChargeAttack({
        isCombatMove: true,
        entity: "peasant",
        attacksUsedSoFar: 0,
        remainingAfterMove: 4,
      }),
    ).toBe(false);
  });
});

// ─── advanceAttacksUsed ───────────────────────────────────────────────────────

describe("advanceAttacksUsed", () => {
  it("increments the counter onto the destination after a combat move", () => {
    const r = advanceAttacksUsed({
      attacksUsed: new Map([["0,0", 0]]),
      fromKey: "0,0",
      toKey: "1,0",
      isCombatMove: true,
      spent: false,
    });
    expect(r.has("0,0")).toBe(false);
    expect(r.get("1,0")).toBe(1);
  });

  it("carries (does not increment) the counter after a non-combat move", () => {
    const r = advanceAttacksUsed({
      attacksUsed: new Map([["0,0", 1]]),
      fromKey: "0,0",
      toKey: "1,0",
      isCombatMove: false,
      spent: false,
    });
    expect(r.get("1,0")).toBe(1);
  });

  it("drops the counter entirely when the unit is spent", () => {
    const r = advanceAttacksUsed({
      attacksUsed: new Map([["0,0", 1]]),
      fromKey: "0,0",
      toKey: "1,0",
      isCombatMove: true,
      spent: true,
    });
    expect(r.has("0,0")).toBe(false);
    expect(r.has("1,0")).toBe(false);
  });
});

// ─── advanceCombatSpent ───────────────────────────────────────────────────────

describe("advanceCombatSpent", () => {
  it("locks the destination when the move locks (e.g. a strike)", () => {
    const r = advanceCombatSpent({
      combatSpentUnits: new Set(),
      fromKey: "0,0",
      toKey: "1,0",
      locks: true,
    });
    expect(r.has("1,0")).toBe(true);
  });

  it("carries an existing lock to the destination on a later (non-locking) move", () => {
    const r = advanceCombatSpent({
      combatSpentUnits: new Set(["0,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      locks: false,
    });
    expect(r.has("0,0")).toBe(false);
    expect(r.has("1,0")).toBe(true);
  });

  it("leaves an unlocked unit unlocked and clears the vacated tile", () => {
    const r = advanceCombatSpent({
      combatSpentUnits: new Set(),
      fromKey: "0,0",
      toKey: "1,0",
      locks: false,
    });
    expect(r.has("0,0")).toBe(false);
    expect(r.has("1,0")).toBe(false);
  });
});

// ─── calcTerritoryIncome ──────────────────────────────────────────────────────

describe("calcTerritoryIncome", () => {
  it("sums terrain income and city bonus, skipping rebel tiles", () => {
    const tiles = [
      makeTile(0, 0, "player", "grass"),   // 2
      makeTile(1, 0, "player", "forest"),  // 2 (but rebel — skipped)
      makeTile(2, 0, "player", "field"),   // 3
      makeTile(3, 0, "player", "grass"),   // city +2, terrain 2
    ];
    const map = new Map(tiles.map((t) => [t.key, t]));
    const entities = new Map<string, EntityType>([["1,0", "rebel"]]); // forest suppressed
    const cities = new Set<string>(["3,0"]);
    // grass 2 + (forest rebel 0) + field 3 + grass 2 + city 2 = 9
    // + city-adjacency bonus: field at 2,0 is adjacent to same-owner city at 3,0 -> +1 = 10
    expect(calcTerritoryIncome(tiles, entities, cities, map)).toBe(10);
  });
});

describe("calcTerritoryIncome city-adjacency bonus", () => {
  it("grants +1 per developed same-owner tile adjacent to a city, stacking", () => {
    // City at 0,0; two developed neighbours (field + sawmill) -> +2 bonus,
    // plus their own income (3 + 3) and the city tile (grass 2 + city 2).
    const tiles = [
      makeTile(0, 0, "player", "grass"),    // city: 2 + CITY_BONUS 2
      makeTile(1, 0, "player", "field"),    // 3, adjacent to city -> +1
      makeTile(0, 1, "player", "sawmill"),  // 3, adjacent to city -> +1
    ];
    const tileMap2 = new Map(tiles.map((t) => [t.key, t]));
    const cities = new Set(["0,0"]);
    // 2 + 2 (city) + 3 + 3 + 1 + 1 = 12
    expect(calcTerritoryIncome(tiles, new Map(), cities, tileMap2)).toBe(12);
  });
  it("does not grant the bonus for an enemy-owned adjacent city", () => {
    const tiles = [makeTile(1, 0, "player", "field")];
    const enemyCity = makeTile(0, 0, "ai1", "grass");
    const tileMap2 = new Map([
      ["1,0", tiles[0]],
      ["0,0", enemyCity],
    ]);
    const cities = new Set(["0,0"]);
    // Only the field's own income, no bonus (city owned by ai1).
    expect(calcTerritoryIncome(tiles, new Map(), cities, tileMap2)).toBe(3);
  });
});

describe("calcTerritoryUpkeep admin burden", () => {
  it("adds ceil((tiles-20)/2) for clusters over 20 tiles", () => {
    // 26 empty tiles, no entities: upkeep is purely burden = ceil(6/2) = 3
    const tiles = Array.from({ length: 26 }, (_, i) =>
      makeTile(i, 0, "player", "grass"),
    );
    const entities = new Map<string, EntityType>();
    expect(calcTerritoryUpkeep(tiles, entities)).toBe(3);
  });
  it("charges no burden at 20 tiles", () => {
    const tiles = Array.from({ length: 20 }, (_, i) =>
      makeTile(i, 0, "player", "grass"),
    );
    expect(calcTerritoryUpkeep(tiles, new Map())).toBe(0);
  });
});

// ─── canDevelopTile ───────────────────────────────────────────────────────────

describe("canDevelopTile", () => {
  const base = { entityId: "peasant" as const, terrain: "grass" as const, isSpent: false, balance: 5, isCity: false };
  it("allows a non-spent peasant on grass/forest with >=5 gold", () => {
    expect(canDevelopTile(base)).toBe(true);
    expect(canDevelopTile({ ...base, terrain: "forest" })).toBe(true);
  });
  it("rejects non-peasants", () => {
    expect(canDevelopTile({ ...base, entityId: "warrior" })).toBe(false);
  });
  it("rejects a peasant standing on a city tile", () => {
    expect(canDevelopTile({ ...base, isCity: true })).toBe(false);
  });
  it("rejects spent peasants", () => {
    expect(canDevelopTile({ ...base, isSpent: true })).toBe(false);
  });
  it("rejects insufficient gold", () => {
    expect(canDevelopTile({ ...base, balance: 4 })).toBe(false);
  });
  it("rejects non-developable terrain", () => {
    expect(canDevelopTile({ ...base, terrain: "desert" })).toBe(false);
    expect(canDevelopTile({ ...base, terrain: "field" })).toBe(false);
  });
});
