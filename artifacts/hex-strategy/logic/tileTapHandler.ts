import type { Dispatch, SetStateAction } from "react";
import { unstable_batchedUpdates } from "react-native";
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

    const lakeLanding = fromLake && !movingToLake;

    // Pre-compute lake fund changes and apply visual lake-tile mutations to
    // newTileMap so Phase 1 immediately shows the from-tile as unoccupied.
    const newLakeFunds = new Map(lakeUnitFunds);
    let lakeFundToCredit = 0;
    const fromLakeKey = selectedEntityKey;
    if (fromLake && movingToLake) {
      const fund = newLakeFunds.get(fromLakeKey) ?? 0;
      newLakeFunds.delete(fromLakeKey);
      newLakeFunds.set(key, fund);
      if (fromTile) {
        newTileMap.set(fromLakeKey, { ...fromTile, owner: "neutral" });
      }
    } else if (fromLake && !movingToLake) {
      const fund = newLakeFunds.get(fromLakeKey) ?? 0;
      newLakeFunds.delete(fromLakeKey);
      lakeFundToCredit = fund;
      if (fromTile) {
        newTileMap.set(fromLakeKey, { ...fromTile, owner: "neutral" });
      }
    }

    // Phase 1: immediate visual feedback — show unit at destination, clear
    // selection, and start movement animation. No BFS yet.
    // React 18 automatic batching handles these as a single render.
    setMutableTileMap(new Map(newTileMap));
    setEntities(new Map(newEntities));
    setSpentUnits(newSpentUnits);
    setCombatSpentUnits(newCombatSpentUnits);
    setPartialMoves(newPartialMoves);
    setLakeUnitFunds(newLakeFunds);
    setSelectedEntityKey(null);
    setSelectedTileKey(key);
    if (ribbonOpen) closeRibbon();
    if (movingEntityId) {
      triggerUnitAnimation(fromKeyForAnim, key, movingEntityId);
    }

    // Phase 2 (deferred): run the BFS territory recalculation and apply
    // isolation penalties — these are expensive and do not affect the
    // initial visual frame, so they run in the next event-loop tick.
    setTimeout(() => {
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
      if (fromLake) {
        newLiveOwnerMap.delete(fromLakeKey);
      }

      // Credit any lake funds to the destination territory now that BFS has
      // computed the correct territory boundaries.
      if (lakeFundToCredit > 0) {
        const newTerritory = getContiguousTerritory(newTileMap, key, "player");
        const newTerrId = getTerritoryId(newTerritory);
        if (newTerrId) {
          newBalances.set(newTerrId, (newBalances.get(newTerrId) ?? 0) + lakeFundToCredit);
        }
      }

      setMutableTileMap(new Map(newTileMap));
      setEntities(new Map(newEntities));
      setTerritoryBalances(newBalances);
      setGraveyard(newGraveyard);
      setRuins(newRuins);
      setLiveOwnerMap(newLiveOwnerMap);
      checkWinLoss(newTileMap);
    }, 0);
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
        }
        unstable_batchedUpdates(() => {
          if (armedEntityId === "city" && !canMerge) {
            setCities((prev) => new Set([...prev, key]));
          } else {
            if (!canMerge) {
              newEntities.set(key, armedEntityId);
              if (canOverwriteRebel) {
                newSpentUnits.add(key);
              }
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
        });
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
      const isCity = armedEntityId === "city";
      if (isCity) {
        setCities((prev) => new Set([...prev, key]));
      } else {
        newEntities.delete(key);
        newEntities.set(key, armedEntityId);
      }
      const newCombatSpent2 = new Set([...combatSpentUnits, key]);
      const newSpentUnits2 = new Set(spentUnits);
      newSpentUnits2.add(key);

      // Phase 1: immediate visual feedback — show unit at destination and
      // clear selection state before the expensive BFS runs.
      // React 18 automatic batching handles these as a single render.
      setMutableTileMap(new Map(newTileMap));
      setEntities(new Map(newEntities));
      setCombatSpentUnits(newCombatSpent2);
      setSpentUnits(newSpentUnits2);
      setArmedEntityId(null);
      setSelectedEntityKey(null);
      setSelectedTileKey(key);
      closeRibbon();

      // Phase 2 (deferred): BFS territory recalculation, penalty, and
      // balance/ownership state updates in the next event-loop tick.
      setTimeout(() => {
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
        setMutableTileMap(new Map(newTileMap));
        setEntities(new Map(newEntities));
        setTerritoryBalances(newBalances);
        setGraveyard(newGraveyard2);
        setRuins(newRuins2);
        setLiveOwnerMap(newLiveOwnerMap);
        checkWinLoss(newTileMap);
      }, 0);
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
      unstable_batchedUpdates(() => {
        setSelectedEntityKey(null);
        setSelectedTileKey(key);
      });
    } else {
      unstable_batchedUpdates(() => {
        setSelectedEntityKey(key);
        setSelectedTileKey(key);
        setArmedEntityId(null);
        if (ribbonOpen) closeRibbon();
      });
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
    unstable_batchedUpdates(() => {
      setSelectedTileKey(null);
      setArmedEntityId(null);
      if (ribbonOpen) closeRibbon();
    });
    return;
  }

  unstable_batchedUpdates(() => {
    setSelectedTileKey(key);
    setSelectedEntityKey(null);
    setArmedEntityId(null);
    if (ribbonOpen) closeRibbon();
  });
}
