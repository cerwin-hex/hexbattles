import { describe, expect, it } from "vitest";
import {
  ALL_GAME_ELEMENTS,
  DEFAULT_GAME_ELEMENTS,
  GAME_ELEMENTS,
  decodeGameElements,
  enabledElementCount,
  enabledUnitTypes,
  encodeGameElements,
  isEntityEnabled,
  normalizeGameElements,
  type GameElementDef,
} from "@/constants/gameElements";

// Beta behaviour is exercised against a fixture that marks a real element as
// beta, so these cases stay stable as elements graduate out of beta. Using real
// ids keeps the types honest.
const BETA_FIXTURE: readonly GameElementDef[] = GAME_ELEMENTS.map((d) =>
  d.id === "rebels" ? { ...d, beta: true } : d,
);

// Mirrors the rule DEFAULT_GAME_ELEMENTS applies, so the fixture's beta element
// can be exercised independently of which elements ship in beta.
function buildDefaultsFor(defs: readonly GameElementDef[]): Record<string, boolean> {
  return Object.fromEntries(defs.map((d) => [d.id, !d.beta]));
}

describe("GAME_ELEMENTS", () => {
  it("has no duplicate ids", () => {
    const ids = GAME_ELEMENTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every element a name and a blurb", () => {
    for (const d of GAME_ELEMENTS) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.blurb.length).toBeGreaterThan(0);
    }
  });
});

describe("DEFAULT_GAME_ELEMENTS / ALL_GAME_ELEMENTS", () => {
  it("defaults every non-beta element on and every beta element off", () => {
    for (const d of GAME_ELEMENTS) {
      expect(DEFAULT_GAME_ELEMENTS[d.id]).toBe(!d.beta);
    }
  });

  it("turns everything on in ALL_GAME_ELEMENTS", () => {
    for (const d of GAME_ELEMENTS) expect(ALL_GAME_ELEMENTS[d.id]).toBe(true);
  });
});

describe("normalizeGameElements", () => {
  it("returns the defaults for null and undefined", () => {
    expect(normalizeGameElements(null)).toEqual(DEFAULT_GAME_ELEMENTS);
    expect(normalizeGameElements(undefined)).toEqual(DEFAULT_GAME_ELEMENTS);
  });

  it("keeps known booleans and fills the rest from the defaults", () => {
    const out = normalizeGameElements({ rebels: false });
    expect(out.rebels).toBe(false);
    expect(out.mounted).toBe(DEFAULT_GAME_ELEMENTS.mounted);
  });

  it("drops unknown keys and non-boolean values", () => {
    const out = normalizeGameElements({ nonsense: true, mounted: "yes" });
    expect(out).toEqual(DEFAULT_GAME_ELEMENTS);
    expect("nonsense" in out).toBe(false);
  });
});

describe("encode / decode", () => {
  it("round-trips a mixed set", () => {
    const set = { ...ALL_GAME_ELEMENTS, rebels: false };
    expect(decodeGameElements(encodeGameElements(set))).toEqual(set);
  });

  it("round-trips the all-on and all-off sets", () => {
    const allOff = normalizeGameElements(
      Object.fromEntries(GAME_ELEMENTS.map((d) => [d.id, false])),
    );
    expect(decodeGameElements(encodeGameElements(ALL_GAME_ELEMENTS))).toEqual(ALL_GAME_ELEMENTS);
    expect(encodeGameElements(allOff)).toBe("");
    expect(decodeGameElements("")).toEqual(allOff);
  });

  it("treats a missing param as the defaults, not as all-off", () => {
    expect(decodeGameElements(undefined)).toEqual(DEFAULT_GAME_ELEMENTS);
  });
});

describe("isEntityEnabled / enabledUnitTypes", () => {
  it("gates scout and knight behind mounted", () => {
    const off = { ...ALL_GAME_ELEMENTS, mounted: false };
    expect(isEntityEnabled("scout", off)).toBe(false);
    expect(isEntityEnabled("knight", off)).toBe(false);
    expect(isEntityEnabled("scout", ALL_GAME_ELEMENTS)).toBe(true);
  });

  it("leaves ungated entities alone", () => {
    const off = { ...ALL_GAME_ELEMENTS, mounted: false };
    for (const id of ["peasant", "warrior", "swordsman", "tower", "castle"] as const) {
      expect(isEntityEnabled(id, off)).toBe(true);
    }
  });

  it("lists only enabled units and never a building", () => {
    const off = { ...ALL_GAME_ELEMENTS, mounted: false, ranged: false };
    expect(enabledUnitTypes(off)).toEqual(["peasant", "warrior", "swordsman"]);
    expect(enabledUnitTypes(ALL_GAME_ELEMENTS)).toContain("knight");
    expect(enabledUnitTypes(ALL_GAME_ELEMENTS)).toContain("longbowman");
    expect(enabledUnitTypes(ALL_GAME_ELEMENTS)).not.toContain("tower");
  });

  it("returns the same array instance for the same element object", () => {
    const set = { ...ALL_GAME_ELEMENTS };
    expect(enabledUnitTypes(set)).toBe(enabledUnitTypes(set));
  });
});

describe("beta elements", () => {
  it("starts a beta element off and every other element on", () => {
    const defaults = buildDefaultsFor(BETA_FIXTURE);
    expect(defaults.rebels).toBe(false);
    expect(defaults.mounted).toBe(true);
    expect(defaults.improvements).toBe(true);
    expect(defaults.adminBurden).toBe(true);
  });

  it("lists a beta element like any other — nothing is hidden", () => {
    expect(BETA_FIXTURE.map((d) => d.id)).toContain("rebels");
    expect(enabledElementCount({ ...ALL_GAME_ELEMENTS }, BETA_FIXTURE).total).toBe(
      BETA_FIXTURE.length,
    );
  });
});

describe("enabledElementCount", () => {
  it("counts the enabled elements against the whole registry", () => {
    const total = GAME_ELEMENTS.length;
    const chosen = { ...ALL_GAME_ELEMENTS, mounted: false };
    expect(enabledElementCount(chosen)).toEqual({ on: total - 1, total });
    expect(enabledElementCount(ALL_GAME_ELEMENTS)).toEqual({ on: total, total });
  });
});
