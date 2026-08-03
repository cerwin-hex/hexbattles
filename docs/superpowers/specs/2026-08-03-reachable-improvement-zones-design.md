# Reachable Improvement Zones, and Cities Further Apart

Date: 2026-08-03
Branch: `main`
Status: approved
Amends: `2026-08-02-city-improvement-rules-design.md`

## 1. Goal

Two adjustments to the city rules laid down on 2026-08-02.

1. There are too many cities on a mature map. The founding spacing goes from 3
   to 4 tiles.
2. A city's improvement zone is pure line of sight today: a tile two hexes away
   is improvable even when a mountain ridge or an unbridged lake stands between
   it and the city. The zone becomes a *reachable* area — you can only build
   where the city could actually send people.

## 2. Player-facing rules

### 2.1 Founding a city

> A new city must be at least **4 tiles** away from every city you already own,
> anywhere on the map. Enemy and neutral cities do not block you.

`MIN_OWN_CITY_DISTANCE` 3 → 4. Everything else about founding is unchanged: the
one-city-per-5-tiles cap, the fact that the rule is checked only when founding
(a territory that shrinks, splits, or captures a city standing too close keeps
every city), and that the spacing counts the owner's cities globally.

Not changed: `MIN_CITY_DISTANCE = 5`, the spacing between the neutral cities a
generated map starts with. That count is already tunable from Settings.

### 2.2 The improvement zone

> You can improve a tile within 2 tiles of one of your Cities in that same
> territory, **counted along a route the city could actually reach**. Mountains
> block, and so does water you have not spanned with a Bridge of your own.

Decisions made explicit so they are not re-litigated:

- **Steps, not movement cost.** A forest costs 2 movement to enter but is one
  step away. Using movement cost would put a forest at range 2 permanently out
  of reach and make the far Sawmill unbuildable — a nerf nobody asked for. On
  open ground the new rule is exactly the old one.
- **On land, terrain only; ownership is irrelevant along the way.** The route
  may cross tiles you do not own, including tiles held by an enemy. There is
  ground there either way. Only the endpoint has to be yours — already enforced
  by the callers, which pass tiles of their own territory.
- **A lake must be your own crossing.** Water is passable only because someone
  built across it, so the zone crosses a lake only when that lake tile is yours
  *and* passable — your Bridge, or your unit holding one. This follows
  `isTerritoryTile`, not the movement rule, which lets a unit walk over anyone's
  bridge. Without the ownership test an enemy's bridge would extend your zone,
  and an enemy unit stepping onto the water would open it while it stood there.
- **A crossed lake is a corridor, never a target.** Lake is not a source terrain
  of any improvement, so it can never itself be built on.
- **The zone reacts to bridges immediately.** Building or losing a bridge
  changes what is reachable within the same turn.
- **Which city pays is unchanged**: the nearest covering city that has not
  built this turn, ties broken by the lower tile key. "Nearest" now means
  fewest steps along a legal route.

## 3. Implementation

### 3.1 Reach, computed per city rather than per tile

`findImproveAnchor` is called once per candidate tile — by the Build ribbon, by
the tap handler, and by the AI's improve helper. Running a search inside it
would make the cost O(territory x cities x zone), the same quadratic shape as
the regression fixed in `1c67762`.

Instead, a new helper in `logic/gameLogic.ts`:

```ts
export type ImproveReach = ReadonlyMap<string, ReadonlyMap<string, number>>;

export function cityImproveReach(o: {
  cityKeys: Iterable<string>;
  owner: TerritoryOwner;
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
}): ImproveReach;
```

It walks outward from each city breadth-first, at most `CITY_IMPROVE_RADIUS`
steps, refusing to enter a mountain or a lake that is not `owner`'s own
passable crossing, and returns
`tileKey -> (cityKey -> steps)`. Each city visits at most 19 tiles, so the whole
map's reach costs O(cities).

`findImproveAnchor` then takes `reach` where it took `territoryCityKeys`, and
reads the distances out of the map instead of calling `hexDistance`. Anchor
selection is byte-identical to today's.

### 3.2 Call sites

| Site | Change |
| --- | --- |
| `hooks/useSelectionState.ts` | one `useMemo` for the territory's reach, keyed on the city keys, `activeTileMap` and `entities`; both improvement memos consume it |
| `logic/tileTapHandler.ts` | builds reach for the selected territory before its re-check |
| `logic/aiHelpers.ts` (`dtFindImproveMove`) | builds reach once, before the territory loop |

`canImproveTile` is untouched: it already takes the resolved `anchor`.

### 3.3 Rules text

`components/WelcomeModal.tsx` and `components/MainMenu.tsx` both say "within 2
tiles of one of your Cities". Both gain the blocking clause, and the founding
distance in the Cities section goes 3 → 4.

## 4. Testing

- `cityImproveReach`: open ground reproduces `hexDistance <= 2`; a mountain wall
  cuts off the tiles behind it; an unbridged lake cuts off, and your own bridged
  one does not; an enemy's bridge and an enemy unit on the water both stay
  blocked, while your own unit on the water crosses; a forest at 2 steps stays
  in reach.
- `findImproveAnchor`: the existing seven cases, restated against a reach map,
  keep their results.
- `canFoundCity` / `foundCitySites`: distance-3 sites that used to be legal are
  now rejected; distance 4 is accepted.
- The AI improve helper respects a wall.

Full suite must pass. Any AI strength check uses `mirroredAb`.
