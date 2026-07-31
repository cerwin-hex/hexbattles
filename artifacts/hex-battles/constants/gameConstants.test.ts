import { describe, expect, it } from "vitest";
import { ALL_GAME_ELEMENTS } from "@/constants/gameElements";
import {
  INFO_TABLE_ROWS,
  buildingPurchasablesFor,
  improvementPurchasablesFor,
  unitPurchasablesFor,
} from "@/constants/gameConstants";

const noMounted = { ...ALL_GAME_ELEMENTS, mounted: false };
const noImprovements = { ...ALL_GAME_ELEMENTS, improvements: false };

describe("unitPurchasablesFor", () => {
  it("drops cavalry when mounted is off", () => {
    const ids = unitPurchasablesFor(noMounted).map((p) => p.id);
    expect(ids).not.toContain("scout");
    expect(ids).not.toContain("knight");
  });

  it("keeps cavalry when mounted is on", () => {
    const ids = unitPurchasablesFor(ALL_GAME_ELEMENTS).map((p) => p.id);
    expect(ids).toContain("scout");
    expect(ids).toContain("knight");
  });

  it("always keeps the melee track", () => {
    for (const set of [noMounted, ALL_GAME_ELEMENTS]) {
      const ids = unitPurchasablesFor(set).map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining(["peasant", "warrior", "swordsman"]));
    }
  });

  it("never lists the rebel", () => {
    expect(unitPurchasablesFor(ALL_GAME_ELEMENTS).map((p) => p.id)).not.toContain("rebel");
  });
});

describe("buildingPurchasablesFor", () => {
  it("is unaffected by the mounted element", () => {
    expect(buildingPurchasablesFor(noMounted).map((p) => p.id)).toEqual(
      buildingPurchasablesFor(ALL_GAME_ELEMENTS).map((p) => p.id),
    );
  });
});

describe("improvementPurchasablesFor", () => {
  it("is empty when improvements are off", () => {
    expect(improvementPurchasablesFor(noImprovements)).toEqual([]);
  });

  it("lists every improvement when they are on", () => {
    expect(improvementPurchasablesFor(ALL_GAME_ELEMENTS).length).toBeGreaterThan(0);
  });
});

describe("reference tables", () => {
  it("still describes the whole game", () => {
    // The rules and welcome modals never filter — see the spec, section 2.
    expect(INFO_TABLE_ROWS.map((r) => r.id)).toContain("knight");
  });
});
