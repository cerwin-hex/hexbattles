import { describe, expect, it } from "vitest";
import {
  ALL_GAME_ELEMENTS,
  DEFAULT_GAME_ELEMENTS,
  GAME_ELEMENTS,
  decodeGameElements,
  elementsForNewGame,
  enabledUnitTypes,
  enabledVisibleCount,
  encodeGameElements,
  isEntityEnabled,
  normalizeGameElements,
  visibleGameElements,
  type GameElementDef,
} from "@/constants/gameElements";

// main ships no beta element, so beta behaviour is exercised against a fixture
// that marks a real element as beta. Using real ids keeps the types honest.
const BETA_FIXTURE: readonly GameElementDef[] = GAME_ELEMENTS.map((d) =>
  d.id === "rebels" ? { ...d, beta: true } : d,
);

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
    const off = { ...ALL_GAME_ELEMENTS, mounted: false };
    expect(enabledUnitTypes(off)).toEqual(["peasant", "warrior", "swordsman"]);
    expect(enabledUnitTypes(ALL_GAME_ELEMENTS)).toContain("knight");
    expect(enabledUnitTypes(ALL_GAME_ELEMENTS)).not.toContain("tower");
  });

  it("returns the same array instance for the same element object", () => {
    const set = { ...ALL_GAME_ELEMENTS };
    expect(enabledUnitTypes(set)).toBe(enabledUnitTypes(set));
  });
});

describe("beta visibility", () => {
  it("hides beta elements until they are opted into", () => {
    expect(visibleGameElements(false, BETA_FIXTURE).map((d) => d.id)).not.toContain("rebels");
    expect(visibleGameElements(true, BETA_FIXTURE).map((d) => d.id)).toContain("rebels");
  });

  it("forces a hidden beta element off for a new game", () => {
    const chosen = { ...ALL_GAME_ELEMENTS };
    expect(elementsForNewGame(chosen, false, BETA_FIXTURE).rebels).toBe(false);
    expect(elementsForNewGame(chosen, true, BETA_FIXTURE).rebels).toBe(true);
  });

  it("leaves the stored choice untouched", () => {
    const chosen = { ...ALL_GAME_ELEMENTS };
    elementsForNewGame(chosen, false, BETA_FIXTURE);
    expect(chosen.rebels).toBe(true);
  });

  it("counts only the visible elements", () => {
    const chosen = { ...ALL_GAME_ELEMENTS, mounted: false };
    expect(enabledVisibleCount(chosen, false, BETA_FIXTURE)).toEqual({ on: 2, total: 3 });
    expect(enabledVisibleCount(chosen, true, BETA_FIXTURE)).toEqual({ on: 3, total: 4 });
  });
});
