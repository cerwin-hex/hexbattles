import { describe, it, expect, vi, afterEach } from "vitest";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { runOneAiTurnHeadless } from "@/logic/aiSelfPlay";
import { spawnRebelsForOwner } from "@/logic/gameLogic";
import type { AiWorkingState } from "@/logic/aiStrategy";

// ─────────────────────────────────────────────────────────────────────────────
// Rebel spawning runs per-owner at the START of each owner's turn, from a
// global armed snapshot taken at the END of the previous round. Only tiles
// owned by the active owner are eligible for spawn and spread.
// ─────────────────────────────────────────────────────────────────────────────

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

function makeWs(tiles: HexTile[], overrides: Partial<AiWorkingState> = {}): AiWorkingState {
  return {
    tileMap: new Map(tiles.map((t) => [t.key, t])),
    entities: new Map(),
    balances: new Map(),
    liveOwnerMap: new Map(),
    graveyard: new Set(),
    ruins: new Set(),
    cities: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    attacksUsed: new Map(),
    combatSpentUnits: new Set(),
    freeTowerUsed: new Map(),
    ...overrides,
  };
}

// ── Unit tests for spawnRebelsForOwner ───────────────────────────────────────

describe("spawnRebelsForOwner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("armed grave in owner territory spawns rebel (75% roll hits) and is consumed", () => {
    const tileMap = new Map([["5,5", makeTile(5, 5, "player")]]);
    const entities = new Map<string, EntityType>();
    const graveyard = new Set(["5,5"]);
    const armedGraves = new Set(["5,5"]);

    spawnRebelsForOwner(
      "player", tileMap, entities, graveyard, new Set(),
      armedGraves, new Set(), () => 0.5, // 0.5 < 0.75 → spawn
    );

    expect(entities.get("5,5")).toBe("rebel");
    expect(armedGraves.has("5,5")).toBe(false); // consumed from armed set
    expect(graveyard.has("5,5")).toBe(false);   // skull marker cleared
  });

  it("armed grave in a different owner's territory is NOT consumed or spawned", () => {
    const tileMap = new Map([["5,5", makeTile(5, 5, "ai1")]]);
    const entities = new Map<string, EntityType>();
    const graveyard = new Set(["5,5"]);
    const armedGraves = new Set(["5,5"]);

    spawnRebelsForOwner(
      "player", tileMap, entities, graveyard, new Set(),
      armedGraves, new Set(), () => 0.5,
    );

    expect(entities.get("5,5")).toBeUndefined();
    expect(armedGraves.has("5,5")).toBe(true); // untouched
    expect(graveyard.has("5,5")).toBe(true);   // untouched
  });

  it("grave is consumed from graveyard even when the 75% roll misses", () => {
    const tileMap = new Map([["5,5", makeTile(5, 5, "player")]]);
    const entities = new Map<string, EntityType>();
    const graveyard = new Set(["5,5"]);
    const armedGraves = new Set(["5,5"]);

    spawnRebelsForOwner(
      "player", tileMap, entities, graveyard, new Set(),
      armedGraves, new Set(), () => 0.99, // 0.99 > 0.75 → miss
    );

    expect(entities.get("5,5")).toBeUndefined(); // no rebel
    expect(armedGraves.has("5,5")).toBe(false);  // still consumed
    expect(graveyard.has("5,5")).toBe(false);    // still cleared
  });

  it("background spawn (2%) fires only on owner tiles, not neighbour owner tiles", () => {
    const tileMap = new Map([
      ["0,0", makeTile(0, 0, "player")],
      ["1,0", makeTile(1, 0, "ai1")],
    ]);
    const entities = new Map<string, EntityType>();

    spawnRebelsForOwner(
      "player", tileMap, entities, new Set(), new Set(),
      new Set(), new Set(), () => 0.01, // 0.01 < 0.02 → background fires
    );

    expect(entities.get("0,0")).toBe("rebel");   // player tile spawned
    expect(entities.get("1,0")).toBeUndefined(); // ai1 tile untouched
  });
});

// ── Integration tests via runOneAiTurnHeadless ────────────────────────────────

describe("rebel spawn — integration via runOneAiTurnHeadless", () => {
  afterEach(() => vi.restoreAllMocks());

  it("armed grave in player territory rises at end of AI phase (player sees rebel next turn)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // < 0.75 → spawn
    // ai1 owns no tiles → does nothing. Grave at 5,5 is armed (from prev round).
    const state = makeWs([makeTile(5, 5, "player")], {
      graveyard: new Set(["5,5"]),
    });
    await runOneAiTurnHeadless(
      state, "ai1", 2, "medium",
      new Set(["5,5"]) /* armedGraves */, new Set(),
    );

    expect(state.entities.get("5,5")).toBe("rebel");
    expect(state.graveyard.has("5,5")).toBe(false); // consumed
  });

  it("is suspended in round 1 — no spawn even with armed grave", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = makeWs([makeTile(5, 5, "player")], {
      graveyard: new Set(["5,5"]),
    });
    await runOneAiTurnHeadless(
      state, "ai1", 1, "medium",
      new Set(["5,5"]), new Set(),
    );

    expect(state.entities.get("5,5")).toBeUndefined(); // round 1 guard
    expect(state.graveyard.has("5,5")).toBe(true);     // untouched
  });

  it("background spread fires for AI owner even with no armed graves", async () => {
    // ai1 owns one tile; no deaths → armedGraves is empty.
    // Background spawn (2%) should still fire from round 2 onward.
    vi.spyOn(Math, "random").mockReturnValue(0.01); // 0.01 < 0.02 → background fires
    const state = makeWs([makeTile(0, 0, "ai1")]);
    await runOneAiTurnHeadless(
      state, "ai1", 2, "medium",
      new Set() /* armedGraves */, new Set(),
    );
    expect(state.entities.get("0,0")).toBe("rebel");
  });

  it("grave created THIS round by player bankruptcy is in nextArmedGraves and spawns rebel immediately", async () => {
    // Player territory: (0,0) grass + (1,0) grass. Warrior at (0,0).
    // income = 4 (2 × grass), warrior upkeep = 9 → net −5 → bankrupt.
    // warrior on grass → deleted from entities, graveyard.add("0,0").
    // After player economy, nextArmedGraves = ws.graveyard = {"5,5", "0,0"}.
    // Player spawn fires both: rebel at 5,5 (pre-armed) + rebel at 0,0 (new).
    vi.spyOn(Math, "random").mockReturnValue(0.5); // < 0.75 → spawn for all rolls
    const state = makeWs(
      [
        makeTile(0, 0, "player", "grass"),
        makeTile(1, 0, "player", "grass"),
        makeTile(5, 5, "player", "grass"), // isolated — separate territory
      ],
      {
        entities: new Map<string, EntityType>([["0,0", "warrior"]]),
        balances: new Map([["0,0", 0]]), // territory ID "0,0" → balance 0 → bankrupt
        graveyard: new Set(["5,5"]),     // pre-existing armed grave
      },
    );
    await runOneAiTurnHeadless(
      state, "ai1", 2, "medium",
      new Set(["5,5"]) /* armedGraves */, new Set(),
    );

    // Pre-existing grave at 5,5 rose.
    expect(state.entities.get("5,5")).toBe("rebel");
    expect(state.graveyard.has("5,5")).toBe(false);

    // Bankruptcy grave at 0,0 also rose — same-round arming is the new behaviour.
    expect(state.entities.get("0,0")).toBe("rebel");
    expect(state.graveyard.has("0,0")).toBe(false);
  });
});
