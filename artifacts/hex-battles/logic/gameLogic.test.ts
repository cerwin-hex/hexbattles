import { describe, it, expect } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import {
  calcTerritoryUpkeep,
  applySingleHexPenalty,
  initTerritoryBalances,
  mergedUnitType,
  resolveMovedUnitMoves,
  isChargeAttack,
  advanceAttacksUsed,
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

  it("counts simple_unit upkeep (3)", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "simple_unit"]]))).toBe(3);
  });

  it("counts advanced_unit upkeep (9)", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "advanced_unit"]]))).toBe(9);
  });

  it("counts expert_unit upkeep (27)", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "expert_unit"]]))).toBe(27);
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
    // simple_unit=3, tower(1st)=1, bridge=1
    expect(
      calcTerritoryUpkeep(
        tiles,
        ents([["0,0", "simple_unit"], ["1,0", "tower"], ["2,0", "bridge"]]),
      ),
    ).toBe(3 + 1 + 1);
  });

  it("unit on lake tile counts bridge upkeep too", () => {
    const tiles = [makeTile(0, 0, "player", "lake")];
    // simple_unit=3, implied bridge=1
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "simple_unit"]]))).toBe(4);
  });

  it("rebel entity has zero upkeep", () => {
    const tiles = [makeTile(0, 0, "player")];
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "rebel"]]))).toBe(0);
  });
});

// ─── mergedUnitType ───────────────────────────────────────────────────────────

describe("mergedUnitType", () => {
  it("1+1 = advanced_unit (strength 2)", () => {
    expect(mergedUnitType(1, 1)).toBe("advanced_unit");
  });

  it("1+2 = expert_unit (strength 3)", () => {
    expect(mergedUnitType(1, 2)).toBe("expert_unit");
  });

  it("2+1 = expert_unit (strength 3)", () => {
    expect(mergedUnitType(2, 1)).toBe("expert_unit");
  });

  it("2+2 caps at expert_unit (strength 3)", () => {
    expect(mergedUnitType(2, 2)).toBe("expert_unit");
  });

  it("1+1+1 (two merges): first merge gives advanced (str 2), second gives expert (str 3)", () => {
    const step1 = mergedUnitType(1, 1);
    expect(step1).toBe("advanced_unit");
    const step2 = mergedUnitType(2, 1);
    expect(step2).toBe("expert_unit");
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
    const entities2 = new Map<string, EntityType>([["1,0", "simple_unit"]]);
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
        entity: "simple_unit",
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
