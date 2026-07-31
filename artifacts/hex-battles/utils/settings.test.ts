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
  it("fills both new fields from the defaults when absent", () => {
    const out = normalizeSettings({});
    expect(out.elements).toEqual(DEFAULT_GAME_ELEMENTS);
    expect(out.showBetaElements).toBe(false);
  });

  it("keeps a stored element set", () => {
    const stored = { ...DEFAULT_GAME_ELEMENTS, rebels: false };
    expect(normalizeSettings({ elements: stored }).elements).toEqual(stored);
  });

  it("repairs a corrupt element set", () => {
    const out = normalizeSettings({ elements: { rebels: "no", bogus: 1 } as never });
    expect(out.elements).toEqual(DEFAULT_GAME_ELEMENTS);
  });

  it("treats any non-true showBetaElements as false", () => {
    expect(normalizeSettings({ showBetaElements: true }).showBetaElements).toBe(true);
    expect(normalizeSettings({ showBetaElements: "yes" as never }).showBetaElements).toBe(false);
  });

  it("still normalizes the pre-existing fields", () => {
    expect(normalizeSettings({ mountainPct: 999 }).mountainPct).toBe(25);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
