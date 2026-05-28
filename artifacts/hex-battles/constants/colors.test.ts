import { describe, it, expect } from "vitest";
import { buildOwnerColorMaps, COLOR_PALETTE } from "@/constants/colors";
import { COLOR_KEYS } from "@/utils/settings";

describe("buildOwnerColorMaps", () => {
  it("assigns the chosen color to the player slot", () => {
    const maps = buildOwnerColorMaps("red");
    expect(maps.fills.player).toBe(COLOR_PALETTE.red.fill);
    expect(maps.borders.player).toBe(COLOR_PALETTE.red.border);
  });

  it("distributes the remaining five colors to ai1..ai5 without duplicates", () => {
    const maps = buildOwnerColorMaps("green");
    const aiFills = ["ai1", "ai2", "ai3", "ai4", "ai5"].map((k) => maps.fills[k]);
    expect(new Set(aiFills).size).toBe(5);
    expect(aiFills.includes(COLOR_PALETTE.green.fill)).toBe(false);
  });

  it("keeps neutral fill defined", () => {
    const maps = buildOwnerColorMaps("teal");
    expect(maps.fills.neutral).toBeTruthy();
  });

  it("works for every color in the palette", () => {
    for (const c of COLOR_KEYS) {
      const maps = buildOwnerColorMaps(c);
      expect(maps.fills.player).toBe(COLOR_PALETTE[c].fill);
      expect(Object.keys(maps.borders).filter((k) => k.startsWith("ai"))).toHaveLength(5);
    }
  });
});
