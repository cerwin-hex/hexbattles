import { describe, it, expect, vi } from "vitest";
import type { HexTile, EntityType, TerritoryOwner, AiState } from "@/types";

// Both hooks under test are pure computations wrapped in a single `useMemo`.
// Replacing useMemo with an identity call is a faithful shim (useMemo returns
// fn()) and lets the real hook bodies run in the plain node environment, with
// no React renderer and no mocking of the logic being tested.
vi.mock("react", () => ({ useMemo: (fn: () => unknown) => fn() }));

import { useEconBreakdown } from "@/hooks/useEconBreakdown";
import { useDevEconomicOverlays } from "@/hooks/useDevEconomicOverlays";
import { calcTerritoryIncome, calcTerritoryUpkeep } from "@/logic/gameLogic";

function makeTile(
  q: number,
  r: number,
  owner: TerritoryOwner,
  terrain: HexTile["terrain"] = "grass",
): HexTile {
  return { q, r, key: `${q},${r}`, owner, terrain, cityBuffer: false, isCity: false };
}

/** Build a tileMap (and matching territory list) from `[q, r, terrain]` triples. */
function makeTerritory(
  owner: TerritoryOwner,
  coords: Array<[number, number, HexTile["terrain"]]>,
): { tileMap: Map<string, HexTile>; territory: HexTile[] } {
  const tileMap = new Map<string, HexTile>();
  const territory: HexTile[] = [];
  for (const [q, r, terrain] of coords) {
    const t = makeTile(q, r, owner, terrain);
    tileMap.set(t.key, t);
    territory.push(t);
  }
  return { tileMap, territory };
}

/** The dev overlay renders one label per AI territory, formatted `"A 10(+5)"`. */
function overlayNet(label: string): number {
  const m = label.match(/\(([+-]\d+)\)$/);
  if (!m) throw new Error(`overlay label has no net component: "${label}"`);
  return Number(m[1]);
}

function runDevOverlay(o: {
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  cities: Set<string>;
  balances?: Map<string, number>;
}) {
  const tileDataMap = new Map<string, { cx: number; cy: number }>();
  for (const key of o.tileMap.keys()) tileDataMap.set(key, { cx: 0, cy: 0 });
  return useDevEconomicOverlays({
    isDeveloperModeActive: true,
    aiOwners: ["ai1"],
    activeTileMap: o.tileMap,
    territoryBalances: o.balances ?? new Map(),
    entities: o.entities,
    cities: o.cities,
    tileDataMap,
    aiStateMap: new Map<string, AiState>(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev economy overlay: the "balance(+net)" label shown over each AI territory
// in developer mode must agree with the economy the engine actually applies
// (applyOwnerEconomy → calcTerritoryIncome / calcTerritoryUpkeep). It drifted
// by inlining its own income formula, which omitted the city-adjacency bonus
// that Field tiles earn from a neighbouring same-owner city.
//
// One known exception, not covered here: applyOwnerEconomy also grants the
// super_expert tier a per-land-tile income bonus, and the overlay is not given
// the difficulty, so its label still understates that tier's net.
// ─────────────────────────────────────────────────────────────────────────────
describe("useDevEconomicOverlays", () => {
  it("counts the city-adjacency bonus a Field earns from a neighbouring city", () => {
    // City on 0,0 with a Field neighbour, so the Field earns +1 on top of its
    // own terrain income.
    const { tileMap, territory } = makeTerritory("ai1", [
      [0, 0, "grass"],
      [1, 0, "field"],
      [0, 1, "grass"],
    ]);
    const entities = new Map<string, EntityType>();
    const cities = new Set<string>(["0,0"]);

    const overlays = runDevOverlay({ tileMap, entities, cities });

    expect(overlays).toHaveLength(1);
    const engineNet =
      calcTerritoryIncome(territory, entities, cities, tileMap) -
      calcTerritoryUpkeep(territory, entities);
    expect(overlayNet(overlays[0].label)).toBe(engineNet);
  });

  it("matches the engine economy on a mixed territory with rebels and buildings", () => {
    const { tileMap, territory } = makeTerritory("ai1", [
      [0, 0, "grass"],
      [1, 0, "field"],
      [0, 1, "field"],
      [-1, 1, "desert"],
      [1, -1, "sawmill"],
      [-1, 0, "mine"],
      [0, -1, "forest"],
    ]);
    const entities = new Map<string, EntityType>([
      ["0,1", "rebel"],
      ["-1,1", "tower"],
      ["1,-1", "warrior"],
    ]);
    const cities = new Set<string>(["0,0", "-1,0"]);

    const overlays = runDevOverlay({ tileMap, entities, cities });

    expect(overlays).toHaveLength(1);
    const engineNet =
      calcTerritoryIncome(territory, entities, cities, tileMap) -
      calcTerritoryUpkeep(territory, entities);
    expect(overlayNet(overlays[0].label)).toBe(engineNet);
  });

  it("still denies a rebel-held tile its whole income", () => {
    const { tileMap, territory } = makeTerritory("ai1", [
      [0, 0, "grass"],
      [1, 0, "grass"],
      [0, 1, "grass"],
    ]);
    const cities = new Set<string>(["0,0"]);
    const clean = new Map<string, EntityType>();
    const rebelOnCity = new Map<string, EntityType>([["0,0", "rebel"]]);

    const netClean = overlayNet(
      runDevOverlay({ tileMap, entities: clean, cities })[0].label,
    );
    const netRebel = overlayNet(
      runDevOverlay({ tileMap, entities: rebelOnCity, cities })[0].label,
    );

    // grass (2) + CITY_BONUS (1) = 3 denied.
    expect(netClean - netRebel).toBe(3);
    expect(netRebel).toBe(
      calcTerritoryIncome(territory, rebelOnCity, cities, tileMap) -
        calcTerritoryUpkeep(territory, rebelOnCity),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Economy breakdown modal: the "Net per turn" figure the player reads must be
// the same number the engine credits to the territory. The breakdown counts
// rebel-held tiles in its income lines on purpose and offsets them with a
// single "Rebels −X" line, so only the net is meaningful to compare — but that
// net must never drift from calcTerritoryIncome − calcTerritoryUpkeep.
// ─────────────────────────────────────────────────────────────────────────────
describe("useEconBreakdown", () => {
  it("deducts terrain AND the city bonus for a rebel sitting on a city", () => {
    const grassCity = makeTerritory("player", [
      [0, 0, "grass"],
      [1, 0, "grass"],
      [0, 1, "grass"],
    ]);
    const desertCity = makeTerritory("player", [
      [0, 0, "desert"],
      [1, 0, "grass"],
      [0, 1, "grass"],
    ]);
    const cities = new Set<string>(["0,0"]);
    const rebelOnCity = new Map<string, EntityType>([["0,0", "rebel"]]);

    // Cities are generated on grass or desert, so both rates are reachable.
    const onGrass = useEconBreakdown({
      selectedTerritory: grassCity.territory,
      entities: rebelOnCity,
      cities,
    })!;
    expect(onGrass.rebelCount).toBe(1);
    expect(onGrass.rebelTotalLoss).toBe(3);

    const onDesert = useEconBreakdown({
      selectedTerritory: desertCity.territory,
      entities: rebelOnCity,
      cities,
    })!;
    expect(onDesert.rebelTotalLoss).toBe(2);
  });

  it("deducts the city-adjacency bonus a rebel-held Field loses", () => {
    const { territory } = makeTerritory("player", [
      [0, 0, "grass"],
      [1, 0, "field"],
      [0, 1, "grass"],
    ]);
    const cities = new Set<string>(["0,0"]);
    const rebelOnField = new Map<string, EntityType>([["1,0", "rebel"]]);

    const b = useEconBreakdown({
      selectedTerritory: territory,
      entities: rebelOnField,
      cities,
    })!;

    // field (3) + adjacency bonus from the city on 0,0 (1) = 4 denied.
    expect(b.rebelTotalLoss).toBe(4);
  });

  it("net never drifts from the engine economy across randomized territories", () => {
    const rng = mulberry32(12345);
    const mismatches: string[] = [];
    for (let iter = 0; iter < 400; iter++) {
      const coords: Array<[number, number, HexTile["terrain"]]> = SHAPE.map(
        ([q, r]) => [q, r, TERRAINS[Math.floor(rng() * TERRAINS.length)]],
      );
      const { tileMap, territory } = makeTerritory("player", coords);
      const entities = new Map<string, EntityType>();
      const cities = new Set<string>();
      for (const t of territory) {
        let e = ENTS[Math.floor(rng() * ENTS.length)];
        // Rebels never occupy lake tiles in the real game (spawnRebelsForOwner
        // skips them), so don't generate that unreachable combination.
        if (e === "rebel" && t.terrain === "lake") e = undefined;
        if (e) entities.set(t.key, e);
        if (rng() < 0.35) cities.add(t.key);
      }

      const ui = useEconBreakdown({
        selectedTerritory: territory,
        entities,
        cities,
      })!;
      const engineNet =
        calcTerritoryIncome(territory, entities, cities, tileMap) -
        calcTerritoryUpkeep(territory, entities);

      if (ui.net !== engineNet) {
        mismatches.push(
          `iter ${iter}: ui=${ui.net} engine=${engineNet} — ` +
            territory
              .map(
                (t) =>
                  `${t.key}:${t.terrain}${cities.has(t.key) ? "+city" : ""}` +
                  `${entities.has(t.key) ? "/" + entities.get(t.key) : ""}`,
              )
              .join(" "),
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});

/** Contiguous 9-tile blob around the origin; shape is irrelevant to the economy,
 *  it only has to be one territory so both paths see the same tile set. */
const SHAPE: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [-1, 1],
  [1, -1],
  [-1, 0],
  [0, -1],
  [2, 0],
  [2, -1],
];

const TERRAINS: HexTile["terrain"][] = [
  "grass",
  "forest",
  "desert",
  "field",
  "sawmill",
  "mine",
  "lake",
];

const ENTS: (EntityType | undefined)[] = [
  undefined,
  "rebel",
  "peasant",
  "warrior",
  "tower",
  "castle",
];

/** Deterministic PRNG so a mismatch is always reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
