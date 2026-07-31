# Game Elements Toggle — Design

Date: 2026-07-31
Branch: `feat/game-elements-toggle` (to be created from `main`)
Status: approved for planning

## 1. Goal

Let the player choose which parts of the game to play with, before a new game
starts. The main menu gains a collapsible **Game Elements** list where each
element can be switched on or off. Unfinished elements (Ranged units, Fog of
War) are hidden behind a **Show beta elements** setting so they never appear by
accident.

The framework ships on `main` with the elements that exist on `main`. The two
unmerged branches each add their own registry entry when they merge — two lines
of code, no dead buttons in the meantime.

## 2. Scope

**Toggleable on `main`:**

| Element | Id | Beta |
|---|---|---|
| Mounted units | `mounted` | no |
| Improvements | `improvements` | no |
| Administrative burden | `adminBurden` | no |
| Rebels | `rebels` | no |

**Added later by their own branch:** Ranged units (`ranged`, beta), Fog of War
(`fogOfWar`, beta).

**Deliberately not toggleable:** melee/basic units (peasant → warrior →
swordsman) are the only units that can take ground, so the game has no capture
path without them; cities and city founding; unit merging and upgrading; the
single-hex split penalty; bridges; fortifications (tower/castle). Bridges and
fortifications were considered and dropped — they can be added to the registry
later without redesign.

**Not in scope:** changing the "How to Play" and Welcome modals. They keep
describing the full game regardless of which elements are active. `INFO_TABLE_ROWS`
and `ENTITY_UPKEEP_ORDER` therefore stay unfiltered.

## 3. Architecture

### 3.1 The registry — `constants/gameElements.ts`

One new file owns everything about elements:

```ts
export type GameElementId = "mounted" | "improvements" | "adminBurden" | "rebels";

export interface GameElementDef {
  id: GameElementId;
  /** Menu row title, e.g. "Mounted Units". */
  name: string;
  /** One-line explanation shown under the title. */
  blurb: string;
  /** Beta elements are hidden unless the player opts into seeing them. */
  beta: boolean;
}

export const GAME_ELEMENTS: readonly GameElementDef[];

export type GameElements = Record<GameElementId, boolean>;

/** Every non-beta element on, every beta element off. */
export const DEFAULT_GAME_ELEMENTS: GameElements;

/** Every element on — the full rule set. Used by self-play and tests. */
export const ALL_GAME_ELEMENTS: GameElements;

/** Fills missing keys from DEFAULT_GAME_ELEMENTS, drops unknown keys, coerces
 *  non-booleans. Never throws. */
export function normalizeGameElements(raw: unknown): GameElements;

/** Comma-joined ids of the enabled elements, e.g. "mounted,rebels". */
export function encodeGameElements(e: GameElements): string;
export function decodeGameElements(s: string | undefined): GameElements;
```

Merging the ranged branch means adding `| "ranged"` to the union and one entry
to `GAME_ELEMENTS`. Nothing else.

### 3.2 Why an explicit value, not a module global

The alternative — a module-level "active rule set" set once at game start —
gives a smaller diff but is a correctness hazard here:

- `logic/aiSelfPlay.ts` (`playMatch`, `playFreeForAll`) runs many complete games
  in a single process. A global rule set would leak between them.
- `logic/aiExpert.ts` already carries ~7 `__setExpertXxx` module globals. Those
  are test knobs; game rules must not join them.
- `constants/gameConstants.ts` computes `PURCHASABLES`, `UNIT_PURCHASABLES`,
  `BUILDING_PURCHASABLES` and `IMPROVEMENT_PURCHASABLES` at import time. These
  have to become functions of the element set either way, which is most of the
  work — after that, passing the value explicitly costs almost nothing.

### 3.3 Derived purchasable lists — `constants/gameConstants.ts`

The four import-time constants become functions:

```ts
// The element type is the existing shape of PURCHASABLES' entries
// ({ id, ...ENTITY_META[id] }); it gets a name, `Purchasable`, when extracted.
export function purchasablesFor(elements: GameElements): Purchasable[];
export function unitPurchasablesFor(elements: GameElements): Purchasable[];
export function buildingPurchasablesFor(elements: GameElements): Purchasable[];
export function improvementPurchasablesFor(elements: GameElements): readonly ImprovementMeta[];
```

`PURCHASABLES` stays as the unfiltered base list, since `INFO_TABLE_ROWS` and
`ENTITY_UPKEEP_ORDER` derive from it and must not change (§2). The existing
`UNIT_PURCHASABLES` / `BUILDING_PURCHASABLES` / `IMPROVEMENT_PURCHASABLES`
constants are removed; every call site takes the function form.

The element → entity mapping lives in `gameElements.ts` as a single table, so
"which units belong to Mounted" is stated once:

```ts
/** Entities gated by an element. Entities absent from this map are always available. */
const ENTITY_ELEMENT: Partial<Record<EntityType, GameElementId>> = {
  scout: "mounted",
  knight: "mounted",
};
export function isEntityEnabled(id: EntityType, elements: GameElements): boolean;
```

### 3.4 Where each element bites

| Element | Off means |
|---|---|
| `mounted` | `unitPurchasablesFor` drops scout/knight; `handleTileTapLogic` refuses to buy or upgrade to them; AI candidate generation skips them. No cavalry can exist, so `STRENGTH_TO_CAVALRY` merges are unreachable — that code is left untouched. |
| `improvements` | `improvementPurchasablesFor` returns `[]`; `handleTileTapLogic` refuses the improve action; the AI generates no improve candidates. `TERRAIN_INCOME` for field/sawmill/mine is left untouched — those terrains simply never come into existence. |
| `adminBurden` | `calcTerritoryUpkeep` (`logic/gameLogic.ts:45`) and the display path `useEconBreakdown.ts:165` add 0 instead of `calcAdminBurden(territory.length)`. `calcAdminBurden` itself is unchanged. |
| `rebels` | `spawnRebelsForOwner` still sweeps and clears armed graves/ruins but places no rebel. Skull and ruin markers still render — they mark where units fell — they just never breed. |

`spawnRebelsForOwner` gains a trailing `spawnEnabled: boolean` parameter rather
than being skipped at its two call sites, so the site-consumption bookkeeping
keeps running and markers do not accumulate forever.

### 3.5 Threading

The element set is plumbed through exactly five seams:

1. `TileTapParams` (`logic/tileTapHandler.ts:42`) — new `elements: GameElements` field.
2. `EndTurnParams` (`logic/endTurnHandler.ts:12`) — same.
3. `AiWorkingState` (`logic/aiStrategy.ts:949`) — new **optional** `elements?: GameElements`.
   Absent means `ALL_GAME_ELEMENTS`: self-play and the existing AI tests exercise
   the full rule set, so they need no edits. `game.tsx` always sets it.
4. `AiContext` (`logic/aiHelpers.ts:19`) — new `elements: GameElements` field,
   populated at its single construction site (`aiStrategy.ts:1201`) from `ws`.
   This is what the decision tree and the expert search read.
5. `app/game.tsx` — parses the element set once and passes it as a prop to
   `PurchaseRibbon` and into the three logic entry points.

**Performance:** the expert search resolves its allowed-entity list **once per AI
turn**, at `AiContext` construction, never per candidate inside
`generateCandidateActions`. There is an open 900 ms peak-turn guard failing on
the improvements branch; this feature must not add per-candidate work.

### 3.6 Persistence and transport

**App settings** (`utils/settings.ts`) — `GameSettings` gains:

- `elements: GameElements` — the player's menu choices, remembered between app
  launches, defaulting to `DEFAULT_GAME_ELEMENTS`.
- `showBetaElements: boolean` — default `false`.

`normalizeSettings` fills both from defaults, so stored settings written before
this feature load cleanly. `elements` runs through `normalizeGameElements`.

**Route params** — `MainMenu.startNewGame` adds one param,
`elements: encodeGameElements(...)`, alongside the existing terrain params.
`game.tsx` decodes it next to `clampPctParam` (around `app/game.tsx:180`).

**Saved games** (`utils/savedGame.ts`) — `SavedGameConfig` gains an **optional**
`elements?: GameElements`, and `Serialized.state` is untouched; `v` stays `1`.
This follows the `armedGraveyard?` / `armedRuins?` precedent already in the file.
A save written before this feature has no field and loads as
`DEFAULT_GAME_ELEMENTS` — every shipped element on, beta off.

### 3.7 UI

**`components/GameElementsSection.tsx`** (new) — the collapsible section.
`MainMenu.tsx` is already 774 lines; the list, its rows and its styles live in
their own file and the menu renders one component.

```
GAME ELEMENTS        4 of 4  ▾     ← collapsed by default, tap to expand
──────────────────────────────
  Mounted units            [ ●]
  Scouts and knights
  Improvements             [ ●]
  Fields, sawmills, mines
  Admin. burden            [ ●]
  Big realms pay extra
  Rebels                   [ ●]
  Uprisings on the map
──────────────────────────────
        COMMENCE BATTLE ▶
```

The header counter reads "N of M" over the *visible* elements, so it becomes
"4 of 6" once beta rows are shown. Beta rows carry a small `BETA` chip.

**`components/Toggle.tsx`** (new) — a small on/off switch in the menu's gold-on-
brown style. The app has no switch component today; `SettingsModal` only uses
`Slider`. Both the element rows and the beta setting use it.

**`components/SettingsModal.tsx`** — gains a "Show beta elements" row with a
one-line explanation ("Unfinished features under active development").

**`components/PurchaseRibbon.tsx`** — takes the element set as a prop and maps
over `unitPurchasablesFor` / `buildingPurchasablesFor` /
`improvementPurchasablesFor` instead of the removed constants.

### 3.8 Behaviour rules and edge cases

1. **Hidden beta is forced off.** When `showBetaElements` is false, beta
   elements are excluded from the list *and* forced off in the element set sent
   to a new game — even if a stored `true` says otherwise. The stored value is
   kept, so the choice returns when beta is switched back on.
2. **A saved game keeps its own set.** Resuming uses the set stored with the
   save and ignores the current settings entirely, including the beta setting.
   A game started with Rebels off stays without rebels forever.
3. **Unknown data is dropped silently.** Unrecognised ids in a route param, in
   stored settings, or in a saved game are discarded by `normalizeGameElements`;
   missing ids fall back to the default. No error is surfaced — a corrupt
   element list must never block starting or resuming a game.
4. **Turning an element off mid-game is impossible by construction.** The list
   is only reachable from the main menu, before a game exists.

## 4. Testing

New `constants/gameElements.test.ts`:

- `normalizeGameElements` on `null`, `{}`, garbage keys, non-boolean values,
  and a partial set.
- `encodeGameElements` / `decodeGameElements` round-trip, including the
  all-off and all-on sets.
- `DEFAULT_GAME_ELEMENTS` has every non-beta element on and every beta element
  off, and `GAME_ELEMENTS` has no duplicate ids.

New `constants/gameConstants.test.ts` (the directory has `colors.test.ts` but no
suite for `gameConstants.ts` yet):

- `unitPurchasablesFor` excludes scout/knight when `mounted` is off and includes
  them when on; melee units are present in both cases.
- `improvementPurchasablesFor` returns `[]` when `improvements` is off.

Extend `utils/savedGame.test.ts`:

- A serialized save without `elements` loads as `DEFAULT_GAME_ELEMENTS`.
- A save with an element set round-trips.

New `utils/settings.test.ts` (`utils/settings.ts` has no suite today):

- `normalizeSettings` fills `elements` and `showBetaElements` from defaults when
  absent, and repairs a corrupt `elements`.

Extend the logic suites:

- `logic/rebelSpawn.test.ts` — with `rebels` off, a turn with armed graves
  spawns nothing and the armed sites are still cleared.
- `logic/gameLogic.test.ts` — a 30-tile territory pays no administrative burden
  when `adminBurden` is off, and the documented burden when on.
- `logic/tileTapHandler.test.ts` — buying a scout with `mounted` off is refused;
  the improve action with `improvements` off is refused.
- `logic/aiStrategy.test.ts` — an AI with `mounted` off never buys scout or
  knight over a full turn.

## 5. Acceptance criteria

1. The main menu shows a collapsed **Game Elements** row with an "N of M"
   counter; tapping it expands four toggle rows and leaves the start button
   reachable without scrolling on a phone-sized screen.
2. Element choices survive an app restart.
3. Starting a game with an element off means that element is absent for the
   player *and* the AI for the whole game.
4. Resuming a game uses the element set it was started with.
5. A saved game created before this feature resumes with all four elements on.
6. Beta elements are invisible until **Show beta elements** is switched on in
   Settings, and are off in a new game while invisible.
7. `pnpm run typecheck` and `pnpm test` pass from the repository root.
8. The AI peak-turn timing guard does not regress.

## 6. Plain-language summary

The main menu gets a fold-out list where you switch parts of the game on and off
before you start: mounted units, improvements, the administrative burden on big
realms, and rebels. Your choices are remembered for next time, and each game
keeps the choices it was started with — a game begun without rebels stays
without rebels even if you change the menu later. Unfinished features (ranged
units, fog of war) stay hidden until you switch on "show beta elements" in
Settings, and they can join the list with two lines of code once they are ready.
The AI obeys exactly the same choices you do. The rules text still describes the
whole game.
