import { useMemo, useRef } from "react";
import type { BorderEdge, EntityType, HexTile, TerritoryOwner } from "@/types";
import { HEX_EDGES, tileKey } from "@/utils/hexMath";
import {
  ENTITY_META,
  getContiguousTerritory,
  getTerritoryId,
  getValidMoves,
  getMaxEnemyZoC,
  unitMovement,
  unitCanMerge,
  isCavalry,
  cavalryMoveKind,
} from "@/utils/hexGrid";
import { computeSelectionBorderEdges } from "@/utils/borderEdges";

interface SelectionStateParams {
  selectedTileKey: string | null;
  selectedEntityKey: string | null;
  armedEntityId: EntityType | null;
  activeTileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  spentUnits: Set<string>;
  combatSpentUnits: Set<string>;
  partialMoves: Map<string, number>;
  territoryBalances: Map<string, number>;
  cities: Set<string>;
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
  activeTileMap,
  entities,
  spentUnits,
  combatSpentUnits,
  partialMoves,
  territoryBalances,
  cities,
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
    const movingStrength = ENTITY_META[entityId].strength;
    const remaining = partialMoves.get(selectedEntityKey) ?? unitMovement(entityId);
    const raw = getValidMoves(
      selectedEntityKey,
      "player",
      entities,
      activeTileMap,
      spentUnits,
      remaining,
      combatSpentUnits,
    );
    // Remove ally unit tiles that aren't a legal merge target: combined strength > 3,
    // dest is combat-spent, or either unit can't merge (e.g. cavalry). Landing on an
    // ally that can't be merged with would otherwise overwrite it.
    for (const k of raw) {
      const destTile = activeTileMap.get(k);
      if (destTile?.owner !== "player") continue;
      const destEntity = entities.get(k);
      if (!destEntity || !ENTITY_META[destEntity].isUnit) continue;
      const legalMerge =
        unitCanMerge(entityId) &&
        unitCanMerge(destEntity) &&
        movingStrength + ENTITY_META[destEntity].strength <= 3 &&
        !combatSpentUnits.has(k);
      if (!legalMerge) raw.delete(k);
    }
    return raw;
  }, [
    selectedEntityKey,
    entities,
    activeTileMap,
    spentUnits,
    partialMoves,
    combatSpentUnits,
  ]);

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

  const validPlacementAttackTiles = useMemo<Set<string>>(() => {
    if (!armedEntityId) return new Set();
    const meta = ENTITY_META[armedEntityId];
    if (!meta.isUnit) return new Set();
    const result = new Set<string>();
    for (const tile of selectedTerritory) {
      if (tile.terrain === "mountain") continue;
      if (tile.terrain === "lake" && entities.get(tile.key) !== "bridge") continue;
      const [q, r] = tile.key.split(",").map(Number);
      for (const {
        dir: [dq, dr],
      } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (selectedTileKeys.has(nk)) continue;
        const neighbor = activeTileMap.get(nk);
        if (!neighbor) continue;
        if (neighbor.terrain === "mountain") continue;
        if (neighbor.terrain === "lake" && entities.get(nk) !== "bridge") continue;
        const existingEntity = entities.get(nk);
        // Cavalry can never assault a fortification, even when buying into combat.
        if (isCavalry(armedEntityId) && cavalryMoveKind(existingEntity) === "building")
          continue;
        if (existingEntity && existingEntity !== "rebel") {
          // buildings with higher strength can't be captured
          if (
            !ENTITY_META[existingEntity].isUnit &&
            meta.strength < ENTITY_META[existingEntity].strength
          )
            continue;
        }
        const enemyZoC = getMaxEnemyZoC(nk, "player", entities, activeTileMap);
        if (meta.strength > enemyZoC) result.add(nk);
      }
    }
    return result;
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

  const territoryHasCity = useMemo(
    () => selectedTerritory.some((t) => cities.has(t.key)),
    [selectedTerritory, cities],
  );

  const selectionBorderEdges = useMemo<BorderEdge[]>(
    () => computeSelectionBorderEdges(selectedTileKeys, tileDataMap, tileMap, INNER_SIZE, BORDER_W),
    [selectedTileKeys, tileDataMap, tileMap, INNER_SIZE],
  );

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
    fortificationDots,
    validBridgePlacementTiles,
    hasBridgePlacementAvailable,
    validPlacementAttackTiles,
    minUnitCost,
    territoryHasCity,
    selectionBorderEdges,
    affordableTerritoryTileKeys,
  };
}
