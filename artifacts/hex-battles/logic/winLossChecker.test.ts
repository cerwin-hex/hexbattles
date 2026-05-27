import { describe, it, expect } from "vitest";
import type { HexTile, TerritoryOwner } from "@/types";
import { checkWinLossLogic } from "@/logic/winLossChecker";

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

function domRef(shown = false): { current: boolean } {
  return { current: shown };
}

// ─── Defeat ───────────────────────────────────────────────────────────────────

describe("defeat", () => {
  it("returns defeat when player has no tiles", () => {
    const map = tileMap([makeTile(0, 0, "ai1")]);
    const result = checkWinLossLogic(map, ["ai1"], domRef());
    expect(result).toEqual({ result: "defeat" });
  });

  it("returns defeat when all player tiles are zero (empty map)", () => {
    const result = checkWinLossLogic(new Map(), ["ai1"], domRef());
    expect(result).toEqual({ result: "defeat" });
  });
});

// ─── Victory ──────────────────────────────────────────────────────────────────

describe("victory", () => {
  it("returns victory when all AI owners have no non-lake tiles", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "neutral"),
    ]);
    const result = checkWinLossLogic(map, ["ai1"], domRef());
    expect(result).toEqual({ result: "victory" });
  });

  it("AI lake tile does not count as AI presence (still victory)", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1", "lake"),
    ]);
    const result = checkWinLossLogic(map, ["ai1"], domRef());
    expect(result).toEqual({ result: "victory" });
  });

  it("is not victory when at least one AI has a non-lake tile", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1"),
    ]);
    const result = checkWinLossLogic(map, ["ai1"], domRef());
    expect(result).not.toEqual({ result: "victory" });
  });

  it("all AIs must be eliminated for victory (multi-ai)", () => {
    const map = tileMap([
      makeTile(0, 0, "player"),
      makeTile(5, 5, "ai2"),
    ]);
    // ai1 eliminated, ai2 not
    const result = checkWinLossLogic(map, ["ai1", "ai2"], domRef());
    expect(result?.result).not.toBe("victory");
  });
});

// ─── Dominance notification ───────────────────────────────────────────────────

describe("dominance notification", () => {
  it("returns showDominance when player owns >= 70% of playable tiles", () => {
    // 7 player tiles, 3 ai tiles = 70%
    const tiles = [
      ...Array.from({ length: 7 }, (_, i) => makeTile(i, 0, "player")),
      ...Array.from({ length: 3 }, (_, i) => makeTile(i, 1, "ai1")),
    ];
    const map = tileMap(tiles);
    const result = checkWinLossLogic(map, ["ai1"], domRef(false));
    expect(result).toEqual({ result: null, showDominance: true });
  });

  it("does not trigger dominance when player owns < 70%", () => {
    // 6 player tiles, 4 ai tiles = 60%
    const tiles = [
      ...Array.from({ length: 6 }, (_, i) => makeTile(i, 0, "player")),
      ...Array.from({ length: 4 }, (_, i) => makeTile(i, 1, "ai1")),
    ];
    const map = tileMap(tiles);
    const result = checkWinLossLogic(map, ["ai1"], domRef(false));
    expect(result).toBeNull();
  });

  it("does not trigger dominance a second time (already shown)", () => {
    const tiles = [
      ...Array.from({ length: 9 }, (_, i) => makeTile(i, 0, "player")),
      makeTile(0, 1, "ai1"),
    ];
    const map = tileMap(tiles);
    const ref = domRef(true); // already shown
    const result = checkWinLossLogic(map, ["ai1"], ref);
    expect(result).toBeNull();
  });

  it("sets dominanceShownRef.current to true after firing", () => {
    const tiles = [
      ...Array.from({ length: 8 }, (_, i) => makeTile(i, 0, "player")),
      ...Array.from({ length: 2 }, (_, i) => makeTile(i, 1, "ai1")),
    ];
    const map = tileMap(tiles);
    const ref = domRef(false);
    checkWinLossLogic(map, ["ai1"], ref);
    expect(ref.current).toBe(true);
  });

  it("mountain and lake tiles are excluded from playable count", () => {
    // 1 player grass, 1 ai grass, 8 mountains — 50% not >= 70% — no dominance
    const tiles = [
      makeTile(0, 0, "player"),
      makeTile(1, 0, "ai1"),
      ...Array.from({ length: 8 }, (_, i) => makeTile(i + 2, 0, "neutral", "mountain")),
    ];
    const map = tileMap(tiles);
    const result = checkWinLossLogic(map, ["ai1"], domRef(false));
    expect(result).toBeNull();
  });
});

// ─── No result ────────────────────────────────────────────────────────────────

describe("no result", () => {
  it("returns null in a normal ongoing game", () => {
    const map = tileMap([makeTile(0, 0, "player"), makeTile(1, 0, "ai1")]);
    const result = checkWinLossLogic(map, ["ai1"], domRef(false));
    expect(result).toBeNull();
  });
});
