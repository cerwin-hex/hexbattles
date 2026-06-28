# Rebel Spawn — Per-Owner at Turn Start

**Date:** 2026-06-28
**Status:** Approved

---

## Goal

Rebels currently spawn once per round, at the end of the AI phase (after all owners have moved). The new behaviour: rebels spawn at the **start of each owner's turn**, restricted to **that owner's own territory**. Both the grave/ruin spawn (75% chance) and the background/spread spawn (2%/7.5%/10%) apply only to the active owner's tiles.

---

## Behaviour Spec

### Spawn trigger
- Before each owner takes their turn, `spawnRebelsForOwner(owner, ...)` runs.
- Only tiles where `tile.owner === owner` are eligible — both as spawn targets and as sources for the spread check.
- Neighbor-rebel counts for spread still read from the full global entities map (enemy rebels on adjacent tiles count).

### Armed snapshot — one-round delay
- A global armed snapshot (`armedGraves: Set<string>`, `armedRuins: Set<string>`) is taken **once per round**, at the end of the AI phase (after all moves and player economy).
- Deaths during round R are in that snapshot and arm for round R+1. No same-round spawning.
- The player's rebel spawn also uses this snapshot, applied at the **end** of `runAiTurn` just before returning control to the player — so the player sees rebels immediately at the start of their new turn.

### Round 1
- No rebel spawn in round 1. `armedGraveyardRef` starts as an empty Set, so nothing is armed.

### Spawn order within a round (example: player + AI1 + AI2)
```
[End of round R's AI phase]
  snapshot: nextArmedGraves = ws.graveyard   (all deaths from round R)
  spawnRebelsForOwner("player", nextArmedGraves)   ← player sees rebels at round R+1 start
  store nextArmedGraves in armedGraveyardRef
  publish state + advanceTurn()

[Round R+1 — player takes turn]

[Round R+1 — player presses End Turn → runAiTurn(armedGraveyardRef)]
  AI1 turn start: spawnRebelsForOwner("ai1", armedGraves)
  AI1 moves
  AI2 turn start: spawnRebelsForOwner("ai2", armedGraves)
  AI2 moves
  player economy runs
  snapshot: nextArmedGraves = ws.graveyard   (all deaths from round R+1)
  spawnRebelsForOwner("player", nextArmedGraves)
  store nextArmedGraves
  publish state + advanceTurn()
```

### Timing invariant
A unit killed (or economy-liquidated) in round R can spawn a rebel at the start of round R+1 for whichever owner controls that tile at spawn time. This applies symmetrically to player kills, AI kills, and economy deaths.

---

## Implementation Plan

### 1. `logic/gameLogic.ts` — new `spawnRebelsForOwner`

Add alongside `spawnRebels` (keep `spawnRebels` for now; remove it later if it becomes unused):

```ts
export function spawnRebelsForOwner(
  owner: TerritoryOwner,
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,        // mutated in place (caller clones first)
  graveyard: Set<string>,
  ruins: Set<string>,
  armedGraves: Set<string>,                 // shared; owner's entries consumed here
  armedRuins: Set<string>,                  // shared; owner's entries consumed here
  rng: () => number = Math.random,
): void
```

Logic:
1. Snapshot `preSpread = new Map(entities)` before any mutations.
2. Iterate `armedGraves`: if `tileMap.get(key)?.owner === owner` and not lake and unoccupied → 75% spawn rebel; consume from `armedGraves` (and from `graveyard`).
3. Same for `armedRuins` (against `ruins`).
4. Spread loop: for every `tile` where `tile.owner === owner`, not mountain/lake, not occupied — count rebel neighbours in `preSpread` (global), roll 2%/7.5%/10%.

### 2. `logic/aiStrategy.ts` — `AiTurnCallbacks`

Add to `state`:
```ts
setArmedGraves(graves: Set<string>, ruins: Set<string>): void;
```

### 3. `logic/aiStrategy.ts` — `runAiTurn` signature

```ts
export async function runAiTurn(
  ws: AiWorkingState,
  cbs: AiTurnCallbacks,
  aiOwners: TerritoryOwner[],
  currentTurn: number,
  difficulty: Difficulty,
  armedGraves: Set<string> = new Set(),   // replaces spawnRebelsAtRoundEnd
  armedRuins: Set<string> = new Set(),
): Promise<void>
```

Remove: `spawnRebelsAtRoundEnd` boolean parameter and all references to it.

Internal changes:
- Remove early `armedGraves`/`armedRuins` snapshot at function start.
- Before each `aiOwner`'s decision loop: call `spawnRebelsForOwner(aiOwner, ...)` (guarded by `currentTurn !== 1`); publish updated entities/graveyard/ruins.
- At the end, after player economy:
  ```ts
  if (currentTurn !== 1) {
    const nextArmedGraves = new Set(ws.graveyard);
    const nextArmedRuins  = new Set(ws.ruins);
    ws.entities = new Map(ws.entities);
    spawnRebelsForOwner("player", ws.tileMap, ws.entities,
                        ws.graveyard, ws.ruins,
                        nextArmedGraves, nextArmedRuins);
    cbs.state.setArmedGraves(nextArmedGraves, nextArmedRuins);
  }
  ```
- Remove old rebel spawn block entirely.

### 4. `app/game.tsx`

Add refs:
```ts
const armedGraveyardRef = useRef<Set<string>>(new Set());
const armedRuinsRef     = useRef<Set<string>>(new Set());
```

Wire callback in `makeAiTurnCallbacks`:
```ts
setArmedGraves: (graves, ruins) => {
  armedGraveyardRef.current = graves;
  armedRuinsRef.current     = ruins;
},
```

Pass to `runAiTurnOrchestration`:
```ts
await runAiTurnOrchestration(
  ws, cbs, aiOwners, currentTurn ?? 0,
  aiDifficultyRef.current,
  armedGraveyardRef.current,   // was: true (spawnRebelsAtRoundEnd)
  armedRuinsRef.current,
);
```

### 5. `logic/endTurnHandler.ts`

Add to `EndTurnParams`:
```ts
armedGraveyard: Set<string>;
armedRuins: Set<string>;
```

Pass both to `runAiTurn` call at the end of `handleEndTurnLogic`.

Update comment block: replace references to "after every owner has moved" with "per-owner at turn start".

### 6. `logic/aiSelfPlay.ts`

`runOneAiTurnHeadless`: replace `spawnRebelsAtRoundEnd: boolean` parameter with
`armedGraves: Set<string> = new Set(), armedRuins: Set<string> = new Set()`. Pass through to `runAiTurn`.

Round loop in `runMatch`:
```ts
const armedGraves = new Set(ws.graveyard);
const armedRuins  = new Set(ws.ruins);
for (const owner of COMPETITORS) {
  ws.spentUnits = new Set(); /* ... budget reset ... */
  // Spawn for this owner before their turn (guarded by turn > 1)
  if (turn !== 1) {
    ws.entities = new Map(ws.entities);
    spawnRebelsForOwner(owner, ws.tileMap, ws.entities,
                        ws.graveyard, ws.ruins,
                        armedGraves, armedRuins, rng);
  }
  await runAiTurn(ws, cbs, [owner], turn, diffByOwner[owner]);
}
// No separate spawnRebels call at round end — per-owner handles it.
// Snapshot for next round done inside runAiTurn (React) or arm here for self-play?
```

**Self-play note:** In self-play, `runAiTurn` is called per-owner with `spawnRebelsAtRoundEnd = false` (now: empty default armed sets). Self-play must do its own armed snapshot at round start and call `spawnRebelsForOwner` per owner itself (as above). The end-of-round player-spawn step inside `runAiTurn` does NOT run for self-play (there is no "player"). Self-play just re-snapshots armed graves at the start of each new round.

### 7. `logic/rebelSpawn.test.ts`

Rewrite all three tests for Option B semantics:

- **Test 1:** armed grave in player's territory → `spawnRebelsForOwner("player", ...)` rises it (via `runOneAiTurnHeadless` with the grave pre-passed as armed).
- **Test 2:** round 1 guard — no spawn even with armed grave.
- **Test 3:** grave created DURING the round (from bankruptcy) → IS in the end-of-round armed snapshot → spawns rebel on the owner's NEXT turn (verify it is NOT spawned within the same round, i.e. not in AI spawn pass, only in the end-of-round player spawn pass).

---

## What does NOT change

- Spawn probabilities: 75% per grave/ruin, 2%/7.5%/10% spread.
- `spawnRebels` (the existing global function) stays in `gameLogic.ts` until confirmed unused, then deleted.
- Win/loss check, economy, single-hex penalty — all unchanged.
- The round counter still advances at the end of `runAiTurn`.
