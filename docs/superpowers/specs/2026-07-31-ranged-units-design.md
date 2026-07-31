# Ranged Units — Design

Date: 2026-07-31
Branch: `feat/ranged-units`
Status: approved for planning

## 1. Goal

Add a third unit track to Hex Battles: **ranged units** (Shortbowman →
Longbowman → Crossbowman). They cannot capture anything. Instead they shoot at
adjacent enemy units, killing them outright without taking ground.

Supporting this requires splitting the game's single `strength` value into an
**offensive** and a **defensive** strength for every entity. For all existing
entities the two values are equal to today's `strength`, so nothing that exists
today changes behaviour.

**Scope for v1: player-only.** The AI never buys ranged units. It must handle
the player's ranged units correctly as an opponent. Teaching the AI to buy and
fire them is deliberately deferred to a later branch.

## 2. Player-facing rules

| Unit | Cost | Upkeep | Attack | Defense | Movement | Tier |
|---|---|---|---|---|---|---|
| Shortbowman | 12 | 4 | 2 | 0 | 3 | 1 |
| Longbowman | 24 | 12 | 3 | 1 | 3 | 2 |
| Crossbowman | 36 | 36 | 4 | 2 | 3 | 3 |

Costs and upkeep match the cavalry track exactly, extrapolated to tier 3 from
the two patterns already in `ENTITY_META`: cost rises by 12 per tier (12 / 24 /
36) and upkeep triples per tier (4 / 12 / 36).

Rules:

1. **Movement** is the infantry default (3), using the normal terrain costs and
   the normal split-move budget.
2. **Ranged units can never capture.** They may only move onto tiles their
   owner already owns. Neutral tiles, enemy tiles, enemy units, enemy
   fortifications and rebel-occupied tiles are all closed to them. They can
   never be bought directly into an attack outside their territory.
3. **One shot per turn, range 1.** A ranged unit may fire at one of the six
   neighbouring tiles. Legal targets are enemy units and rebels. Towers,
   castles, cities and bridges cannot be shot.
4. **A shot kills when the shooter's attack exceeds the target's defense.**
   Targets that survive are not shown as targets at all — the shot is either a
   kill or not offered. The victim is removed; the tile does not change owner.
5. **Firing costs the shot, not the movement.** A ranged unit may move, fire,
   and keep moving with whatever budget is left, in any order. It may fire even
   when its movement is exhausted.
6. **Merging** works within the ranged track only, by tier: two Shortbowmen
   merge into a Longbowman, Shortbowman + Longbowman into a Crossbowman. Ranged
   units never merge with infantry or cavalry. If either unit has already fired,
   the merged unit counts as having fired, so merging cannot refresh a spent
   shot.
7. **A kill leaves a target marker** (🎯) on the tile where the victim stood.
   It is purely visual: it lives exactly as long as a grave and is cleared the
   same ways, but it never spawns a rebel.

Design intent: a Shortbowman has 0 defense, so it protects neither itself nor
its neighbours — any Peasant can walk in and kill it. Ranged units are pure
support and must stand behind infantry. In exchange a Crossbowman removes any
one adjacent enemy every turn, since 4 exceeds every defense value in the game.

## 3. Data model

### 3.1 `EntityType`

Three new values in `types.ts`: `shortbowman`, `longbowman`, `crossbowman`.

### 3.2 `EntityMeta`

Replace `strength` with three fields. **Delete `strength` outright** rather than
keeping it alongside the new ones — the ~70 existing call sites then become a
typecheck-driven worklist instead of a manual audit.

```ts
export type UnitClass = "infantry" | "cavalry" | "ranged";

export interface EntityMeta {
  name: string;
  cost: number;
  upkeep: number;
  isUnit: boolean;
  offStrength: number;
  defStrength: number;
  /** Merge/upgrade rank within the unit's class. 0 for non-combat entities. */
  tier: number;
  /** Present for units only; drives merge track and entry rules. */
  unitClass?: UnitClass;
  movement?: number;
  maxAttacks?: number;
}
```

Full table after the change (existing rows keep off = def = today's `strength`):

| Entity | cost | upkeep | isUnit | off | def | tier | class | movement | maxAttacks |
|---|---|---|---|---|---|---|---|---|---|
| peasant | 10 | 3 | yes | 1 | 1 | 1 | infantry | — | — |
| warrior | 20 | 9 | yes | 2 | 2 | 2 | infantry | — | — |
| swordsman | 30 | 27 | yes | 3 | 3 | 3 | infantry | — | — |
| scout | 12 | 4 | yes | 1 | 1 | 1 | cavalry | 5 | 2 |
| knight | 24 | 12 | yes | 2 | 2 | 2 | cavalry | 5 | 2 |
| shortbowman | 12 | 4 | yes | 2 | 0 | 1 | ranged | — | — |
| longbowman | 24 | 12 | yes | 3 | 1 | 2 | ranged | — | — |
| crossbowman | 36 | 36 | yes | 4 | 2 | 3 | ranged | — | — |
| tower | 15 | 1 | no | 1 | 1 | 1 | — | — | — |
| castle | 30 | 5 | no | 2 | 2 | 2 | — | — | — |
| bridge | 5 | 1 | no | 0 | 0 | 0 | — | — | — |
| rebel | 0 | 0 | no | 0 | 0 | 0 | — | — | — |
| city | 5 | 0 | no | 0 | 0 | 0 | — | — | — |

Tower/castle upkeep stays the per-building base rate; linear defense upkeep via
`calcDefenseUpkeep` / `nextDefenseUpkeep` is untouched.

### 3.3 Which strength each call site uses

Decided once, applied everywhere:

| Call site | Uses |
|---|---|
| `getZoCStrength`, `getMaxEnemyZoC` | **def** — what a tile projects in defense |
| Enemy-tile entry check in `getValidMoves` | attacker **off** vs enemy ZoC |
| Building capture (`getPlacementAttackTiles`, `tileTapHandler` armed placement) | attacker **off** vs building **def** |
| Ranged kill condition | shooter **off** vs target **def** |
| AI "how strong / how dangerous is this entity" sums | **max(off, def)** |
| AI ZoC and capture feasibility | **def** (via the ZoC helpers) |
| `UnitToken` ring thickness, info tables | **tier** |

A Shortbowman therefore contributes 0 to its owner's zone of control — it
neither defends its own tile nor supports its neighbours.

### 3.4 Unit-class helpers

`isCavalry` currently derives from `maxAttacks > 1`. Re-derive it (and the new
`isRanged`) from `unitClass`, which produces identical results for every
existing entity:

```ts
export function unitClassOf(e: EntityType): UnitClass | undefined;
export function isCavalry(e: EntityType): boolean;   // unitClass === "cavalry"
export function isRanged(e: EntityType): boolean;    // unitClass === "ranged"
export function canCapture(e: EntityType): boolean;  // !isRanged(e)
```

### 3.5 Tier-based merging

`mergeResult` sums `strength` today, which breaks for ranged: 2 + 2 = 4 skips
Longbowman, and def 0 + 0 maps to nothing. It sums `tier` instead, against a
per-class table.

Replace `STRENGTH_TO_UNIT` / `STRENGTH_TO_CAVALRY` in
`constants/gameConstants.ts` with:

```ts
export const TIER_TO_UNIT: Record<UnitClass, Record<number, EntityType>> = {
  infantry: { 1: "peasant",     2: "warrior",    3: "swordsman" },
  cavalry:  { 1: "scout",       2: "knight" },
  ranged:   { 1: "shortbowman", 2: "longbowman", 3: "crossbowman" },
};
```

`mergeResult(a, b)`: both must be units of the same `unitClass`; result is
`TIER_TO_UNIT[class][tierA + tierB] ?? null`.

**This is a refactor, not a rule change.** For existing units tier equals
today's strength, so every outcome is preserved: peasant + peasant → warrior,
peasant + warrior → swordsman, warrior + warrior → null, scout + scout →
knight, scout + knight → null, mixed tracks → null. A test must assert this
parity explicitly.

`UNIT_UPGRADE` gains `shortbowman → longbowman` and `longbowman →
crossbowman`.

## 4. Entry rules: one shared gate

"May this unit enter this tile?" is encoded in **three** independent places
today, which is why the cavalry rules had to be mirrored three times:

1. `getValidMoves` (the enemy branch, the neutral branch, and the ally-rebel
   branch) — `utils/hexGrid.ts`
2. `getPlacementAttackTiles` — `utils/hexGrid.ts`
3. the armed-placement branch in `handleTileTapLogic` — `logic/tileTapHandler.ts`

The ranged rule is expressed as **one predicate**, `canCapture(e)` (`false` only
for ranged units), applied at every point where a unit takes ground:

1. `getValidMoves`, neutral branch — `if (!canCapture(mover)) continue;`
2. `getValidMoves`, enemy branch — same guard, alongside the existing cavalry check
3. `getValidMoves`, own-territory rebel branch — ranged may not step onto a
   rebel, because clearing a rebel is a strike
4. `getPlacementAttackTiles` — returns an empty set for a ranged armed unit, so
   a bowman can never be bought into an attack
5. `handleTileTapLogic` armed placement — `canOverwriteRebel` and
   `canOverwriteBuilding` both require `canCapture`

A single all-classes `mayEnter` predicate was considered and rejected. The
cavalry rules are consulted at *some* branches and deliberately not at others —
a cavalry unit that has already struck may still move onto a friendly unit to
merge, and may still take a neutral tile that happens to hold a rebel. Routing
every branch through one predicate would silently change both. What *is* worth
consolidating is `cavalryMoveKind`, which is already class-agnostic and is
called for non-cavalry purposes in `tileTapHandler`: rename it to `moveKind`.
`cavalryMayEnter` keeps its name and its cavalry-only scope.

Ranged units follow the existing ally-tile rules unchanged: they may move onto
an allied unit's tile to merge, and `useSelectionState` already strips ally
tiles whose merge would be illegal, so no new guard is needed.

## 5. The ranged attack

New module `logic/rangedAttack.ts`, kept pure so it can be tested without React
and reused by the AI later.

```ts
/** Adjacent tiles this unit may legally shoot right now. Empty if it is not a
 *  ranged unit, or it has already fired this turn. */
export function rangedTargets(o: {
  shooterKey: string;
  owner: TerritoryOwner;
  entities: Map<string, EntityType>;
  tileMap: Map<string, HexTile>;
  firedUnits: Set<string>;
}): Set<string>;

/** Applies one shot. Returns the new entities map, the new kill-marker set and
 *  the new fired set. Never touches ownership or territory balances. */
export function resolveRangedShot(o: { ... }): {
  entities: Map<string, EntityType>;
  killMarks: Set<string>;
  firedUnits: Set<string>;
};
```

Target legality, all conditions required:

- the tile is one of the shooter's six neighbours;
- it holds an entity that is a **unit** (`isUnit`) owned by another player, **or**
  a `rebel` (rebels are legal targets regardless of whose tile they stand on);
- it is not a `tower`, `castle`, `city` or `bridge`;
- `offStrength(shooter) > defStrength(target)`;
- `!firedUnits.has(shooterKey)`.

Resolution:

1. Delete the target entity.
2. **If the target tile is a lake, restore a `bridge` entity there.** This
   mirrors the existing rule that a unit leaving a lake tile leaves its bridge
   behind — the bridge is a structure, not something the unit carried. It is
   also what makes the no-recalculation claim below true: without the restore,
   `isTerritoryTile` drops the lake tile out of the victim's territory and can
   split it, which would drag in the full recalculation and single-hex-penalty
   path. Side effect: the restored bridge costs the victim 1 upkeep.
3. Add the target key to the kill-marker set.
4. Add the shooter to `firedUnits`. The shooter is **not** added to
   `spentUnits` and **not** added to `combatSpentUnits`; its `partialMoves`
   entry is untouched.

Because ownership and passability never change, a shot needs **no territory
recalculation, no single-hex penalty pass and no win/loss check** — which keeps
it cheap and keeps it away from the peak-turn performance budget.

### 5.1 Why "has fired" needs its own state

The obvious container is the existing `attacksUsed` map, and it is wrong.
`advanceAttacksUsed` drops a unit's counter when the unit becomes spent
(`if (!o.spent)`), which is harmless for cavalry because a spent cavalry unit
cannot act at all. Ranged units break that invariant precisely because firing is
decoupled from the movement budget: a bowman could fire, walk until its movement
hit zero, have its counter dropped on becoming spent, and then — still
selectable, since `isSelectableEntity` does not check `spentUnits` — fire again.

So "has fired" gets its own per-turn container, `firedUnits: Set<string>`, which
must survive all three of:

- **moving** — re-keyed from the source tile to the destination on every move,
  the same way `advanceAttacksUsed` re-keys its counter;
- **becoming spent** — unlike `attacksUsed`, the flag is kept;
- **merging** — the merged unit's flag is the **union** of the two units' flags,
  in both the move-merge path in `tileTapHandler` and the buy-merge path.

`firedUnits` is cleared at the same point `attacksUsed` is reset today —
`setAttacksUsed(new Map())` in `logic/endTurnHandler.ts` — and threads through
exactly the same places as `attacksUsed` (game state, `MoveHistorySnapshot`, the
AI exec callbacks).

## 6. The kill marker

A new marker set, `killMarks: Set<string>`, sitting beside `graveyard` and
`ruins`:

- placed when a ranged shot kills;
- cleared immediately when a unit enters the tile, exactly like a grave (and
  hidden under any occupying token, since `GraveyardLayer` already skips keys
  present in `entities`);
- otherwise cleared wholesale at the **start of the player's turn**.

That single clear reproduces a grave's on-screen lifetime exactly, and it does
so without the `ArmedSites` two-phase machinery. The reasoning is specific to
v1: only the player can create a kill marker, and it can only be created during
the player's own turn. A marker placed in turn N therefore survives the rest of
turn N and the whole AI phase, and disappears as turn N+1 begins — one full
round, the same as a grave. The moment the AI gains ranged units this must
become an owner-scoped sweep with arming, like graves; note it in the code.

Concretely: `AiDecisionExec.state` gains a `setKillMarks` callback, called with
an empty set in the player block at the end of `runAiTurn` in
`logic/aiStrategy.ts` — the same place the player's rebel spawn and re-arm
already run, which is the start of the player's turn.

The marker is **not** threaded through the AI's working state. The AI never
creates one, and an AI unit stepping onto a marked tile hides it visually and
then has it cleared by the turn-start sweep anyway.

Rendering is a third branch in `GraveyardLayer` using the 🎯 glyph.

Plumbing: `app/game.tsx` state, `MoveHistorySnapshot` (so undoing a shot removes
the marker along with restoring the victim), `hooks/useMoveHistory.ts`,
`hooks/useAiTurnCallbacks.ts`, `logic/aiSelfPlay.ts` (no-op setter) and
`utils/savedGame.ts`.

## 7. UI

### 7.1 Placeholder icons

Real art is not ready, so the three new units and the kill marker use emoji:
🏹 Shortbowman, 🪃 Longbowman, ✴️ Crossbowman, 🎯 kill marker.

`components/UnitIcon.tsx` is currently a pure SVG-AST pipeline typed as
`Record<EntityType, Ast>`. Add an emoji branch: an entity either has inline SVG
art or an emoji glyph, and `UnitIcon` renders a React Native `<Text>` for the
latter. `UnitIcon` already returns a self-contained element inside a plain View
tree (SvgXml emits its own `<svg>` root), so a `<Text>` drops in at every call
site — board tokens, the purchase ribbon, the info tables and the entity panel.
Swapping in real art later means moving one entry from the emoji map to the SVG
map.

`UnitToken`'s ring thickness switches from `strength` to `tier`, which keeps
every existing token pixel-identical.

### 7.2 Targeting

- `useSelectionState` gains `validRangedTargets: Set<string>`, computed via
  `rangedTargets` whenever `selectedEntityKey` holds a player-owned ranged unit.
- `MovementHighlightLayer` renders them as a **red targeting ring** (a stroked
  circle), visually distinct from the filled dots that mean movement. The
  existing filled red "attack move" dot keeps its meaning for melee.
- `MovementHighlightTapTargets` adds transparent tap polygons for the target
  set.
- `handleTileTapLogic` gets a new branch, placed **before** the unit-move
  branch: if `selectedEntityKey` holds a ranged unit and the tapped key is in
  `validRangedTargets`, `pushHistory()` then apply `resolveRangedShot` and
  commit. There is no ambiguity with the move branch, because a ranged unit's
  targets can never also be valid move tiles.
- The shooter stays selected after firing so the player can immediately move it
  away.

### 7.3 Panels and tables

- `EntityPanel` shows Attack and Defense as separate values and indicates when
  the shot is used this turn.
- `INFO_TABLE_ROWS`, `WelcomeModal` and `MainMenu` go from one strength column
  to two (Attack / Defense).
- The purchase ribbon picks the three units up automatically from
  `ENTITY_META` via `PURCHASABLES`; it already scrolls horizontally, so eight
  unit entries need no layout change.

## 8. AI

The AI does not buy ranged units in v1. Two derived lists must filter them out:

- `aiUnitBuyOrder` in `logic/aiStrategy.ts` (currently `filter(isUnit)`)
- `UNIT_TYPES` in `logic/aiExpert.ts` (currently `filter(isUnit)`)

Both also sort by `strength`; they switch to `tier` (identical ordering for the
units the AI can buy).

Handling the player's ranged units follows from §3.3: everything ZoC- and
capture-related reads defense, so the AI naturally sees a Shortbowman as the
open target it is, while its threat/value sums use `max(off, def)` so it does
not underestimate a Crossbowman.

**Self-play strength cannot regress.** Every entity the AI can buy has
off = def = its old strength, and the AI never buys a ranged unit, so AI-vs-AI
games are unchanged. The existing self-play tests are the check; no
new-vs-old A/B run is required for this branch.

## 9. Persistence

`utils/savedGame.ts` serialises `EntityType` values directly, so saves
containing ranged units work without a format change. Saves capture mid-turn
state (`spentUnits`, `attacksUsed`), so both new sets join them as optional
fields, defaulted on load exactly like `armedGraveyard` already is:
`killMarks: new Set(parsed.state.killMarks ?? [])` and
`firedUnits: new Set(parsed.state.firedUnits ?? [])`. Saves written before this
branch keep loading.

## 10. Testing

New `logic/rangedAttack.test.ts`:

- target list excludes own units, towers, castles, cities, bridges and
  non-adjacent tiles;
- kill condition per tier — Shortbowman (2) kills Peasant/Scout (def 1) but not
  Warrior (def 2); Crossbowman (4) kills Swordsman (def 3);
- rebels are always legal targets, on either side's tiles;
- shooting a unit standing on a lake restores the bridge;
- a second shot in the same turn is not offered;
- **fire, then exhaust movement, then try to fire again** — the regression test
  for §5.1; the second shot must still be refused after the unit is spent;
- the shooter keeps its movement and is not spent.

Extensions to existing suites:

- `utils/hexGrid.test.ts` — new costs/upkeeps; ranged cannot enter neutral,
  enemy or rebel tiles; `getPlacementAttackTiles` is empty for ranged; ZoC with
  a def-0 unit projects nothing.
- `logic/gameLogic.test.ts` — **merge parity** for infantry and cavalry across
  the tier refactor, plus the three ranged merges and a merge inheriting the
  fired flag from either side.
- `logic/tileTapHandler.test.ts` — fire-then-move, move-then-fire, firing with
  zero movement left, and that a shot changes no tile ownership.
- `logic/endTurnHandler.test.ts` / `logic/rebelSpawn.test.ts` — kill markers are
  swept on the owner's turn and never spawn a rebel.
- `utils/savedGame.test.ts` — round-trip with ranged units and kill markers;
  a pre-branch save loads with an empty marker set.
- Existing self-play tests must produce unchanged results.

## 11. Out of scope

- AI buying, positioning or firing ranged units.
- Range greater than 1, line of sight, or terrain effects on shooting.
- Ranged units damaging fortifications.
- Real (non-emoji) artwork.
- Fixing the pre-existing behaviour where moving onto a non-mergeable allied
  unit destroys it.
