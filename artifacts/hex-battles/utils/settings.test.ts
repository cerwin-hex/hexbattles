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
import { DEFAULT_SETTINGS, normalizeSettings } from "@/utils/settings";

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
