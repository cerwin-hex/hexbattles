import { useMemo, useRef } from "react";
import type { BorderEdge, EntityType, HexTile, TerrainType, TerritoryOwner } from "@/types";
import { HEX_EDGES, tileKey } from "@/utils/hexMath";
import {
  ENTITY_META,
  IMPROVEMENTS,
  getContiguousTerritory,
  getTerritoryId,
  getValidMoves,
  getPlacementAttackTiles,
  improveTargetFor,
  unitMovement,
} from "@/utils/hexGrid";
import {
  canImproveTile,
  findImproveAnchor,
  foundCitySites,
  mergeResult,
  ownCityKeys,
} from "@/logic/gameLogic";
import { rangedTargets } from "@/logic/rangedAttack";
import { computeSelectionBorderEdges } from "@/utils/borderEdges";
import { SELECTED_UNIT_RING } from "@/constants/colors";

// One shared instance for the "nothing armed" case. MovementHighlightLayer is
// React.memo'd with an identity-based equality function, so returning a fresh
// `new Set()` on every render would defeat its memoization and redraw the SVG
// layer on every state change.
const EMPTY_TILE_SET: Set<string> = new Set();

// Stands in for "some city could pay" when asking canImproveTile about every
// condition EXCEPT the anchor. It is never used as a real city key — the
// predicate only distinguishes null from non-null.
const ANCHOR_PROBE = "anchor-probe";

interface SelectionStateParams {
  selectedTileKey: string | null;
  selectedEntityKey: string | null;
  armedEntityId: EntityType | null;
  armedImprovement: TerrainType | null;
  activeTileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  spentUnits: Set<string>;
  combatSpentUnits: Set<string>;
  partialMoves: Map<string, number>;
  firedUnits: Set<string>;
  territoryBalances: Map<string, number>;
  cities: Set<string>;
  improvedCities: Set<string>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  isAiTurn: boolean;
  gameResult: unknown;
  turn: number;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  tileMap: Map<string, HexTile>;
  INNER_SIZE: number;
  BORDER_W: number;
}

export function useSelectionState({
  selectedTileKey,
  selectedEntityKey,
  armedEntityId,
  armedImprovement,
  activeTileMap,
  entities,
  spentUnits,
  combatSpentUnits,
  partialMoves,
  firedUnits,
  territoryBalances,
  cities,
  improvedCities,
  freeTowerUsedTiles,
  isAiTurn,
  gameResult,
  turn,
  tileDataMap,
  tileMap,
  INNER_SIZE,
  BORDER_W,
}: SelectionStateParams) {
  const selectedTerritory = useMemo<HexTile[]>(() => {
    if (!selectedTileKey) return [];
    const tile = activeTileMap.get(selectedTileKey);
    if (!tile || tile.owner !== "player") return [];
    return getContiguousTerritory(activeTileMap, selectedTileKey, "player", entities);
  }, [selectedTileKey, activeTileMap, entities]);

  const selectedTerritoryId = useMemo<string | null>(
    () => getTerritoryId(selectedTerritory),
    [selectedTerritory],
  );

  const selectedTerritoryBalance = useMemo<number>(() => {
    if (selectedTerritoryId) {
      return territoryBalances.get(selectedTerritoryId) ?? 0;
    }
    let max = 0;
    for (const v of territoryBalances.values()) {
      if (v > max) max = v;
    }
    return max;
  }, [selectedTerritoryId, territoryBalances]);

  const selectedTileKeys = useMemo<Set<string>>(
    () => new Set(selectedTerritory.map((t) => t.key)),
    [selectedTerritory],
  );

  const selectedTerritoryDefenseCounts = useMemo<{ tower: number; castle: number }>(() => {
    let tower = 0, castle = 0;
    for (const t of selectedTerritory) {
      const e = entities.get(t.key);
      if (e === "tower") tower++;
      else if (e === "castle") castle++;
    }
    return { tower, castle };
  }, [selectedTerritory, entities]);

  const validMoveTiles = useMemo<Set<string>>(() => {
    if (!selectedEntityKey) return new Set();
    const tile = activeTileMap.get(selectedEntityKey);
    if (!tile || tile.owner !== "player") return new Set();
    const entityId = entities.get(selectedEntityKey);
    if (!entityId || !ENTITY_META[entityId].isUnit) return new Set();
    const remaining = partialMoves.get(selectedEntityKey) ?? unitMovement(entityId);
    const raw = getValidMoves(
      selectedEntityKey,
      "player",
      entities,
      activeTileMap,
      spentUnits,
      cities,
      remaining,
      combatSpentUnits,
    );
    // Remove ally unit tiles that aren't a legal merge target: no valid merge
    // result (combined strength too high, or cross-track e.g. cavalry + infantry)
    // or the destination is combat-spent. Landing on an ally that can't be merged
    // with would otherwise overwrite it.
    for (const k of raw) {
      const destTile = activeTileMap.get(k);
      if (destTile?.owner !== "player") continue;
      const destEntity = entities.get(k);
      if (!destEntity || !ENTITY_META[destEntity].isUnit) continue;
      const legalMerge =
        mergeResult(entityId, destEntity) !== null &&
        !combatSpentUnits.has(k);
      if (!legalMerge) raw.delete(k);
    }
    return raw;
  }, [
    selectedEntityKey,
    entities,
    activeTileMap,
    spentUnits,
    cities,
    partialMoves,
    combatSpentUnits,
  ]);

  // The adjacent enemy tiles the selected unit may shoot right now. Empty for
  // anything that is not a player-owned ranged unit with its shot still
  // available; rangedTargets applies those rules.
  const validRangedTargets = useMemo<Set<string>>(() => {
    if (!selectedEntityKey) return EMPTY_TILE_SET;
    if (activeTileMap.get(selectedEntityKey)?.owner !== "player")
      return EMPTY_TILE_SET;
    const targets = rangedTargets({
      shooterKey: selectedEntityKey,
      owner: "player",
      entities,
      tileMap: activeTileMap,
      firedUnits,
    });
    // Collapse the empty result (every non-ranged unit, which is the common
    // case) onto the shared instance rather than a fresh Set, so selecting or
    // moving an ordinary unit doesn't hand the memoized SVG layers a new
    // identity and force a redraw.
    return targets.size > 0 ? targets : EMPTY_TILE_SET;
  }, [selectedEntityKey, entities, activeTileMap, firedUnits]);

  const fortificationDots = useMemo<Set<string>>(() => {
    let territory: HexTile[];
    if (selectedEntityKey) {
      const selEntity = entities.get(selectedEntityKey);
      if (!selEntity || ENTITY_META[selEntity].isUnit || selEntity === "city" || selEntity === "bridge")
        return new Set();
      territory = getContiguousTerritory(
        activeTileMap,
        selectedEntityKey,
        "player",
        entities,
      );
    } else if (
      armedEntityId &&
      !ENTITY_META[armedEntityId].isUnit &&
      armedEntityId !== "city" &&
      armedEntityId !== "bridge"
    ) {
      territory = selectedTerritory;
    } else {
      return new Set();
    }
    const territoryKeys = new Set(territory.map((t) => t.key));
    const dots = new Set<string>();
    for (const t of territory) {
      const e = entities.get(t.key);
      if (!e || ENTITY_META[e].isUnit || e === "city" || e === "rebel" || e === "bridge")
        continue;
      dots.add(t.key);
      const [q, r] = t.key.split(",").map(Number);
      for (const {
        dir: [dq, dr],
      } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (territoryKeys.has(nk)) dots.add(nk);
      }
    }
    return dots;
  }, [
    selectedEntityKey,
    armedEntityId,
    selectedTerritory,
    entities,
    activeTileMap,
  ]);

  const validBridgePlacementTiles = useMemo<Set<string>>(() => {
    if (armedEntityId !== "bridge") return new Set();
    const result = new Set<string>();
    for (const tile of selectedTerritory) {
      const [q, r] = tile.key.split(",").map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (selectedTileKeys.has(nk)) continue;
        const neighbor = activeTileMap.get(nk);
        if (!neighbor || neighbor.terrain !== "lake") continue;
        if (entities.has(nk)) continue;
        result.add(nk);
      }
    }
    return result;
  }, [armedEntityId, selectedTerritory, selectedTileKeys, activeTileMap, entities]);

  const hasBridgePlacementAvailable = useMemo<boolean>(() => {
    for (const tile of selectedTerritory) {
      const [q, r] = tile.key.split(",").map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (selectedTileKeys.has(nk)) continue;
        const neighbor = activeTileMap.get(nk);
        if (!neighbor || neighbor.terrain !== "lake") continue;
        if (entities.has(nk)) continue;
        return true;
      }
    }
    return false;
  }, [selectedTerritory, selectedTileKeys, activeTileMap, entities]);

  // The cities of the selected territory. Both improvement helpers need the
  // keys rather than a yes/no, since the zone and the per-turn allowance are
  // resolved per city.
  const territoryCityKeys = useMemo<string[]>(
    () => selectedTerritory.filter((t) => cities.has(t.key)).map((t) => t.key),
    [selectedTerritory, cities],
  );

  // Every tile of the selected territory where a city may be founded. NOT
  // gated on a city being armed: the ribbon needs it to decide whether to
  // offer the City item at all, and only the highlight layer restricts its use
  // to the armed case.
  const validCitySites = useMemo<Set<string>>(
    () =>
      foundCitySites(
        selectedTerritory,
        territoryCityKeys.length,
        ownCityKeys(cities, activeTileMap, "player"),
      ),
    [selectedTerritory, territoryCityKeys, cities, activeTileMap],
  );

  // Every tile of the selected territory where the armed improvement may be
  // built. Empty when no improvement is armed, so arming Field lights up only
  // grass tiles rather than the whole territory.
  const validImprovementTiles = useMemo<Set<string>>(() => {
    if (!armedImprovement) return EMPTY_TILE_SET;
    const result = new Set<string>();
    for (const tile of selectedTerritory) {
      const { anchor } = findImproveAnchor({
        tileKey: tile.key,
        territoryCityKeys,
        usedCities: improvedCities,
      });
      if (
        canImproveTile({
          terrain: tile.terrain,
          targetTerrain: armedImprovement,
          balance: selectedTerritoryBalance,
          anchor,
          isCity: cities.has(tile.key),
          occupantEntity: entities.get(tile.key),
        })
      )
        result.add(tile.key);
    }
    return result;
  }, [
    armedImprovement,
    selectedTerritory,
    selectedTerritoryBalance,
    territoryCityKeys,
    improvedCities,
    cities,
    entities,
  ]);

  // Whether the territory holds at least one tile each improvement could be
  // built on, ignoring gold, plus why not when it does not: `inRange` false
  // means no city covers a candidate tile, `inRange` true with `available`
  // false means every covering city has already built this turn. An
  // unaffordable item dims with its price showing, which is the ribbon's
  // existing convention, but an item with no possible target says so instead.
  const improvementAvailability = useMemo<
    Map<TerrainType, { available: boolean; inRange: boolean }>
  >(() => {
    const result = new Map<TerrainType, { available: boolean; inRange: boolean }>();
    for (const imp of IMPROVEMENTS) {
      let available = false;
      let inRange = false;
      for (const tile of selectedTerritory) {
        if (improveTargetFor(tile.terrain) !== imp.target) continue;
        // Ask first whether the anchor is the ONLY thing that could still
        // block this tile. Without this, a tile that is really blocked by a
        // building, a rebel, or by being the city itself would still count
        // towards `inRange` and make the ribbon claim "Cities used" when no
        // city has built. ANCHOR_PROBE stands in for "some city is free", so
        // canImproveTile reports on every other condition.
        if (
          !canImproveTile({
            terrain: tile.terrain,
            targetTerrain: imp.target,
            balance: imp.cost,
            anchor: ANCHOR_PROBE,
            isCity: cities.has(tile.key),
            occupantEntity: entities.get(tile.key),
          })
        )
          continue;
        const a = findImproveAnchor({
          tileKey: tile.key,
          territoryCityKeys,
          usedCities: improvedCities,
        });
        if (a.inRange) inRange = true;
        if (a.anchor !== null) {
          available = true;
          break;
        }
      }
      result.set(imp.target, { available, inRange });
    }
    return result;
  }, [selectedTerritory, territoryCityKeys, improvedCities, cities, entities]);

  const validPlacementAttackTiles = useMemo<Set<string>>(() => {
    if (!armedEntityId) return new Set();
    return getPlacementAttackTiles(
      armedEntityId,
      selectedTerritory,
      selectedTileKeys,
      activeTileMap,
      entities,
    );
  }, [
    armedEntityId,
    selectedTerritory,
    selectedTileKeys,
    activeTileMap,
    entities,
  ]);

  const minUnitCost = useMemo(() => {
    return Math.min(
      ...Object.values(ENTITY_META)
        .filter((m) => m.isUnit)
        .map((m) => m.cost),
    );
  }, []);

  const selectionBorderEdges = useMemo<BorderEdge[]>(
    () => computeSelectionBorderEdges(selectedTileKeys, tileDataMap, tileMap, INNER_SIZE, BORDER_W),
    [selectedTileKeys, tileDataMap, tileMap, INNER_SIZE],
  );

  // A light-green outline around the single tile of a selected building (tower,
  // castle, bridge) — the same hue as the selected-unit ring. Independent of the
  // territory selection: bridges can sit on a lake tile that yields no
  // contiguous territory, so this keys off `selectedEntityKey` directly.
  const buildingSelectionEdges = useMemo<BorderEdge[]>(() => {
    if (!selectedEntityKey) return [];
    const e = entities.get(selectedEntityKey);
    if (!e || ENTITY_META[e].isUnit || e === "city" || e === "rebel") return [];
    return computeSelectionBorderEdges(
      new Set([selectedEntityKey]),
      tileDataMap,
      tileMap,
      INNER_SIZE,
      BORDER_W,
      SELECTED_UNIT_RING,
    );
  }, [selectedEntityKey, entities, tileDataMap, tileMap, INNER_SIZE, BORDER_W]);

  const affordableTerritoryCache = useRef<{
    activeTileMap: Map<string, HexTile>;
    entities: Map<string, EntityType>;
    territoryBalances: Map<string, number>;
    freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
    isAiTurn: boolean;
    gameResult: unknown;
    turn: number;
    result: Set<string>;
  } | null>(null);

  const affordableTerritoryTileKeys = useMemo<Set<string>>(() => {
    if (isAiTurn || gameResult !== null) return new Set();
    const cached = affordableTerritoryCache.current;
    if (
      cached &&
      cached.activeTileMap === activeTileMap &&
      cached.entities === entities &&
      cached.territoryBalances === territoryBalances &&
      cached.freeTowerUsedTiles === freeTowerUsedTiles &&
      cached.isAiTurn === isAiTurn &&
      cached.gameResult === gameResult &&
      cached.turn === turn
    )
      return cached.result;
    const keys = new Set<string>();
    const visited = new Set<string>();
    const playerFreeTowerUsed =
      freeTowerUsedTiles.get("player") ?? new Set<string>();
    for (const tile of Array.from(activeTileMap.values())) {
      if (tile.owner !== "player" || visited.has(tile.key)) continue;
      const territory = getContiguousTerritory(
        activeTileMap,
        tile.key,
        "player",
        entities,
      );
      for (const t of territory) visited.add(t.key);
      const id = getTerritoryId(territory);
      if (!id) continue;
      const balance = territoryBalances.get(id) ?? 0;
      const towerFree =
        territory.length >= 2 &&
        !territory.some((t) => playerFreeTowerUsed.has(t.key));
      // In round 1, only the free tower can be placed — balance spending is locked
      const canAfford = turn === 1 ? towerFree : balance >= minUnitCost;
      if (!canAfford) continue;
      for (const t of territory) keys.add(t.key);
    }
    affordableTerritoryCache.current = {
      activeTileMap,
      entities,
      territoryBalances,
      freeTowerUsedTiles,
      isAiTurn,
      gameResult,
      turn,
      result: keys,
    };
    return keys;
  }, [
    activeTileMap,
    entities,
    territoryBalances,
    minUnitCost,
    freeTowerUsedTiles,
    isAiTurn,
    gameResult,
    turn,
  ]);

  return {
    selectedTerritory,
    selectedTerritoryId,
    selectedTerritoryBalance,
    selectedTileKeys,
    selectedTerritoryDefenseCounts,
    validMoveTiles,
    validRangedTargets,
    fortificationDots,
    validBridgePlacementTiles,
    hasBridgePlacementAvailable,
    validImprovementTiles,
    improvementAvailability,
    validPlacementAttackTiles,
    minUnitCost,
    territoryCityKeys,
    validCitySites,
    selectionBorderEdges,
    buildingSelectionEdges,
    affordableTerritoryTileKeys,
  };
}
