# City Placement and Improvement Zones

Date: 2026-08-02
Branch: `feat/city-improvement-rules`
Status: approved for planning
Amends: `2026-07-30-improvements-from-build-menu-design.md`

## 1. Goal

Cities and improvements are currently almost unconstrained in space. A
territory may hold exactly one city — anywhere, as long as the territory has
five tiles — and once it does, *every* tile of that territory is improvable,
for as many improvements per turn as gold allows. The result is that late-game
territories turn into a uniform carpet of fields and mines, and the city itself
is a bookkeeping token rather than a place on the map.

Three rules replace that:

1. A territory may found **one city per five tiles** it owns, and a new city
   must be **at least 3 tiles from every city its owner already holds**.
2. Improvements may only be built **within 2 tiles of a city in the same
   territory**. Outside every such zone, building is illegal.
3. **Each city pays for at most one improvement per turn.**

Together these make a city a centre with a radius, make where you found it
matter, and put a per-turn ceiling on economic build-out that scales with how
many cities you have earned.

## 2. Player-facing rules

### 2.1 Founding a city

> A territory may hold one city for every 5 tiles it owns: 5–9 tiles allow one
> city, 10–14 allow two, and so on. A new city must also be at least 3 tiles
> away from every city you already own, anywhere on the map. Enemy and neutral
> cities do not block you.

Consequences, stated so they are not re-litigated later:

- **The cap is per territory; the spacing is global.** The cap counts the
  tiles and the cities of the one contiguous territory paying for the city.
  The 3-tile check runs against every city the owner holds, including cities in
  their other territories — two of your territories may not crowd each other
  across a shared border.
- **"At least 3 tiles apart" is `hexDistance >= 3`**, i.e. two tiles of gap.
  This mirrors the existing map-generator idiom in `hexGrid.ts`, where
  `MIN_CITY_DISTANCE = 5` rejects on `hexDistance(...) < MIN_CITY_DISTANCE`.
- **The rules apply at build time only.** A territory that shrinks below its
  cap keeps its cities. Capturing an enemy city that sits 1 tile from your own
  is legal and destroys nothing. Splitting a territory in two never removes a
  city. Nothing in this spec ever demolishes a city.
- **The cap counts cities, not who built them.** A captured city inside the
  territory counts against the cap like a founded one.
- **This rule is not gated by a game element.** Cities exist in every game, so
  the cap and the spacing always apply. Rules 2.2 and 2.3 are improvement
  rules and are therefore only reachable when the Improvements element is on.

### 2.2 Where improvements may be built

> An improvement may only be built on a tile within 2 tiles of one of your
> cities in the same territory. A city in a different territory of yours does
> not extend the zone.

- **`hexDistance <= 2`**, so a city covers itself plus 18 surrounding tiles —
  of which only the ones the territory actually owns are candidates.
- The city tile itself remains un-improvable, as today.
- Every other existing condition is unchanged: correct base terrain, enough
  gold in the territory's balance, no building or rebel on the tile. A friendly
  unit still does not block, and improving still does not spend that unit.
- The old "territory has a city" condition is subsumed: a territory with no
  city has no zone, so nothing is improvable.

### 2.3 One improvement per city per turn

> Each of your cities can pay for one improvement per turn. A tile in range of
> several of your cities uses the nearest city that has not built yet this
> turn.

- **Nearest unused city wins.** An improvement is legal when at least one city
  within range has not yet built this turn; the nearest such city is consumed.
  Ties between equally distant unused cities are broken by tile key, so the
  choice is deterministic and testable.
- **Overlap is a real benefit.** Two cities 3 tiles apart share part of their
  zones; a player may build two improvements in the shared area in one turn,
  one charged to each city. This follows from "nearest unused" and is
  intended — it is the reward for tight, legal city spacing.
- **The allowance is per owner turn.** The player's cities reset when the
  player's turn ends; each AI owner's cities reset at the start of that
  owner's turn.
- **Undo restores the allowance.** Undoing an improvement returns both the
  terrain and the consumed city's build for that turn.

## 3. Implementation

### 3.1 Shared predicates in `logic/gameLogic.ts`

Every rule above becomes one pure predicate that the player UI, the player tap
handler and both AI brains all call. This is the pattern `canImproveTile`
(`gameLogic.ts:618`) already establishes, and the discipline the improvement
commit site already follows — `tileTapHandler.ts:460` re-checks the predicate
rather than trusting the highlight set, because the highlight is a render-time
snapshot. Both new predicates inherit that discipline.

Constants (in `utils/hexGrid.ts`, beside `CITY_BONUS` and `IMPROVEMENTS`):

```ts
/** Tiles a territory must own per city it may found. */
export const TILES_PER_CITY = 5;
/** Minimum hex distance between two cities of the same owner. */
export const MIN_OWN_CITY_DISTANCE = 3;
/** How far a city's improvement zone reaches. */
export const CITY_IMPROVE_RADIUS = 2;

/** How many cities a territory of `tileCount` tiles may hold. */
export function cityCapFor(tileCount: number): number {
  return Math.floor(tileCount / TILES_PER_CITY);
}
```

**Founding.** A point predicate, plus a set-builder for the callers that need
every legal site at once (the highlight layer and the AI candidate generators):

```ts
export function canFoundCity(o: {
  targetKey: string;
  /** Tiles in the contiguous territory paying for the city. */
  territoryTileCount: number;
  /** Cities already inside that territory. */
  territoryCityCount: number;
  /** Every city this owner holds, anywhere on the map. */
  ownCityKeys: Iterable<string>;
}): boolean;

/** Every tile of `territory` where this owner may found a city. */
export function foundCitySites(
  territory: HexTile[],
  territoryCityCount: number,
  ownCityKeys: Iterable<string>,
): Set<string>;
```

`foundCitySites` evaluates the cap once and then walks the territory a single
time, so it is O(territory x owned cities) per call rather than per candidate
tile. `canFoundCity` covers only the two new rules; occupancy, terrain and
affordability stay where they already live (`classifyOwnTilePlacement`,
`playerCanAfford`), and callers keep combining them as they do today.

**Improving.** One helper resolves both the zone and the per-turn allowance,
and returns the city that would pay, so the commit site can mark it used
without recomputing the choice:

```ts
export interface ImproveAnchor {
  /** Nearest in-range city that has not built this turn, or null. */
  anchor: string | null;
  /** Whether any city was in range at all — drives the UI's reason label. */
  inRange: boolean;
}

export function findImproveAnchor(o: {
  tileKey: string;
  /** Keys of the cities inside the same territory. */
  territoryCityKeys: Iterable<string>;
  /** Cities of this owner that already built this turn. */
  usedCities: ReadonlySet<string>;
}): ImproveAnchor;
```

`canImproveTile` drops its `territoryHasCity` field and takes `anchor:
string | null` instead, returning false when it is null. Everything else in
that predicate is unchanged.

> **Test-fixture note:** `gameLogic.test.ts:705-768` drives ~15 assertions off
> one shared `base` object that sets `territoryHasCity`. Swapping the field
> breaks all of them at once, so updating that fixture is part of the change,
> not fallout to discover later.

### 3.2 Per-turn state: separate for the player and for each AI

The player's used-cities set and the AI's must not be the same object.
`endTurnHandler` resets the per-turn sets *and then* drives `runAiTurn` for
every AI owner inside the same flow (`endTurnHandler.ts:162-166`), so one
global set reset at that single point would let the AI spend the player's
allowance before the player's next turn began. The codebase already solves
this by splitting: `spentUnits` is React state for the player and
`ws.spentUnits` on `AiWorkingState` for the AI. The same split applies here.

- **Player:** `improvedCities: Set<string>` in `game.tsx`, holding the keys of
  cities that have paid for an improvement this turn. Cleared in
  `endTurnHandler` alongside `firedUnits`. Added to `MoveHistorySnapshot`
  (`types.ts:76`) and threaded through `useMoveHistory` so undo restores it —
  without this, undoing an improvement gives the terrain back but burns the
  city's build for the turn.
- **AI:** `cityImproveUsed: Set<string>` on `AiWorkingState`, created fresh per
  owner turn exactly as `ws.spentUnits` is, and copied-on-write in the same
  style (`aiStrategy.ts:1658`). Read by `dtFindImproveMove`, written by
  `dtExecImprove`. This also puts the first real ceiling on the decision
  loop's improve priority, which today can improve unboundedly many tiles in
  one turn across its 100 iterations.

Cities themselves need no new plumbing: the `cities: Set<string>` already
flows through `aiCtx`/`ws` and is the single runtime source of truth
(`aiStrategy.ts:1452,1591` add founded cities to it). The `HexTile.isCity`
flag is only the map generator's seed and is not read by any rule here.

### 3.3 Player path

**Commit (`logic/tileTapHandler.ts`).**

- Improvement branch (455-491): resolve the anchor with `findImproveAnchor`,
  re-check `canImproveTile` with it, and on success add the anchor to
  `improvedCities` in the same batched update that writes the terrain and
  charges the gold. `pushHistory()` already runs before the mutation, so undo
  is covered by 3.2.
- Placement branch (494-625): add a `canFoundCity` re-check for
  `armedEntityId === "city"` at the `if (!alreadyOccupied && selectedTerritoryId)`
  guard, failing to `triggerErrorFlash` like every other rejected placement.
  Note this branch enforces **no** city rule at all today — the old
  "one per territory, 5+ tiles" rule lived only in the ribbon, so the tap path
  is where the rule genuinely starts being enforced.
- The city branch inside the *attack* placement path (641) stays untouched:
  `getPlacementAttackTiles` returns early for non-units (`hexGrid.ts:461`), so
  a city can never be bought onto an enemy tile and that branch is unreachable.

**Selection (`hooks/useSelectionState.ts`).**

- `territoryHasCity` (246) becomes `territoryCityKeys: string[]` — the cities
  of the selected territory — since both new helpers need the keys, not a
  boolean.
- `validImprovementTiles` (254) and `improvementAvailability` (287) resolve an
  anchor per tile and pass it to `canImproveTile`. `improvementAvailability`
  keeps its "ignore gold" convention (`balance: imp.cost`) and gains a matching
  reason so the ribbon can tell "no city near" from "cities used".
- New `validCitySites: Set<string>`, memoized from `foundCitySites` for the
  selected territory. It is **not** gated on a city being armed: the ribbon
  needs it to decide whether to offer the City item at all (see the `Too close`
  state below), and only the highlight layer restricts its use to the armed
  case.

**Highlighting.** Arming City today lights the whole territory, because the
purchase dots come from `MovementHighlightLayer` sharing
`classifyOwnTilePlacement` — a predicate that takes only
`{armedEntityId, occupant, tileOwner, terrain}` and structurally cannot see
cities. Rather than widening it, `validCitySites` is passed to the layer as a
sibling filter applied only when `armedEntityId === "city"`.

**Ribbon (`components/PurchaseRibbon.tsx`).** The `cityAlreadyBuilt` /
`cityTooSmall` pair (88-90) and the `costLabel` / `costIsMoney` chain
(101-119) become three states:

| Condition | Label |
| --- | --- |
| `cityCapFor(tiles) === 0` | `<5 tiles` |
| cap reached | `MAX` |
| cap free but `validCitySites` empty | `Too close` |

The improvement items' single `"Needs city"` label (210-220) splits into
`No city near` (no city within 2 of any candidate tile) and `Cities used` (in
range, but every such city has built this turn).

### 3.4 AI

- `aiStrategy.ts:531` — replace `currTerr.length >= 5 && !alreadyHasCity` with
  the cap check, and filter the candidate scan at 552 through
  `foundCitySites`.
- `aiExpert.ts:1000-1004` — same rules, but this is *candidate generation*:
  an illegal city build left in the list gets scored and valued by the 2-ply
  search. `foundCitySites` is computed once per generation pass and the
  candidate loop tests membership, keeping cost proportional to owned
  territory rather than to territory x cities.
- `aiHelpers.ts:229-260` `dtFindImproveMove` — its own comment names it the
  single choke point for AI improvements, so the zone and allowance filters go
  here and both brains inherit them. The plan must confirm that
  `aiExpert.ts:1285` reaches improvements only through this function and does
  not generate its own improve candidates.
- `aiStrategy.ts:1633-1656` `dtExecImprove` — resolve the anchor before
  mutating the tile map and add it to `ws.cityImproveUsed` on success.

### 3.5 Documentation

`WelcomeModal.tsx:140-143` and `MainMenu.tsx:88` state the current rules
verbatim ("Once a territory has a City, a Peasant there can improve the tile it
stands on…") and go stale with this change. Both get the new wording: the
per-5-tiles cap, the 3-tile spacing, the 2-tile zone, and the one-per-city-per-
turn limit.

## 4. Testing

- **`gameLogic.test.ts`** — `canFoundCity`: cap boundaries (4/5/9/10 tiles),
  cities counted inside the territory, `hexDistance` 2 rejected and 3 accepted,
  own cities in another territory still blocking, enemy/neutral cities not
  blocking. `findImproveAnchor`: distance 2 in and 3 out, nearest-unused
  selection, deterministic tie-break, `inRange` true when every in-range city
  is used. `canImproveTile`: the existing suite re-pointed at `anchor`.
- **`tileTapHandler.test.ts`** — founding rejected below the cap and within 3
  tiles; improvement rejected outside every zone; a second improvement charged
  to the same city in one turn rejected while one charged to a different city
  in range succeeds; undo restores `improvedCities`.
- **`aiHelpers.test.ts`** — `dtFindImproveMove` returns nothing outside the
  zones and nothing when every in-range city is used.
- **`aiStrategy` / `aiExpert` suites** — no AI founds a city that violates
  either rule; the Expert candidate list contains no illegal city build.
- Existing suites that assume "one city per territory, 5+ tiles" need review:
  a 5–9 tile territory behaves identically, so most should pass untouched.

## 5. Non-goals and known effects

- **No rebalancing.** Improvement costs, `CITY_BONUS` and the field
  city-adjacency bonus are untouched by this spec.
- Two effects pull against each other and are worth measuring rather than
  guessing: multiple cities per territory now multiply `CITY_BONUS` and the
  field adjacency bonus upward, while dead zones and the per-turn cap pull the
  number of improvements down. A new-vs-old self-play A/B after merge is the
  way to read the net — Expert-vs-Hard is saturated and will not show it.
- **No zone visualisation.** Showing a city's 2-tile ring as a persistent
  overlay is deliberately out of scope; the armed-improvement highlight already
  reveals the legal tiles.
- **No demolition or relocation of cities.** Nothing in this change can remove
  a city.
