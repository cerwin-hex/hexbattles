import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  EntityType,
  HexTile,
  TerritoryOwner,
  MoveHistorySnapshot,
  GameResult,
} from "@/types";

interface UseMoveHistoryParams {
  entities: Map<string, EntityType>;
  cities: Set<string>;
  mutableTileMap: Map<string, HexTile>;
  territoryBalances: Map<string, number>;
  spentUnits: Set<string>;
  combatSpentUnits: Set<string>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  partialMoves: Map<string, number>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  lakeUnitFunds: Map<string, number>;
  selectedTileKey: string | null;
  isAiTurn: boolean;
  gameResult: GameResult;
  ribbonOpen: boolean;
  closeRibbon: () => void;
  setEntities: (m: Map<string, EntityType>) => void;
  setCities: (s: Set<string>) => void;
  setMutableTileMap: (m: Map<string, HexTile>) => void;
  setTerritoryBalances: (m: Map<string, number>) => void;
  setSpentUnits: (s: Set<string>) => void;
  setCombatSpentUnits: (s: Set<string>) => void;
  setLiveOwnerMap: (m: Map<string, TerritoryOwner>) => void;
  setPartialMoves: (m: Map<string, number>) => void;
  setFreeTowerUsedTiles: (m: Map<TerritoryOwner, Set<string>>) => void;
  setLakeUnitFunds: (m: Map<string, number>) => void;
  setSelectedTileKey: (k: string | null) => void;
  setSelectedEntityKey: (k: string | null) => void;
  setArmedEntityId: (id: EntityType | null) => void;
}

export function useMoveHistory({
  entities,
  cities,
  mutableTileMap,
  territoryBalances,
  spentUnits,
  combatSpentUnits,
  liveOwnerMap,
  partialMoves,
  freeTowerUsedTiles,
  lakeUnitFunds,
  selectedTileKey,
  isAiTurn,
  gameResult,
  ribbonOpen,
  closeRibbon,
  setEntities,
  setCities,
  setMutableTileMap,
  setTerritoryBalances,
  setSpentUnits,
  setCombatSpentUnits,
  setLiveOwnerMap,
  setPartialMoves,
  setFreeTowerUsedTiles,
  setLakeUnitFunds,
  setSelectedTileKey,
  setSelectedEntityKey,
  setArmedEntityId,
}: UseMoveHistoryParams) {
  const [moveHistory, setMoveHistory] = useState<MoveHistorySnapshot[]>([]);

  const pushHistory = useCallback(() => {
    setMoveHistory((prev) => [
      ...prev.slice(-9),
      {
        entities: new Map(entities),
        cities: new Set(cities),
        mutableTileMap: new Map(mutableTileMap),
        territoryBalances: new Map(territoryBalances),
        spentUnits: new Set(spentUnits),
        combatSpentUnits: new Set(combatSpentUnits),
        liveOwnerMap: new Map(liveOwnerMap),
        partialMoves: new Map(partialMoves),
        freeTowerUsedTiles: new Map(
          [...freeTowerUsedTiles.entries()].map(([k, v]) => [k, new Set(v)]),
        ),
        lakeUnitFunds: new Map(lakeUnitFunds),
        selectedTileKey,
      },
    ]);
  }, [
    entities,
    cities,
    mutableTileMap,
    territoryBalances,
    spentUnits,
    combatSpentUnits,
    liveOwnerMap,
    partialMoves,
    freeTowerUsedTiles,
    lakeUnitFunds,
    selectedTileKey,
  ]);

  const handleUndo = useCallback(() => {
    if (isAiTurn || gameResult !== null) return;
    setMoveHistory((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setEntities(snapshot.entities);
      setCities(snapshot.cities ?? new Set());
      setMutableTileMap(snapshot.mutableTileMap);
      setTerritoryBalances(snapshot.territoryBalances);
      setSpentUnits(snapshot.spentUnits);
      setCombatSpentUnits(snapshot.combatSpentUnits ?? new Set());
      setLiveOwnerMap(snapshot.liveOwnerMap);
      setPartialMoves(snapshot.partialMoves);
      setFreeTowerUsedTiles(snapshot.freeTowerUsedTiles);
      setLakeUnitFunds(snapshot.lakeUnitFunds);
      setSelectedTileKey(snapshot.selectedTileKey);
      setSelectedEntityKey(null);
      setArmedEntityId(null);
      if (ribbonOpen) closeRibbon();
      return prev.slice(0, -1);
    });
  }, [
    isAiTurn,
    gameResult,
    ribbonOpen,
    closeRibbon,
    setEntities,
    setCities,
    setMutableTileMap,
    setTerritoryBalances,
    setSpentUnits,
    setCombatSpentUnits,
    setLiveOwnerMap,
    setPartialMoves,
    setFreeTowerUsedTiles,
    setLakeUnitFunds,
    setSelectedTileKey,
    setSelectedEntityKey,
    setArmedEntityId,
  ]);

  return { moveHistory, setMoveHistory, pushHistory, handleUndo };
}
