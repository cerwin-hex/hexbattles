import { describe, it, expect, afterEach } from "vitest";
import {
  evaluatePosition,
  simulateAction,
  runExpertTerritoryDecisionLoop,
  __setExpertInertPocketFront,
  __setExpertSafeCaptureAugment,
  DEFAULT_WEIGHTS,
  type SimState,
  type ExpertAction,
} from "@/logic/aiExpert";
import type { AiDecisionExec, AiWorkingState } from "@/logic/aiStrategy";
import type { AiContext } from "@/logic/aiHelpers";
import { ALL_GAME_ELEMENTS } from "@/constants/gameElements";
import { runOneAiTurnHeadless } from "@/logic/aiSelfPlay";
import type { HexTile, EntityType, TerritoryOwner } from "@/types";
import { getContiguousTerritory, getTerritoryId } from "@/utils/hexGrid";
import { hexDistance, tileKey, HEX_EDGES } from "@/utils/hexMath";

// ════════════════════════════════════════════════════════════════════════════
// Single-hex enemy pocket enclosed by own territory.
//
// Regression guard for the stall the Expert AI used to show here. `borderBonus`
// and `frontline` are per-unit sums (unlike breakthrough/assault, which are
// de-duplicated per target tile), and `frontier` counts every owned edge facing
// the pocket. A lone enemy hex therefore acted as a permanent reward well: each
// unit parked beside it collected strength × (borderBonus + frontline), and
// capturing the pocket cashed all of that out at once. Measured capture delta
// fell 2.5 per adjacent peasant — +9.2 with one unit alongside, but −3.3 with
// six — so the AI ringed the pocket indefinitely, and each extra unit it built
// made taking the tile look worse. With a rebel on the pocket it was 3 worse
// still (a rebel denies the enemy that tile's income, so taking it earns no
// `leader` suppression credit) and the capture also never reached the 2-ply pass,
// because the safe-capture augment excluded any occupied target.
//
// The property under test is not merely "the delta is positive" but that it is
// INDEPENDENT of how many units happen to stand next to the pocket. A sign check
// alone would pass again as soon as some term reacquired an N-dependence.
// ════════════════════════════════════════════════════════════════════════════

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

const POCKET = "0,0";
const RING = HEX_EDGES.map(({ dir: [dq, dr] }) => tileKey(dq, dr));
const START = "2,0"; // an ai1 tile well away from the pocket

/** What sits on the pocket. A rebel has strength 0; a swordsman defends it. */
type Occupant = "empty" | "rebel" | "swordsman";

/**
 * An ai1 blob (radius 2) with one enemy hex at its centre, plus a substantial
 * enemy mass far to the east so the pocket is not the only enemy on the board
 * (which would trip the `advanceTargets` late-game fallback). `ringUnits` ai1
 * peasants are parked on the pocket's six neighbours.
 */
function buildBoard(opts: { occupant: Occupant; ringUnits: number }): {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
} {
  const tiles: HexTile[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (hexDistance(q, r, 0, 0) > 2) continue;
      tiles.push(makeTile(q, r, q === 0 && r === 0 ? "player" : "ai1"));
    }
  }
  for (let q = 7; q <= 9; q++) {
    for (let r = 0; r <= 2; r++) tiles.push(makeTile(q, r, "player"));
  }
  const tileMap = new Map(tiles.map((t) => [t.key, t]));

  const entities = new Map<string, EntityType>();
  if (opts.occupant !== "empty") entities.set(POCKET, opts.occupant);
  for (let i = 0; i < opts.ringUnits; i++) entities.set(RING[i], "peasant");

  const balances = new Map<string, number>();
  const tid = getTerritoryId(getContiguousTerritory(tileMap, START, "ai1", entities));
  if (tid) balances.set(tid, 30);
  return { tileMap, entities, balances };
}

function ctxOf(b: ReturnType<typeof buildBoard>): AiContext {
  return {
    tileMap: b.tileMap,
    entities: b.entities,
    balances: b.balances,
    cities: new Set(),
    spentUnits: new Set(),
    partialMoves: new Map(),
    combatSpentUnits: new Set(),
    cityImproveUsed: new Set(),
    aiOwner: "ai1",
    elements: ALL_GAME_ELEMENTS,
  };
}

function workingStateOf(b: ReturnType<typeof buildBoard>): AiWorkingState {
  return {
    tileMap: b.tileMap,
    entities: b.entities,
    balances: b.balances,
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
  };
}

/** 1-ply score delta of capturing the pocket from RING[0]. */
function captureDelta(occupant: Occupant, ringUnits: number): number {
  const b = buildBoard({ occupant, ringUnits });
  const base: SimState = {
    tileMap: b.tileMap,
    entities: b.entities,
    balances: b.balances,
    cities: new Set(),
  };
  const capture: ExpertAction = { kind: "move", from: RING[0], to: POCKET };
  const score = (s: SimState): number =>
    evaluatePosition("ai1", s.tileMap, s.entities, s.balances, s.cities, DEFAULT_WEIGHTS);
  return score(simulateAction(base, capture, "ai1")) - score(base);
}

/** The first action the expert loop dispatches for the pocket's territory. */
async function firstExpertAction(ctx: AiContext): Promise<ExpertAction | null> {
  let first: ExpertAction | null = null;
  const stop = (a: ExpertAction): boolean => {
    if (!first) first = a;
    return false; // halt the loop after one action
  };
  const exec: AiDecisionExec = {
    move: async (from, to) => stop({ kind: "move", from, to }),
    buy: async (unitType, target, cost, outside) =>
      stop({ kind: "buy", unitType, target, cost, outside }),
    build: async (buildingType, target, cost) => stop({ kind: "build", buildingType, target, cost }),
    upgrade: async (target, to, cost) => stop({ kind: "upgrade", target, to, cost }),
    remove: async (target) => stop({ kind: "remove", target }),
    improve: async () => false,
    markSpent: () => {},
    setTerritoryState: () => {},
  };
  await runExpertTerritoryDecisionLoop(START, ctx, exec, () => true);
  return first;
}

const RING_SIZES = [1, 2, 4, 6];

describe("expert AI vs a single-hex enemy pocket inside its own territory", () => {
  afterEach(() => {
    __setExpertInertPocketFront(null);
    __setExpertSafeCaptureAugment(null);
  });

  for (const occupant of ["empty", "rebel"] as const) {
    it(`values capturing a ${occupant} pocket independently of how many units surround it`, () => {
      const deltas = RING_SIZES.map((n) => captureDelta(occupant, n));
      // Every delta positive — the capture is an improvement, not a loss.
      for (const d of deltas) expect(d).toBeGreaterThan(0);
      // ...and identical regardless of ring size. This is the real property: the
      // old per-unit front terms made it fall 2.5 for every extra adjacent unit.
      for (const d of deltas) expect(d).toBeCloseTo(deltas[0], 6);
    });

    it(`takes a ${occupant} pocket even when six units already ring it`, async () => {
      const act = await firstExpertAction(ctxOf(buildBoard({ occupant, ringUnits: 6 })));
      expect(act).toEqual({ kind: "move", from: RING[0], to: POCKET });
    });

    it(`clears a ${occupant} pocket within one full turn`, async () => {
      const ws = workingStateOf(buildBoard({ occupant, ringUnits: 1 }));
      await runOneAiTurnHeadless(ws, "ai1", 3, "expert");
      expect(ws.tileMap.get(POCKET)!.owner).toBe("ai1");
    });
  }

  it("still degrades with ring size when the fix is toggled off (guards the toggle)", () => {
    __setExpertInertPocketFront(false);
    const deltas = RING_SIZES.map((n) => captureDelta("rebel", n));
    // Original behaviour: strictly decreasing in ring size, and negative by 4.
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]).toBeLessThan(deltas[i - 1]);
    expect(deltas[deltas.length - 1]).toBeLessThan(0);
  });

  it("keeps front credit for an isolated pocket that CAN strike back", () => {
    // A swordsman on the pocket defends it and can attack out, so it is a real
    // front: the front terms must still apply. Detected as the ring-size
    // dependence the inert cases no longer have.
    const deltas = RING_SIZES.map((n) => captureDelta("swordsman", n));
    expect(deltas[deltas.length - 1]).not.toBeCloseTo(deltas[0], 6);
    // And killing it is still overwhelmingly attractive (threat + enemyMilitary).
    for (const d of deltas) expect(d).toBeGreaterThan(50);
  });

  it("picks the rebel capture under the shipping search config", async () => {
    // The safe-capture augment used to skip ANY occupied target, so a strength-0
    // rebel hid the capture from the 2-ply pass entirely (measured 1-ply rank
    // 17-75 of 100-120 candidates — far outside the top-K). It now admits targets
    // whose occupant contributes no ZoC.
    //
    // Note on coverage: the augment's effect is that a candidate gets *deep-scored*,
    // which is not observable from outside the loop, and on this board the eval
    // alone already ranks the capture first — so this asserts the end result under
    // the shipping config rather than isolating the augment. The gate widening is
    // strictly additive (it only ever admits more candidates); the self-play A/B is
    // what guards it against a strength regression.
    const act = await firstExpertAction(ctxOf(buildBoard({ occupant: "rebel", ringUnits: 6 })));
    expect(act).toEqual({ kind: "move", from: RING[0], to: POCKET });
  });
});
