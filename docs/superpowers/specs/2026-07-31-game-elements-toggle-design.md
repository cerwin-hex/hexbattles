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
| `mounted` | `unitPurchasablesFor` drops scout/knight; `handleTileTapLogic` refuses to buy them; the AI's three creation points skip them (`AI_UNIT_BUY_ORDER_ASC`/`_DESC` and the rebel-clearing `buyPreference` in `aiStrategy.ts`, `UNIT_TYPES` in `aiExpert.ts`). Because no cavalry can then exist, `STRENGTH_TO_CAVALRY` merges and `UNIT_UPGRADE.scout` are unreachable — that code is left untouched. |
| `ranged` (beta, merged with the ranged-units branch) | `unitPurchasablesFor` drops the bowmen; `handleTileTapLogic` refuses to buy them. No AI creation point can offer them at any setting: `aiBuyableUnits` (`constants/gameConstants.ts`) composes this element gate with the ranged exclusion, and the rebel-clearing `buyPreference` only ever considers scout/peasant. Because no bowman can then exist, the ranged merge track and `logic/rangedAttack.ts` are unreachable — that code is left untouched. |
| `improvements` | `improvementPurchasablesFor` returns `[]`; `handleTileTapLogic` refuses the improve action; `dtFindImproveMove` (`logic/aiHelpers.ts:234`) returns `null`, which is the single choke point both AI brains use — the decision tree's priority J and the expert search's last resort. `TERRAIN_INCOME` for field/sawmill/mine is left untouched — those terrains simply never come into existence. |
| `adminBurden` | `calcTerritoryUpkeep` (`logic/gameLogic.ts:45`) adds 0 instead of `calcAdminBurden(territory.length)`, which covers every economy path. The two display hooks that compute their own numbers — `useEconBreakdown.ts:165` and `useDevEconomicOverlays.ts:65` — take the element set too, so the panel matches the charge. `calcAdminBurden` itself is unchanged. |
| `rebels` | `spawnRebelsForOwner` still sweeps and clears armed graves/ruins but places no rebel. Skull and ruin markers still render — they mark where units fell — they just never breed. The new-game seeding pass in `app/game.tsx` — which scatters the opening board's starting rebels, independently of `spawnRebelsForOwner` — is gated the same way, so Rebels off also means no rebels at kickoff. |

`spawnRebelsForOwner` gains a trailing `spawnEnabled: boolean` parameter rather
than being skipped at its two call sites, so the site-consumption bookkeeping
keeps running and markers do not accumulate forever.

### 3.5 Threading

The element set is plumbed through exactly four seams:

1. `TileTapParams` (`logic/tileTapHandler.ts:42`) — new `elements: GameElements` field.
2. `AiWorkingState` (`logic/aiStrategy.ts:949`) — new **optional** `elements?: GameElements`.
   Absent means `ALL_GAME_ELEMENTS`: self-play and the existing AI tests exercise
   the full rule set, so they need no edits. `game.tsx` always sets it.
3. `AiContext` (`logic/aiHelpers.ts:19`) — new `elements: GameElements` field,
   populated at its single construction site (`aiStrategy.ts:1201`) from `ws`.
   This is what the decision tree and the expert search read.
4. `app/game.tsx` — parses the element set once, passes it as a prop to
   `PurchaseRibbon` and the two economy display hooks, and into
   `handleTileTapLogic` and the `AiWorkingState` it builds.

`EndTurnParams` deliberately gets **no** field: `handleEndTurnLogic` neither
charges economy nor spawns rebels — both happen inside `runAiTurn` via
`applyOwnerEconomy` and `spawnRebelsForOwner` — so it has nothing to gate.

Two shared functions take the element set as an **optional trailing argument**
that defaults to `ALL_GAME_ELEMENTS`, so the ~20 existing test call sites keep
working unchanged:

- `calcTerritoryUpkeep(territory, ents, elements?)` — gates the admin burden.
- `applyOwnerEconomy({ …, elements? })` — forwards it to `calcTerritoryUpkeep`.

`spawnRebelsForOwner` instead gets a required trailing `spawnEnabled` argument
after its existing `rng` parameter, defaulting to `true`.

`enabledUnitTypes` is memoized on the element object's identity with a `WeakMap`,
because the expert search calls it once per candidate-generation pass. `game.tsx`
builds the element object once per game, so the map holds a single entry. The
decision tree's sorted buy orders are hoisted to a single computation at the top
of `runAiTerritoryDecisionLoop` instead — once per territory, not per iteration.

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

**Saved games** (`utils/savedGame.ts`) — the save exists for one purpose: getting
back into a game you left by accident. It is deliberately treated lightly here.
`SavedGameConfig` gains an **optional** `elements?: GameElements`; `Serialized.state`
is untouched and `v` stays `1`, following the `armedGraveyard?` / `armedRuins?`
precedent already in the file. Storing the field is the cheapest way to keep
resume honest — without it, a game begun without rebels would sprout rebels the
moment the menu setting changed. A save written before this feature has no field
and loads as `DEFAULT_GAME_ELEMENTS`. No migration, no version bump, no further
ceremony.

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

Extend `utils/savedGame.test.ts` — one case only, guarding the crash path:

- A serialized save without `elements` loads as `DEFAULT_GAME_ELEMENTS`.

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

1. A **Game Elements** section with an "N of M" counter lists four toggle rows,
   and the start button stays reachable on a phone-sized screen. (Superseded by
   section 7: the section lives in Settings, expanded, and the menu scrolls.)
2. Element choices survive an app restart.
3. Starting a game with an element off means that element is absent for the
   player *and* the AI for the whole game.
4. Resuming works: a game resumes with the element set it was started with, and
   a save created before this feature resumes with all four elements on.
5. Beta elements are listed like any other, carry a BETA label, and start off.
   (Superseded by section 7: the original design hid them behind a setting.)
6. `pnpm run typecheck` and `pnpm test` pass from the repository root.
7. The AI peak-turn timing guard does not regress.

## 6. Plain-language summary

Settings gets a list where you switch parts of the game on and off before you
start a game: mounted units, improvements, the administrative burden on big
realms, and rebels. Your choices are remembered for next time, and each game
keeps the choices it was started with — a game begun without rebels stays
without rebels even if you change the menu later. Unfinished features (ranged
units, fog of war) sit in the same list with a BETA label and start switched
off, and they can join it with two lines of code once they are ready.
The AI obeys exactly the same choices you do. The rules text still describes the
whole game.

## 7. Change after implementation (2026-08-01)

On-device testing showed the main menu had no scrolling body of its own, so on a
short screen the start buttons fell off the bottom and could not be reached. Two
changes followed:

- The Game Elements list moved out of the main menu and into the Settings modal.
  With a scrolling modal to live in it no longer collapses: the rows are always
  visible and the header keeps its "N of M" summary. Sections 1-4 are unaffected
  — only the section's host changed; acceptance criterion 1 is restated above.
- The menu body between the pinned title and the pinned start stack is now a
  ScrollView, so it can never overflow again regardless of what it contains.
- The gear icon in the menu's top corner became a full-width **Settings** button
  below AI Difficulty, now that Settings holds a choice made per new game rather
  than only cosmetic preferences.
- `Slider` gained a `compact` variant — shorter track, smaller readout, no end
  labels. The four terrain sliders share one bordered block under a single
  "Terrain" heading, roughly halving that section's height.

At the same time, map size, opponent count and difficulty moved from local
component state into the persisted settings, so they are remembered between
games and across launches like the terrain sliders. `updateSettings` now takes a
patch rather than a whole settings object, so a control firing before hydration
completes cannot write pre-hydration defaults back over stored settings.

One bug fell out of that persistence: `Slider` passed `[min, max]` as the
dependency list of its `useAnimatedReaction`, which suppresses Reanimated's
automatic closure capture, so the prepare worklet kept comparing against the
`value` present at mount. Sliders seeded before they render were unaffected;
Map Size, which receives its stored value when hydration lands, showed the right
number above a thumb parked at the default. `value` is now a dependency, and the
reaction skips while a finger is down so the re-registration it triggers on each
emitted step cannot fight the drag.

The **Show beta elements** setting is gone. Hiding beta elements made sense while
the list was the first thing on the main menu; once it moved behind a Settings
button, a setting that governs what another setting on the same screen shows was
only indirection. Beta elements are now listed like any other, carry the BETA
label they always had, and start switched off — which `DEFAULT_GAME_ELEMENTS`
already did, so the guarantee that nobody meets an unfinished feature without
choosing it is unchanged. `showBetaElements`, `visibleGameElements` and
`elementsForNewGame` are deleted; `enabledVisibleCount` becomes
`enabledElementCount`, counting against the whole registry.
