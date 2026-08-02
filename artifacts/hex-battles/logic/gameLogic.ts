import {
  EntityType,
  TerrainType,
  HexTile,
  TerritoryOwner,
  ENTITY_META,
  canCapture,
  calcDefenseUpkeep,
  getContiguousTerritory,
  getTerritoryId,
  TERRAIN_INCOME,
  CITY_BONUS,
  unitMaxAttacks,
  calcAdminBurden,
  HEX_EDGES,
  tileKey,
  improveCostFor,
  improveTargetFor,
  hexDistance,
  cityCapFor,
  CITY_IMPROVE_RADIUS,
  MIN_OWN_CITY_DISTANCE,
} from "@/utils/hexGrid";
import type { ArmedSites } from "@/types";
import { TIER_TO_UNIT } from "@/constants/gameConstants";
import { ALL_GAME_ELEMENTS, type GameElements } from "@/constants/gameElements";

export function calcTerritoryUpkeep(
  territory: HexTile[],
  ents: Map<string, EntityType>,
  /** Omitted means the full rule set — keeps every existing caller honest. */
  elements: GameElements = ALL_GAME_ELEMENTS,
): number {
  let towers = 0, castles = 0, unitUpkeep = 0, bridges = 0;
  for (const t of territory) {
    const e = ents.get(t.key);
    if (!e) continue;
    if (e === "tower") towers++;
    else if (e === "castle") castles++;
    else if (e === "bridge") bridges++;
    else {
      unitUpkeep += ENTITY_META[e].upkeep;
      // Unit standing on a lake tile implies a bridge underneath — count its upkeep too.
      if (t.terrain === "lake") bridges++;
    }
  }
  return (
    unitUpkeep +
    calcDefenseUpkeep("tower", towers) +
    calcDefenseUpkeep("castle", castles) +
    bridges * ENTITY_META["bridge"].upkeep +
    (elements.adminBurden ? calcAdminBurden(territory.length) : 0)
  );
}

/**
 * Apply one owner's per-turn economy to every territory they hold: credit net
 * income (income − upkeep, plus an optional land-tile income bonus for the
 * "super" AI tiers) and, when reserves + income cannot cover upkeep, drain the
 * balance to 0 and liquidate units — demolishing buildings too on a deep
 * shortfall, releasing any ruined bridge's lake tile back to neutral.
 *
 * This is the SINGLE source of truth for the economy step, applied exactly once
 * per owner per round at the start of that owner's turn. It replaces four
 * drifted inline copies (the player + AI branches of endTurnHandler, the
 * end-of-AI-phase player re-check in aiStrategy, and self-play's creditIncome) —
 * the drift between them caused upkeep to be charged twice and wrongly bankrupt
 * negative-net territories whose reserves covered exactly one application.
 *
 * Mutates `tileMap`/`entities`/`balances`/`graveyard`/`ruins` in place; callers
 * own those maps and publish fresh copies afterwards. Returns whether ANY of the
 * owner's territories went bankrupt, so the caller can run the single-hex sweep.
 */
export function applyOwnerEconomy(o: {
  owner: TerritoryOwner;
  tileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  balances: Map<string, number>;
  cities: Set<string>;
  graveyard: Set<string>;
  ruins: Set<string>;
  /** Grant the land-tile income bonus (super_expert AI tier). */
  incomeBonus: boolean;
  /** Omitted means the full rule set. */
  elements?: GameElements;
}): boolean {
  const {
    owner, tileMap, entities, balances, cities, graveyard, ruins, incomeBonus,
    elements = ALL_GAME_ELEMENTS,
  } = o;
  let bankruptcyOccurred = false;
  const visited = new Set<string>();
  for (const tile of Array.from(tileMap.values())) {
    if (tile.owner !== owner || visited.has(tile.key)) continue;
    if (tile.terrain === "mountain") continue;
    const territory = getContiguousTerritory(tileMap, tile.key, owner, entities);
    for (const t of territory) visited.add(t.key);
    const territoryId = getTerritoryId(territory);
    if (!territoryId) continue;
    const income = calcTerritoryIncome(territory, entities, cities, tileMap);
    const incomeModifier = incomeBonus
      ? territory.filter((t) => t.terrain !== "lake").length
      : 0;
    const upkeep = calcTerritoryUpkeep(territory, entities, elements);
    const current = balances.get(territoryId) ?? 0;
    const delta = income + incomeModifier - upkeep;
    const newBalance = current + delta;
    if (newBalance < 0) {
      // Bankruptcy: reserves + income cannot cover upkeep, so the balance is
      // drained to 0 (paying as much of the bill as possible) and units are
      // liquidated; if upkeep still outstrips income, buildings are demolished.
      bankruptcyOccurred = true;
      balances.set(territoryId, 0);
      let unitUpkeepSaved = 0;
      // Water tiles where a unit died in THIS bankruptcy. Deliberately pass-local
      // rather than testing `graveyard.has`: a stale grave left over from an
      // earlier round must not suppress a legitimate new ruin below.
      const lakeUnitDeaths = new Set<string>();
      for (const t of territory) {
        const e = entities.get(t.key);
        if (e && ENTITY_META[e].isUnit) {
          unitUpkeepSaved += ENTITY_META[e].upkeep;
          // A unit on a lake tile sat on a bridge — restore the bridge so the
          // lake tile stays connected to the territory. Any marker here is
          // deferred to the demolition pass: if the bridge survives it would
          // render underneath the bridge (i.e. not at all), so there is nothing
          // worth recording.
          if (tileMap.get(t.key)?.terrain === "lake") {
            entities.set(t.key, "bridge");
            lakeUnitDeaths.add(t.key);
          } else {
            entities.delete(t.key);
            graveyard.add(t.key);
          }
        }
      }
      if (delta + unitUpkeepSaved < 0) {
        for (const t of territory) {
          const e = entities.get(t.key);
          if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
            entities.delete(t.key);
            // A demolished bridge must release its lake tile to neutral, else the
            // owned lake keeps rendering as a bridge with a territory border.
            const lt = e === "bridge" ? tileMap.get(t.key) : undefined;
            if (lt?.terrain === "lake") {
              tileMap.set(t.key, { ...lt, owner: "neutral" });
              // Bridge and unit both lost on the same tile: show the skull, not
              // the ruin, and never both.
              if (lakeUnitDeaths.has(t.key)) graveyard.add(t.key);
              else ruins.add(t.key);
            } else {
              ruins.add(t.key);
            }
          }
        }
      }
    } else {
      balances.set(territoryId, newBalance);
    }
  }
  return bankruptcyOccurred;
}

export function applySingleHexPenalty(
  prevTileMap: Map<string, HexTile>,
  tileMap: Map<string, HexTile>,
  balances: Map<string, number>,
  entities: Map<string, EntityType>,
  graveyard: Set<string>,
  ruins: Set<string>,
  exemptKey?: string,
): void {
  const allOwners = new Set<TerritoryOwner>([
    "player",
    "ai1",
    "ai2",
    "ai3",
    "ai4",
    "ai5",
  ]);
  const visited = new Set<string>();
  for (const tile of tileMap.values()) {
    if (!allOwners.has(tile.owner as TerritoryOwner) || visited.has(tile.key))
      continue;
    if (tile.terrain === "mountain") continue;
    const territory = getContiguousTerritory(
      tileMap,
      tile.key,
      tile.owner as TerritoryOwner,
      entities,
    );
    for (const t of territory) visited.add(t.key);
    if (territory.length !== 1) continue;
    const singleKey = territory[0].key;
    if (exemptKey && singleKey === exemptKey) continue;
    const prevOwner = prevTileMap.get(singleKey)?.owner;
    if (prevOwner === tile.owner) {
      const prevTerritory = getContiguousTerritory(
        prevTileMap,
        singleKey,
        tile.owner as TerritoryOwner,
        entities,
      );
      if (prevTerritory.length === 1) continue;
    }
    const id = getTerritoryId(territory);
    if (id) balances.set(id, 0);
    const entity = entities.get(singleKey);
    const lt = tileMap.get(singleKey);
    if (entity && entity !== "rebel") {
      entities.delete(singleKey);
      if (ENTITY_META[entity].isUnit) {
        graveyard.add(singleKey);
        // Unit was on a bridge tile — also demolish the bridge since its territory is gone.
        if (lt?.terrain === "lake") {
          tileMap.set(singleKey, { ...lt, owner: "neutral" });
        }
      } else if (entity !== "city") {
        ruins.add(singleKey);
        // Bridge removed: lake tile must lose owner.
        if (entity === "bridge" && lt?.terrain === "lake") {
          tileMap.set(singleKey, { ...lt, owner: "neutral" });
        }
      }
    } else if (lt?.terrain === "lake" && lt.owner !== "neutral") {
      // Ownerless lake tile with no entity — reset to neutral.
      tileMap.set(singleKey, { ...lt, owner: "neutral" });
    }
  }
}

/**
 * The sites in `sites` that currently sit on a tile owned by `owner` — i.e. the
 * set to arm for that owner's next turn. Passing `"neutral"` collects the
 * orphaned markers on bridgeless water tiles.
 *
 * Ownership is read fresh, so a site whose tile changed hands is armed by its
 * new owner and silently dropped from the old one's bucket on the next re-arm.
 */
export function armedSitesForOwner(
  owner: TerritoryOwner,
  tileMap: Map<string, HexTile>,
  sites: Set<string>,
): Set<string> {
  const armed = new Set<string>();
  for (const key of sites) {
    if (tileMap.get(key)?.owner === owner) armed.add(key);
  }
  return armed;
}

/**
 * Expire the orphaned markers on neutral water tiles, then arm the ones standing
 * now. Consume-then-arm in a single pass, so each marker survives exactly one
 * call — one full player turn, since the only caller runs at the player's turn
 * boundary.
 *
 * These markers can never breed a rebel (lake tiles are excluded from spawning),
 * so this only clears them; it is the counterpart to `spawnRebelsForOwner` for
 * tiles that have no owner to sweep them.
 *
 * Callers must clone graveyard/ruins before passing.
 */
export function sweepNeutralMarkers(
  tileMap: Map<string, HexTile>,
  graveyard: Set<string>,
  ruins: Set<string>,
  armedGraveyard: ArmedSites,
  armedRuins: ArmedSites,
): void {
  for (const key of armedGraveyard.get("neutral") ?? []) graveyard.delete(key);
  for (const key of armedRuins.get("neutral") ?? []) ruins.delete(key);
  armedGraveyard.set("neutral", armedSitesForOwner("neutral", tileMap, graveyard));
  armedRuins.set("neutral", armedSitesForOwner("neutral", tileMap, ruins));
}

/**
 * Per-owner variant of rebel spawning. Fires at the start of each owner's
 * turn. Both grave/ruin spawn (75%) and background/spread (2/7.5/10%) are
 * restricted to tiles where tile.owner === owner. Neighbour-rebel counts for
 * spread still read the full global entities map (enemy rebels count).
 *
 * armedGraves / armedRuins are the shared round-start armed sets; this
 * function consumes (deletes) the owner's entries — both from the armed sets
 * and from graveyard/ruins — so each site rolls exactly once and skull markers
 * are cleared after processing.
 *
 * Callers must clone entities/graveyard/ruins before passing.
 */
export function spawnRebelsForOwner(
  owner: TerritoryOwner,
  tileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  graveyard: Set<string>,
  ruins: Set<string>,
  armedGraves: Set<string>,
  armedRuins: Set<string>,
  rng: () => number = Math.random,
  /** When false, armed sites are still consumed and markers still cleared —
   *  they simply never breed. Keeps the bookkeeping running with rebels off. */
  spawnEnabled = true,
): void {
  const preSpread = new Map(entities);

  for (const key of [...armedGraves]) {
    if (tileMap.get(key)?.owner !== owner) continue;
    armedGraves.delete(key);
    if (!graveyard.has(key)) continue;
    graveyard.delete(key);
    if (tileMap.get(key)?.terrain === "lake") continue;
    if (entities.has(key)) continue;
    if (spawnEnabled && rng() < 0.75) entities.set(key, "rebel");
  }
  for (const key of [...armedRuins]) {
    if (tileMap.get(key)?.owner !== owner) continue;
    armedRuins.delete(key);
    if (!ruins.has(key)) continue;
    ruins.delete(key);
    if (tileMap.get(key)?.terrain === "lake") continue;
    if (entities.has(key)) continue;
    if (spawnEnabled && rng() < 0.75) entities.set(key, "rebel");
  }

  if (!spawnEnabled) return;

  for (const tile of tileMap.values()) {
    if (tile.owner !== owner) continue;
    if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
    if (entities.has(tile.key)) continue;
    const [tq, tr] = tile.key.split(",").map(Number);
    const neighborRebelCount = HEX_EDGES.filter(({ dir: [dq, dr] }) => {
      const nk = tileKey(tq + dq, tr + dr);
      return preSpread.get(nk) === "rebel";
    }).length;
    const chance =
      neighborRebelCount >= 2 ? 0.1 : neighborRebelCount === 1 ? 0.075 : 0.02;
    if (rng() < chance) entities.set(tile.key, "rebel");
  }
}

export function initTerritoryBalances(
  tiles: HexTile[],
  tileMap: Map<string, HexTile>,
): Map<string, number> {
  const balances = new Map<string, number>();
  const visited = new Set<string>();
  const owners: TerritoryOwner[] = [
    "player",
    "ai1",
    "ai2",
    "ai3",
    "ai4",
    "ai5",
  ];
  for (const tile of tiles) {
    if (!owners.includes(tile.owner) || visited.has(tile.key)) continue;
    const territory = getContiguousTerritory(tileMap, tile.key, tile.owner);
    const id = getTerritoryId(territory);
    if (!id) continue;
    balances.set(id, territory.length >= 2 ? 10 : 0);
    for (const t of territory) visited.add(t.key);
  }
  return balances;
}

/**
 * Track-aware merge resolution and the single source of truth for whether two
 * units may merge — replacing the old per-unit `unitCanMerge` + strength-only
 * `mergedUnitType`, neither of which could enforce same-track pairing. Returns
 * the merged unit type, or null when the merge is illegal: two units merge only
 * within the same track — both infantry, both cavalry or both ranged, never
 * mixed — and only when their combined tier maps to a unit in that track (so
 * warrior + warrior, scout + knight, etc. all return null). Entities without a
 * unit class (buildings, markers) never merge.
 *
 * Invariant: when non-null, the result's tier equals tierA + tierB, because
 * each TIER_TO_UNIT track maps n to the unit of tier n.
 */
export function mergeResult(a: EntityType, b: EntityType): EntityType | null {
  const ca = ENTITY_META[a].unitClass;
  const cb = ENTITY_META[b].unitClass;
  if (!ca || ca !== cb) return null;
  const total = ENTITY_META[a].tier + ENTITY_META[b].tier;
  return TIER_TO_UNIT[ca][total] ?? null;
}

/** How an armed purchase resolves on one tile of the player's own territory. */
export interface OwnTilePlacement {
  /** The unit this purchase merges into, or null when it is not a merge. */
  mergeInto: EntityType | null;
  /** The purchase overruns a rebel that stands inside our own territory. */
  overwritesRebel: boolean;
  /** The purchase takes an enemy building that lost the strength contest. */
  overwritesBuilding: boolean;
  /** The purchase puts a unit on one of our own bridges. */
  standsOnBridge: boolean;
  /** Nothing legal can be bought here, whatever the balance says. */
  blocked: boolean;
}

/**
 * Whether — and how — the armed entity may be bought onto a tile of the
 * player's own territory. The single source of truth for that rule, shared by
 * the tap handler (which acts on it) and the highlight layer (which draws it);
 * they drifted apart once already, leaving purchase dots on tiles that only
 * error-flash when tapped.
 *
 * Gold, cities and graveyards are deliberately out of scope: the caller owns
 * those, because the highlight layer cannot see all of them.
 */
export function classifyOwnTilePlacement(o: {
  armedEntityId: EntityType;
  occupant: EntityType | undefined;
  tileOwner: TerritoryOwner | undefined;
  terrain: TerrainType;
}): OwnTilePlacement {
  const { armedEntityId, occupant, tileOwner, terrain } = o;
  const armedIsUnit = ENTITY_META[armedEntityId].isUnit;
  const occupantIsAllyUnit =
    !!occupant &&
    occupant !== "rebel" &&
    occupant !== "city" &&
    occupant !== "bridge" &&
    ENTITY_META[occupant].isUnit &&
    tileOwner === "player";
  const mergeInto =
    armedIsUnit && occupantIsAllyUnit ? mergeResult(armedEntityId, occupant) : null;
  const overwritesRebel =
    armedIsUnit && canCapture(armedEntityId) && occupant === "rebel";
  const occupantIsBuilding =
    !!occupant && !ENTITY_META[occupant].isUnit && occupant !== "rebel";
  const overwritesBuilding =
    armedIsUnit &&
    canCapture(armedEntityId) &&
    occupantIsBuilding &&
    tileOwner !== "player" &&
    ENTITY_META[armedEntityId].offStrength >= ENTITY_META[occupant].defStrength;
  const standsOnBridge =
    armedIsUnit && occupant === "bridge" && tileOwner === "player";
  // A lake tile carries a purchase only through a bridge, and only for a unit —
  // an armed bridge is placed through its own path, never this one.
  const lakeBlocked = terrain === "lake" && occupant !== "bridge";
  return {
    mergeInto,
    overwritesRebel,
    overwritesBuilding,
    standsOnBridge,
    blocked:
      lakeBlocked ||
      (!!occupant &&
        !mergeInto &&
        !overwritesRebel &&
        !overwritesBuilding &&
        !standsOnBridge),
  };
}

/**
 * Resolves how a unit's movement budget is recorded at its destination after a
 * move, so a turn can be split into several individual moves up to the unit's
 * max movement (`maxRange`, e.g. 3 for infantry, 5 for cavalry).
 *
 * - Plain move: keep the unit active and store its remaining moves. Only spend
 *   it when no moves are left.
 * - Combat (attacking enemy units, buildings, or capturing an enemy tile):
 *   always spend the unit, regardless of remaining moves. (Charge units that
 *   still have attacks left pass `isCombat: false` so they stay active — the
 *   caller tracks the attack budget separately.)
 * - Merge: never spends on its own; the merged unit keeps the lower of the two
 *   units' remaining moves and is only spent once that hits zero.
 *
 * `remaining` is `null` when the unit is at full range — callers should NOT
 * store a partialMoves entry in that case (absence means "full").
 */
/**
 * Charge ability: a unit with maxAttacks > 1 (cavalry) keeps acting after a
 * combat move instead of being spent, as long as it still has an attack AND
 * movement left. The attack budget is shared with movement — once movement is
 * gone the unit is spent even if attacks remain.
 *
 * This is the single source of truth for charge, shared by the player tap
 * handler and the AI exec, so both sides resolve cavalry charges identically
 * (the original bug was the rebel path drifting from the capture path).
 */
export function isChargeAttack(o: {
  isCombatMove: boolean;
  entity: EntityType;
  attacksUsedSoFar: number;
  remainingAfterMove: number;
}): boolean {
  const maxAttacks = unitMaxAttacks(o.entity);
  return (
    o.isCombatMove &&
    maxAttacks > 1 &&
    o.attacksUsedSoFar + 1 < maxAttacks &&
    o.remainingAfterMove > 0
  );
}

/**
 * Advance the per-turn attack counter when a unit moves from `fromKey` to
 * `toKey`. A combat move increments the count; a non-combat move carries it.
 * The source key is always cleared (so a stale count can't attach to a unit
 * that later lands there). Spent units drop their counter entirely. Returns a
 * new map; shared by the player tap handler and the AI exec.
 */
export function advanceAttacksUsed(o: {
  attacksUsed: Map<string, number>;
  fromKey: string;
  toKey: string;
  isCombatMove: boolean;
  spent: boolean;
}): Map<string, number> {
  const next = new Map(o.attacksUsed);
  const used = next.get(o.fromKey) ?? 0;
  next.delete(o.fromKey);
  if (!o.spent) {
    const now = o.isCombatMove ? used + 1 : used;
    if (now > 0) next.set(o.toKey, now);
  }
  return next;
}

/**
 * Move the "has fired this turn" flag from `fromKey` to `toKey`.
 *
 * Deliberately NOT folded into advanceAttacksUsed: that helper drops a unit's
 * counter when the unit becomes spent, which is harmless for cavalry (a spent
 * cavalry unit cannot act) but would hand a ranged unit a second shot, since
 * a spent bowman may still fire. The flag survives moving and spending, and a
 * merge unions it — otherwise a used shot could be refreshed by merging in a
 * fresh bowman.
 */
export function advanceFired(o: {
  firedUnits: Set<string>;
  fromKey: string;
  toKey: string;
  isMerge: boolean;
}): Set<string> {
  const next = new Set(o.firedUnits);
  const moverFired = next.has(o.fromKey);
  const destFired = o.isMerge && next.has(o.toKey);
  next.delete(o.fromKey);
  if (moverFired || destFired) next.add(o.toKey);
  else next.delete(o.toKey);
  return next;
}

/**
 * Carry the "combat-locked" flag with a unit as it moves from `fromKey` to
 * `toKey`. A unit is combat-locked once it has struck a defender (cavalry, who
 * may then still take one open tile) or finished its combat for the turn
 * (everyone else). The flag follows the unit so cavalry can't strike a second
 * defender after repositioning, and so a stale entry never lingers on the
 * vacated tile. Returns a new set; shared by the player tap handler and the AI.
 */
export function advanceCombatSpent(o: {
  combatSpentUnits: Set<string>;
  fromKey: string;
  toKey: string;
  /** True if this move leaves the unit combat-locked (struck or spent-by-combat). */
  locks: boolean;
}): Set<string> {
  const next = new Set(o.combatSpentUnits);
  const wasLocked = next.has(o.fromKey);
  next.delete(o.fromKey);
  if (wasLocked || o.locks) next.add(o.toKey);
  return next;
}

/**
 * The remaining movement budget of the unit at `key`. A unit with a recorded
 * partial-move count uses that; a spent unit (tracked in `spentUnits` with no
 * partial entry) has 0 remaining; an untouched unit is at full `maxRange`.
 *
 * Used when merging onto an existing unit: the merged unit keeps the LOWER of
 * the two budgets, so merging a fresh unit into a spent one (e.g. one bought
 * into an attack) must not resurrect a movement budget. Shared by the player
 * tap handler and the AI so the two paths cannot drift apart.
 */
export function effectiveRemaining(
  key: string,
  partialMoves: Map<string, number>,
  spentUnits: Set<string>,
  maxRange: number,
): number {
  const pm = partialMoves.get(key);
  if (pm !== undefined) return pm;
  return spentUnits.has(key) ? 0 : maxRange;
}

export function resolveMovedUnitMoves(o: {
  isMerge: boolean;
  isCombat: boolean;
  remainingAfterMove: number;
  destRemaining: number;
  maxRange: number;
}): { spent: boolean; remaining: number | null } {
  if (o.isMerge) {
    const merged = Math.min(o.remainingAfterMove, o.destRemaining);
    if (merged <= 0) return { spent: true, remaining: null };
    return { spent: false, remaining: merged < o.maxRange ? merged : null };
  }
  if (o.isCombat || o.remainingAfterMove <= 0) {
    return { spent: true, remaining: null };
  }
  return {
    spent: false,
    remaining: o.remainingAfterMove < o.maxRange ? o.remainingAfterMove : null,
  };
}

/**
 * The single rule for whether an improvement may be built on a tile. Consumed
 * by the Build ribbon, the tile-tap handler and the AI's improve helper, so all
 * three agree: the ribbon can never offer something the tap handler refuses.
 *
 * Not covered here: the round-1 lock (a ribbon-level gate, like every other
 * buildable) and territory ownership (callers pass tiles from their own
 * territory).
 */
export function canImproveTile(o: {
  /** The tile's current terrain. */
  terrain: TerrainType;
  /** The improvement being built, identified by the terrain it produces. */
  targetTerrain: TerrainType;
  /** The territory's gold balance. */
  balance: number;
  /**
   * The city that would pay for this improvement — from findImproveAnchor.
   * Null means no city of the territory covers the tile, or every covering
   * city has already built this turn.
   */
  anchor: string | null;
  /** Whether the tile itself is a city. */
  isCity: boolean;
  /** The entity standing on the tile, if any. */
  occupantEntity: EntityType | undefined;
}): boolean {
  if (o.anchor === null) return false;
  if (o.isCity) return false;
  // A friendly unit occupies the terrain, it does not consume it — improving
  // under a unit is allowed and does not spend that unit. Buildings and rebels
  // block.
  if (o.occupantEntity && !ENTITY_META[o.occupantEntity].isUnit) return false;
  if (o.occupantEntity === "rebel") return false;
  if (improveTargetFor(o.terrain) !== o.targetTerrain) return false;
  return o.balance >= improveCostFor(o.targetTerrain);
}

/**
 * The cities of `cities` that stand on tiles `owner` holds. The `cities` set is
 * global — it holds every city on the board regardless of owner — so the
 * founding distance rule, which only counts the owner's own cities, has to
 * filter it through the tile map first.
 */
export function ownCityKeys(
  cities: Iterable<string>,
  tileMap: Map<string, HexTile>,
  owner: TerritoryOwner,
): string[] {
  const out: string[] = [];
  for (const key of cities) {
    if (tileMap.get(key)?.owner === owner) out.push(key);
  }
  return out;
}

/**
 * Whether a city may be founded on `targetKey`. Covers the two spatial rules
 * only — one city per TILES_PER_CITY tiles of the paying territory, and at
 * least MIN_OWN_CITY_DISTANCE from every city the owner already holds.
 * Occupancy, terrain and gold stay with the callers that already check them
 * (classifyOwnTilePlacement, playerCanAfford), exactly as before.
 */
export function canFoundCity(o: {
  targetKey: string;
  /** Tiles in the contiguous territory paying for the city. */
  territoryTileCount: number;
  /** Cities already inside that territory, however they were acquired. */
  territoryCityCount: number;
  /** Every city this owner holds, anywhere on the map. */
  ownCityKeys: Iterable<string>;
}): boolean {
  if (o.territoryCityCount >= cityCapFor(o.territoryTileCount)) return false;
  const [q, r] = o.targetKey.split(",").map(Number);
  for (const key of o.ownCityKeys) {
    const [cq, cr] = key.split(",").map(Number);
    if (hexDistance(q, r, cq, cr) < MIN_OWN_CITY_DISTANCE) return false;
  }
  return true;
}

/**
 * Every tile of `territory` where this owner may found a city. Evaluates the
 * cap once and then walks the territory a single time, so the cost is
 * O(territory x own cities) per call rather than per candidate tile — the
 * expert search asks for this once per candidate-generation pass.
 */
export function foundCitySites(
  territory: HexTile[],
  territoryCityCount: number,
  ownCities: Iterable<string>,
): Set<string> {
  const out = new Set<string>();
  if (territoryCityCount >= cityCapFor(territory.length)) return out;
  const cityCoords = [...ownCities].map((k) => k.split(",").map(Number) as [number, number]);
  for (const tile of territory) {
    let blocked = false;
    for (const [cq, cr] of cityCoords) {
      if (hexDistance(tile.q, tile.r, cq, cr) < MIN_OWN_CITY_DISTANCE) {
        blocked = true;
        break;
      }
    }
    if (!blocked) out.add(tile.key);
  }
  return out;
}

/**
 * Which city would pay for an improvement on a tile.
 *
 * `inRange` exists so the UI can tell the two failure modes apart: no city
 * covers the tile at all, versus every covering city has already built this
 * turn.
 */
export interface ImproveAnchor {
  /** Nearest covering city that has not built this turn, or null. */
  anchor: string | null;
  /** Whether any city of the territory covers the tile at all. */
  inRange: boolean;
}

/**
 * Resolves both the zone rule and the one-improvement-per-city-per-turn rule at
 * once: a tile is improvable when a city of the SAME territory stands within
 * CITY_IMPROVE_RADIUS and has not built this turn. Overlapping zones are a real
 * benefit — the nearest unused city pays, so two cities three tiles apart allow
 * two improvements in their shared area in one turn. Ties between equally
 * distant unused cities go to the lower tile key, so the choice is
 * deterministic and testable.
 */
export function findImproveAnchor(o: {
  tileKey: string;
  /** Keys of the cities inside the same territory. */
  territoryCityKeys: Iterable<string>;
  /** Cities of this owner that already paid for an improvement this turn. */
  usedCities: ReadonlySet<string>;
}): ImproveAnchor {
  const [q, r] = o.tileKey.split(",").map(Number);
  let anchor: string | null = null;
  let bestDist = Infinity;
  let inRange = false;
  for (const key of o.territoryCityKeys) {
    const [cq, cr] = key.split(",").map(Number);
    const dist = hexDistance(q, r, cq, cr);
    if (dist > CITY_IMPROVE_RADIUS) continue;
    inRange = true;
    if (o.usedCities.has(key)) continue;
    // A tie can only occur once an anchor is set, so `anchor` is non-null
    // whenever the second clause is reached.
    if (dist < bestDist || (dist === bestDist && key < anchor!)) {
      bestDist = dist;
      anchor = key;
    }
  }
  return { anchor, inRange };
}

/**
 * Gross per-turn income of a single tile: terrain income, plus CITY_BONUS when
 * the tile is a city, plus the city-adjacency field bonus (+1 per adjacent
 * owned city for a Field tile only). `isOwnedCityNeighbor` decides whether a
 * neighbouring city counts as same-owner — callers supply the appropriate check
 * (tileMap owner comparison in the real economy, a same-territory key set in the
 * UI breakdown). Sharing this with calcTerritoryIncome keeps the rebel-loss
 * offset and the actual income formula from drifting apart.
 */
export function tileEconomicIncome(
  tile: HexTile,
  cities: Set<string>,
  isOwnedCityNeighbor: (neighborKey: string) => boolean,
): number {
  let income = (TERRAIN_INCOME[tile.terrain] ?? 0) + (cities.has(tile.key) ? CITY_BONUS : 0);
  // Only Fields earn the city-adjacency bonus (+1 per neighbouring owned city).
  if (tile.terrain === "field") {
    const [q, r] = tile.key.split(",").map(Number);
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(q + dq, r + dr);
      if (cities.has(nk) && isOwnedCityNeighbor(nk)) income += 1;
    }
  }
  return income;
}

/**
 * Single source of truth for a territory's per-turn income. Sums each non-rebel
 * tile's gross income (see tileEconomicIncome) — a rebel on a tile denies that
 * tile's ENTIRE income, terrain + city bonus + adjacency. Centralizing this
 * avoids the income formula drifting across the ~8 sites that previously inlined it.
 */
export function calcTerritoryIncome(
  territory: HexTile[],
  entities: Map<string, EntityType>,
  cities: Set<string>,
  tileMap: Map<string, HexTile>,
): number {
  let income = 0;
  for (const t of territory) {
    if (entities.get(t.key) === "rebel") continue;
    income += tileEconomicIncome(t, cities, (nk) => tileMap.get(nk)?.owner === t.owner);
  }
  return income;
}

/**
 * Auto-place the free round-1 tower for every eligible player territory,
 * using the same scoring heuristic as the AI: prefer the tile whose 6
 * neighbours contain the most player-owned tiles (maximises defensive coverage).
 *
 * Returns new Maps; the caller is responsible for committing them to React state
 * and recording undo history before calling this.
 */
export function autoDeployFreeTowers(
  activeTileMap: Map<string, HexTile>,
  entities: Map<string, EntityType>,
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>,
  graveyard: Set<string>,
  cities: Set<string>,
): {
  newEntities: Map<string, EntityType>;
  newFreeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
} {
  const newEntities = new Map(entities);
  const playerUsed = new Set(freeTowerUsedTiles.get("player") ?? []);
  const newFreeTowerUsedTiles = new Map(freeTowerUsedTiles);

  const visited = new Set<string>();
  for (const tile of activeTileMap.values()) {
    if (tile.owner !== "player" || visited.has(tile.key)) continue;
    const territory = getContiguousTerritory(activeTileMap, tile.key, "player", newEntities);
    for (const t of territory) visited.add(t.key);

    if (territory.length < 2) continue;
    if (territory.some((t) => playerUsed.has(t.key))) continue;

    const candidates = territory.filter(
      (t) =>
        t.terrain !== "mountain" &&
        t.terrain !== "lake" &&
        !newEntities.has(t.key) &&
        !cities.has(t.key) &&
        !graveyard.has(t.key),
    );
    if (candidates.length === 0) continue;

    const score = (key: string): number => {
      const [cq, cr] = key.split(",").map(Number);
      let n = 0;
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(cq + dq, cr + dr);
        if (activeTileMap.get(nk)?.owner === "player") n++;
      }
      return n;
    };

    const best = candidates.reduce(
      (b, c) => (score(c.key) > score(b.key) ? c : b),
      candidates[0],
    );

    newEntities.set(best.key, "tower");
    for (const t of territory) playerUsed.add(t.key);
  }

  newFreeTowerUsedTiles.set("player", playerUsed);
  return { newEntities, newFreeTowerUsedTiles };
}
