import { describe, it, expect } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { ALL_GAME_ELEMENTS } from "@/constants/gameElements";
import {
  calcTerritoryUpkeep,
  applySingleHexPenalty,
  applyOwnerEconomy,
  initTerritoryBalances,
  mergeResult,
  classifyOwnTilePlacement,
  buildingDotSuppressed,
  resolveMovedUnitMoves,
  effectiveRemaining,
  isChargeAttack,
  advanceAttacksUsed,
  advanceCombatSpent,
  advanceFired,
  calcTerritoryIncome,
  tileEconomicIncome,
  canImproveTile,
  canFoundCity,
  foundCitySites,
  ownCityKeys,
  findImproveAnchor,
  cityImproveReach,
} from "@/logic/gameLogic";
import { cityCapFor } from "@/utils/hexGrid";
import { hexDistance } from "@/utils/hexMath";

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

/** `makeTile` addressed by tile key, for the city rules whose inputs are keys. */
function mkTile(key: string, owner: TerritoryOwner): HexTile {
  const [q, r] = key.split(",").map(Number);
  return makeTile(q, r, owner);
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
    expect(mergeResult("swordsman", "peasant")).toBeNull();
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
    expect(mergeResult("warrior", "knight")).toBeNull();
  });

  it("buildings and markers never merge", () => {
    expect(mergeResult("tower", "tower")).toBeNull();
    expect(mergeResult("peasant", "tower")).toBeNull();
    expect(mergeResult("peasant", "rebel")).toBeNull();
  });

  it("two scout merges in sequence: scout+scout = knight (str 2), then knight cannot merge further", () => {
    const step1 = mergeResult("scout", "scout");
    expect(step1).toBe("knight");
    expect(mergeResult("knight", "scout")).toBeNull();
  });
});

// ─── classifyOwnTilePlacement ─────────────────────────────────────────────────

describe("classifyOwnTilePlacement", () => {
  function classify(
    armedEntityId: EntityType,
    occupant?: EntityType,
    opts: { tileOwner?: TerritoryOwner; terrain?: HexTile["terrain"] } = {},
  ) {
    return classifyOwnTilePlacement({
      armedEntityId,
      occupant,
      tileOwner: opts.tileOwner ?? "player",
      terrain: opts.terrain ?? "grass",
    });
  }

  it("an empty tile takes any purchase", () => {
    expect(classify("shortbowman").blocked).toBe(false);
    expect(classify("peasant").blocked).toBe(false);
    expect(classify("tower").blocked).toBe(false);
  });

  it("a ranged unit cannot overrun a rebel — it takes no ground", () => {
    const p = classify("shortbowman", "rebel");
    expect(p.blocked).toBe(true);
    expect(p.overwritesRebel).toBe(false);
  });

  it("a capturing unit overruns a rebel", () => {
    const p = classify("peasant", "rebel");
    expect(p.blocked).toBe(false);
    expect(p.overwritesRebel).toBe(true);
  });

  it("only same-track units that merge are placeable on an ally", () => {
    expect(classify("shortbowman", "shortbowman").mergeInto).toBe("longbowman");
    expect(classify("shortbowman", "peasant").blocked).toBe(true);
    expect(classify("peasant", "shortbowman").blocked).toBe(true);
    // Same track, but tier 1 + tier 3 overflows the track — no merge, no dot.
    expect(classify("shortbowman", "crossbowman").blocked).toBe(true);
  });

  it("a ranged unit cannot take an enemy building", () => {
    expect(classify("shortbowman", "tower", { tileOwner: "ai1" }).blocked).toBe(true);
    expect(
      classify("swordsman", "tower", { tileOwner: "ai1" }).overwritesBuilding,
    ).toBe(true);
  });

  it("our own buildings are never overwritten", () => {
    expect(classify("swordsman", "tower").blocked).toBe(true);
  });

  it("a city is founded under a friendly unit, a fort is not", () => {
    // A city lives in its own set, not in entities, so the unit standing there
    // keeps its tile — the same reasoning canImproveTile applies to fields.
    expect(classify("city", "peasant").blocked).toBe(false);
    expect(classify("city", "shortbowman").blocked).toBe(false);
    // Towers and castles would have to take the entities slot the unit holds.
    expect(classify("tower", "peasant").blocked).toBe(true);
    expect(classify("castle", "peasant").blocked).toBe(true);
  });

  it("a city is not founded under a rebel or an enemy's unit", () => {
    expect(classify("city", "rebel").blocked).toBe(true);
    expect(classify("city", "peasant", { tileOwner: "ai1" }).blocked).toBe(true);
  });

  it("a city is not founded on another building, nor on a lake", () => {
    expect(classify("city", "tower").blocked).toBe(true);
    expect(classify("city", "bridge", { terrain: "lake" }).blocked).toBe(true);
    expect(classify("city", undefined, { terrain: "lake" }).blocked).toBe(true);
  });

  it("an AI buyer reads the same rules as the player", () => {
    const asAi = (armedEntityId: EntityType, occupant?: EntityType) =>
      classifyOwnTilePlacement({
        armedEntityId,
        occupant,
        tileOwner: "ai1",
        terrain: "grass",
        buyer: "ai1",
      });
    // Its own unit is an ally: a city goes under it, a tower does not, and two
    // same-track units still merge.
    expect(asAi("city", "peasant").blocked).toBe(false);
    expect(asAi("tower", "peasant").blocked).toBe(true);
    expect(asAi("peasant", "peasant").mergeInto).toBe("warrior");
    // Its own tower is not an enemy building to be overrun.
    expect(asAi("swordsman", "tower").blocked).toBe(true);
    // And the same tile read by the player is someone else's ground.
    expect(classify("city", "peasant", { tileOwner: "ai1" }).blocked).toBe(true);
    expect(
      classify("swordsman", "tower", { tileOwner: "ai1" }).overwritesBuilding,
    ).toBe(true);
  });

  it("a lake tile carries a unit only through a bridge", () => {
    expect(classify("peasant", undefined, { terrain: "lake" }).blocked).toBe(true);
    const bridged = classify("peasant", "bridge", { terrain: "lake" });
    expect(bridged.blocked).toBe(false);
    expect(bridged.standsOnBridge).toBe(true);
    // A building cannot be founded on the bridge a unit may stand on.
    expect(classify("tower", "bridge", { terrain: "lake" }).blocked).toBe(true);
  });
});

// ─── buildingSiteBlocked ──────────────────────────────────────────────────────

describe("buildingDotSuppressed", () => {
  function site(
    armedEntityId: EntityType,
    o: { cities?: string[]; graveyard?: string[]; fortificationDots?: string[] } = {},
  ) {
    return buildingDotSuppressed({
      armedEntityId,
      key: "1,0",
      cities: new Set(o.cities ?? []),
      graveyard: new Set(o.graveyard ?? []),
      fortificationDots: new Set(o.fortificationDots ?? []),
    });
  }

  it("a city tile takes no building — the tap handler rejects it, so no dot", () => {
    // The reported bug: arming a tower drew a dot on a city it cannot take.
    expect(site("tower", { cities: ["1,0"] })).toBe(true);
    expect(site("castle", { cities: ["1,0"] })).toBe(true);
    expect(site("city", { cities: ["1,0"] })).toBe(true);
  });

  it("units are unaffected — they may stand on a city, a grave or beside a fort", () => {
    expect(site("peasant", { cities: ["1,0"] })).toBe(false);
    expect(site("peasant", { graveyard: ["1,0"] })).toBe(false);
    expect(site("peasant", { fortificationDots: ["1,0"] })).toBe(false);
  });

  // Fort cover is the one term that is a display choice rather than a rule:
  // the blue cover dot keeps the tile, and the tap still builds.
  it("graves (a rule) and existing fort cover (a display choice) both withdraw the dot", () => {
    expect(site("tower", { graveyard: ["1,0"] })).toBe(true);
    expect(site("tower", { fortificationDots: ["1,0"] })).toBe(true);
  });

  it("a clear tile blocks nothing", () => {
    expect(site("tower", { cities: ["0,0"], graveyard: ["2,0"] })).toBe(false);
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
      makeTile(3, 0, "player", "grass"),   // city +1, terrain 2
    ];
    const map = new Map(tiles.map((t) => [t.key, t]));
    const entities = new Map<string, EntityType>([["1,0", "rebel"]]); // forest suppressed
    const cities = new Set<string>(["3,0"]);
    // grass 2 + (forest rebel 0) + field 3 + grass 2 + city 1 = 8
    // + city-adjacency bonus: field at 2,0 is adjacent to same-owner city at 3,0 -> +1 = 9
    expect(calcTerritoryIncome(tiles, entities, cities, map)).toBe(9);
  });
});

describe("tileEconomicIncome", () => {
  const noCityNeighbor = () => false;
  it("returns terrain income for a plain tile", () => {
    expect(tileEconomicIncome(makeTile(0, 0, "player", "grass"), new Set(), noCityNeighbor)).toBe(2);
    expect(tileEconomicIncome(makeTile(0, 0, "player", "desert"), new Set(), noCityNeighbor)).toBe(1);
  });
  it("adds CITY_BONUS when the tile itself is a city", () => {
    // grass 2 + CITY_BONUS 1 = 3 — this is the value a rebel on a grass city denies.
    expect(
      tileEconomicIncome(makeTile(0, 0, "player", "grass"), new Set(["0,0"]), noCityNeighbor),
    ).toBe(3);
  });
  it("adds +1 per adjacent owned city for a field tile", () => {
    // field 3 + one adjacent owned city = 4
    expect(
      tileEconomicIncome(makeTile(1, 0, "player", "field"), new Set(["0,0"]), (nk) => nk === "0,0"),
    ).toBe(4);
  });
  it("does not add the adjacency bonus for a sawmill or mine (fields only)", () => {
    // sawmill 3, mine 3 — neither earns the city-adjacency bonus.
    expect(
      tileEconomicIncome(makeTile(1, 0, "player", "sawmill"), new Set(["0,0"]), (nk) => nk === "0,0"),
    ).toBe(3);
    expect(
      tileEconomicIncome(makeTile(1, 0, "player", "mine"), new Set(["0,0"]), (nk) => nk === "0,0"),
    ).toBe(3);
  });
  it("does not add the adjacency bonus for an unimproved tile", () => {
    expect(
      tileEconomicIncome(makeTile(1, 0, "player", "grass"), new Set(["0,0"]), (nk) => nk === "0,0"),
    ).toBe(2);
  });
});

describe("calcTerritoryIncome city-adjacency bonus", () => {
  it("grants +1 per field adjacent to a city; sawmills do not stack", () => {
    // City at 0,0; one field neighbour (+1 bonus) and one sawmill neighbour
    // (no bonus — fields only). Plus their own income (3 + 3) and the city
    // tile (grass 2 + city 1).
    const tiles = [
      makeTile(0, 0, "player", "grass"),    // city: 2 + CITY_BONUS 1
      makeTile(1, 0, "player", "field"),    // 3, adjacent to city -> +1
      makeTile(0, 1, "player", "sawmill"),  // 3, adjacent to city -> no bonus
    ];
    const tileMap2 = new Map(tiles.map((t) => [t.key, t]));
    const cities = new Set(["0,0"]);
    // 2 + 1 (city) + 3 + 3 + 1 (field adj only) = 10
    expect(calcTerritoryIncome(tiles, new Map(), cities, tileMap2)).toBe(10);
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
  it("charges no burden when the element is off", () => {
    const tiles = Array.from({ length: 26 }, (_, i) =>
      makeTile(i, 0, "player", "grass"),
    );
    const off = { ...ALL_GAME_ELEMENTS, adminBurden: false };
    expect(calcTerritoryUpkeep(tiles, new Map(), off)).toBe(0);
  });

  it("still charges unit upkeep with the burden off", () => {
    const tiles = Array.from({ length: 26 }, (_, i) =>
      makeTile(i, 0, "player", "grass"),
    );
    const off = { ...ALL_GAME_ELEMENTS, adminBurden: false };
    expect(calcTerritoryUpkeep(tiles, ents([["0,0", "peasant"]]), off)).toBe(3);
  });

  it("charges the burden when the element is explicitly on", () => {
    const tiles = Array.from({ length: 26 }, (_, i) =>
      makeTile(i, 0, "player", "grass"),
    );
    expect(calcTerritoryUpkeep(tiles, new Map(), ALL_GAME_ELEMENTS)).toBe(3);
  });
});

// ─── canImproveTile ───────────────────────────────────────────────────────────

describe("canImproveTile", () => {
  const base = {
    terrain: "grass" as const,
    targetTerrain: "field" as const,
    balance: 5,
    anchor: "0,0" as string | null,
    isCity: false,
    occupantEntity: undefined as EntityType | undefined,
  };

  it("allows an empty tile whose terrain matches the improvement", () => {
    expect(canImproveTile(base)).toBe(true);
    expect(
      canImproveTile({ ...base, terrain: "forest", targetTerrain: "sawmill", balance: 4 }),
    ).toBe(true);
    expect(
      canImproveTile({ ...base, terrain: "desert", targetTerrain: "mine", balance: 5 }),
    ).toBe(true);
  });

  it("rejects a terrain that does not match the chosen improvement", () => {
    expect(canImproveTile({ ...base, terrain: "forest" })).toBe(false);
    expect(canImproveTile({ ...base, terrain: "desert" })).toBe(false);
  });

  it("rejects non-improvable and already-improved terrain", () => {
    expect(canImproveTile({ ...base, terrain: "mountain" })).toBe(false);
    expect(canImproveTile({ ...base, terrain: "lake" })).toBe(false);
    expect(canImproveTile({ ...base, terrain: "field" })).toBe(false);
    expect(canImproveTile({ ...base, terrain: "mine", targetTerrain: "mine" })).toBe(false);
  });

  it("requires a city in range that has not built this turn", () => {
    expect(canImproveTile({ ...base, anchor: null })).toBe(false);
  });

  it("rejects a city tile", () => {
    expect(canImproveTile({ ...base, isCity: true })).toBe(false);
  });

  it("rejects insufficient gold (field 2, sawmill 3, mine 4)", () => {
    expect(canImproveTile({ ...base, balance: 1 })).toBe(false);
    expect(
      canImproveTile({ ...base, terrain: "forest", targetTerrain: "sawmill", balance: 2 }),
    ).toBe(false);
    expect(
      canImproveTile({ ...base, terrain: "desert", targetTerrain: "mine", balance: 3 }),
    ).toBe(false);
  });

  it("allows building under a friendly unit", () => {
    expect(canImproveTile({ ...base, occupantEntity: "peasant" })).toBe(true);
    expect(canImproveTile({ ...base, occupantEntity: "swordsman" })).toBe(true);
    expect(canImproveTile({ ...base, occupantEntity: "knight" })).toBe(true);
  });

  it("rejects a tile occupied by a building", () => {
    expect(canImproveTile({ ...base, occupantEntity: "tower" })).toBe(false);
    expect(canImproveTile({ ...base, occupantEntity: "castle" })).toBe(false);
    expect(canImproveTile({ ...base, occupantEntity: "bridge" })).toBe(false);
  });

  it("rejects a tile occupied by a rebel", () => {
    expect(canImproveTile({ ...base, occupantEntity: "rebel" })).toBe(false);
  });
});

// ─── applyOwnerEconomy ────────────────────────────────────────────────────────
// The single source of truth for the per-owner economy step (income/upkeep/
// bankruptcy), applied once per owner per round at the start of that owner's
// turn. These were previously inlined in endTurnHandler; they live here now that
// the four drifted copies are unified into this one function.

describe("applyOwnerEconomy", () => {
  function run(o: {
    owner?: TerritoryOwner;
    tiles: HexTile[];
    entities?: [string, EntityType][];
    balances?: [string, number][];
    cities?: string[];
    incomeBonus?: boolean;
  }) {
    const tileMapM = tileMap(o.tiles);
    const entitiesM = ents(o.entities ?? []);
    const balancesM = new Map<string, number>(o.balances ?? []);
    const graveyard = new Set<string>();
    const ruins = new Set<string>();
    const bankrupt = applyOwnerEconomy({
      owner: o.owner ?? "player",
      tileMap: tileMapM,
      entities: entitiesM,
      balances: balancesM,
      cities: new Set(o.cities ?? []),
      graveyard,
      ruins,
      incomeBonus: o.incomeBonus ?? false,
    });
    return { bankrupt, tileMap: tileMapM, entities: entitiesM, balances: balancesM, graveyard, ruins };
  }

  it("credits grass tile income (2) to the balance", () => {
    const r = run({ tiles: [makeTile(0, 0, "player")], balances: [["0,0", 10]] });
    expect(r.balances.get("0,0")).toBe(12); // 10 + 2 income − 0 upkeep
    expect(r.bankrupt).toBe(false);
  });

  it("deducts unit upkeep from income", () => {
    const r = run({
      tiles: [makeTile(0, 0, "player")],
      entities: [["0,0", "peasant"]],
      balances: [["0,0", 10]],
    });
    expect(r.balances.get("0,0")).toBe(9); // 10 + 2 − 3
  });

  it("adds the city bonus to income", () => {
    const r = run({
      tiles: [makeTile(0, 0, "player")],
      balances: [["0,0", 0]],
      cities: ["0,0"],
    });
    expect(r.balances.get("0,0")).toBe(3); // grass 2 + city 1
  });

  it("kills units and drains the balance to 0 on bankruptcy", () => {
    // Desert (income 1) + swordsman (upkeep 27), no reserves → bankrupt.
    const r = run({
      tiles: [makeTile(0, 0, "player", "desert")],
      entities: [["0,0", "swordsman"]],
      balances: [["0,0", 0]],
    });
    expect(r.bankrupt).toBe(true);
    expect(r.balances.get("0,0")).toBe(0);
    expect(r.entities.has("0,0")).toBe(false);
    expect(r.graveyard.has("0,0")).toBe(true);
  });

  it("does not bankrupt when reserves cover the deficit", () => {
    // Grass (2) + peasant (3) → net −1; reserve 100 covers it.
    const r = run({
      tiles: [makeTile(0, 0, "player")],
      entities: [["0,0", "peasant"]],
      balances: [["0,0", 100]],
    });
    expect(r.bankrupt).toBe(false);
    expect(r.balances.get("0,0")).toBe(99);
    expect(r.entities.has("0,0")).toBe(true);
  });

  it("survives at exactly 0 (boundary: 0 is not < 0)", () => {
    // Two grass (income 4) + warrior on a lake/bridge (upkeep 9 + implied 1 = 10)
    // → net −6; a 6g reserve lands the balance at exactly 0 without bankruptcy.
    const r = run({
      tiles: [
        makeTile(0, 0, "player", "grass"),
        makeTile(1, 0, "player", "grass"),
        makeTile(0, 1, "player", "lake"),
      ],
      entities: [["0,1", "warrior"]],
      balances: [["0,0", 6]],
    });
    expect(r.bankrupt).toBe(false);
    expect(r.balances.get("0,0")).toBe(0);
    expect(r.entities.get("0,1")).toBe("warrior");
  });

  it("demolishes buildings when liquidating units cannot cover the deficit", () => {
    // Desert (1) + castle (upkeep 5), no units to liquidate → building demolished.
    const r = run({
      tiles: [makeTile(0, 0, "player", "desert")],
      entities: [["0,0", "castle"]],
      balances: [["0,0", 0]],
    });
    expect(r.bankrupt).toBe(true);
    expect(r.entities.has("0,0")).toBe(false);
    expect(r.ruins.has("0,0")).toBe(true);
  });

  it("releases a demolished bridge's lake tile to neutral", () => {
    // Grass with a rebel (income suppressed) + bridged lake → income 0, bridge
    // upkeep 1 → bankrupt → bridge demolished, its lake tile released to neutral.
    const r = run({
      tiles: [makeTile(0, 0, "player", "grass"), makeTile(1, 0, "player", "lake")],
      entities: [["0,0", "rebel"], ["1,0", "bridge"]],
      balances: [["0,0", 0]],
    });
    expect(r.bankrupt).toBe(true);
    expect(r.ruins.has("1,0")).toBe(true);
    expect(r.tileMap.get("1,0")?.owner).toBe("neutral");
  });

  it("grants the land-tile income bonus only when incomeBonus is set", () => {
    const base = { tiles: [makeTile(0, 0, "ai1")], owner: "ai1" as TerritoryOwner, balances: [["0,0", 0] as [string, number]] };
    expect(run({ ...base, incomeBonus: false }).balances.get("0,0")).toBe(2); // grass only
    expect(run({ ...base, incomeBonus: true }).balances.get("0,0")).toBe(3);  // grass 2 + 1 land tile
  });

  it("only touches the named owner's territories", () => {
    const r = run({
      owner: "player",
      tiles: [makeTile(0, 0, "player"), makeTile(5, 5, "ai1")],
      balances: [["0,0", 0], ["5,5", 0]],
    });
    expect(r.balances.get("0,0")).toBe(2); // player credited
    expect(r.balances.get("5,5")).toBe(0); // ai1 untouched
  });
});

// ─── Ranged merging ───────────────────────────────────────────────────────────

describe("ranged merging", () => {
  it("merges along the ranged track by tier", () => {
    expect(mergeResult("shortbowman", "shortbowman")).toBe("longbowman");
    expect(mergeResult("shortbowman", "longbowman")).toBe("crossbowman");
    expect(mergeResult("longbowman", "longbowman")).toBeNull();
    expect(mergeResult("crossbowman", "shortbowman")).toBeNull();
  });

  it("never merges with another track", () => {
    expect(mergeResult("shortbowman", "peasant")).toBeNull();
    expect(mergeResult("shortbowman", "scout")).toBeNull();
  });
});

// ─── Fired flag carry ─────────────────────────────────────────────────────────

describe("advanceFired", () => {
  it("carries the fired flag to the destination", () => {
    const r = advanceFired({
      firedUnits: new Set(["0,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: false,
    });
    expect(r.has("0,0")).toBe(false);
    expect(r.has("1,0")).toBe(true);
  });

  it("keeps the flag even when the unit runs out of movement", () => {
    // Unlike advanceAttacksUsed, becoming spent must NOT clear it: a ranged
    // unit can fire with zero movement left, so a dropped flag would hand it a
    // second shot.
    const r = advanceFired({
      firedUnits: new Set(["0,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: false,
    });
    expect(r.has("1,0")).toBe(true);
  });

  it("unions the flag on a merge", () => {
    const fromFired = advanceFired({
      firedUnits: new Set(["0,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: true,
    });
    expect(fromFired.has("1,0")).toBe(true);

    const destFired = advanceFired({
      firedUnits: new Set(["1,0"]),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: true,
    });
    expect(destFired.has("1,0")).toBe(true);
  });

  it("clears the destination when neither unit had fired", () => {
    const r = advanceFired({
      firedUnits: new Set(),
      fromKey: "0,0",
      toKey: "1,0",
      isMerge: false,
    });
    expect(r.has("1,0")).toBe(false);
  });
});

// ─── City founding rules ──────────────────────────────────────────────────────

describe("cityCapFor", () => {
  it("allows one city per five tiles, rounded down", () => {
    expect(cityCapFor(0)).toBe(0);
    expect(cityCapFor(4)).toBe(0);
    expect(cityCapFor(5)).toBe(1);
    expect(cityCapFor(9)).toBe(1);
    expect(cityCapFor(10)).toBe(2);
    expect(cityCapFor(23)).toBe(4);
  });
});

describe("canFoundCity", () => {
  const base = {
    targetKey: "0,0",
    territoryTileCount: 5,
    territoryCityCount: 0,
    ownCityKeys: [] as string[],
  };

  it("needs five tiles per city", () => {
    expect(canFoundCity({ ...base, territoryTileCount: 4 })).toBe(false);
    expect(canFoundCity({ ...base, territoryTileCount: 5 })).toBe(true);
  });

  it("counts the cities the territory already holds against the cap", () => {
    expect(canFoundCity({ ...base, territoryTileCount: 9, territoryCityCount: 1 })).toBe(false);
    expect(canFoundCity({ ...base, territoryTileCount: 10, territoryCityCount: 1 })).toBe(true);
  });

  it("rejects a site closer than four tiles to a city the owner holds", () => {
    // "3,0" is three tiles from the origin, "4,0" is four.
    expect(canFoundCity({ ...base, territoryTileCount: 10, territoryCityCount: 1, ownCityKeys: ["3,0"] })).toBe(false);
    expect(canFoundCity({ ...base, territoryTileCount: 10, territoryCityCount: 1, ownCityKeys: ["4,0"] })).toBe(true);
  });

  it("checks the distance against every own city, including ones outside this territory", () => {
    expect(
      canFoundCity({
        ...base,
        territoryTileCount: 20,
        territoryCityCount: 1,
        ownCityKeys: ["6,0", "1,1"],
      }),
    ).toBe(false);
  });
});

describe("ownCityKeys", () => {
  it("keeps only cities standing on tiles this owner holds", () => {
    const tileMap = new Map<string, HexTile>([
      ["0,0", mkTile("0,0", "player")],
      ["3,0", mkTile("3,0", "ai1")],
      ["6,0", mkTile("6,0", "neutral")],
    ]);
    const cities = new Set(["0,0", "3,0", "6,0"]);
    expect(ownCityKeys(cities, tileMap, "player")).toEqual(["0,0"]);
  });
});

describe("foundCitySites", () => {
  it("returns every legal tile of the territory and nothing else", () => {
    // A one-row territory from 0,0 to 4,0 with a city already at 0,0.
    const territory = ["0,0", "1,0", "2,0", "3,0", "4,0"].map((k) => mkTile(k, "player"));
    const sites = foundCitySites(territory, 1, ["0,0"]);
    // Cap is floor(5/5) = 1 and one city exists, so nothing is legal.
    expect(sites.size).toBe(0);
  });

  it("excludes only the tiles within four of an own city", () => {
    const keys = ["0,0", "1,0", "2,0", "3,0", "4,0", "5,0", "6,0", "7,0", "8,0", "9,0"];
    const territory = keys.map((k) => mkTile(k, "player"));
    const sites = foundCitySites(territory, 1, ["0,0"]);
    expect([...sites].sort()).toEqual(["4,0", "5,0", "6,0", "7,0", "8,0", "9,0"]);
  });
});

// ─── cityImproveReach ─────────────────────────────────────────────────────────

/** Open grass spanning q,r in -5..5 — every zone under test fits inside it. */
function openBoard(): Map<string, HexTile> {
  const tiles: HexTile[] = [];
  for (let q = -5; q <= 5; q++) {
    for (let r = -5; r <= 5; r++) tiles.push(makeTile(q, r, "player"));
  }
  return tileMap(tiles);
}

/** `openBoard` with the listed tiles retextured, for the blocking tests. */
function boardWith(terrainByKey: Record<string, HexTile["terrain"]>): Map<string, HexTile> {
  const map = openBoard();
  for (const [key, terrain] of Object.entries(terrainByKey)) {
    map.set(key, { ...map.get(key)!, terrain });
  }
  return map;
}

function reachOn(
  cityKeys: string[],
  map: Map<string, HexTile> = openBoard(),
  entities: Map<string, EntityType> = new Map(),
) {
  return cityImproveReach({ cityKeys, owner: "player", tileMap: map, entities });
}

/** `boardWith`, then the listed tiles handed to another owner. */
function boardOwnedBy(
  terrainByKey: Record<string, HexTile["terrain"]>,
  ownerByKey: Record<string, TerritoryOwner>,
): Map<string, HexTile> {
  const map = boardWith(terrainByKey);
  for (const [key, owner] of Object.entries(ownerByKey)) {
    map.set(key, { ...map.get(key)!, owner });
  }
  return map;
}

describe("cityImproveReach", () => {
  it("reaches every tile within two steps on open ground", () => {
    const reach = reachOn(["0,0"]);
    // The whole distance-2 disc, city tile included, and nothing beyond it.
    for (const t of openBoard().values()) {
      const within = hexDistance(t.q, t.r, 0, 0) <= 2;
      expect(reach.get(t.key)?.has("0,0") ?? false).toBe(within);
    }
  });

  it("counts steps, not movement cost, so a forest two away stays in reach", () => {
    // Forest costs 2 movement to enter; the zone is measured in steps.
    const reach = reachOn(["0,0"], boardWith({ "1,0": "forest", "2,0": "forest" }));
    expect(reach.get("2,0")?.get("0,0")).toBe(2);
  });

  it("does not reach through a mountain", () => {
    // "1,0" is the only two-step route from "0,0" to "2,0".
    const reach = reachOn(["0,0"], boardWith({ "1,0": "mountain" }));
    expect(reach.has("1,0")).toBe(false);
    expect(reach.has("2,0")).toBe(false);
    // A tile the ridge does not stand in front of is untouched.
    expect(reach.get("0,2")?.get("0,0")).toBe(2);
  });

  it("does not reach across an unbridged lake", () => {
    const lake = boardWith({ "1,0": "lake" });
    expect(reachOn(["0,0"], lake).has("2,0")).toBe(false);
  });

  it("reaches across its own bridged lake, but the lake itself is only a corridor", () => {
    const lake = boardWith({ "1,0": "lake" });
    const reach = reachOn(["0,0"], lake, ents([["1,0", "bridge"]]));
    expect(reach.get("2,0")?.get("0,0")).toBe(2);
    // The lake tile is reachable; canImproveTile is what refuses to build on it.
    expect(reach.get("1,0")?.get("0,0")).toBe(1);
  });

  it("does not cross an enemy's bridge", () => {
    // Units may walk over anyone's bridge; a city only builds across its own.
    const enemyBridge = boardOwnedBy({ "1,0": "lake" }, { "1,0": "ai1" });
    const reach = reachOn(["0,0"], enemyBridge, ents([["1,0", "bridge"]]));
    expect(reach.has("1,0")).toBe(false);
    expect(reach.has("2,0")).toBe(false);
  });

  it("does not open a route because an enemy unit stands on the water", () => {
    const enemyOnLake = boardOwnedBy({ "1,0": "lake" }, { "1,0": "ai1" });
    const reach = reachOn(["0,0"], enemyOnLake, ents([["1,0", "swordsman"]]));
    expect(reach.has("2,0")).toBe(false);
  });

  it("crosses a lake its own unit holds", () => {
    // A unit standing on your bridge keeps the crossing open while it is there.
    const lake = boardWith({ "1,0": "lake" });
    const reach = reachOn(["0,0"], lake, ents([["1,0", "swordsman"]]));
    expect(reach.get("2,0")?.get("0,0")).toBe(2);
  });

  it("records every city that reaches a tile, with its own step count", () => {
    expect(reachOn(["0,0", "2,0"]).get("1,0")).toEqual(new Map([["0,0", 1], ["2,0", 1]]));
  });
});

// ─── findImproveAnchor ────────────────────────────────────────────────────────

describe("findImproveAnchor", () => {
  const noneUsed = new Set<string>();

  it("picks a city within two tiles and reports it in range", () => {
    expect(
      findImproveAnchor({ tileKey: "2,0", reach: reachOn(["0,0"]), usedCities: noneUsed }),
    ).toEqual({ anchor: "0,0", inRange: true });
  });

  it("rejects a tile three or more away", () => {
    expect(
      findImproveAnchor({ tileKey: "3,0", reach: reachOn(["0,0"]), usedCities: noneUsed }),
    ).toEqual({ anchor: null, inRange: false });
  });

  it("rejects a tile two away that no route reaches", () => {
    const reach = reachOn(["0,0"], boardWith({ "1,0": "mountain" }));
    expect(findImproveAnchor({ tileKey: "2,0", reach, usedCities: noneUsed })).toEqual({
      anchor: null,
      inRange: false,
    });
  });

  it("returns nothing when the territory has no city at all", () => {
    expect(
      findImproveAnchor({ tileKey: "0,0", reach: reachOn([]), usedCities: noneUsed }),
    ).toEqual({ anchor: null, inRange: false });
  });

  it("prefers the nearest city among several in range", () => {
    expect(
      findImproveAnchor({
        tileKey: "1,0",
        reach: reachOn(["3,0", "0,0"]),
        usedCities: noneUsed,
      }).anchor,
    ).toBe("0,0");
  });

  it("skips a city that already built this turn and takes the next nearest", () => {
    expect(
      findImproveAnchor({
        tileKey: "1,0",
        reach: reachOn(["0,0", "3,0"]),
        usedCities: new Set(["0,0"]),
      }),
    ).toEqual({ anchor: "3,0", inRange: true });
  });

  it("reports in range but no anchor when every city in range has built", () => {
    expect(
      findImproveAnchor({
        tileKey: "1,0",
        reach: reachOn(["0,0"]),
        usedCities: new Set(["0,0"]),
      }),
    ).toEqual({ anchor: null, inRange: true });
  });

  it("breaks ties between equally distant cities by tile key", () => {
    // "0,0" and "2,0" are both one step from "1,0".
    expect(
      findImproveAnchor({
        tileKey: "1,0",
        reach: reachOn(["2,0", "0,0"]),
        usedCities: noneUsed,
      }).anchor,
    ).toBe("0,0");
  });

  it("takes the city with the shorter route, not the shorter line of sight", () => {
    // A ridge in front of "0,0" leaves it two steps from "1,0" the long way
    // round, while "3,0" reaches the same tile in two steps unobstructed.
    // Without the wall "0,0" would win at one step.
    const reach = reachOn(["0,0", "3,0"], boardWith({ "1,0": "mountain" }));
    expect(reach.get("2,0")?.has("0,0")).toBe(false);
    expect(findImproveAnchor({ tileKey: "2,0", reach, usedCities: noneUsed }).anchor).toBe("3,0");
  });
});
