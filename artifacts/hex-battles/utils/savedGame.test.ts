import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock AsyncStorage with an in-memory store. Must be hoisted before importing
// the module under test, which captures AsyncStorage at module load time.
const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      storage.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      storage.delete(k);
    }),
  },
}));

import type { HexTile } from "@/types";
import {
  __resetForTests,
  clearSavedGame,
  deserializeSavedGame,
  getSavedGameSync,
  hasSavedGameSync,
  hydrateSavedGame,
  isHydrated,
  serializeSavedGame,
  setSavedGame,
  subscribeSavedGame,
  type SavedGame,
} from "@/utils/savedGame";

function makeTile(q: number, r: number, owner: HexTile["owner"] = "neutral"): HexTile {
  return {
    q,
    r,
    key: `${q},${r}`,
    terrain: "grass",
    owner,
    cityBuffer: false,
    isCity: false,
  };
}

function makeSnapshot(): SavedGame {
  const tile1 = makeTile(0, 0, "player");
  const tile2 = makeTile(1, 0, "ai1");
  return {
    tiles: [tile1, tile2],
    config: { numTiles: 80, numOpponents: 2, difficulty: "hard" },
    state: {
      mutableTileMap: new Map([
        [tile1.key, tile1],
        [tile2.key, tile2],
      ]),
      entities: new Map([
        [tile1.key, "simple_unit"],
        [tile2.key, "tower"],
      ]),
      territoryBalances: new Map([
        ["player:0,0", 17],
        ["ai1:1,0", 4],
      ]),
      spentUnits: new Set([tile1.key]),
      combatSpentUnits: new Set([tile2.key]),
      partialMoves: new Map([[tile1.key, 1]]),
      liveOwnerMap: new Map([[tile2.key, "player"]]),
      cities: new Set([tile1.key]),
      graveyard: new Set([tile2.key]),
      ruins: new Set([tile1.key]),
      freeTowerUsedTiles: new Map([
        ["player", new Set([tile1.key, tile2.key])],
        ["ai1", new Set<string>()],
      ]),
      turn: 7,
    },
  };
}

beforeEach(() => {
  storage.clear();
  __resetForTests();
});

describe("savedGame module", () => {
  it("starts empty and unhydrated", () => {
    expect(getSavedGameSync()).toBe(null);
    expect(hasSavedGameSync()).toBe(false);
    expect(isHydrated()).toBe(false);
  });

  it("setSavedGame updates the cache and notifies subscribers", () => {
    const snap = makeSnapshot();
    const listener = vi.fn();
    const unsubscribe = subscribeSavedGame(listener);

    setSavedGame(snap);

    expect(getSavedGameSync()).toBe(snap);
    expect(hasSavedGameSync()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("clearSavedGame empties the cache and notifies subscribers", () => {
    setSavedGame(makeSnapshot());
    const listener = vi.fn();
    const unsubscribe = subscribeSavedGame(listener);

    clearSavedGame();

    expect(getSavedGameSync()).toBe(null);
    expect(hasSavedGameSync()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("unsubscribe stops further notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSavedGame(listener);
    unsubscribe();
    setSavedGame(makeSnapshot());
    expect(listener).not.toHaveBeenCalled();
  });

  it("hydrateSavedGame populates cache from AsyncStorage", async () => {
    const snap = makeSnapshot();
    setSavedGame(snap);
    // Simulate process restart: reset module cache without touching storage.
    __resetForTests();

    expect(getSavedGameSync()).toBe(null);
    expect(isHydrated()).toBe(false);

    const loaded = await hydrateSavedGame();

    expect(isHydrated()).toBe(true);
    expect(loaded).not.toBe(null);
    expect(loaded?.state.turn).toBe(snap.state.turn);
    expect(hasSavedGameSync()).toBe(true);
  });

  it("hydrateSavedGame resolves to null when no save exists", async () => {
    const loaded = await hydrateSavedGame();
    expect(loaded).toBe(null);
    expect(getSavedGameSync()).toBe(null);
    expect(isHydrated()).toBe(true);
  });

  it("hydrateSavedGame tolerates corrupt JSON", async () => {
    storage.set("hex_battles_saved_game_v1", "{not-valid-json");
    const loaded = await hydrateSavedGame();
    expect(loaded).toBe(null);
    expect(isHydrated()).toBe(true);
  });
});

describe("serialize / deserialize round-trip", () => {
  it("round-trips a representative full snapshot", () => {
    const snap = makeSnapshot();
    const json = serializeSavedGame(snap);
    const restored = deserializeSavedGame(json);

    expect(restored).not.toBe(null);
    if (!restored) return;

    // Plain fields
    expect(restored.config).toEqual(snap.config);
    expect(restored.tiles).toEqual(snap.tiles);
    expect(restored.state.turn).toBe(snap.state.turn);

    // Maps — same key/value pairs, instance preserved as Map
    expect(restored.state.mutableTileMap).toBeInstanceOf(Map);
    expect([...restored.state.mutableTileMap.entries()]).toEqual(
      [...snap.state.mutableTileMap.entries()],
    );

    expect(restored.state.entities).toBeInstanceOf(Map);
    expect([...restored.state.entities.entries()]).toEqual(
      [...snap.state.entities.entries()],
    );

    expect(restored.state.territoryBalances).toBeInstanceOf(Map);
    expect([...restored.state.territoryBalances.entries()]).toEqual(
      [...snap.state.territoryBalances.entries()],
    );

    expect(restored.state.partialMoves).toBeInstanceOf(Map);
    expect([...restored.state.partialMoves.entries()]).toEqual(
      [...snap.state.partialMoves.entries()],
    );

    expect(restored.state.liveOwnerMap).toBeInstanceOf(Map);
    expect([...restored.state.liveOwnerMap.entries()]).toEqual(
      [...snap.state.liveOwnerMap.entries()],
    );

    // Sets — preserved as Set with same members
    expect(restored.state.spentUnits).toBeInstanceOf(Set);
    expect([...restored.state.spentUnits]).toEqual([...snap.state.spentUnits]);

    expect(restored.state.combatSpentUnits).toBeInstanceOf(Set);
    expect([...restored.state.combatSpentUnits]).toEqual(
      [...snap.state.combatSpentUnits],
    );

    expect(restored.state.cities).toBeInstanceOf(Set);
    expect([...restored.state.cities]).toEqual([...snap.state.cities]);

    expect(restored.state.graveyard).toBeInstanceOf(Set);
    expect([...restored.state.graveyard]).toEqual([...snap.state.graveyard]);

    expect(restored.state.ruins).toBeInstanceOf(Set);
    expect([...restored.state.ruins]).toEqual([...snap.state.ruins]);

    // Nested Map<TerritoryOwner, Set<string>>
    expect(restored.state.freeTowerUsedTiles).toBeInstanceOf(Map);
    expect(restored.state.freeTowerUsedTiles.size).toBe(
      snap.state.freeTowerUsedTiles.size,
    );
    for (const [owner, set] of snap.state.freeTowerUsedTiles) {
      const restoredSet = restored.state.freeTowerUsedTiles.get(owner);
      expect(restoredSet).toBeInstanceOf(Set);
      expect([...(restoredSet ?? [])]).toEqual([...set]);
    }
  });

  it("returns null for invalid JSON", () => {
    expect(deserializeSavedGame("not json at all")).toBe(null);
  });

  it("returns null for unknown schema version", () => {
    const bogus = JSON.stringify({ v: 99, tiles: [], config: {}, state: {} });
    expect(deserializeSavedGame(bogus)).toBe(null);
  });
});
