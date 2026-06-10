import type { Dispatch, SetStateAction } from "react";
// React 18 auto-batches; this shim keeps call sites unchanged
const unstable_batchedUpdates = (fn: () => void) => fn();
import type { EntityType, HexTile, TerritoryOwner } from "@/types";
import {
  ENTITY_META,
  TERRAIN_INCOME,
  CITY_BONUS,
  getContiguousTerritory,
  getTerritoryId,
  getMoveCost,
  recalculateTerritories,
  recalculateTerritoriesForCapture,
  unitMovement,
  unitMaxAttacks,
  unitCanMerge,
} from "@/utils/hexGrid";
import {
  applySingleHexPenalty,
  calcTerritoryUpkeep,
  mergedUnitType,
  resolveMovedUnitMoves,
} from "@/logic/gameLogic";

/**
 * Checks whether the player can afford an action costing `cost` gold with
 * `newUpkeep` ongoing upkeep. Both conditions must hold:
 *   1. balance >= cost
 *   2. balance + (income − (currentUpkeep + newUpkeep)) >= 0
 */
function playerCanAfford(
  balance: number,
  cost: number,
  territory: HexTile[],
  ents: Map<string, EntityType>,
  newUpkeep: number,
  cities: Set<string>,
): boolean {
  if (balance < cost) return false;
  const income = territory.reduce((s, t) => {
    if (ents.get(t.key) === "rebel") return s;
    return s + (TERRAIN_INCOME[t.terrain] ?? 0) + (cities.has(t.key) ? CITY_BONUS : 0);
  }, 0);
  const upkeep = calcTerritoryUpkeep(territory, ents);
  return balance + (income - (upkeep + newUpkeep)) >= 0;
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
  combatSpentUnits: Set<string>;
  spentUnits: Set<string>;
  partialMoves: Map<string, number>;
  attacksUsed: Map<string, number>;
  validBridgePlacementTiles: Set<string>;
  validPlacementAttackTiles: Set<string>;
  ribbonOpen: boolean;
  cities: Set<string>;
  setMutableTileMap: (m: Map<string, HexTile>) => void;
  setLiveOwnerMap: (m: Map<string, TerritoryOwner>) => void;
  setEntities: (m: Map<string, EntityType>) => void;
  setSpentUnits: Dispatch<SetStateAction<Set<string>>>;
  setCombatSpentUnits: (s: Set<string>) => void;
  setPartialMoves: (m: Map<string, number>) => void;
  setAttacksUsed: (m: Map<string, number>) => void;
  setTerritoryBalances: Dispatch<SetStateAction<Map<string, number>>>;
  setSelectedEntityKey: (k: string | null) => void;
  setSelectedTileKey: (k: string | null) => void;
  setGraveyard: (s: Set<string>) => void;
  setRuins: (s: Set<string>) => void;
  setArmedEntityId: (id: EntityType | null) => void;
  setFreeTowerUsedTiles: Dispatch<SetStateAction<Map<TerritoryOwner, Set<string>>>>;
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
    combatSpentUnits,
    spentUnits,
    partialMoves,
    attacksUsed,
    validBridgePlacementTiles,
    validPlacementAttackTiles,
    ribbonOpen,
    cities,
    setMutableTileMap,
    setLiveOwnerMap,
    setEntities,
    setSpentUnits,
    setCombatSpentUnits,
    setPartialMoves,
    setAttacksUsed,
    setTerritoryBalances,
    setSelectedEntityKey,
    setSelectedTileKey,
    setGraveyard,
    setRuins,
    setArmedEntityId,
    setFreeTowerUsedTiles,
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

  // ─── Unit move ───────────────────────────────────────────────────────────────
  if (selectedEntityKey && validMoveTiles.has(key)) {
    const targetTile = activeTileMap.get(key);
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
      existingUnit !== "bridge" &&
      ENTITY_META[existingUnit].isUnit &&
      unitCanMerge(movingUnit) &&
      unitCanMerge(existingUnit) &&
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
      newEntities.delete(key);
      newEntities.delete(selectedEntityKey);
      newEntities.set(key, movingUnit);
    }

    // Bridge auto-restoration: if the unit moved FROM a lake tile (bridge), restore
    // the bridge entity at the source so the bridge structure persists independently.
    if (activeTileMap.get(selectedEntityKey)?.terrain === 'lake') {
      newEntities.set(selectedEntityKey, 'bridge');
    }

    const maxRange = unitMovement(movingUnit);
    const stepsUsed = getMoveCost(selectedEntityKey, key, activeTileMap, entities);
    const prevRemaining = partialMoves.get(selectedEntityKey) ?? maxRange;
    const remainingAfterMove = Math.max(0, prevRemaining - stepsUsed);

    // Combat move: capturing any non-owned tile (neutral OR enemy) OR overwriting a
    // non-bridge entity (rebel/enemy unit). Only repositioning within your own
    // territory (and moving onto your own bridge) is a free, non-combat move.
    const isCombatMove =
      !isMerge &&
      (previousOwner !== "player" ||
       (existingUnit !== undefined && existingUnit !== "bridge"));

    // Charge ability: a unit with maxAttacks > 1 keeps acting after a combat move
    // (instead of being spent) as long as it has attacks AND movement left. The
    // attack budget is shared with movement — once movement is gone the unit is
    // spent even if attacks remain.
    const maxAttacks = unitMaxAttacks(movingUnit);
    const attacksUsedSoFar = attacksUsed.get(selectedEntityKey) ?? 0;
    const isChargeAttack =
      isCombatMove &&
      maxAttacks > 1 &&
      attacksUsedSoFar + 1 < maxAttacks &&
      remainingAfterMove > 0;

    const newSpentUnits = new Set(spentUnits);
    const newPartialMoves = new Map(partialMoves);
    newPartialMoves.delete(selectedEntityKey);
    const destRemaining =
      newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : maxRange);
    const moved = resolveMovedUnitMoves({
      isMerge,
      // A charge attack with attacks/movement to spare behaves like a normal move
      // for the movement budget; combat-spending is deferred to the final attack.
      isCombat: isCombatMove && !isChargeAttack,
      remainingAfterMove,
      destRemaining,
      maxRange,
    });
    newPartialMoves.delete(key);
    if (moved.spent) {
      newSpentUnits.add(key);
    } else {
      newSpentUnits.delete(key);
      if (moved.remaining !== null) newPartialMoves.set(key, moved.remaining);
    }

    // Carry/advance the per-turn attack counter to the destination tile.
    const newAttacksUsed = new Map(attacksUsed);
    newAttacksUsed.delete(selectedEntityKey);
    if (!moved.spent) {
      const attacksNow = isCombatMove ? attacksUsedSoFar + 1 : attacksUsedSoFar;
      if (attacksNow > 0) newAttacksUsed.set(key, attacksNow);
    }

    const newCombatSpentUnits = (isCombatMove && !isChargeAttack)
      ? new Set([...combatSpentUnits, key])
      : combatSpentUnits;

    // Phase 1: immediate visual feedback
    unstable_batchedUpdates(() => {
      setMutableTileMap(new Map(newTileMap));
      setEntities(new Map(newEntities));
      setSpentUnits(newSpentUnits);
      setCombatSpentUnits(newCombatSpentUnits);
      setPartialMoves(newPartialMoves);
      setAttacksUsed(newAttacksUsed);
      setSelectedEntityKey(null);
      setSelectedTileKey(key);
      if (ribbonOpen) closeRibbon();
      if (movingEntityId) {
        triggerUnitAnimation(fromKeyForAnim, key, movingEntityId);
      }
    });

    // Phase 2 (deferred): BFS territory recalculation
    setTimeout(() => {
      const { balances: newBalances } = recalculateTerritories(
        key,
        previousOwner as TerritoryOwner,
        activeTileMap,
        newTileMap,
        territoryBalances,
        newEntities,
        entities,
      );

      const newGraveyard = new Set(graveyard);
      const newRuins = new Set(ruins);
      newGraveyard.delete(key);
      applySingleHexPenalty(
        activeTileMap,
        newTileMap,
        newBalances,
        newEntities,
        newGraveyard,
        newRuins,
      );

      const newLiveOwnerMap = new Map(liveOwnerMap);
      newLiveOwnerMap.set(key, "player");

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

  // ─── Bridge placement ─────────────────────────────────────────────────────────
  if (armedEntityId === "bridge" && validBridgePlacementTiles.has(key)) {
    if (!selectedTerritoryId) return;
    const bridgeCost = ENTITY_META["bridge"].cost;
    const bridgeUpkeep = ENTITY_META["bridge"].upkeep;
    const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
    if (!playerCanAfford(balance, bridgeCost, selectedTerritory, entities, bridgeUpkeep, cities)) {
      triggerErrorFlash(key);
      return;
    }
    pushHistory();
    const newTileMap = new Map(activeTileMap);
    const targetTile = newTileMap.get(key);
    if (targetTile) newTileMap.set(key, { ...targetTile, owner: "player" });
    const newEntities = new Map(entities);
    newEntities.set(key, "bridge");
    const { balances: newBalances } = recalculateTerritories(
      key,
      "neutral" as TerritoryOwner,
      activeTileMap,
      newTileMap,
      territoryBalances,
      newEntities,
    );
    const newTerr = getContiguousTerritory(newTileMap, key, "player", newEntities);
    const newTid = getTerritoryId(newTerr);
    if (newTid) newBalances.set(newTid, (newBalances.get(newTid) ?? 0) - bridgeCost);
    const newLiveOwnerMap = new Map(liveOwnerMap);
    newLiveOwnerMap.set(key, "player");
    unstable_batchedUpdates(() => {
      setMutableTileMap(new Map(newTileMap));
      setEntities(new Map(newEntities));
      setTerritoryBalances(newBalances);
      setLiveOwnerMap(newLiveOwnerMap);
      setArmedEntityId(null);
      setSelectedEntityKey(null);
      closeRibbon();
    });
    return;
  }

  // ─── Armed entity placement on own territory ──────────────────────────────────
  if (armedEntityId && selectedTileKeys.has(key)) {
    const existingOnTile = entities.get(key);
    const armedIsUnit = ENTITY_META[armedEntityId].isUnit;
    const existingIsAllyUnit =
      !!existingOnTile &&
      existingOnTile !== "rebel" &&
      existingOnTile !== "city" &&
      existingOnTile !== "bridge" &&
      ENTITY_META[existingOnTile].isUnit &&
      activeTileMap.get(key)?.owner === "player";
    const canMerge =
      armedIsUnit &&
      existingIsAllyUnit &&
      unitCanMerge(armedEntityId) &&
      unitCanMerge(existingOnTile!) &&
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
    const canPlaceOnBridge =
      armedIsUnit &&
      existingOnTile === "bridge" &&
      activeTileMap.get(key)?.owner === "player";
    // Cities live in a separate Set from entities, so an empty city tile has
    // no entity. Block any non-unit armed entity (city/tower/castle/bridge)
    // from being placed on a city — only units may stand on cities.
    const alreadyOccupied =
      (!!existingOnTile && !canMerge && !canOverwriteRebel && !canOverwriteBuilding && !canPlaceOnBridge) ||
      (!armedIsUnit && cities.has(key));
    // Don't allow placement on lake tiles unless there's a bridge (bridges are placed via validBridgePlacementTiles path)
    const tileData = activeTileMap.get(key);
    if (tileData?.terrain === "lake" && existingOnTile !== "bridge") {
      triggerErrorFlash(key);
      return;
    }
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
      const effectiveNewUpkeep = towerIsFree ? 0 : meta.upkeep;
      if (
        playerCanAfford(balance, effectiveCost, selectedTerritory, entities, effectiveNewUpkeep, cities) &&
        !blockedByGraveyard
      ) {
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
          const placedRange = unitMovement(armedEntityId);
          const existingRemaining =
            newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : placedRange);
          // A freshly placed/bought unit is at full range; the merged unit
          // keeps the lower of the two remaining-move budgets.
          const moved = resolveMovedUnitMoves({
            isMerge: true,
            isCombat: false,
            remainingAfterMove: placedRange,
            destRemaining: existingRemaining,
            maxRange: placedRange,
          });
          newPartialMoves.delete(key);
          if (moved.spent) {
            newSpentUnits.add(key);
          } else {
            newSpentUnits.delete(key);
            if (moved.remaining !== null) newPartialMoves.set(key, moved.remaining);
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

  // ─── Armed unit placed outside own territory (attack/capture) ──────────────────
  if (armedEntityId && validPlacementAttackTiles.has(key)) {
    if (!selectedTerritoryId) return;
    const meta = ENTITY_META[armedEntityId];
    const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
    if (playerCanAfford(balance, meta.cost, selectedTerritory, entities, meta.upkeep, cities)) {
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
      // Charge units bought directly into an attack spend one of their attacks
      // but stay active (with full movement) so they can charge on and attack
      // again. Other units (and cities) are spent immediately as before.
      const isChargePlacement = !isCity && unitMaxAttacks(armedEntityId) > 1;
      const newCombatSpent2 = isChargePlacement
        ? combatSpentUnits
        : new Set([...combatSpentUnits, key]);
      const newSpentUnits2 = new Set(spentUnits);
      if (!isChargePlacement) newSpentUnits2.add(key);
      const newAttacksUsed2 = new Map(attacksUsed);
      if (isChargePlacement) newAttacksUsed2.set(key, 1);

      unstable_batchedUpdates(() => {
        setMutableTileMap(new Map(newTileMap));
        setEntities(new Map(newEntities));
        setCombatSpentUnits(newCombatSpent2);
        setSpentUnits(newSpentUnits2);
        setAttacksUsed(newAttacksUsed2);
        setArmedEntityId(null);
        setSelectedEntityKey(null);
        setSelectedTileKey(key);
        closeRibbon();
      });

      setTimeout(() => {
        const newBalances = recalculateTerritoriesForCapture(
          key,
          "player",
          previousOwner,
          activeTileMap,
          newTileMap,
          territoryBalances,
          newEntities,
          entities,
        );
        const mergedTerritory = getContiguousTerritory(
          newTileMap,
          key,
          "player",
          newEntities,
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

  // ─── Entity selection ─────────────────────────────────────────────────────────
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
    if (armedEntityId) {
      triggerErrorFlash(key);
      return;
    }
    if (selectedEntityKey) {
      unstable_batchedUpdates(() => {
        setSelectedEntityKey(null);
        setSelectedTileKey(null);
      });
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
