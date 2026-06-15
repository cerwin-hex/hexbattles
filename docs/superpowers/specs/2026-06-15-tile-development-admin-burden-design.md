# Tile Development & Administrative Burden — Design

**Date:** 2026-06-15
**Branch:** `tile-development-admin-burden`

## Goal

Add economic depth through two interlocking systems:

- **Tile development** — peasants can spend their turn upgrading owned tiles to
  raise income.
- **Administrative burden** — large territories incur a per-turn cost, pressuring
  the player to develop tiles rather than merely sprawl.

The two are designed to push against each other: sprawl makes you poorer unless
you invest in development.

## 1. New terrain types

Two new `TerrainType` values in `types.ts`, handled table-driven (no behaviour
should branch on the literal string except the two known call sites below):

| New type  | Upgraded from | Income      | Move cost          |
|-----------|---------------|-------------|--------------------|
| `field`   | `grass`       | 2 → **3**   | 1 (same as grass)  |
| `sawmill` | `forest`      | 2 → **3**   | 2 (unchanged)      |

- Added to `TERRAIN_INCOME` and `TERRAIN_MOVE_COST` in `hexGrid.ts`.
- `sawmill` keeps the forest move penalty (income-only upgrade — no terrain
  clearing).
- Lake → fishery is **out of scope** for this iteration.

String-literal terrain comparisons that must learn the new types:
- `hooks/useEconBreakdown.ts:56-58` — tile-type counting (count `field` with
  grass, `sawmill` with forest, or as their own line — see rendering).
- `logic/aiStrategy.ts:764` — neutral-capture priority (treat `field`/`sawmill`
  like `grass`/`forest`, value 2). Neutral tiles are never upgraded, so this is
  defensive.

## 2. Tile development action (new unit action)

A **genuinely new kind of unit action** — not entity placement like tower/castle.
A selected **peasant** standing on an eligible tile may develop it.

Eligibility (all required):
- The acting unit is a `peasant`.
- The peasant is not spent (has its action available this turn).
- The tile is owned by the peasant's owner.
- The tile terrain is `grass` (→ `field`) or `forest` (→ `sawmill`).
- The tile is not a city and not already an upgraded type.
- The territory's balance is ≥ 5.

Effect:
- Deduct **5g** from the territory's balance (same balance buildings are paid
  from).
- Set `tile.terrain` to the upgraded type. **Permanent — cannot be reverted.**
- The peasant **survives** but is marked **spent** for the turn.
- Only peasants can develop.

**UI trigger:** when a non-spent peasant is selected while standing on an eligible
owned tile and the territory can afford it, show a "Develop (5g)" action button.
Tapping it performs the upgrade. New branch in `logic/tileTapHandler.ts`.

## 3. Income centralization (prerequisite — Step 1)

Income is currently copy-pasted across ~10 sites: `endTurnHandler` (player and
AI loops), `aiHelpers`, `aiStrategy` (×3), `aiExpert` (×4), `aiSelfPlay`. All
three income-affecting changes below must land in **every** site or the AI
mis-evaluates its own economy and bankrupts itself (full AI integration was
chosen).

**Before adding any new source**, extract a single shared function:

```
calcTerritoryIncome(territory, cities, tileMap) -> number
```

and replace all call sites with it. Then add the new sources inside that one
function. This mirrors the codebase's existing "single source of truth"
discipline (see charge/merge helpers in `gameLogic.ts`).

`calcTerritoryIncome` sums, per territory:
- `TERRAIN_INCOME[tile.terrain]` for each non-rebel tile (now includes
  `field`/`sawmill` = 3).
- `CITY_BONUS` for each city tile in the territory.
- **City-adjacency development bonus:** for each city in the territory, +1g per
  neighbouring tile that is an upgraded type (`field`/`sawmill`) AND owned by the
  same owner (i.e. in the same territory). This **stacks** (a city ringed by 6
  upgraded tiles grants +6) and is **on top of** each upgraded tile's own +1
  income. The neighbour lookup is the reason this must be centralized — the
  inline AI reduces don't all have `tileMap`.

## 4. Administrative burden

Per territory (contiguous cluster):

```
burden = ceil( max(0, clusterSize - 20) / 2 )
```

where `clusterSize = territory.length` (the contiguous cluster, including
bridged/occupied lake tiles).

Worked examples: 20 → 0, 21 → 1, 26 → 3, 30 → 5, 40 → 10.

Integration:
- Folded into the **upkeep** side. Proposed location: inside
  `calcTerritoryUpkeep(territory, ents)` using `territory.length`, so every caller
  pays it automatically. **Implementation check:** confirm every `calcTerritoryUpkeep`
  caller passes a full contiguous territory; if any pass a partial set, use a
  separate `calcAdminBurden(length)` helper added at each upkeep summation site
  instead.
- Applied only inside the existing turn-gated blocks: player income/upkeep is
  suspended on `turn === 1`; AI on `turn <= 2`. Burden follows the same gating.
- **Burden deliberately feeds the bankruptcy/liquidation path**
  (`endTurnHandler.ts:130-165`): a >20 territory that cannot pay drains to 0 and
  begins liquidating units, then buildings. This is the intended pressure — an
  on-purpose death-spiral, not an accident.

## 5. AI (full integration)

- **Economy correctness** follows automatically once the AI uses the centralized
  income function and the burden-aware upkeep function everywhere.
- **Value functions subtract burden** (via the shared upkeep), so the AI does not
  overextend into territory it cannot afford. **Watch the recently-tuned merge
  logic:** merging two sub-20 clusters can produce a >20 cluster that suddenly
  owes burden the AI did not budget for — the merge evaluation must account for
  the post-merge burden delta.
- **Active development:** the AI uses peasants to build `field`/`sawmill`,
  prioritising tiles adjacent to its own cities (for the stacking bonus) and
  developing when a cluster approaches or exceeds 20 tiles to offset burden. New
  decision branch in `aiStrategy`/`aiExpert`.

## 6. Rendering

- New terrain fills (colours) for `field` and `sawmill` in `HexTileLayer` plus
  colour constants. Distinct icon imagery may follow later; the v1 minimum is
  visually distinct fills so the player can see which tiles are developed.

## 7. Testing

New tests:
- Development action in `tileTapHandler` (eligibility gates, 5g deduction,
  terrain mutation, peasant left spent-but-alive).
- Income: `field`/`sawmill` income, city-adjacency stacking bonus.
- Admin burden: threshold/rounding at 20/21/26/30, interaction with
  bankruptcy/liquidation.
- AI develops tiles (prioritises city-adjacent and burden-threatened clusters).

Existing tests to update (income numbers shift, not just additions):
- `endTurnHandler.test.ts` and `aiExpert.test.ts` assertions that hard-code
  income/balance figures.

## Decisions / defaults (confirmed)

1. Admin burden formula: `ceil((tiles - 20) / 2)`, only the tiles above 20.
2. Burden is scoped **per territory** (contiguous cluster), matching the
   per-territory gold model. Splitting into two sub-20 clusters to dodge burden
   is an accepted strategic trade-off.
3. Upgrades are **income-only**: no movement or passability changes.
4. City-adjacency bonus **stacks** and is **on top of** the tile's own income.
5. AI scope: **full** — correct economy plus active development.
6. Peasant survives and is spent for the turn after developing.
7. Burden counts the whole cluster (including bridged lakes).
8. City-adjacency bonus requires the neighbour to be the same owner.
9. Burden is suspended in the same early rounds as income (player turn 1, AI
   turn ≤ 2).
