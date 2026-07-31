import { describe, it, expect } from "vitest";
import type { EntityType, HexTile, TerritoryOwner } from "@/types";
import { rangedTargets, resolveRangedShot } from "@/logic/rangedAttack";

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

// A shooter on 0,0 (player) with all six neighbours owned by ai1.
function board(): Map<string, HexTile> {
  return tileMap([
    makeTile(0, 0, "player"),
    makeTile(1, 0, "ai1"),
    makeTile(0, 1, "ai1"),
    makeTile(-1, 1, "ai1"),
    makeTile(-1, 0, "ai1"),
    makeTile(0, -1, "ai1"),
    makeTile(1, -1, "ai1"),
    makeTile(2, 0, "ai1"), // two tiles away
  ]);
}

function targets(
  shooter: EntityType,
  others: Array<[string, EntityType]>,
  opts: { fired?: boolean; map?: Map<string, HexTile> } = {},
): Set<string> {
  return rangedTargets({
    shooterKey: "0,0",
    owner: "player",
    entities: new Map<string, EntityType>([["0,0", shooter], ...others]),
    tileMap: opts.map ?? board(),
    firedUnits: new Set(opts.fired ? ["0,0"] : []),
  });
}

describe("rangedTargets", () => {
  it("kills what its offense beats and nothing else", () => {
    // Shortbowman: offense 2 — beats defense 1, not defense 2.
    const t = targets("shortbowman", [
      ["1,0", "peasant"],   // def 1 → killable
      ["0,1", "warrior"],   // def 2 → not killable
      ["-1,0", "scout"],    // def 1 → killable
    ]);
    expect([...t].sort()).toEqual(["-1,0", "1,0"]);
  });

  it("lets a Crossbowman kill the strongest unit in the game", () => {
    const t = targets("crossbowman", [["1,0", "swordsman"]]); // off 4 > def 3
    expect(t.has("1,0")).toBe(true);
  });

  it("never targets fortifications, cities or bridges", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1"),
      makeTile(0, 1, "ai1"),
      makeTile(-1, 0, "ai1", "lake"),
    ]);
    const t = targets(
      "crossbowman",
      [["1,0", "tower"], ["0,1", "castle"], ["-1,0", "bridge"]],
      { map },
    );
    expect(t.size).toBe(0);
  });

  it("never targets a friendly unit", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "player")]);
    expect(targets("crossbowman", [["1,0", "peasant"]], { map }).size).toBe(0);
  });

  it("targets a rebel on either side's ground", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "player"),
      makeTile(0, 1, "ai1"),
    ]);
    const t = targets("shortbowman", [["1,0", "rebel"], ["0,1", "rebel"]], { map });
    expect([...t].sort()).toEqual(["0,1", "1,0"]);
  });

  it("has range 1 only", () => {
    expect(targets("crossbowman", [["2,0", "peasant"]]).size).toBe(0);
  });

  it("offers nothing once the unit has fired", () => {
    expect(targets("crossbowman", [["1,0", "peasant"]], { fired: true }).size).toBe(0);
  });

  it("offers nothing for a non-ranged unit", () => {
    expect(targets("swordsman", [["1,0", "peasant"]]).size).toBe(0);
  });
});

describe("resolveRangedShot", () => {
  it("removes the victim, marks the tile and spends the shot", () => {
    const map = board();
    const before = new Map<string, EntityType>([
      ["0,0", "crossbowman"],
      ["1,0", "swordsman"],
    ]);
    const r = resolveRangedShot({
      shooterKey: "0,0",
      targetKey: "1,0",
      entities: before,
      tileMap: map,
      killMarks: new Set(),
      firedUnits: new Set(),
    });
    expect(r.entities.has("1,0")).toBe(false);
    expect(r.entities.get("0,0")).toBe("crossbowman");
    expect(r.killMarks.has("1,0")).toBe(true);
    expect(r.firedUnits.has("0,0")).toBe(true);
    // Inputs are not mutated.
    expect(before.has("1,0")).toBe(true);
  });

  it("leaves the bridge standing when the victim was on a lake", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "ai1", "lake")]);
    const r = resolveRangedShot({
      shooterKey: "0,0",
      targetKey: "1,0",
      entities: new Map<string, EntityType>([
        ["0,0", "crossbowman"],
        ["1,0", "peasant"],
      ]),
      tileMap: map,
      killMarks: new Set(),
      firedUnits: new Set(),
    });
    expect(r.entities.get("1,0")).toBe("bridge");
  });

  it("does not change tile ownership", () => {
    const map = board();
    resolveRangedShot({
      shooterKey: "0,0",
      targetKey: "1,0",
      entities: new Map<string, EntityType>([
        ["0,0", "crossbowman"],
        ["1,0", "peasant"],
      ]),
      tileMap: map,
      killMarks: new Set(),
      firedUnits: new Set(),
    });
    expect(map.get("1,0")!.owner).toBe("ai1");
  });
});
