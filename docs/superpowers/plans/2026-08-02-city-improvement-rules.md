# City Placement and Improvement Zones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A territory may found one city per 5 tiles it owns, no closer than 3 tiles to any city its owner already holds; improvements may only be built within 2 tiles of a city in the same territory, and each city pays for at most one improvement per turn.

**Architecture:** Every rule becomes one pure predicate in `logic/gameLogic.ts` (with its constants in `utils/hexGrid.ts`), and the player UI, the player tap handler and both AI brains all call the same predicate. Per-turn "this city has already built" state is split: React state for the player, a field on `AiWorkingState` for each AI owner — because `endTurnHandler` resets the player's per-turn sets and *then* runs every AI turn inside the same flow, so a single shared set would let the AI spend the player's allowance.

**Tech Stack:** TypeScript, React Native (Expo), Vitest. Spec: `docs/superpowers/specs/2026-08-02-city-improvement-rules-design.md`.

## Global Constraints

- **All game code in English** — names, comments, string literals. (The user writes Danish; the code never does.)
- **Run typecheck from the repo root only:** `pnpm run typecheck`. Running `tsc` inside a package fails.
- **Tests:** `pnpm test` for everything; `pnpm --filter @workspace/hex-battles exec vitest run <path>` for one file. Paths passed to vitest are relative to `artifacts/hex-battles/`.
- **Never `git push`.** Commit freely; pushing is the user's manual step.
- Exact rule values, copied from the spec: `TILES_PER_CITY = 5`, `MIN_OWN_CITY_DISTANCE = 3` (reject when `hexDistance < 3`), `CITY_IMPROVE_RADIUS = 2` (accept when `hexDistance <= 2`).
- The cap is **per territory**; the 3-tile spacing is checked against **every city the owner holds anywhere**. Enemy and neutral cities never block.
- All rules apply **at build time only**. Nothing in this plan may ever remove a city or an improvement.
- `hexDistance` takes four numbers: `hexDistance(q1, r1, q2, r2)`. It is re-exported from `@/utils/hexGrid`.
- Tile keys are `"q,r"`; parse with `const [q, r] = key.split(",").map(Number)`.
- Working branch: `feat/city-improvement-rules` (already created, spec already committed).

---

## File Structure

**Modified — rules layer**
- `artifacts/hex-battles/utils/hexGrid.ts` — new constants + `cityCapFor`. Sits with `CITY_BONUS` and `IMPROVEMENTS`, the existing rule-value home.
- `artifacts/hex-battles/logic/gameLogic.ts` — new `canFoundCity`, `foundCitySites`, `ownCityKeys`, `findImproveAnchor`; `canImproveTile` re-pointed at an anchor.

**Modified — per-turn state**
- `artifacts/hex-battles/types.ts` — `improvedCities` on `MoveHistorySnapshot`.
- `artifacts/hex-battles/app/game.tsx` — `improvedCities` React state, wiring.
- `artifacts/hex-battles/hooks/useMoveHistory.ts` — snapshot + restore.
- `artifacts/hex-battles/logic/endTurnHandler.ts` — per-turn reset.
- `artifacts/hex-battles/utils/savedGame.ts` — persistence (optional field, empty on load for old saves).
- `artifacts/hex-battles/logic/aiStrategy.ts` — `cityImproveUsed` on `AiWorkingState`, fresh per owner turn.
- `artifacts/hex-battles/logic/aiHelpers.ts` — `cityImproveUsed` on `AiContext`.

**Modified — player path**
- `artifacts/hex-battles/logic/tileTapHandler.ts` — improvement anchor re-check + mark used; city founding re-check.
- `artifacts/hex-battles/hooks/useSelectionState.ts` — `territoryCityKeys`, anchor-based improvement sets, `validCitySites`.
- `artifacts/hex-battles/components/MovementHighlightLayer.tsx` + `components/layerEquality.ts` — city purchase dots filtered by `validCitySites`.
- `artifacts/hex-battles/components/PurchaseRibbon.tsx` — three city states, two improvement reasons.

**Modified — AI**
- `artifacts/hex-battles/logic/aiStrategy.ts` — priority D city rules, `dtExecImprove` marks the anchor used.
- `artifacts/hex-battles/logic/aiExpert.ts` — city candidate generation filtered by the legal-site set.

**Modified — copy**
- `artifacts/hex-battles/components/WelcomeModal.tsx`, `components/MainMenu.tsx`.

**Tests**
- `logic/gameLogic.test.ts`, `logic/tileTapHandler.test.ts`, `logic/aiHelpers.test.ts`, `logic/aiStrategy.test.ts`.

---

### Task 1: City cap and spacing predicates

**Files:**
- Modify: `artifacts/hex-battles/utils/hexGrid.ts` (add beside `CITY_BONUS`, around line 157)
- Modify: `artifacts/hex-battles/logic/gameLogic.ts` (append after `canImproveTile`, ~line 641)
- Test: `artifacts/hex-battles/logic/gameLogic.test.ts`

**Interfaces:**
- Consumes: `hexDistance`, `HexTile`, `TerritoryOwner` from `@/utils/hexGrid`.
- Produces: `TILES_PER_CITY`, `MIN_OWN_CITY_DISTANCE`, `CITY_IMPROVE_RADIUS`, `cityCapFor(tileCount: number): number` (hexGrid); `ownCityKeys(cities, tileMap, owner): string[]`, `canFoundCity(o): boolean`, `foundCitySites(territory, territoryCityCount, ownCities): Set<string>` (gameLogic). Tasks 4, 5 and 6 all call these.

No caller changes in this task — nothing existing breaks, so the commit is green on its own.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/hex-battles/logic/gameLogic.test.ts` (add `canFoundCity`, `foundCitySites`, `ownCityKeys` to the existing import block from `@/logic/gameLogic`, and `cityCapFor` to the import block from `@/utils/hexGrid`):

```ts
// ─── City founding rules ──────────────────────────────────────────────────────

describe("cityCapFor", () => {
  it("allows one city per five tiles, rounded down", () => {
    expect(cityCapFor(0)).toBe(0);
    expect(cityCapFor(4)).toBe(0);
    expect(cityCapFor(5)).toBe(1);
    expect(cityCapFor(9)).toBe(1);
    expect(cityCapFor(10)).toBe(2);
    expect(cityCapFor(23)).toBe(4);
  });
});

describe("canFoundCity", () => {
  const base = {
    targetKey: "0,0",
    territoryTileCount: 5,
    territoryCityCount: 0,
    ownCityKeys: [] as string[],
  };

  it("needs five tiles per city", () => {
    expect(canFoundCity({ ...base, territoryTileCount: 4 })).toBe(false);
    expect(canFoundCity({ ...base, territoryTileCount: 5 })).toBe(true);
  });

  it("counts the cities the territory already holds against the cap", () => {
    expect(canFoundCity({ ...base, territoryTileCount: 9, territoryCityCount: 1 })).toBe(false);
    expect(canFoundCity({ ...base, territoryTileCount: 10, territoryCityCount: 1 })).toBe(true);
  });

  it("rejects a site closer than three tiles to a city the owner holds", () => {
    // "2,0" is two tiles from the origin, "3,0" is three.
    expect(canFoundCity({ ...base, territoryTileCount: 10, territoryCityCount: 1, ownCityKeys: ["2,0"] })).toBe(false);
    expect(canFoundCity({ ...base, territoryTileCount: 10, territoryCityCount: 1, ownCityKeys: ["3,0"] })).toBe(true);
  });

  it("checks the distance against every own city, including ones outside this territory", () => {
    expect(
      canFoundCity({
        ...base,
        territoryTileCount: 20,
        territoryCityCount: 1,
        ownCityKeys: ["5,0", "1,1"],
      }),
    ).toBe(false);
  });
});

describe("ownCityKeys", () => {
  it("keeps only cities standing on tiles this owner holds", () => {
    const tileMap = new Map<string, HexTile>([
      ["0,0", mkTile("0,0", "player")],
      ["3,0", mkTile("3,0", "ai1")],
      ["6,0", mkTile("6,0", "neutral")],
    ]);
    const cities = new Set(["0,0", "3,0", "6,0"]);
    expect(ownCityKeys(cities, tileMap, "player")).toEqual(["0,0"]);
  });
});

describe("foundCitySites", () => {
  it("returns every legal tile of the territory and nothing else", () => {
    // A one-row territory from 0,0 to 4,0 with a city already at 0,0.
    const territory = ["0,0", "1,0", "2,0", "3,0", "4,0"].map((k) => mkTile(k, "player"));
    const sites = foundCitySites(territory, 1, ["0,0"]);
    // Cap is floor(5/5) = 1 and one city exists, so nothing is legal.
    expect(sites.size).toBe(0);
  });

  it("excludes only the tiles within three of an own city", () => {
    const keys = ["0,0", "1,0", "2,0", "3,0", "4,0", "5,0", "6,0", "7,0", "8,0", "9,0"];
    const territory = keys.map((k) => mkTile(k, "player"));
    const sites = foundCitySites(territory, 1, ["0,0"]);
    expect([...sites].sort()).toEqual(["3,0", "4,0", "5,0", "6,0", "7,0", "8,0", "9,0"]);
  });
});
```

`mkTile` is a local helper — add it next to the new describes if the file has no equivalent already (check first; reuse whatever the file uses):

```ts
function mkTile(key: string, owner: TerritoryOwner): HexTile {
  const [q, r] = key.split(",").map(Number);
  return { q, r, key, terrain: "grass", owner, cityBuffer: false, isCity: false };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: FAIL — `canFoundCity is not a function` / import errors for the new names.

- [ ] **Step 3: Add the constants and the cap to `utils/hexGrid.ts`**

Insert directly after `export const CITY_BONUS = 1;` (line 157):

```ts
/** Tiles a territory must own for each city it may found. */
export const TILES_PER_CITY = 5;

/**
 * Minimum hex distance between two cities of the SAME owner. Enemy and neutral
 * cities never block a site. Checked only when founding: a territory that
 * shrinks, splits, or captures a city standing too close keeps every city.
 */
export const MIN_OWN_CITY_DISTANCE = 3;

/** How far a city's improvement zone reaches, in hex distance. */
export const CITY_IMPROVE_RADIUS = 2;

/** How many cities a territory of `tileCount` tiles may hold. */
export function cityCapFor(tileCount: number): number {
  return Math.floor(tileCount / TILES_PER_CITY);
}
```

- [ ] **Step 4: Add the predicates to `logic/gameLogic.ts`**

Add `hexDistance`, `cityCapFor`, `MIN_OWN_CITY_DISTANCE` to the existing `@/utils/hexGrid` import block at the top of the file, then append after `canImproveTile` (~line 641):

```ts
/**
 * The cities of `cities` that stand on tiles `owner` holds. The `cities` set is
 * global — it holds every city on the board regardless of owner — so the
 * founding distance rule, which only counts the owner's own cities, has to
 * filter it through the tile map first.
 */
export function ownCityKeys(
  cities: Iterable<string>,
  tileMap: Map<string, HexTile>,
  owner: TerritoryOwner,
): string[] {
  const out: string[] = [];
  for (const key of cities) {
    if (tileMap.get(key)?.owner === owner) out.push(key);
  }
  return out;
}

/**
 * Whether a city may be founded on `targetKey`. Covers the two spatial rules
 * only — one city per TILES_PER_CITY tiles of the paying territory, and at
 * least MIN_OWN_CITY_DISTANCE from every city the owner already holds.
 * Occupancy, terrain and gold stay with the callers that already check them
 * (classifyOwnTilePlacement, playerCanAfford), exactly as before.
 */
export function canFoundCity(o: {
  targetKey: string;
  /** Tiles in the contiguous territory paying for the city. */
  territoryTileCount: number;
  /** Cities already inside that territory, however they were acquired. */
  territoryCityCount: number;
  /** Every city this owner holds, anywhere on the map. */
  ownCityKeys: Iterable<string>;
}): boolean {
  if (o.territoryCityCount >= cityCapFor(o.territoryTileCount)) return false;
  const [q, r] = o.targetKey.split(",").map(Number);
  for (const key of o.ownCityKeys) {
    const [cq, cr] = key.split(",").map(Number);
    if (hexDistance(q, r, cq, cr) < MIN_OWN_CITY_DISTANCE) return false;
  }
  return true;
}

/**
 * Every tile of `territory` where this owner may found a city. Evaluates the
 * cap once and then walks the territory a single time, so the cost is
 * O(territory x own cities) per call rather than per candidate tile — the
 * expert search asks for this once per candidate-generation pass.
 */
export function foundCitySites(
  territory: HexTile[],
  territoryCityCount: number,
  ownCities: Iterable<string>,
): Set<string> {
  const out = new Set<string>();
  if (territoryCityCount >= cityCapFor(territory.length)) return out;
  const cityCoords = [...ownCities].map((k) => k.split(",").map(Number) as [number, number]);
  for (const tile of territory) {
    let blocked = false;
    for (const [cq, cr] of cityCoords) {
      if (hexDistance(tile.q, tile.r, cq, cr) < MIN_OWN_CITY_DISTANCE) {
        blocked = true;
        break;
      }
    }
    if (!blocked) out.add(tile.key);
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Typecheck**

Run: `pnpm run typecheck` (from `/home/jo/Hex-Battles`)
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add artifacts/hex-battles/utils/hexGrid.ts artifacts/hex-battles/logic/gameLogic.ts artifacts/hex-battles/logic/gameLogic.test.ts
git commit -m "feat(cities): add the city cap and spacing predicates"
```

---

### Task 2: Improvement anchor resolution

**Files:**
- Modify: `artifacts/hex-battles/logic/gameLogic.ts` (append after `foundCitySites`)
- Test: `artifacts/hex-battles/logic/gameLogic.test.ts`

**Interfaces:**
- Consumes: `CITY_IMPROVE_RADIUS`, `hexDistance` from `@/utils/hexGrid`.
- Produces: `ImproveAnchor` (`{ anchor: string | null; inRange: boolean }`) and `findImproveAnchor(o): ImproveAnchor`. Task 4 calls it from `useSelectionState`, `tileTapHandler`, `aiHelpers` and `aiStrategy`.

Still no caller changes — `canImproveTile` is untouched until Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/hex-battles/logic/gameLogic.test.ts` (add `findImproveAnchor` to the `@/logic/gameLogic` import):

```ts
// ─── findImproveAnchor ────────────────────────────────────────────────────────

describe("findImproveAnchor", () => {
  const noneUsed = new Set<string>();

  it("picks a city within two tiles and reports it in range", () => {
    expect(
      findImproveAnchor({ tileKey: "2,0", territoryCityKeys: ["0,0"], usedCities: noneUsed }),
    ).toEqual({ anchor: "0,0", inRange: true });
  });

  it("rejects a tile three or more away", () => {
    expect(
      findImproveAnchor({ tileKey: "3,0", territoryCityKeys: ["0,0"], usedCities: noneUsed }),
    ).toEqual({ anchor: null, inRange: false });
  });

  it("returns nothing when the territory has no city at all", () => {
    expect(
      findImproveAnchor({ tileKey: "0,0", territoryCityKeys: [], usedCities: noneUsed }),
    ).toEqual({ anchor: null, inRange: false });
  });

  it("prefers the nearest city among several in range", () => {
    expect(
      findImproveAnchor({
        tileKey: "1,0",
        territoryCityKeys: ["3,0", "0,0"],
        usedCities: noneUsed,
      }).anchor,
    ).toBe("0,0");
  });

  it("skips a city that already built this turn and takes the next nearest", () => {
    expect(
      findImproveAnchor({
        tileKey: "1,0",
        territoryCityKeys: ["0,0", "3,0"],
        usedCities: new Set(["0,0"]),
      }),
    ).toEqual({ anchor: "3,0", inRange: true });
  });

  it("reports in range but no anchor when every city in range has built", () => {
    expect(
      findImproveAnchor({
        tileKey: "1,0",
        territoryCityKeys: ["0,0"],
        usedCities: new Set(["0,0"]),
      }),
    ).toEqual({ anchor: null, inRange: true });
  });

  it("breaks ties between equally distant cities by tile key", () => {
    // "0,0" and "2,0" are both distance 1 from "1,0".
    expect(
      findImproveAnchor({
        tileKey: "1,0",
        territoryCityKeys: ["2,0", "0,0"],
        usedCities: noneUsed,
      }).anchor,
    ).toBe("0,0");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts -t findImproveAnchor`
Expected: FAIL — `findImproveAnchor is not a function`.

- [ ] **Step 3: Implement it**

Append to `logic/gameLogic.ts` (add `CITY_IMPROVE_RADIUS` to the `@/utils/hexGrid` import):

```ts
/**
 * Which city would pay for an improvement on a tile.
 *
 * `inRange` exists so the UI can tell the two failure modes apart: no city
 * covers the tile at all, versus every covering city has already built this
 * turn.
 */
export interface ImproveAnchor {
  /** Nearest covering city that has not built this turn, or null. */
  anchor: string | null;
  /** Whether any city of the territory covers the tile at all. */
  inRange: boolean;
}

/**
 * Resolves both the zone rule and the one-improvement-per-city-per-turn rule at
 * once: a tile is improvable when a city of the SAME territory stands within
 * CITY_IMPROVE_RADIUS and has not built this turn. Overlapping zones are a real
 * benefit — the nearest unused city pays, so two cities three tiles apart allow
 * two improvements in their shared area in one turn. Ties between equally
 * distant unused cities go to the lower tile key, so the choice is
 * deterministic and testable.
 */
export function findImproveAnchor(o: {
  tileKey: string;
  /** Keys of the cities inside the same territory. */
  territoryCityKeys: Iterable<string>;
  /** Cities of this owner that already paid for an improvement this turn. */
  usedCities: ReadonlySet<string>;
}): ImproveAnchor {
  const [q, r] = o.tileKey.split(",").map(Number);
  let anchor: string | null = null;
  let bestDist = Infinity;
  let inRange = false;
  for (const key of o.territoryCityKeys) {
    const [cq, cr] = key.split(",").map(Number);
    const dist = hexDistance(q, r, cq, cr);
    if (dist > CITY_IMPROVE_RADIUS) continue;
    inRange = true;
    if (o.usedCities.has(key)) continue;
    if (dist < bestDist || (dist === bestDist && anchor !== null && key < anchor)) {
      bestDist = dist;
      anchor = key;
    }
  }
  return { anchor, inRange };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm run typecheck
git add artifacts/hex-battles/logic/gameLogic.ts artifacts/hex-battles/logic/gameLogic.test.ts
git commit -m "feat(cities): resolve which city pays for an improvement"
```

---

### Task 3: Per-turn used-city state (player and AI), no behaviour change

**Files:**
- Modify: `artifacts/hex-battles/types.ts:76-92` (`MoveHistorySnapshot`)
- Modify: `artifacts/hex-battles/app/game.tsx` (state near line 395; resume block near 622; reset block near 640; `useMoveHistory` call near 981)
- Modify: `artifacts/hex-battles/hooks/useMoveHistory.ts`
- Modify: `artifacts/hex-battles/logic/endTurnHandler.ts` (params near line 45, destructure near 90, reset near 166)
- Modify: `artifacts/hex-battles/utils/savedGame.ts`
- Modify: `artifacts/hex-battles/logic/aiHelpers.ts:20-33` (`AiContext`)
- Modify: `artifacts/hex-battles/logic/aiStrategy.ts` (`AiWorkingState` near line 980; `ws` construction near 1070; `aiCtx` getters near 1240; per-owner reset)

**Interfaces:**
- Produces: player state `improvedCities: Set<string>` + `setImprovedCities`; `MoveHistorySnapshot.improvedCities: Set<string>`; `AiContext.cityImproveUsed: Set<string>`; `AiWorkingState.cityImproveUsed: Set<string>`. Task 4 reads and writes all of them.

Nothing reads the new state yet, so this task is pure plumbing: the game must behave exactly as before. Follow `firedUnits` everywhere — it is the closest existing per-turn set and every site you need to touch already handles it.

- [ ] **Step 1: Add the field to the history snapshot type**

In `artifacts/hex-battles/types.ts`, inside `MoveHistorySnapshot` (after `firedUnits: Set<string>;`):

```ts
  /** Cities that already paid for an improvement this turn. */
  improvedCities: Set<string>;
```

- [ ] **Step 2: Thread it through `useMoveHistory`**

In `hooks/useMoveHistory.ts`: add `improvedCities: Set<string>;` and `setImprovedCities: (s: Set<string>) => void;` to `UseMoveHistoryParams` (next to `firedUnits` / `setFiredUnits`), add both to the destructured parameter list, add `improvedCities: new Set(improvedCities),` to the snapshot object in `pushHistory`, add `improvedCities` to the `pushHistory` dependency array, and add this to `handleUndo` next to the `setFiredUnits` line:

```ts
      setImprovedCities(snapshot.improvedCities ?? new Set());
```

The `?? new Set()` matches the existing defensive style for `cities` and `firedUnits` — a snapshot pushed before this change has no such field.

- [ ] **Step 3: Add the player state in `game.tsx`**

Next to `const [firedUnits, setFiredUnits] = useState<Set<string>>(new Set());` (line 395):

```ts
  // Cities that already paid for an improvement this turn. Cleared when the
  // player's turn ends; each AI owner tracks its own in AiWorkingState.
  const [improvedCities, setImprovedCities] = useState<Set<string>>(new Set());
```

Then:
- In the resume branch (near line 622, after `setFiredUnits(s.firedUnits);`): `setImprovedCities(s.improvedCities ?? new Set());`
- In the fresh-game branch (near line 645, after `setFiredUnits(new Set());`): `setImprovedCities(new Set());`
- Pass `improvedCities` and `setImprovedCities` into the `useMoveHistory({ ... })` call (near line 981).

- [ ] **Step 4: Reset it at end of turn**

In `logic/endTurnHandler.ts`: add `setImprovedCities: (s: Set<string>) => void;` to the params interface next to `setFiredUnits`, destructure it next to `setFiredUnits`, and add the reset next to `setFiredUnits(new Set());` (line 166):

```ts
  setImprovedCities(new Set());
```

Then pass `setImprovedCities` from `game.tsx` wherever `setFiredUnits` is already passed to the end-turn handler.

- [ ] **Step 5: Persist it**

In `utils/savedGame.ts`, mirror `firedUnits` exactly: `improvedCities: Set<string>;` on the state interface (line ~31), `improvedCities?: string[];` on the serialized interface (line ~73), `improvedCities: [...g.state.improvedCities],` when writing (line ~103), and when reading (line ~142):

```ts
        improvedCities: new Set(parsed.state.improvedCities ?? []),
```

The optional field and the `?? []` keep saves written before this change loadable.

- [ ] **Step 6: Add the AI's own set**

In `logic/aiHelpers.ts`, inside `AiContext` (after `combatSpentUnits`):

```ts
  /** Cities of this AI that already paid for an improvement this turn. */
  cityImproveUsed: Set<string>;
```

In `logic/aiStrategy.ts`:
- Add `cityImproveUsed: Set<string>;` to `AiWorkingState` (near line 980).
- Initialise it to `new Set()` where `ws` is built, and **reset it to a fresh empty set at the start of each owner's turn**, in the same place `ws.spentUnits` is established for that owner. Copy-on-write it like `markSpent` does (`aiStrategy.ts:1658`) rather than mutating in place.
- Expose it on the `aiCtx` object next to the other pass-throughs (`get cities() { ... }` near line 1240) as `get cityImproveUsed() { return ws.cityImproveUsed; }`.
- Every other place that constructs an `AiContext` or `AiWorkingState` literal needs the new field too — `new Set()` is right for all of them. Known sites: `logic/aiSelfPlay.ts`, `logic/aiHelpers.test.ts:43` (`makeCtx`), `logic/aiExpert.test.ts:47` (`makeCtx`), `logic/aiStrategy.test.ts:471` (`makeAiCtx`) and `logic/aiStrategy.test.ts:20` (`makeEmptyWs`). Search for `combatSpentUnits:` to catch any others.

- [ ] **Step 7: Verify nothing changed**

Run: `pnpm run typecheck` then `pnpm test`
Expected: typecheck clean, the whole suite as green as it was before this task (no new failures).

- [ ] **Step 8: Commit**

```bash
git add -A artifacts/hex-battles
git commit -m "feat(cities): track which cities have built this turn"
```

---

### Task 4: Enforce the improvement zone and the per-turn allowance

**Files:**
- Modify: `artifacts/hex-battles/logic/gameLogic.ts:618-641` (`canImproveTile`)
- Modify: `artifacts/hex-battles/hooks/useSelectionState.ts:246-305`
- Modify: `artifacts/hex-battles/logic/tileTapHandler.ts:455-491`
- Modify: `artifacts/hex-battles/logic/aiHelpers.ts:245-270` (`dtFindImproveMove`)
- Modify: `artifacts/hex-battles/logic/aiStrategy.ts:1633-1656` (`dtExecImprove`)
- Modify: `artifacts/hex-battles/app/game.tsx` (pass `improvedCities` to `useSelectionState` and to the tap handler)
- Test: `artifacts/hex-battles/logic/gameLogic.test.ts`, `artifacts/hex-battles/logic/tileTapHandler.test.ts`, `artifacts/hex-battles/logic/aiHelpers.test.ts`

**Interfaces:**
- Consumes: `findImproveAnchor`, `ImproveAnchor` (Task 2); `improvedCities` / `AiContext.cityImproveUsed` / `AiWorkingState.cityImproveUsed` (Task 3).
- Produces: `canImproveTile` now takes `anchor: string | null` in place of `territoryHasCity: boolean`; `useSelectionState` returns `territoryCityKeys: string[]` in place of `territoryHasCity: boolean`, and `improvementAvailability: Map<TerrainType, { available: boolean; inRange: boolean }>` in place of `Map<TerrainType, boolean>`. Task 5 consumes both from the ribbon.

This is the task where behaviour actually changes for both the player and the AI. The signature swap on `canImproveTile` forces all three call sites into the same commit — that is intended, not scope creep.

- [ ] **Step 1: Update the `canImproveTile` tests**

In `logic/gameLogic.test.ts`, the `canImproveTile` describe block (line ~705) drives ~15 assertions off one shared `base` object. Replace the `territoryHasCity: true,` line in that fixture with:

```ts
    anchor: "0,0" as string | null,
```

and replace the "requires a city in the territory" case:

```ts
  it("requires a city in range that has not built this turn", () => {
    expect(canImproveTile({ ...base, anchor: null })).toBe(false);
  });
```

Everything else in the block stays as-is.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts -t canImproveTile`
Expected: FAIL — the fixture no longer matches the predicate's parameter type / the null case still passes for the wrong reason.

- [ ] **Step 3: Swap the field in `canImproveTile`**

In `logic/gameLogic.ts`, replace the `territoryHasCity` field and its guard:

```ts
export function canImproveTile(o: {
  /** The tile's current terrain. */
  terrain: TerrainType;
  /** The improvement being built, identified by the terrain it produces. */
  targetTerrain: TerrainType;
  /** The territory's gold balance. */
  balance: number;
  /**
   * The city that would pay for this improvement — from findImproveAnchor.
   * Null means no city of the territory covers the tile, or every covering
   * city has already built this turn.
   */
  anchor: string | null;
  /** Whether the tile itself is a city. */
  isCity: boolean;
  /** The entity standing on the tile, if any. */
  occupantEntity: EntityType | undefined;
}): boolean {
  if (o.anchor === null) return false;
  if (o.isCity) return false;
  // ... rest unchanged
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/gameLogic.test.ts`
Expected: PASS. (`pnpm run typecheck` will still fail — the three call sites are next.)

- [ ] **Step 5: Update `useSelectionState`**

Add `improvedCities: Set<string>;` to `SelectionStateParams` and the destructured list; import `findImproveAnchor` alongside `canImproveTile`. Then:

Replace `territoryHasCity` (line 246):

```ts
  // The cities of the selected territory. Both improvement helpers need the
  // keys rather than a yes/no, since the zone and the per-turn allowance are
  // resolved per city.
  const territoryCityKeys = useMemo<string[]>(
    () => selectedTerritory.filter((t) => cities.has(t.key)).map((t) => t.key),
    [selectedTerritory, cities],
  );
```

Rewrite `validImprovementTiles` (line 254) — the `canImproveTile` call gains the anchor:

```ts
  const validImprovementTiles = useMemo<Set<string>>(() => {
    if (!armedImprovement) return EMPTY_TILE_SET;
    const result = new Set<string>();
    for (const tile of selectedTerritory) {
      const { anchor } = findImproveAnchor({
        tileKey: tile.key,
        territoryCityKeys,
        usedCities: improvedCities,
      });
      if (
        canImproveTile({
          terrain: tile.terrain,
          targetTerrain: armedImprovement,
          balance: selectedTerritoryBalance,
          anchor,
          isCity: cities.has(tile.key),
          occupantEntity: entities.get(tile.key),
        })
      )
        result.add(tile.key);
    }
    return result;
  }, [
    armedImprovement,
    selectedTerritory,
    selectedTerritoryBalance,
    territoryCityKeys,
    improvedCities,
    cities,
    entities,
  ]);
```

Rewrite `improvementAvailability` (line 287) to report the reason as well as the yes/no. It keeps its existing "ignore gold" convention (`balance: imp.cost`):

```ts
  // Whether the territory holds at least one tile each improvement could be
  // built on, ignoring gold, plus why not when it does not: `inRange` false
  // means no city covers a candidate tile, `inRange` true with `available`
  // false means every covering city has already built this turn. An
  // unaffordable item dims with its price showing, which is the ribbon's
  // existing convention, but an item with no possible target says so instead.
  const improvementAvailability = useMemo<
    Map<TerrainType, { available: boolean; inRange: boolean }>
  >(() => {
    const result = new Map<TerrainType, { available: boolean; inRange: boolean }>();
    for (const imp of IMPROVEMENTS) {
      let available = false;
      let inRange = false;
      for (const tile of selectedTerritory) {
        if (improveTargetFor(tile.terrain) !== imp.target) continue;
        const a = findImproveAnchor({
          tileKey: tile.key,
          territoryCityKeys,
          usedCities: improvedCities,
        });
        if (a.inRange) inRange = true;
        if (
          canImproveTile({
            terrain: tile.terrain,
            targetTerrain: imp.target,
            balance: imp.cost,
            anchor: a.anchor,
            isCity: cities.has(tile.key),
            occupantEntity: entities.get(tile.key),
          })
        ) {
          available = true;
          break;
        }
      }
      result.set(imp.target, { available, inRange });
    }
    return result;
  }, [selectedTerritory, territoryCityKeys, improvedCities, cities, entities]);
```

Add `improveTargetFor` to the `@/utils/hexGrid` import. In the returned object, replace `territoryHasCity` with `territoryCityKeys`.

- [ ] **Step 6: Update the tap handler's improvement branch**

In `logic/tileTapHandler.ts`: add `improvedCities: Set<string>;` and `setImprovedCities: Dispatch<SetStateAction<Set<string>>>;` to `TileTapParams`, destructure both, and import `findImproveAnchor`. Replace lines 459-489 (from `const territoryHasCity = ...` through the batched update):

```ts
    // Re-check the rule rather than trusting the highlight set, which is
    // computed from a render-time snapshot.
    const { anchor } = findImproveAnchor({
      tileKey: key,
      territoryCityKeys: selectedTerritory.filter((t) => cities.has(t.key)).map((t) => t.key),
      usedCities: improvedCities,
    });
    if (
      !targetTile ||
      !canImproveTile({
        terrain: targetTile.terrain,
        targetTerrain: armedImprovement,
        balance,
        anchor,
        isCity: cities.has(key),
        occupantEntity: entities.get(key),
      })
    ) {
      triggerErrorFlash(key);
      return;
    }
    const cost = improveCostFor(armedImprovement);
    pushHistory();
    const newTileMap = new Map(activeTileMap);
    newTileMap.set(key, { ...targetTile, terrain: armedImprovement });
    unstable_batchedUpdates(() => {
      setMutableTileMap(newTileMap);
      setTerritoryBalances((prev) => {
        const next = new Map(prev);
        next.set(selectedTerritoryId, (next.get(selectedTerritoryId) ?? 0) - cost);
        return next;
      });
      // The anchor is non-null here — canImproveTile rejects otherwise. It
      // spends its one improvement for this turn.
      setImprovedCities((prev) => new Set([...prev, anchor!]));
      setArmedImprovement(null);
      closeRibbon();
    });
    return;
```

`pushHistory()` already runs before the mutation, so undo restores `improvedCities` via Task 3.

- [ ] **Step 7: Update the AI's improvement chokepoint**

In `logic/aiHelpers.ts`, `dtFindImproveMove`: replace the `territoryHasCity` lines with the territory's city keys, and resolve an anchor per tile. Update its doc comment to describe the zone and the allowance rather than "requires a city in the territory":

```ts
  if (!ctx.elements.improvements) return null;
  const territoryCityKeys = territory.filter((t) => ctx.cities.has(t.key)).map((t) => t.key);
  if (territoryCityKeys.length === 0) return null;
  let best: { key: string; terrain: TerrainType } | null = null;
  let bestPrio = -1;
  for (const t of territory) {
    const target = improveTargetFor(t.terrain);
    if (!target) continue;
    const { anchor } = findImproveAnchor({
      tileKey: t.key,
      territoryCityKeys,
      usedCities: ctx.cityImproveUsed,
    });
    if (
      !canImproveTile({
        terrain: t.terrain,
        targetTerrain: target,
        balance,
        anchor,
        isCity: ctx.cities.has(t.key),
        occupantEntity: ctx.entities.get(t.key),
      })
    )
      continue;
```

The rest of the loop (the city-adjacency priority) is unchanged.

- [ ] **Step 8: Mark the anchor used in `dtExecImprove`**

In `logic/aiStrategy.ts:1633-1656`, resolve the anchor **before** rewriting the tile map (afterwards the territory is recomputed anyway, but the anchor must be read from the same territory the finder used), and record it on success. Insert after the `const tt = ws.tileMap.get(target); if (!tt) return false;` guard:

```ts
        const terrBefore = getContiguousTerritory(ws.tileMap, target, aiOwner, ws.entities);
        const { anchor } = findImproveAnchor({
          tileKey: target,
          territoryCityKeys: terrBefore.filter((t) => ws.cities.has(t.key)).map((t) => t.key),
          usedCities: ws.cityImproveUsed,
        });
        if (!anchor) return false;
```

and after the balance update, before the state setters:

```ts
        ws.cityImproveUsed = new Set(ws.cityImproveUsed);
        ws.cityImproveUsed.add(anchor);
```

- [ ] **Step 9: Wire the new state through `game.tsx`**

Pass `improvedCities` into the `useSelectionState({ ... })` call, and `improvedCities` + `setImprovedCities` into the tap-handler params object. Replace any use of the removed `territoryHasCity` return value with `territoryCityKeys.length > 0` for now; Task 5 gives the ribbon its real states.

- [ ] **Step 10: Write the behaviour tests**

In `logic/tileTapHandler.test.ts`, inside the existing `describe("improvement placement")` block (line ~972), which already has an `improveParams` helper whose default fixture is a two-tile territory `0,0`/`1,0` with the city at `1,0` and the tap on `0,0`. Add `improvedCities: new Set(),` and `setImprovedCities: vi.fn(),` to the shared `makeParams` defaults (line ~25) first, then add:

```ts
  it("flashes an error when the tile is more than two tiles from any city", () => {
    const tiles = [
      makeTile(0, 0, "player", "grass"),
      makeTile(1, 0, "player", "grass"),
      makeTile(2, 0, "player", "grass"),
      makeTile(3, 0, "player", "grass"),
    ];
    const params = improveParams({
      key: "3,0",
      activeTileMap: tileMap(tiles),
      selectedTerritory: tiles,
      selectedTileKeys: new Set(["0,0", "1,0", "2,0", "3,0"]),
      cities: new Set(["0,0"]),
      validImprovementTiles: new Set(["3,0"]),
    });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("3,0");
  });

  it("flashes an error when the only city in range already built this turn", () => {
    const params = improveParams({ improvedCities: new Set(["1,0"]) });
    handleTileTapLogic(params);
    expect(params.setMutableTileMap).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("0,0");
  });

  it("charges a second improvement to another city in range", () => {
    const tiles = [
      makeTile(0, 0, "player", "grass"),
      makeTile(1, 0, "player", "grass"),
      makeTile(2, 0, "player", "grass"),
    ];
    const params = improveParams({
      key: "1,0",
      activeTileMap: tileMap(tiles),
      selectedTerritory: tiles,
      selectedTileKeys: new Set(["0,0", "1,0", "2,0"]),
      cities: new Set(["0,0", "2,0"]),
      improvedCities: new Set(["0,0"]),
      validImprovementTiles: new Set(["1,0"]),
    });
    handleTileTapLogic(params);
    const written = vi.mocked(params.setMutableTileMap).mock.calls[0][0];
    expect(written.get("1,0")?.terrain).toBe("field");
    const updater = vi.mocked(params.setImprovedCities).mock.calls[0][0];
    const next =
      typeof updater === "function" ? updater(params.improvedCities) : updater;
    expect(next.has("2,0")).toBe(true);
  });
```

The file's existing "flashes an error when the territory has no city" case still passes unchanged: an empty `cities` set yields a null anchor.

In `logic/aiHelpers.test.ts`, add to the `dtFindImproveMove` describe (line ~357):

```ts
  it("returns null when every improvable tile lies outside the city zones", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(5, 5, "ai1", "grass")];
    const ctx = makeCtx(tiles, [], [], "ai1");
    ctx.cities = new Set(["5,5"]);
    expect(dtFindImproveMove(tiles, ctx, 10)).toBeNull();
  });

  it("returns null when every city covering the improvable tiles has already built", () => {
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(1, 0, "ai1", "grass")];
    const ctx = makeCtx(tiles, [], [], "ai1");
    ctx.cities = new Set(["1,0"]);
    ctx.cityImproveUsed = new Set(["1,0"]);
    expect(dtFindImproveMove(tiles, ctx, 10)).toBeNull();
  });
```

**Existing fixtures in that describe must move inside a zone.** Three tests (lines ~371, ~381, ~391 — "improves an empty grass tile into a field", "improves a tile that a friendly unit is standing on", "ignores spent units") use `tiles = [makeTile(0, 0, ...), makeTile(5, 5, ...)]` with `ctx.cities = new Set(["5,5"])`. Distance 10 is now out of range, and `5,5` is not adjacent in the territory either. Change each to:

```ts
    const tiles = [makeTile(0, 0, "ai1", "grass"), makeTile(1, 0, "ai1", "grass")];
    // ... same entities/ctx as before ...
    ctx.cities = new Set(["1,0"]);
```

The expected result stays `{ key: "0,0", terrain: "field" }` — the city tile itself is never improvable, so `0,0` remains the only candidate.

- [ ] **Step 11: Run everything**

Run: `pnpm run typecheck` then `pnpm test`
Expected: typecheck clean; the new tests pass. Existing AI and selection tests that assumed "any tile of a territory with a city is improvable" will need their fixtures moved inside a city zone — that is a real consequence of the rule, so fix the fixture, never the rule.

- [ ] **Step 12: Commit**

```bash
git add -A artifacts/hex-battles
git commit -m "feat(improvements): confine improvements to city zones, one per city per turn"
```

---

### Task 5: Enforce and surface the city rules in the player path

**Files:**
- Modify: `artifacts/hex-battles/logic/tileTapHandler.ts:494-625` (placement branch)
- Modify: `artifacts/hex-battles/hooks/useSelectionState.ts` (new `validCitySites`)
- Modify: `artifacts/hex-battles/components/layerEquality.ts:87-128`
- Modify: `artifacts/hex-battles/components/MovementHighlightLayer.tsx:101-133`
- Modify: `artifacts/hex-battles/components/PurchaseRibbon.tsx:79-220`
- Modify: `artifacts/hex-battles/app/game.tsx` (prop wiring)
- Test: `artifacts/hex-battles/logic/tileTapHandler.test.ts`, `artifacts/hex-battles/components/renderLayers.test.ts`

**Interfaces:**
- Consumes: `canFoundCity`, `foundCitySites`, `ownCityKeys`, `cityCapFor` (Task 1); `territoryCityKeys`, `improvementAvailability` reason shape (Task 4).
- Produces: `useSelectionState` returns `validCitySites: Set<string>`; `MovementHighlightLayerProps` gains `validCitySites: Set<string>`; `PurchaseRibbon` gains `validCitySites: Set<string>`.

Note: the tap handler currently enforces **no** city rule at all — the old "one per territory, 5+ tiles" rule lived only in the ribbon. This task is where the rule genuinely starts being enforced.

- [ ] **Step 1: Write the failing tap-handler tests**

Add this describe block to `logic/tileTapHandler.test.ts`, using the file's existing `makeParams`, `makeTile` and `tileMap` helpers:

```ts
// ─── City founding rules ──────────────────────────────────────────────────────

describe("founding a city", () => {
  /** A straight row of `n` player tiles from 0,0 to n-1,0. */
  function row(n: number): HexTile[] {
    return Array.from({ length: n }, (_, i) => makeTile(i, 0, "player"));
  }

  function cityParams(
    tiles: HexTile[],
    overrides: Partial<TileTapParams> = {},
  ): TileTapParams {
    return makeParams({
      armedEntityId: "city",
      activeTileMap: tileMap(tiles),
      selectedTerritory: tiles.filter((t) => t.owner === "player"),
      selectedTileKeys: new Set(
        tiles.filter((t) => t.owner === "player").map((t) => t.key),
      ),
      selectedTerritoryId: "0,0",
      territoryBalances: new Map([["0,0", 100]]),
      ...overrides,
    });
  }

  it("rejects a city when the territory is already at its cap", () => {
    // 9 tiles → cap floor(9/5) = 1, and one city already stands at 0,0.
    const params = cityParams(row(9), { key: "5,0", cities: new Set(["0,0"]) });
    handleTileTapLogic(params);
    expect(params.setCities).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("5,0");
  });

  it("rejects a city within three tiles of one the player already holds", () => {
    // 15 tiles → cap 3, so only the spacing rule can reject 2,0.
    const params = cityParams(row(15), { key: "2,0", cities: new Set(["0,0"]) });
    handleTileTapLogic(params);
    expect(params.setCities).not.toHaveBeenCalled();
    expect(params.triggerErrorFlash).toHaveBeenCalledWith("2,0");
  });

  it("allows a city exactly three tiles away when the cap allows it", () => {
    // 10 tiles → cap 2, one city held, and 3,0 is exactly the minimum distance.
    const params = cityParams(row(10), { key: "3,0", cities: new Set(["0,0"]) });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).not.toHaveBeenCalled();
    expect(params.setCities).toHaveBeenCalled();
  });

  it("ignores an enemy city when checking the distance", () => {
    // An ai1 city sits two tiles away at 1,1; only the player's own cities block.
    const tiles = [...row(5), makeTile(1, 1, "ai1")];
    const params = cityParams(tiles, { key: "0,0", cities: new Set(["1,1"]) });
    handleTileTapLogic(params);
    expect(params.triggerErrorFlash).not.toHaveBeenCalled();
    expect(params.setCities).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`
Expected: FAIL — the first two found the city anyway, because nothing checks.

- [ ] **Step 3: Add the re-check to the placement branch**

In `logic/tileTapHandler.ts`, import `canFoundCity` and `ownCityKeys`. Inside the `if (!alreadyOccupied && selectedTerritoryId) {` block (line ~521), directly after `const blockedByGraveyard = ...`:

```ts
      // The city rules — cap and spacing — re-checked at the commit site. The
      // ribbon and the purchase dots compute the same thing from a render-time
      // snapshot; this is the authority.
      const cityRuleOk =
        armedEntityId !== "city" ||
        canFoundCity({
          targetKey: key,
          territoryTileCount: selectedTerritory.length,
          territoryCityCount: selectedTerritory.filter((t) => cities.has(t.key)).length,
          ownCityKeys: ownCityKeys(cities, activeTileMap, "player"),
        });
```

and extend the guard on the next line:

```ts
      if (
        playerCanAfford(balance, effectiveCost) &&
        !blockedByGraveyard &&
        cityRuleOk
      ) {
```

The existing `else { triggerErrorFlash(key); }` already covers the rejection.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/tileTapHandler.test.ts`
Expected: PASS.

- [ ] **Step 5: Expose the legal sites from `useSelectionState`**

Import `foundCitySites` and `ownCityKeys`. Add after `territoryCityKeys`:

```ts
  // Every tile of the selected territory where a city may be founded. NOT
  // gated on a city being armed: the ribbon needs it to decide whether to
  // offer the City item at all, and only the highlight layer restricts its use
  // to the armed case.
  const validCitySites = useMemo<Set<string>>(
    () =>
      foundCitySites(
        selectedTerritory,
        territoryCityKeys.length,
        ownCityKeys(cities, activeTileMap, "player"),
      ),
    [selectedTerritory, territoryCityKeys, cities, activeTileMap],
  );
```

Return `validCitySites` from the hook.

- [ ] **Step 6: Filter the city purchase dots**

In `components/layerEquality.ts`, add `validCitySites: Set<string>;` to `MovementHighlightLayerEqualProps` (after `validImprovementTiles`) and `prev.validCitySites === next.validCitySites &&` to `areMovementHighlightLayerEqual`. The comment above the props type says a new prop cannot be added without deciding how the memo compares it — identity comparison is right here, since the set is memoized.

In `components/MovementHighlightLayer.tsx`, destructure `validCitySites` and add one guard inside the `armedEntityId && armedEntityId !== "bridge"` block, right after the `placement.blocked` check:

```ts
            // A city may only be founded on a legal site: inside the cap and at
            // least three tiles from every city the player already holds.
            if (armedEntityId === "city" && !validCitySites.has(key)) return null;
```

Pass `validCitySites` from `game.tsx`.

- [ ] **Step 7: Give the ribbon its three city states and two improvement reasons**

In `components/PurchaseRibbon.tsx`: replace the `territoryHasCity: boolean` prop with `validCitySites: Set<string>`, change `improvementAvailability` to `Map<TerrainType, { available: boolean; inRange: boolean }>`, and import `cityCapFor`.

Add a `territoryCityCount: number` prop (computed in `game.tsx` as `selectedTerritory.filter((t) => cities.has(t.key)).length` — the ribbon has no `cities` prop and should not grow one), then replace lines 88-90 with:

```ts
          const cityCap = cityCapFor(selectedTerritory.length);
          const cityTooSmall = item.id === "city" && cityCap === 0;
          const cityCapReached =
            item.id === "city" && cityCap > 0 && territoryCityCount >= cityCap;
          const cityNoSite =
            item.id === "city" && !cityTooSmall && !cityCapReached && validCitySites.size === 0;
          const cityLocked = cityTooSmall || cityCapReached || cityNoSite;
```

Update `costLabel` (line 101) so the chain reads: `round1Locked` → `"Round 2+"`, `bridgeLocked` → `"No water"`, `cityTooSmall` → `"<5 tiles"`, `cityCapReached` → `"MAX"`, `cityNoSite` → `"Too close"`, `playerTowerFree` → `"FREE"`, else the cost. Update `costIsMoney` to exclude all three city states, and replace the `cityAlreadyBuilt && styles.ribbonCostBuilt` style condition with `cityCapReached && styles.ribbonCostBuilt`.

For the improvement items (line 210-220):

```ts
              const availability = improvementAvailability.get(imp.target);
              const round1Locked = turn === 1;
              const noTarget = !availability?.available;
              // In range but unavailable can only mean every covering city has
              // already built this turn.
              const usedUp = noTarget && !!availability?.inRange;
              const affordable = imp.cost <= selectedTerritoryBalance;
              const enabled = affordable && !round1Locked && !noTarget;
              const statusLabel = round1Locked
                ? "Round 2+"
                : territoryCityCount === 0
                  ? "Needs city"
                  : usedUp
                    ? "Cities used"
                    : noTarget
                      ? `No ${imp.source} near`
                      : null;
```

The old `noCity` variable goes away — a territory with no city now yields `inRange: false, available: false` for every improvement, and the `territoryCityCount === 0` branch keeps the existing, clearer `"Needs city"` message for that case. `No grass near` / `No forest near` / `No desert near` covers the new case where the terrain exists but only outside every zone.

- [ ] **Step 8: Wire `game.tsx`**

Pass `validCitySites` and `territoryCityCount` to `PurchaseRibbon` and `validCitySites` to `MovementHighlightLayer`; drop the now-unused `territoryHasCity` prop.

- [ ] **Step 9: Run everything**

Run: `pnpm run typecheck` then `pnpm test`
Expected: clean and green. `components/renderLayers.test.ts` asserts on layer props — update its fixtures for the new `validCitySites` prop.

- [ ] **Step 10: Commit**

```bash
git add -A artifacts/hex-battles
git commit -m "feat(cities): enforce the cap and spacing in the player path"
```

---

### Task 6: Teach both AI brains the city rules

**Files:**
- Modify: `artifacts/hex-battles/logic/aiStrategy.ts:528-563` (priority D)
- Modify: `artifacts/hex-battles/logic/aiExpert.ts:998-1006` (candidate generation)
- Test: `artifacts/hex-battles/logic/aiStrategy.test.ts`, `artifacts/hex-battles/logic/aiExpert.test.ts`

**Interfaces:**
- Consumes: `canFoundCity`, `foundCitySites`, `ownCityKeys`, `cityCapFor` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

In `logic/aiStrategy.test.ts`, inside `describe("runAiTerritoryDecisionLoop")`, using its `makeAiCtx` / `makeExec` helpers. Note priority D only considers tiles inside a friendly tower/castle zone of control, so each fixture needs a tower placed where the test wants candidates:

```ts
  it("does not found a second city while the territory is at its cap", async () => {
    // 9 tiles → cap floor(9/5) = 1, and a city already stands at 0,0.
    const tiles = Array.from({ length: 9 }, (_, i) => makeTile(i, 0, "ai1"));
    const entities = new Map<string, EntityType>([["4,0", "tower"]]);
    const aiCtx = makeAiCtx(tiles, "ai1", entities, new Map([["0,0", 100]]));
    aiCtx.cities = new Set(["0,0"]);
    const exec = makeExec();

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => true, "hard");

    const cityBuilds = vi
      .mocked(exec.build)
      .mock.calls.filter(([type]) => type === "city");
    expect(cityBuilds).toHaveLength(0);
  });

  it("never founds a city within three tiles of one it already holds", async () => {
    // 15 tiles → cap 3. The tower at 4,0 puts the zone of control on 3,0/4,0/5,0,
    // all of which are legally far enough from the city at 0,0.
    const tiles = Array.from({ length: 15 }, (_, i) => makeTile(i, 0, "ai1"));
    const entities = new Map<string, EntityType>([["4,0", "tower"]]);
    const aiCtx = makeAiCtx(tiles, "ai1", entities, new Map([["0,0", 100]]));
    aiCtx.cities = new Set(["0,0"]);
    let built = false;
    const exec = makeExec({
      build: vi.fn(async (type) => {
        if (type === "city") built = true;
        return true;
      }),
    });

    await runAiTerritoryDecisionLoop("0,0", aiCtx, exec, () => !built, "hard");

    const cityBuilds = vi
      .mocked(exec.build)
      .mock.calls.filter(([type]) => type === "city");
    // Non-vacuous: the AI must actually want a city here.
    expect(cityBuilds.length).toBeGreaterThan(0);
    for (const [, target] of cityBuilds) {
      const [q, r] = String(target).split(",").map(Number);
      expect(hexDistance(q, r, 0, 0)).toBeGreaterThanOrEqual(3);
    }
  });
```

Import `hexDistance` from `@/utils/hexGrid` in that test file.

In `logic/aiExpert.test.ts`, inside `describe("generateCandidateActions")`, using its `makeTile` / `makeTileMap` / `makeCtx` helpers:

```ts
  it("offers no city candidate closer than three tiles to a city it holds", () => {
    // 12 tiles → cap 2, one city held, so one slot is open.
    const tiles = Array.from({ length: 12 }, (_, i) => makeTile(i, 0, "ai1"));
    const tm = makeTileMap(tiles);
    const ctx = makeCtx(tm, new Map(), "ai1", new Map());
    ctx.cities = new Set(["0,0"]);
    const cands = generateCandidateActions(ctx, Array.from(tm.values()), 100);
    const targets = cands
      .filter((c: ExpertAction) => c.kind === "build" && c.buildingType === "city")
      .map((c) => (c as { target: string }).target);
    // Non-vacuous: with a free slot the generator must offer somewhere legal.
    expect(targets.length).toBeGreaterThan(0);
    for (const key of targets) {
      const [q, r] = key.split(",").map(Number);
      expect(hexDistance(q, r, 0, 0)).toBeGreaterThanOrEqual(3);
    }
  });

  it("offers no city candidate at all once the territory is at its cap", () => {
    const tiles = Array.from({ length: 12 }, (_, i) => makeTile(i, 0, "ai1"));
    const tm = makeTileMap(tiles);
    const ctx = makeCtx(tm, new Map(), "ai1", new Map());
    ctx.cities = new Set(["0,0", "6,0"]); // 2 cities, cap floor(12/5) = 2
    const cands = generateCandidateActions(ctx, Array.from(tm.values()), 100);
    expect(
      cands.some((c: ExpertAction) => c.kind === "build" && c.buildingType === "city"),
    ).toBe(false);
  });
```

Import `hexDistance` from `@/utils/hexGrid` in that file too. If the first test comes out vacuous because the expert's `innerPlacements` set excludes every legal tile of a one-row territory, widen the fixture to a two-row block (add `makeTile(i, 1, "ai1")` for the same range) rather than deleting the non-vacuity assertion.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts logic/aiExpert.test.ts`
Expected: FAIL.

- [ ] **Step 3: Fix the decision tree (`aiStrategy.ts` priority D)**

Import `foundCitySites` and `ownCityKeys`. Replace the gate at line 530-531:

```ts
      const territoryCityCount = currTerr.filter((t) => aiCtx.cities.has(t.key)).length;
      const citySites = foundCitySites(
        currTerr,
        territoryCityCount,
        ownCityKeys(aiCtx.cities, aiCtx.tileMap, aiOwner),
      );
      if (canAfford(cityCost, 0) && citySites.size > 0) {
```

and add one clause to the existing `cityCands` filter (line ~552), so an illegal site can never be picked:

```ts
          if (!citySites.has(t.key)) return false;
```

- [ ] **Step 4: Fix the expert candidate generator (`aiExpert.ts`)**

Import `foundCitySites` and `ownCityKeys`. Replace lines 998-1006:

```ts
  const cityCost = ENTITY_META.city.cost;
  const territoryCityCount = territory.filter((t) => ctx.cities.has(t.key)).length;
  // Precomputed once per generation pass: an illegal city build left in the
  // list would be scored and valued by the 2-ply search, and per-candidate
  // distance scans would make generation cost O(territory x cities).
  const citySites =
    canAfford(cityCost)
      ? foundCitySites(territory, territoryCityCount, ownCityKeys(ctx.cities, ctx.tileMap, ctx.aiOwner))
      : new Set<string>();
  if (citySites.size > 0) {
    // Building on an improved tile would destroy the improvement; don't.
    for (const t of innerPlacements) {
      if (IMPROVED_TERRAINS.has(t.terrain)) continue;
      if (!citySites.has(t.key)) continue;
      out.push({ kind: "build", buildingType: "city", target: t.key, cost: cityCost });
    }
  }
```

Check the surrounding scope for the right owner accessor — the file uses `ctx.aiOwner` elsewhere; use whatever that block already has in scope.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter @workspace/hex-battles exec vitest run logic/aiStrategy.test.ts logic/aiExpert.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite and typecheck**

Run: `pnpm run typecheck` then `pnpm test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add -A artifacts/hex-battles
git commit -m "feat(ai): keep both brains inside the city cap and spacing rules"
```

---

### Task 7: Update the in-game rules copy

**Files:**
- Modify: `artifacts/hex-battles/components/WelcomeModal.tsx:140-143`
- Modify: `artifacts/hex-battles/components/MainMenu.tsx:88`

**Interfaces:** none — copy only.

Both texts state the current rules verbatim ("Once a territory has a City, a Peasant there can improve the tile it stands on…", "Founding a city, tower or castle on an improved tile destroys the improvement") and go stale with this change.

- [ ] **Step 1: Rewrite the WelcomeModal paragraph**

Replace the improvement paragraph at `WelcomeModal.tsx:140` so it states, in the file's existing `<Text style={styles.highlight}>` idiom:

- A territory may found one City per 5 tiles it owns, and a new City must sit at least 3 tiles from every City you already hold.
- Improvements may only be built within 2 tiles of one of your Cities in that territory.
- Each City pays for one improvement per turn.

Keep the existing sentences about what each improvement earns (line 143) and about founding a building on an improved tile destroying it — both are still true.

- [ ] **Step 2: Rewrite the MainMenu blurb**

`MainMenu.tsx:88` carries the short version of the same text. Add the 2-tile zone and the one-per-city-per-turn limit in one sentence; keep it to the length of the surrounding blurbs.

- [ ] **Step 3: Verify**

Run: `pnpm run typecheck` then `pnpm test`
Expected: clean and green. If a snapshot test covers this copy, update it.

- [ ] **Step 4: Commit**

```bash
git add -A artifacts/hex-battles
git commit -m "docs(cities): state the new city and improvement rules in game"
```

---

## Verification

After Task 7, before declaring the branch done:

- [ ] `pnpm run typecheck` from `/home/jo/Hex-Battles` — clean.
- [ ] `pnpm test` — the whole suite green, with the counts compared against `main` so no pre-existing failure is mistaken for a new one.
- [ ] Manual sanity pass in the app (`pnpm --filter @workspace/hex-battles run dev`): arm City in a 10-tile territory holding one city and confirm only tiles 3+ away carry a purchase dot; build one improvement and confirm the tiles around that city stop offering dots while tiles around a second city still do.

## Known follow-up, deliberately out of scope

Balance. Multiple cities per territory now multiply `CITY_BONUS` and the field city-adjacency bonus upward, while dead zones and the per-turn cap pull the number of improvements down. Read the net with a new-vs-old self-play A/B after merge — Expert-vs-Hard is saturated and will not show it. Do not tune constants inside this branch.
