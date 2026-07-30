# Minimum lifetime for graves and ruins

Date: 2026-07-29
Status: approved

## Problem

Three defects, one shared root cause: grave/ruin markers are cleared by an
owner-scoped sweep, and the sweep's timing is inconsistent.

1. **Player graves can rise instantly.** `runAiTurn` (aiStrategy.ts) arms the
   round-end snapshot and consumes it for the player in the same statement
   sequence, so a grave on a player tile can become a rebel the moment it is
   created. Worst case: a unit dies during the AI phase and the player never
   sees the marker at all. AI owners are unaffected — they consume the snapshot
   taken at the end of the *previous* round, which is correct.

2. **Bridge ruins strand forever.** Bankruptcy demolishing a bridge adds a ruin
   *and* flips the lake tile to `neutral`. `spawnRebelsForOwner` skips any key
   whose tile owner differs from the active owner, so a neutral tile is never
   visited by any owner and the marker is never cleared.

3. **A masked variant.** A unit liquidated on a surviving bridge adds a grave to
   the lake tile. It renders as nothing (GraveyardLayer suppresses markers when
   an entity occupies the tile) but sits in the set; today it is cleared only
   because of the same-round arming in defect 1. Fixing 1 without touching this
   would keep dead bookkeeping alive for rounds.

## Rules

- A grave or ruin may only produce a rebel if it stood at the start of its
  owner's **previous** turn. Uniform across combat deaths, bankruptcy
  liquidations, and single-hex isolation penalties.
- Markers on `neutral` water tiles are legitimate and visible for exactly one
  full player turn, then removed. They never produce a rebel (existing lake
  guard in `spawnRebelsForOwner`).
- When a bankruptcy destroys both the bridge and a unit on the same water tile,
  the tile shows a **skull**, not a ruin, and never both.
- A water tile whose bridge is demolished stays `neutral`. Unchanged.
- A water tile whose bridge **survives** liquidation gets no marker at all — it
  cannot render (the bridge entity suppresses it) and cannot spawn.
- Voluntary bridge demolition leaves no marker. Unchanged. (Attacks never
  remove a bridge; the three `owner: "neutral"` sites on lake tiles are the AI's
  own remove action, Expert's simulation of it, and the player's demolish
  button.)

## Design

### Data

`ArmedSites = Map<TerritoryOwner, Set<string>>` in types.ts. Two instances,
`armedGraveyard` and `armedRuins`, replacing the flat `Set<string>` pair
threaded through `game.tsx` → `endTurnHandler` → `runAiTurn`.

`TerritoryOwner` already includes `'neutral'`, so orphaned water markers occupy
a slot in the existing map rather than needing a parallel structure. The neutral
slot is never passed to `spawnRebelsForOwner`; it is only swept.

Invariant: `armedGraveyard.get(O)` holds the grave tiles owned by `O` at the
start of `O`'s previous turn.

### Helpers (gameLogic.ts)

- `armedSitesForOwner(owner, tileMap, sites)` — subset of `sites` on tiles
  currently owned by `owner`. Used for both real owners and `'neutral'`.
- `sweepNeutralMarkers(tileMap, graveyard, ruins, armedGraveyard, armedRuins)` —
  deletes the previously armed neutral keys from `graveyard`/`ruins`, then
  re-arms the neutral slot from what stands now. Consume-then-arm in one pass.

### Timing (aiStrategy.ts)

Per AI owner `O`, at `O`'s turn start, gated by `currentTurn !== 1` exactly as
the spawn is today:

1. spawn from `armedGraveyard.get(O) ?? empty`
2. run `O`'s economy (may create markers)
3. re-arm `O`'s slots from the post-economy state

Re-arming **after** the economy makes bankruptcy markers behave like combat
markers and matches the player path, where the economy already precedes arming.

For the player, at the end of the AI phase (= the player's turn boundary), after
the player economy block: same three steps, then `sweepNeutralMarkers`, then
publish both maps via `cbs.state.setArmedGraves`.

Placing the neutral sweep at this single point — after the player economy, not
before — gives markers created by AI bankruptcy earlier in the phase and by the
player economy moments earlier the same one-player-turn lifetime.

The neutral sweep is **not** gated on round 1, unlike the spawn and the per-owner
re-arm. There is nothing to suspend: it only cleans up markers that can never
breed. Gating it would give a round-1 marker — a bridge isolated by
`applySingleHexPenalty` during the first turn — two turns instead of one,
contradicting the guarantee.

### Marker creation (gameLogic.ts)

`applyOwnerEconomy` bankruptcy, restructured:

- The liquidation loop records lake-tile unit deaths in a **pass-local** set and
  does not add graves for them. Land deaths add graves as before.
- The demolition pass, when it removes a bridge from a lake tile, adds a skull
  if that key is in the pass-local set, otherwise a ruin.
- If the demolition pass does not run, the bridge survives and no marker is
  added for the liquidated unit.

The pass-local set matters: testing `graveyard.has(key)` instead would let a
stale grave from an earlier round suppress a legitimate new ruin.

`applySingleHexPenalty` needs no marker change — its lake branches are if/else,
so each already produces exactly one marker on a tile it flips to neutral, and
the unit branch already yields a skull as the rules require. No path adds a ruin
before a grave for the same key in the same pass.

### Mutation contract

`runAiTurn` mutates the passed maps in place via `.set` and also publishes them
through `cbs.state.setArmedGraves`. `game.tsx` passes a deep clone in and stores
what comes back; `aiSelfPlay` holds one long-lived pair across rounds and
ignores the callback (headless no-op). This replaces self-play's own per-round
`new Set(ws.graveyard)` arming, so both flows share one rule.

### Persistence and rewind

- `savedGame.ts`: both maps serialize as `[TerritoryOwner, string[]][]`, read
  back with `?? []`, `v: 1` retained (same pattern as `attacksUsed`).
- No migration for stranded ruins is needed. Saves load with empty armed maps,
  so the next neutral sweep arms whatever water markers are stuck and the sweep
  after that removes them — self-healing within two player turns.
- `AiStepSnapshot` gains both maps, including the neutral slot, so developer-mode
  AI step rewind cannot double-consume a marker or resurrect an expired one.
- `MoveHistorySnapshot` is unchanged: the armed maps are only mutated inside
  `runAiTurn`, never during the player's own turn, so player undo cannot desync
  them.

### Round 1

Both spawn and re-arm stay behind `currentTurn !== 1`. Round-1 markers are first
armed at each owner's round-2 turn start and first roll in round 3 — today's
timing, unchanged.

## Consequences

- Every marker is visible for at least one complete player turn. AI-owned graves
  can live up to ~2 rounds (created after O's turn in round R, armed at O's turn
  in R+1, consumed at O's turn in R+2).
- Rebel pressure drops slightly; fewer markers roll per round.
- AI strength A/B baselines measured before this change are not comparable
  after it. Re-baseline before tuning Expert.
- Old saves grant one extra round to markers standing at save time.

## Testing

- unit: `armedSitesForOwner` filters by current tile ownership, including
  `'neutral'`.
- unit: `sweepNeutralMarkers` removes previously armed keys and arms current
  ones; a marker survives exactly one sweep.
- rewrite `rebelSpawn.test.ts` "grave created THIS round by player bankruptcy …
  spawns rebel immediately" — it must now *not* rise in the same round.
- fix the stale comment in `economyBankruptcy.test.ts` (the lake grave is no
  longer created-then-consumed; it is never created, because the bridge
  survives). The assertion itself still holds.
- new: the four creation cases (player turn / AI phase × player tile / AI tile),
  each asserting the marker still stands through one full player turn.
- new: a marker on a tile that changes hands is armed by the new owner.
- new: bankruptcy destroying bridge + unit yields a skull and no ruin; bridge
  alone yields a ruin; surviving bridge yields neither.
- new: a water ruin disappears after exactly one player turn, driven end-to-end
  through `runAiTurn` for both a player bankruptcy and an AI bankruptcy (the AI
  case matters because the marker is created mid-phase while the sweep runs at
  the phase end).
