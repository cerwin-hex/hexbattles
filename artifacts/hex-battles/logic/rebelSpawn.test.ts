import { describe, it, expect, vi, afterEach } from "vitest";
import type { HexTile, EntityType, TerritoryOwner, ArmedSites } from "@/types";
import { runOneAiTurnHeadless } from "@/logic/aiSelfPlay";
import {
  armedSitesForOwner,
  spawnRebelsForOwner,
  sweepNeutralMarkers,
} from "@/logic/gameLogic";
import type { AiWorkingState } from "@/logic/aiStrategy";

// ─────────────────────────────────────────────────────────────────────────────
// Rebel spawning runs per-owner at the START of each owner's turn. Each owner
// consumes its OWN armed bucket, filled at the start of that owner's previous
// turn — which is what guarantees every marker at least one full player turn on
// screen. Only tiles owned by the active owner are eligible for spawn and spread.
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
    cityImproveUsed: new Set(),
    freeTowerUsed: new Map(),
    ...overrides,
  };
}

/** One owner's armed bucket, as `runAiTurn` expects it. */
function armedFor(owner: TerritoryOwner, ...keys: string[]): ArmedSites {
  return new Map([[owner, new Set(keys)]]);
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

  it("places no rebel but still consumes the grave when spawning is disabled", () => {
    const tileMap = new Map([["5,5", makeTile(5, 5, "player")]]);
    const entities = new Map<string, EntityType>();
    const graveyard = new Set(["5,5"]);
    const armedGraves = new Set(["5,5"]);

    spawnRebelsForOwner(
      "player", tileMap, entities, graveyard, new Set(),
      armedGraves, new Set(),
      () => 0,   // rng that would always spawn
      false,     // spawnEnabled
    );

    expect(entities.size).toBe(0);            // no rebel from the grave…
    expect(armedGraves.has("5,5")).toBe(false); // …but still consumed
    expect(graveyard.has("5,5")).toBe(false);   // …and the marker cleared
  });

  it("places no background rebel when spawning is disabled", () => {
    // rng() = 0 clears every spawn threshold, so any rebel here is a bug.
    const tileMap = new Map([["0,0", makeTile(0, 0, "player")]]);
    const entities = new Map<string, EntityType>();

    spawnRebelsForOwner(
      "player", tileMap, entities, new Set(), new Set(),
      new Set(), new Set(),
      () => 0,
      false,
    );

    expect(entities.size).toBe(0);
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
      armedFor("player", "5,5"), new Map(),
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
      armedFor("player", "5,5"), new Map(),
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
      new Map() /* armedGraves */, new Map(),
    );
    expect(state.entities.get("0,0")).toBe("rebel");
  });

  it("grave created THIS round by player bankruptcy waits a full turn before rising", async () => {
    // Player territory: (0,0) grass + (1,0) grass. Warrior at (0,0).
    // income = 4 (2 × grass), warrior upkeep = 9 → net −5 → bankrupt.
    // warrior on grass → deleted from entities, graveyard.add("0,0").
    // Arming and consuming are one boundary apart, so the fresh grave at 0,0 is
    // only ARMED this round; it cannot rise until the next one.
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
    const armedGraves = armedFor("player", "5,5");
    await runOneAiTurnHeadless(state, "ai1", 2, "medium", armedGraves, new Map());

    // Pre-existing grave at 5,5 was armed a boundary ago → it rose.
    expect(state.entities.get("5,5")).toBe("rebel");
    expect(state.graveyard.has("5,5")).toBe(false);

    // Bankruptcy grave at 0,0 is still standing, and is now armed for next round.
    expect(state.entities.get("0,0")).toBeUndefined();
    expect(state.graveyard.has("0,0")).toBe(true);
    expect(armedGraves.get("player")?.has("0,0")).toBe(true);

    // Next round, with the same armed buckets carried forward, it rises.
    await runOneAiTurnHeadless(state, "ai1", 3, "medium", armedGraves, new Map());
    expect(state.entities.get("0,0")).toBe("rebel");
    expect(state.graveyard.has("0,0")).toBe(false);
  });

  it("grave on an AI tile is armed by that AI, not by the player", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const state = makeWs(
      [makeTile(0, 0, "ai1", "grass"), makeTile(1, 0, "ai1", "grass")],
      { graveyard: new Set(["0,0"]) },
    );
    const armedGraves: ArmedSites = new Map();
    await runOneAiTurnHeadless(state, "ai1", 2, "medium", armedGraves, new Map());

    // ai1 had nothing armed yet, so the grave survives its turn untouched…
    expect(state.graveyard.has("0,0")).toBe(true);
    // …and lands in ai1's bucket, never the player's.
    expect(armedGraves.get("ai1")?.has("0,0")).toBe(true);
    expect(armedGraves.get("player")?.has("0,0")).toBeFalsy();
  });
});

// ── Armed-bucket helpers ─────────────────────────────────────────────────────

describe("armedSitesForOwner", () => {
  it("keeps only sites on tiles the owner currently holds", () => {
    const tileMap = new Map([
      ["0,0", makeTile(0, 0, "player")],
      ["1,0", makeTile(1, 0, "ai1")],
      ["2,0", makeTile(2, 0, "neutral")],
    ]);
    const sites = new Set(["0,0", "1,0", "2,0", "9,9" /* off-board */]);

    expect([...armedSitesForOwner("player", tileMap, sites)]).toEqual(["0,0"]);
    expect([...armedSitesForOwner("ai1", tileMap, sites)]).toEqual(["1,0"]);
    expect([...armedSitesForOwner("neutral", tileMap, sites)]).toEqual(["2,0"]);
  });

  it("re-arms a captured site under its new owner", () => {
    const sites = new Set(["0,0"]);
    const captured = new Map([["0,0", makeTile(0, 0, "ai1")]]);

    expect(armedSitesForOwner("player", captured, sites).size).toBe(0);
    expect(armedSitesForOwner("ai1", captured, sites).has("0,0")).toBe(true);
  });
});

describe("sweepNeutralMarkers", () => {
  // Water markers have no owner to sweep them, so this single pass is the whole
  // of their lifetime: armed on one call, deleted on the next.
  it("expires a neutral marker on the second sweep, not the first", () => {
    const tileMap = new Map([["0,1", makeTile(0, 1, "neutral", "lake")]]);
    const graveyard = new Set<string>();
    const ruins = new Set(["0,1"]);
    const armedGraveyard: ArmedSites = new Map();
    const armedRuins: ArmedSites = new Map();

    sweepNeutralMarkers(tileMap, graveyard, ruins, armedGraveyard, armedRuins);
    expect(ruins.has("0,1")).toBe(true); // survives one full player turn
    expect(armedRuins.get("neutral")?.has("0,1")).toBe(true);

    sweepNeutralMarkers(tileMap, graveyard, ruins, armedGraveyard, armedRuins);
    expect(ruins.has("0,1")).toBe(false); // gone
    expect(armedRuins.get("neutral")?.size).toBe(0);
  });

  it("leaves markers on owned tiles to their owner's sweep", () => {
    const tileMap = new Map([["0,0", makeTile(0, 0, "player")]]);
    const graveyard = new Set(["0,0"]);
    const armedGraveyard: ArmedSites = new Map();

    sweepNeutralMarkers(tileMap, graveyard, new Set(), armedGraveyard, new Map());
    sweepNeutralMarkers(tileMap, graveyard, new Set(), armedGraveyard, new Map());

    expect(graveyard.has("0,0")).toBe(true);
    expect(armedGraveyard.get("neutral")?.size).toBe(0);
  });
});
