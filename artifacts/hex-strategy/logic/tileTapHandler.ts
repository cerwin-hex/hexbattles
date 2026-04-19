import type { Dispatch, SetStateAction } from "react";
import type { EntityType, HexTile, TerritoryOwner } from "@/types";
import { ENTITY_META, getContiguousTerritory, getTerritoryId, getMoveCost } from "@/utils/hexGrid";
import {
  applySingleHexPenalty,
  mergedUnitType,
} from "@/logic/gameLogic";
import {
  recalculateTerritories,
  recalculateTerritoriesForCapture,
} from "@/utils/hexGrid";

export interface PendingLakeMove {
  fromKey: string;
  toKey: string;
  sourceTerrId: string;
  maxAmount: number;
  minAmount: number;
}

export interface TileTapParams {
  key: string;
  lastTileTapMs: { current: number };
  isAiTurn: boolean;
  gameResult: unknown;
  activeTileMap: Map<string, HexTile>;
  selectedEntityKey: string | null;
  validMoveTiles: Set<string>;
  armedEntityId: EntityType | null;
  selectedTileKeys: Set<string>;
  selectedTerritoryId: string | null;
  selectedTerritory: HexTile[];
  entities: Map<string, EntityType>;
  territoryBalances: Map<string, number>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  turn: number;
  graveyard: Set<string>;
  ruins: Set<string>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  lakeUnitFunds: Map<string, number>;
  combatSpentUnits: Set<string>;
  spentUnits: Set<string>;
  partialMoves: Map<string, number>;
  validPlacementAttackTiles: Set<string>;
  ribbonOpen: boolean;
  cities: Set<string>;
  setMutableTileMap: (m: Map<string, HexTile>) => void;
  setLiveOwnerMap: (m: Map<string, TerritoryOwner>) => void;
  setEntities: (m: Map<string, EntityType>) => void;
  setSpentUnits: Dispatch<SetStateAction<Set<string>>>;
  setCombatSpentUnits: (s: Set<string>) => void;
  setPartialMoves: (m: Map<string, number>) => void;
  setTerritoryBalances: Dispatch<SetStateAction<Map<string, number>>>;
  setLakeUnitFunds: (m: Map<string, number>) => void;
  setSelectedEntityKey: (k: string | null) => void;
  setSelectedTileKey: (k: string | null) => void;
  setGraveyard: (s: Set<string>) => void;
  setRuins: (s: Set<string>) => void;
  setArmedEntityId: (id: EntityType | null) => void;
  setFreeTowerUsedTiles: Dispatch<SetStateAction<Map<TerritoryOwner, Set<string>>>>;
  setLakeTransferAmount: (n: number) => void;
  setPendingLakeMove: (p: PendingLakeMove | null) => void;
  setCities: Dispatch<SetStateAction<Set<string>>>;
  checkWinLoss: (map: Map<string, HexTile>) => void;
  pushHistory: () => void;
  triggerErrorFlash: (key: string) => void;
  triggerUnitAnimation: (from: string, to: string, entity: EntityType) => void;
  closeRibbon: () => void;
}

export function handleTileTapLogic(params: TileTapParams): void {
  const {
    key,
    lastTileTapMs,
    isAiTurn,
    gameResult,
    activeTileMap,
    selectedEntityKey,
    validMoveTiles,
    armedEntityId,
    selectedTileKeys,
    selectedTerritoryId,
    selectedTerritory,
    entities,
    territoryBalances,
    freeTowerUsedTiles,
    turn,
    graveyard,
    ruins,
    liveOwnerMap,
    lakeUnitFunds,
    combatSpentUnits,
    spentUnits,
    partialMoves,
    validPlacementAttackTiles,
    ribbonOpen,
    cities,
    setMutableTileMap,
    setLiveOwnerMap,
    setEntities,
    setSpentUnits,
    setCombatSpentUnits,
    setPartialMoves,
    setTerritoryBalances,
    setLakeUnitFunds,
    setSelectedEntityKey,
    setSelectedTileKey,
    setGraveyard,
    setRuins,
    setArmedEntityId,
    setFreeTowerUsedTiles,
    setLakeTransferAmount,
    setPendingLakeMove,
    setCities,
    checkWinLoss,
    pushHistory,
    triggerErrorFlash,
    triggerUnitAnimation,
    closeRibbon,
  } = params;

  const now = Date.now();
  if (now - lastTileTapMs.current < 50) return;
  lastTileTapMs.current = now;
  if (isAiTurn || gameResult !== null) return;
  const tile = activeTileMap.get(key);

  if (selectedEntityKey && validMoveTiles.has(key)) {
    const targetTile = activeTileMap.get(key);
    const movingToLake = targetTile?.terrain === "lake";
    const fromTile = activeTileMap.get(selectedEntityKey);
    const fromLake = fromTile?.terrain === "lake";

    if (movingToLake && !fromLake) {
      const sourceTerritory = getContiguousTerritory(
        activeTileMap,
        selectedEntityKey,
        "player",
      );
      const sourceTerrId = getTerritoryId(sourceTerritory);
      if (!sourceTerrId) return;
      const sourceBalance = territoryBalances.get(sourceTerrId) ?? 0;
      const movingEntityType = entities.get(selectedEntityKey);
      const minAmount = movingEntityType
        ? ENTITY_META[movingEntityType].upkeep * 2
        : 2;
      if (sourceBalance < minAmount) {
        triggerErrorFlash(key);
        return;
      }
      setLakeTransferAmount(minAmount);
      setPendingLakeMove({
        fromKey: selectedEntityKey,
        toKey: key,
        sourceTerrId,
        maxAmount: sourceBalance,
        minAmount,
      });
      return;
    }

    const movingEntityId = entities.get(selectedEntityKey);
    const fromKeyForAnim = selectedEntityKey;

    pushHistory();
    const prevTile = activeTileMap.get(key);
    const previousOwner = prevTile?.owner ?? "neutral";
    const newTileMap = new Map(activeTileMap);
    if (targetTile) {
      newTileMap.set(key, { ...targetTile, owner: "player" });
    }
    const newEntities = new Map(entities);
    const movingUnit = newEntities.get(selectedEntityKey)!;
    const existingUnit = newEntities.get(key);
    const isMerge =
      !!existingUnit &&
      existingUnit !== "city" &&
      existingUnit !== "rebel" &&
      ENTITY_META[existingUnit].isUnit &&
      activeTileMap.get(key)?.owner === "player" &&
      ENTITY_META[movingUnit].strength +
        ENTITY_META[existingUnit].strength <=
        3 &&
      !combatSpentUnits.has(key);

    if (isMerge) {
      const merged = mergedUnitType(
        ENTITY_META[movingUnit].strength,
        ENTITY_META[existingUnit!].strength,
      );
      newEntities.delete(selectedEntityKey);
      newEntities.set(key, merged);
    } else {
      // NOTE: cities are in the cities Set (not entities), so
      // existingUnit will never be "city" — unit moves freely onto city tiles.
      newEntities.delete(key);
      newEntities.delete(selectedEntityKey);
      newEntities.set(key, movingUnit);
    }

    const stepsUsed = getMoveCost(selectedEntityKey, key, activeTileMap);
    const prevRemaining = partialMoves.get(selectedEntityKey) ?? 3;
    const remainingAfterMove = movingToLake
      ? 0
      : Math.max(0, prevRemaining - stepsUsed);

    const newSpentUnits = new Set(spentUnits);
    const newPartialMoves = new Map(partialMoves);
    newPartialMoves.delete(selectedEntityKey);
    if (isMerge) {
      const destRemaining =
        newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : 3);
      // Merged unit inherits the remaining steps of whichever unit had fewer left (the one that moved more)
      const mergedRemaining = Math.min(remainingAfterMove, destRemaining);
      newSpentUnits.delete(key);
      newPartialMoves.delete(key);
      if (mergedRemaining <= 0) {
        newSpentUnits.add(key);
      } else if (mergedRemaining < 3) {
        newPartialMoves.set(key, mergedRemaining);
      }
    } else {
      newSpentUnits.add(key);
      newPartialMoves.delete(key);
    }

    // A move is "combat" if it defeated an entity or captured a non-neutral tile
    const isCombatMove =
      !isMerge &&
      (previousOwner !== "neutral" || existingUnit !== undefined);
    const newCombatSpentUnits = isCombatMove
      ? new Set([...combatSpentUnits, key])
      : combatSpentUnits;

    const { balances: newBalances } = recalculateTerritories(
      key,
      previousOwner as TerritoryOwner,
      activeTileMap,
      newTileMap,
      territoryBalances,
    );

    const newGraveyard = new Set(graveyard);
    const newRuins = new Set(ruins);
    newGraveyard.delete(key);
    // Exempt the destination tile when landing from a lake — the unit is
    // intentionally establishing a new beachhead, not being cut off.
    const lakeLanding = fromLake && !movingToLake;
    applySingleHexPenalty(
      activeTileMap,
      newTileMap,
      newBalances,
      newEntities,
      newGraveyard,
      newRuins,
      lakeLanding ? key : undefined,
    );

    const newLiveOwnerMap = new Map(liveOwnerMap);
    newLiveOwnerMap.set(key, "player");

    const newLakeFunds = new Map(lakeUnitFunds);
    if (fromLake && movingToLake) {
      const fund = newLakeFunds.get(selectedEntityKey) ?? 0;
      newLakeFunds.delete(selectedEntityKey);
      newLakeFunds.set(key, fund);
      if (fromTile) {
        newTileMap.set(selectedEntityKey, {
          ...fromTile,
          owner: "neutral",
        });
        newLiveOwnerMap.delete(selectedEntityKey);
      }
    } else if (fromLake && !movingToLake) {
      const fund = newLakeFunds.get(selectedEntityKey) ?? 0;
      newLakeFunds.delete(selectedEntityKey);
      const newTerritory = getContiguousTerritory(
        newTileMap,
        key,
        "player",
      );
      const newTerrId = getTerritoryId(newTerritory);
      if (newTerrId && fund > 0) {
        newBalances.set(
          newTerrId,
          (newBalances.get(newTerrId) ?? 0) + fund,
        );
      }
      if (fromTile) {
        newTileMap.set(selectedEntityKey, {
          ...fromTile,
          owner: "neutral",
        });
        newLiveOwnerMap.delete(selectedEntityKey);
      }
    }

    setMutableTileMap(newTileMap);
    setLiveOwnerMap(newLiveOwnerMap);
    setEntities(newEntities);
    setSpentUnits(newSpentUnits);
    setCombatSpentUnits(newCombatSpentUnits);
    setPartialMoves(newPartialMoves);
    setTerritoryBalances(newBalances);
    setLakeUnitFunds(newLakeFunds);
    setSelectedEntityKey(null);
    setSelectedTileKey(key);
    setGraveyard(newGraveyard);
    setRuins(newRuins);
    checkWinLoss(newTileMap);
    if (ribbonOpen) closeRibbon();
    if (movingEntityId) {
      triggerUnitAnimation(fromKeyForAnim, key, movingEntityId);
    }
    return;
  }

  if (armedEntityId && selectedTileKeys.has(key)) {
    const existingOnTile = entities.get(key);
    const armedIsUnit = ENTITY_META[armedEntityId].isUnit;
    const existingIsAllyUnit =
      !!existingOnTile &&
      existingOnTile !== "rebel" &&
      existingOnTile !== "city" &&
      ENTITY_META[existingOnTile].isUnit &&
      activeTileMap.get(key)?.owner === "player";
    const canMerge =
      armedIsUnit &&
      existingIsAllyUnit &&
      ENTITY_META[armedEntityId].strength +
        ENTITY_META[existingOnTile!].strength <=
        3;
    const canOverwriteRebel = armedIsUnit && existingOnTile === "rebel";
    const existingIsBuilding =
      !!existingOnTile &&
      !ENTITY_META[existingOnTile].isUnit &&
      existingOnTile !== "rebel";
    const existingBuildingIsOwn =
      existingIsBuilding && activeTileMap.get(key)?.owner === "player";
    const canOverwriteBuilding =
      armedIsUnit &&
      existingIsBuilding &&
      !existingBuildingIsOwn &&
      ENTITY_META[armedEntityId].strength >=
        ENTITY_META[existingOnTile as EntityType].strength;
    const alreadyOccupied =
      (!!existingOnTile && !canMerge && !canOverwriteRebel && !canOverwriteBuilding) ||
      // prevent placing a second city on an existing city tile
      (armedEntityId === "city" && cities.has(key));
    if (!alreadyOccupied && selectedTerritoryId) {
      const meta = ENTITY_META[armedEntityId];
      const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
      const placingTower = armedEntityId === "tower";
      const playerUsedSet =
        freeTowerUsedTiles.get("player") ?? new Set<string>();
      const towerIsFree =
        placingTower &&
        turn === 1 &&
        selectedTerritory.length >= 2 &&
        !selectedTerritory.some((t) => playerUsedSet.has(t.key));
      const blockedByGraveyard = !meta.isUnit && graveyard.has(key);
      const effectiveCost = towerIsFree ? 0 : meta.cost;
      if (balance >= effectiveCost && !blockedByGraveyard) {
        pushHistory();
        const newEntities = new Map(entities);
        const newSpentUnits = new Set(spentUnits);
        const newPartialMoves = new Map(partialMoves);
        if (canMerge) {
          const merged = mergedUnitType(
            ENTITY_META[armedEntityId].strength,
            ENTITY_META[existingOnTile!].strength,
          );
          newEntities.set(key, merged);
          const existingRemaining =
            newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : 3);
          const mergedRemaining = Math.min(3, existingRemaining);
          newSpentUnits.delete(key);
          newPartialMoves.delete(key);
          if (mergedRemaining <= 0) {
            newSpentUnits.add(key);
          } else if (mergedRemaining < 3) {
            newPartialMoves.set(key, mergedRemaining);
          }
        } else if (armedEntityId === "city") {
          setCities((prev) => new Set([...prev, key]));
        } else {
          newEntities.set(key, armedEntityId);
          if (canOverwriteRebel) {
            newSpentUnits.add(key);
          }
        }
        setEntities(newEntities);
        setTerritoryBalances((prev) => {
          const next = new Map(prev);
          next.set(selectedTerritoryId, balance - effectiveCost);
          return next;
        });
        if (towerIsFree) {
          setFreeTowerUsedTiles((prev) => {
            const next = new Map(prev);
            const ownerSet = new Set(prev.get("player") ?? []);
            for (const t of selectedTerritory) ownerSet.add(t.key);
            next.set("player", ownerSet);
            return next;
          });
        }
        setSpentUnits(newSpentUnits);
        setPartialMoves(newPartialMoves);
        setArmedEntityId(null);
        setSelectedEntityKey(null);
        closeRibbon();
        return;
      } else {
        triggerErrorFlash(key);
      }
    } else if (alreadyOccupied) {
      triggerErrorFlash(key);
    }
    return;
  }

  if (armedEntityId && validPlacementAttackTiles.has(key)) {
    if (!selectedTerritoryId) return;
    const meta = ENTITY_META[armedEntityId];
    const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
    if (balance >= meta.cost) {
      pushHistory();
      const previousOwner = (activeTileMap.get(key)?.owner ??
        "neutral") as TerritoryOwner;
      const newTileMap = new Map(activeTileMap);
      const targetTile = newTileMap.get(key);
      if (targetTile)
        newTileMap.set(key, { ...targetTile, owner: "player" });
      const newEntities = new Map(entities);
      if (armedEntityId === "city") {
        setCities((prev) => new Set([...prev, key]));
      } else {
        newEntities.delete(key);
        newEntities.set(key, armedEntityId);
      }
      const newBalances = recalculateTerritoriesForCapture(
        key,
        "player",
        previousOwner,
        activeTileMap,
        newTileMap,
        territoryBalances,
      );
      const mergedTerritory = getContiguousTerritory(
        newTileMap,
        key,
        "player",
      );
      const mergedId = getTerritoryId(mergedTerritory);
      if (mergedId)
        newBalances.set(
          mergedId,
          (newBalances.get(mergedId) ?? 0) - meta.cost,
        );
      const newGraveyard2 = new Set(graveyard);
      const newRuins2 = new Set(ruins);
      applySingleHexPenalty(
        activeTileMap,
        newTileMap,
        newBalances,
        newEntities,
        newGraveyard2,
        newRuins2,
      );
      const newLiveOwnerMap = new Map(liveOwnerMap);
      newLiveOwnerMap.set(key, "player");
      // Placing a unit via attack counts as combat — it cannot be merged with this turn
      const newCombatSpent2 = new Set([...combatSpentUnits, key]);
      setMutableTileMap(newTileMap);
      setLiveOwnerMap(newLiveOwnerMap);
      setEntities(newEntities);
      setTerritoryBalances(newBalances);
      setGraveyard(newGraveyard2);
      setRuins(newRuins2);
      setCombatSpentUnits(newCombatSpent2);
      setSpentUnits((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setArmedEntityId(null);
      setSelectedEntityKey(null);
      closeRibbon();
      setSelectedTileKey(key);
      checkWinLoss(newTileMap);
    } else {
      triggerErrorFlash(key);
    }
    return;
  }

  const entityOnTile = entities.get(key);
  const isSelectableEntity =
    entityOnTile &&
    entityOnTile !== "city" &&
    entityOnTile !== "rebel" &&
    tile?.owner === "player";
  if (isSelectableEntity) {
    if (selectedEntityKey === key) {
      setSelectedEntityKey(null);
      setSelectedTileKey(key);
    } else {
      setSelectedEntityKey(key);
      setSelectedTileKey(key);
      setArmedEntityId(null);
      if (ribbonOpen) closeRibbon();
    }
    return;
  }

  if (!tile || tile.owner !== "player") {
    if (armedEntityId || selectedEntityKey) {
      triggerErrorFlash(key);
      return;
    }
    setSelectedTileKey(null);
    return;
  }

  if (selectedTileKeys.has(key) && !selectedEntityKey) {
    setSelectedTileKey(null);
    setArmedEntityId(null);
    if (ribbonOpen) closeRibbon();
    return;
  }

  setSelectedTileKey(key);
  setSelectedEntityKey(null);
  setArmedEntityId(null);
  if (ribbonOpen) closeRibbon();
}
