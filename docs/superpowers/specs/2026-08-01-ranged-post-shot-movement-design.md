# Ranged Units — Post-Shot Movement Clamp

Date: 2026-08-01
Branch: `feat/ranged-units`
Status: approved for planning
Amends: `2026-07-31-ranged-units-design.md` (rule 5)

## 1. Goal

Firing currently costs a ranged unit nothing but its shot: it may move, fire,
and keep moving on whatever budget is left. That makes the bowman a hit-and-run
unit — it can step out from behind its line, kill, and retreat back out of
reach in the same turn, which is exactly the play the class was not meant to
have.

New rule: **firing clamps the shooter's remaining movement to at most 1 point.**

## 2. Player-facing rule

Rule 5 of the ranged spec is replaced by:

> **Firing clamps the shooter's movement.** A ranged unit may move and fire in
> either order, and may fire even when its movement is exhausted. But the
> moment it fires, its remaining movement budget is cut to at most 1 point. A
> unit that has already spent its budget stays at 0.

Consequences, stated so they are not re-litigated later:

- **Movement before the shot is untouched.** Move 3, then fire, and nothing is
  lost. The rule targets fire-then-retreat, not move-then-fire. This is
  deliberate: a clamp cannot be applied retroactively to movement already
  spent, and blocking the shot outright after a long move would be a different
  and harsher rule.
- **Forest closes after a shot.** `TERRAIN_MOVE_COST.forest` is 2, so a
  1-point budget cannot pay for it. After firing, a bowman may only step onto
  1-cost terrain (grass, desert, field, sawmill, mine, and lake via a bridge).
  This was chosen over a "one hex step regardless of cost" rule: the clamp
  reuses the existing budget machinery exactly, while a free step would need a
  new special case threaded through `getValidMoves`.
- **The shooter is still not spent.** Firing does not add the unit to
  `spentUnits`; it keeps a live 1-point budget, and only becomes spent by using
  it. A bowman with 0 movement left may still fire.
- **Merging cannot launder the clamp.** No new rule is needed:
  `resolveMovedUnitMoves` already takes `Math.min` of the mover's and the
  destination's remaining budgets on a merge, so the merged unit is never
  fresher than the clamped one. In practice a clamped bowman spends its single
  point stepping onto the ally, leaving 0, so the merged unit ends up spent.
  Rule 6's fired-flag carry-over is unaffected.

## 3. Implementation

### 3.1 The clamp lives in the pure shot resolver

`POST_SHOT_MOVEMENT = 1` is a named constant in `logic/rangedAttack.ts`.

`resolveRangedShot` takes `partialMoves` as an input and returns a fresh
clamped copy alongside the collections it already returns:

```ts
const partialMoves = new Map(o.partialMoves);
const shooter = o.entities.get(o.shooterKey);
const remaining = o.partialMoves.get(o.shooterKey) ?? unitMovement(shooter);
partialMoves.set(o.shooterKey, Math.min(remaining, POST_SHOT_MOVEMENT));
```

Keeping the clamp in the pure function — rather than in the tap handler — means
the AI inherits the rule for free when a later branch teaches it to shoot. That
matches the file's existing contract, which states it is kept state-free so
both callers can drive it.

**The clamped value must be written, never left absent.** `partialMoves` is a
sparse map: a missing entry means "full budget", and `tileTapHandler.ts` reads
`partialMoves.get(key) ?? maxRange`. A bowman that fires before moving has no
entry yet, so omitting the write would hand it its full 3 points back.

### 3.2 Callers

- `logic/tileTapHandler.ts` — the ranged-shot branch passes `partialMoves` in
  and threads `shot.partialMoves` out.
- `app/game.tsx` — `setPartialMoves(shot.partialMoves)` inside the existing
  `unstable_batchedUpdates` block for the shot.
- The stale comment "The shooter keeps its movement, so leave it selected to
  move away" is rewritten; the shooter stays selected, but on a 1-point leash.

### 3.3 No UI work

Movement highlights derive from `partialMoves` through `getValidMoves`, so the
reachable-tile ring shrinks to the adjacent 1-cost tiles in the same render
that resolves the shot. No layer, equality function or overlay changes.

### 3.4 No new persisted state

`partialMoves` is already saved and restored by `utils/savedGame.ts`. The clamp
writes into it and introduces nothing new to serialise.

### 3.5 No AI work

The AI never buys ranged units in v1 and never fires, so no AI path reaches
`resolveRangedShot`. Facing a player's bowman is unchanged: the clamp alters
only the shooter's own budget, not ownership, ZoC or passability.

## 4. Testing

`logic/rangedAttack.test.ts`:
- fires with a full budget (no map entry) → shooter's entry is written as 1
- fires with 2 left → clamped to 1
- fires with 1 left → stays 1
- fires with 0 left → stays 0, never negative
- other units' entries in `partialMoves` are untouched, and the input map is
  not mutated

`logic/tileTapHandler.test.ts`:
- fire-then-move: after a shot the bowman may step onto one adjacent 1-cost
  tile and is then spent
- fire-then-forest: an adjacent forest tile is not a valid move after a shot,
  though it was before
- move-then-fire: spending 2 of 3 points and then firing leaves 1 — the earlier
  move is not punished
- the existing regression from §5.1 of the ranged spec still holds: fire,
  exhaust the clamped movement, and a second shot is still refused

`logic/tileTapHandler.test.ts` (merge loophole):
- a bowman that fires and then merges into an unmoved same-track bowman cannot
  refresh its budget: the single clamped point pays for the step, so the merged
  unit ends spent rather than holding the destination's full 3

## 5. Documents to correct

The old rule is stated in prose in two places on this branch, and both are
wrong the moment this lands:

- `docs/superpowers/specs/2026-07-31-ranged-units-design.md` rule 5 — replaced
  with the text in §2 and a pointer to this document.
- `docs/superpowers/plans/2026-07-31-ranged-units.md` — any step or comment
  that restates "keeps its movement" is updated to match.
