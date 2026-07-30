# Improvements built from the Build menu

Date: 2026-07-30
Status: approved

## Problem

Today an improvement (Field, Sawmill, Mine) can only be created by a peasant
standing on the matching terrain, via an "Improve" button in the entity panel.
That couples an economic decision to unit positioning: to farm a grass tile you
must first walk a peasant onto it and spend its turn there.

The peasant requirement is removed. Improvements become ordinary purchases in
the Build ribbon, available to the player and the AI on any legal tile in the
territory, limited only by gold.

## Rules

An improvement may be built when **all** of the following hold:

- The tile belongs to the acting owner's selected territory.
- The tile's terrain is the improvement's source terrain:
  grass → **Field** (2), forest → **Sawmill** (3), desert → **Mine** (4).
  Lake, mountain and already-improved terrain therefore exclude themselves.
- The territory contains a **city**. Unchanged from today — only the peasant
  requirement is being removed.
- It is **round 2 or later**. Improvements inherit the existing
  `round1Locked = turn === 1 && !isTower` rule that every other buildable
  follows.
- The territory balance covers the cost.
- The tile carries **no city and no building** (tower, castle, bridge).

Additional rules:

- A **friendly unit on the tile does not block**. Units occupy terrain, they do
  not consume it. Building under a unit does **not** spend that unit — it keeps
  its movement and attacks.
- **No per-turn cap.** Gold is the only limiter, for player and AI alike.
- Nothing becomes spent, for anyone. An improvement is a purchase, not an
  action.
- A **graveyard or ruin marker does not block** an improvement. The existing
  `blockedByGraveyard` rule is scoped to buildings (`!meta.isUnit`) and stays
  that way; terrain work is not a foundation.
- Founding a city, tower or castle on an improved tile still destroys the
  improvement and reverts the terrain to its base
  (`tileTapHandler.ts` `destroysImprovement`). Unchanged.
- Undo restores terrain and gold — the improvement branch calls `pushHistory()`
  before mutating, like every other purchase.

Income effect (unchanged, stated here for the ribbon labels):
Field +1/turn (plus +1 per adjacent owned city), Sawmill +1/turn, Mine +2/turn.

## Design

### Catalogue, not entities

`IMPROVE_COST_BY_TARGET` in `hexGrid.ts` is private today. It is replaced by an
exported catalogue keyed by target terrain:

```ts
export interface ImprovementMeta {
  source: TerrainType;   // grass | forest | desert
  target: TerrainType;   // field | sawmill | mine
  name: string;          // "Field" | "Sawmill" | "Mine"
  cost: number;          // 2 | 3 | 4
  incomeDelta: number;   // +1 | +1 | +2  (base terrain delta, excludes city bonus)
}
export const IMPROVEMENTS: readonly ImprovementMeta[];
```

`improveTargetFor`, `improveCostFor`, `baseTerrainFor`, `IMPROVED_TERRAINS` and
`IMPROVEMENT_BASE` are all derived from or kept consistent with this one table,
so source/target/cost can never drift apart. Their signatures are unchanged;
existing callers keep working.

`gameConstants.ts` exposes `IMPROVEMENT_PURCHASABLES` derived from
`IMPROVEMENTS`, in catalogue order (Field, Sawmill, Mine).

Improvements are deliberately **not** added to `ENTITY_META`. That record feeds
`PURCHASABLES` → `UNIT_PURCHASABLES` / `BUILDING_PURCHASABLES` /
`INFO_TABLE_ROWS` / `ENTITY_UPKEEP_ORDER`, and every `ENTITY_META[armedEntityId]`
dereference in `tileTapHandler.ts` (lines 385, 433, 444, 445) and
`useSelectionState.ts` (149) would receive `undefined` for an improvement.

### Armed state

`armedEntityId: EntityType | null` cannot carry a terrain, and it is read in 66
places. Rather than widening the type, `game.tsx` gains a second piece of state:

```ts
const [armedImprovement, setArmedImprovement] = useState<TerrainType | null>(null);
```

The invariant "at most one thing is armed" is enforced in exactly one place —
two wrapper setters defined in `game.tsx` and passed down in place of the raw
setters:

- `armEntity(id: EntityType | null)` → sets `armedEntityId`, clears `armedImprovement`
- `armImprovement(terrain: TerrainType | null)` → sets `armedImprovement`, clears `armedEntityId`

Every existing child call site (`setArmedEntityId(null)` in `BottomActionMenu`,
`PurchaseRibbon`, `tileTapHandler`) keeps its current shape and now clears both
through `armEntity`. No read site of `armedEntityId` changes meaning: when an
improvement is armed, `armedEntityId` is `null`, so entity-placement code paths
stay inert without modification.

### Shared predicate

`canImproveTile` in `gameLogic.ts` is rewritten as the single rule consumed by
the ribbon, the tap handler and the AI:

```ts
export function canImproveTile(o: {
  terrain: TerrainType;
  targetTerrain: TerrainType;
  balance: number;
  territoryHasCity: boolean;
  isCity: boolean;
  occupantEntity: EntityType | undefined;  // undefined = empty tile
  turn: number;
}): boolean
```

It checks: source terrain matches `targetTerrain`, not a city, occupant (if any)
is a unit rather than a building, territory has a city, `turn > 1`, and
`balance >= improveCostFor(targetTerrain)`. Three callers, one rule — this is
what prevents the ribbon showing an item as affordable while the tap handler
silently refuses it.

The `entityId`/`isSpent` parameters are removed.

### Placement path

`tileTapHandler.ts` gains a branch placed **above** the armed-entity-placement
branch (line 383), structured like the bridge branch (line 343):

1. Guard on `armedImprovement && validImprovementTiles.has(key)`.
2. Re-check `canImproveTile` (defence in depth against a stale highlight set);
   `triggerErrorFlash(key)` and return if it fails.
3. `pushHistory()`.
4. New tile map with the target terrain; balance debited on
   `selectedTerritoryId`.
5. `unstable_batchedUpdates`: `setMutableTileMap`, `setTerritoryBalances`,
   `armImprovement(null)`, `closeRibbon()`.

No `recalculateTerritories` call — a terrain change alters neither ownership nor
passability, so territory membership and balances-by-territory are untouched.
`spentUnits` is never modified.

The handler signature gains `armedImprovement` and `validImprovementTiles`.

### Selection state

`useSelectionState` gains, mirroring `validBridgePlacementTiles` /
`hasBridgePlacementAvailable`:

- `validImprovementTiles: Set<string>` — empty unless an improvement is armed;
  otherwise every tile of `selectedTerritory` that passes `canImproveTile`.
- `improvementAvailability: Map<TerrainType, boolean>` — one entry per
  improvement, true when the territory holds at least one tile of that
  improvement's source terrain that is not a city and not occupied by a
  building. Computed independently of what is armed, because the ribbon needs it
  for all three items at once. Affordability is *not* folded in — an unaffordable
  item dims with its price shown, which is the existing convention.

`validImprovementTiles` is passed to `MovementHighlightLayer` alongside
`validBridgePlacementTiles`, so arming Field highlights only grass tiles rather
than the whole territory, and to `handleTileTap`.

### Ribbon

`PurchaseRibbon` renders `BUILDING_PURCHASABLES` followed by a thin vertical
divider and then `IMPROVEMENT_PURCHASABLES`, in the same `ScrollView`. The
Build ribbon becomes: Tower, Castle, Bridge, City │ Field, Sawmill, Mine.

Improvement cards reuse `styles.ribbonItem` / `ribbonItemArmed` /
`ribbonItemDisabled` unchanged. Differences from a building card:

- **Icon**: improvements have no `UnitIcon`. A small hexagon filled with
  `TERRAIN_FILLS[target]` and the same `#0D0A06` stroke that
  `ImprovementMarkerLayer` uses on the board, so the card matches the tile the
  player is about to create. Rendered by a new tiny component
  `components/ImprovementIcon.tsx` (react-native-svg `Polygon`, reusing
  `hexCornersString`) to keep `PurchaseRibbon` readable.
- **Cost**: `CoinValue` with the numeric cost, exactly like buildings.
- **Effect line**: `CoinValue` with `+{incomeDelta}` and suffix `/turn`, in the
  slot where buildings show upkeep, using the existing green `#70C870` income
  colour.
- **Status label**, in priority order, reusing the existing plain-text vocabulary:
  `"Round 2+"` (turn 1) → `"Needs city"` (no city in territory) →
  `"No grass"` / `"No forest"` / `"No desert"` (no source tile available).
  When a status label is shown the cost is not a money value, so it renders as
  plain text without a coin — same `costIsMoney` treatment buildings already use.

`territoryHasCity` is already a `PurchaseRibbon` prop. New props:
`armedImprovement`, `armImprovement`, `improvementAvailability`.

The `canBuild` gate on the Build button (`selectedTerritory.length > 0`) is
unchanged and already correct for improvements.

### Removals

- `EntityPanel.tsx`: the improve button block (174–193), the derivations (78–93),
  the `improveCostFor` / `improveTargetFor` / `canImproveTile` imports, the
  `onImprove` prop (31, 49) and `territoryHasCity` (65, only used by
  `improveEnabled`). `entityTerritory` stays — `entityTerritoryId` needs it.
- `game.tsx`: `handleImproveTile` (1060–1103) and the `onImprove` prop at 1621.
  The `improveCostFor` import at 64 goes if nothing else uses it.

## AI

`dtFindImproveMove` in `aiHelpers.ts` loses the two filters that referenced
peasants:

```ts
if (ctx.entities.get(t.key) !== "peasant") continue;   // removed
if (spentUnits.has(t.key)) continue;                   // removed
```

and gains the new occupancy rule (skip tiles holding a building) via the shared
`canImproveTile`. It keeps the city requirement, the affordability check, and
the priority-2 preference for tiles adjacent to one of the AI's own cities
(where the field bonus stacks). The `spentUnits` parameter is dropped from the
signature; call sites in `aiStrategy.ts:938` and `aiExpert.ts:1272` are updated.

**Termination.** The last-resort improve branch (`aiStrategy.ts` priority J,
`aiExpert.ts:1264`) fires once per decision-loop iteration while gold lasts.
It cannot loop forever: `dtExecImprove` rewrites `ws.tileMap` live and clears
the cache, so an improved tile immediately stops matching `improveTargetFor`
and the candidate set shrinks monotonically. The 100-iteration loop cap remains
as a backstop. No artificial per-turn cap is added — the AI plays by the same
gold-only rule as the player.

**Bug fixed in the same change.** `dtExecImprove` (`aiStrategy.ts:1613`) calls
`ws.spentUnits.add(target)`. That line exists only because the old rule spent
the improving peasant. Under the new rules an improvement may be built under a
friendly unit, and the line would freeze that unit for the rest of the turn. It
is removed. (The comments at `aiExpert.ts:1270-1271` and `aiStrategy.ts:936`
that explain the `spentUnits` re-pick guard are rewritten to describe the
terrain-based guard instead.)

**Validation.** Per `project_expert_ai_behaviour_tweaks`, AI behaviour changes
are validated with the **new-vs-old A/B self-play** harness, not against Hard
(saturated). If the gold-only rule regresses Expert's strength, the follow-up
is an AI-side gold reserve (improve only above the cheapest useful unit cost) —
a heuristic, not a game rule. That follow-up is out of scope for this change and
is only taken if the A/B shows a regression.

## Tests

Rewritten, not deleted — coverage is preserved and re-aimed:

- **`gameLogic.test.ts`** — `canImproveTile` cases move from peasant/spent
  assertions to terrain-match, city-requirement, round-1, affordability, and
  occupancy (allowed under a unit, blocked on city/tower/castle/bridge).
- **`aiHelpers.test.ts`** — `dtFindImproveMove` cases drop the peasant fixtures;
  add: picks an empty grass tile, picks a tile under a friendly unit, skips a
  tile under a tower, still prefers a city-adjacent tile, still returns null
  without a city.
- **`hexGrid.test.ts`** — the `IMPROVEMENTS` catalogue is internally consistent
  with `improveTargetFor` / `improveCostFor` / `baseTerrainFor` /
  `IMPROVED_TERRAINS` (round-trip source↔target for all three).

New:

- **`tileTapHandler.test.ts`** — the improvement placement branch: successful
  build debits gold and changes terrain; leaves `spentUnits` untouched with a
  unit on the tile; rejects an unaffordable build; rejects a tile outside the
  territory; rejects a city tile; does not touch `entities`.

Adjusted fixtures:

- **`aiStrategy.test.ts`**, **`aiExpert.test.ts`**, **`aiExpertPocket.test.ts`**
  — any scenario that placed a peasant purely to enable an improvement, and any
  assertion that an improved tile's key lands in `spentUnits`.

## Out of scope

- Removing improvements / reverting terrain on demand.
- Changing improvement costs or income values.
- An AI gold reserve (see Validation above — only if the A/B regresses).
- Any change to how founding a building destroys an improvement.
