import { describe, expect, it, vi } from "vitest";

// Hoisted before the import below: settings.ts captures AsyncStorage at module
// load time. These tests only exercise the pure normalizer, but the module
// still has to load.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { DEFAULT_GAME_ELEMENTS } from "@/constants/gameElements";
import {
  cityCountForMap,
  cityPctForCount,
  DEFAULT_SETTINGS,
  maxCitiesForMap,
  normalizeSettings,
} from "@/utils/settings";

describe("normalizeSettings — game elements", () => {
  it("fills the element set from the defaults when absent", () => {
    expect(normalizeSettings({}).elements).toEqual(DEFAULT_GAME_ELEMENTS);
  });

  it("keeps a stored element set", () => {
    const stored = { ...DEFAULT_GAME_ELEMENTS, rebels: false };
    expect(normalizeSettings({ elements: stored }).elements).toEqual(stored);
  });

  it("repairs a corrupt element set", () => {
    const out = normalizeSettings({ elements: { rebels: "no", bogus: 1 } as never });
    expect(out.elements).toEqual(DEFAULT_GAME_ELEMENTS);
  });

  it("still normalizes the pre-existing fields", () => {
    expect(normalizeSettings({ mountainPct: 999 }).mountainPct).toBe(25);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("normalizeSettings — remembered new-game choices", () => {
  it("falls back to the defaults for a blob written before the fields existed", () => {
    const out = normalizeSettings({ playerColor: "red" });
    expect(out.tileCount).toBe(DEFAULT_SETTINGS.tileCount);
    expect(out.opponentCount).toBe(DEFAULT_SETTINGS.opponentCount);
    expect(out.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
  });

  it("keeps stored choices", () => {
    const out = normalizeSettings({
      tileCount: 150,
      opponentCount: 1,
      difficulty: "super_expert",
    });
    expect(out.tileCount).toBe(150);
    expect(out.opponentCount).toBe(1);
    expect(out.difficulty).toBe("super_expert");
  });

  it("clamps tileCount to the slider's range", () => {
    expect(normalizeSettings({ tileCount: 5 }).tileCount).toBe(40);
    expect(normalizeSettings({ tileCount: 9999 }).tileCount).toBe(200);
  });

  it("clamps opponentCount to the number of pills", () => {
    expect(normalizeSettings({ opponentCount: 0 }).opponentCount).toBe(1);
    expect(normalizeSettings({ opponentCount: 12 }).opponentCount).toBe(4);
  });

  it("rejects a difficulty that is not one of the five", () => {
    expect(normalizeSettings({ difficulty: "nightmare" as never }).difficulty).toBe("medium");
    expect(normalizeSettings({ difficulty: null as never }).difficulty).toBe("medium");
  });
});

describe("normalizeSettings — neutral city density", () => {
  it("reads a blob written when cities were a plain count", () => {
    // The default map was 100 tiles then, so the count is already a density.
    expect(normalizeSettings({ cityCount: 3 } as never).cityPct).toBe(3);
    expect(normalizeSettings({ cityCount: 0 } as never).cityPct).toBe(0);
  });

  it("prefers the density when both fields are present", () => {
    expect(normalizeSettings({ cityCount: 5, cityPct: 1 } as never).cityPct).toBe(1);
  });

  it("keeps the fractional density the slider produces on odd map sizes", () => {
    expect(normalizeSettings({ cityPct: 2.5 }).cityPct).toBe(2.5);
  });

  it("clamps a corrupt or out-of-range density", () => {
    expect(normalizeSettings({ cityPct: 99 }).cityPct).toBe(6);
    expect(normalizeSettings({ cityPct: -4 }).cityPct).toBe(0);
    expect(normalizeSettings({ cityPct: Number.NaN }).cityPct).toBe(0);
    expect(normalizeSettings({}).cityPct).toBe(DEFAULT_SETTINGS.cityPct);
  });
});

describe("city density ↔ count", () => {
  it("turns one density into more cities on a bigger map", () => {
    expect(cityCountForMap(2, 40)).toBe(1);
    expect(cityCountForMap(2, 100)).toBe(2);
    expect(cityCountForMap(2, 200)).toBe(4);
  });

  it("gives no cities only when the density is zero", () => {
    expect(cityCountForMap(0, 200)).toBe(0);
    // 1% of 40 tiles rounds to nothing; a chosen density must still show up.
    expect(cityCountForMap(1, 40)).toBe(1);
  });

  it("offers a wider slider on a bigger map", () => {
    expect(maxCitiesForMap(40)).toBe(2);
    expect(maxCitiesForMap(100)).toBe(4);
    expect(maxCitiesForMap(200)).toBe(8);
  });

  it("never returns more cities than the slider offers", () => {
    for (const tiles of [40, 70, 100, 150, 200]) {
      expect(cityCountForMap(6, tiles)).toBe(maxCitiesForMap(tiles));
    }
  });

  it("round-trips a slider position through the stored density", () => {
    for (const tiles of [40, 70, 100, 150, 200]) {
      for (let count = 0; count <= maxCitiesForMap(tiles); count++) {
        expect(cityCountForMap(cityPctForCount(count, tiles), tiles)).toBe(count);
      }
    }
  });
});
