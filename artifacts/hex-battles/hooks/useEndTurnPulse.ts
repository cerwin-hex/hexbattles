import { useEffect, useRef, useState, useTransition } from "react";
import type { SharedValue } from "react-native-reanimated";
import {
  cancelAnimation,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSharedValue } from "react-native-reanimated";
import type { EntityType, HexTile, TerritoryOwner } from "@/types";
import {
  ENTITY_META,
  getContiguousTerritory,
  getTerritoryId,
  getValidMoves,
} from "@/utils/hexGrid";

interface UseEndTurnPulseParams {
  entities: Map<string, EntityType>;
  activeTileMap: Map<string, HexTile>;
  spentUnits: Set<string>;
  combatSpentUnits: Set<string>;
  territoryBalances: Map<string, number>;
  minUnitCost: number;
  isAiTurn: boolean;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  turn: number;
  armedEntityId: EntityType | null;
  ribbonOpen: boolean;
}

export function useEndTurnPulse({
  entities,
  activeTileMap,
  spentUnits,
  combatSpentUnits,
  territoryBalances,
  minUnitCost,
  isAiTurn,
  freeTowerUsedTiles,
  turn,
  armedEntityId,
  ribbonOpen,
}: UseEndTurnPulseParams) {
  const pulseVal = useSharedValue(1);
  const [, startPulseTransition] = useTransition();
  const [shouldPulseEndTurn, setShouldPulseEndTurn] = useState(false);
  const prevPulseInputs = useRef<{
    entities: Map<string, EntityType>;
    activeTileMap: Map<string, HexTile>;
    spentUnits: Set<string>;
    territoryBalances: Map<string, number>;
    freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
    isAiTurn: boolean;
    turn: number;
  } | null>(null);

  useEffect(() => {
    const prev = prevPulseInputs.current;
    if (
      prev &&
      prev.entities === entities &&
      prev.activeTileMap === activeTileMap &&
      prev.spentUnits === spentUnits &&
      prev.territoryBalances === territoryBalances &&
      prev.freeTowerUsedTiles === freeTowerUsedTiles &&
      prev.isAiTurn === isAiTurn &&
      prev.turn === turn
    )
      return;
    prevPulseInputs.current = {
      entities,
      activeTileMap,
      spentUnits,
      territoryBalances,
      freeTowerUsedTiles,
      isAiTurn,
      turn,
    };
    startPulseTransition(() => {
      if (isAiTurn) {
        setShouldPulseEndTurn(false);
        return;
      }
      const hasValidMove = Array.from(entities.entries()).some(
        ([key, entityId]) => {
          const meta = ENTITY_META[entityId];
          if (!meta.isUnit) return false;
          const tile = activeTileMap.get(key);
          if (tile?.owner !== "player") return false;
          if (spentUnits.has(key)) return false;
          const moves = getValidMoves(
            key,
            "player",
            entities,
            activeTileMap,
            spentUnits,
            undefined,
            combatSpentUnits,
          );
          return moves.size > 0;
        },
      );
      if (hasValidMove) {
        setShouldPulseEndTurn(false);
        return;
      }
      const playerFreeTowerUsed =
        freeTowerUsedTiles.get("player") ?? new Set<string>();
      const visited = new Set<string>();
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
        const canAfford = turn === 1 ? towerFree : balance >= minUnitCost;
        if (canAfford) {
          setShouldPulseEndTurn(false);
          return;
        }
      }
      setShouldPulseEndTurn(true);
    });
  }, [
    entities,
    activeTileMap,
    spentUnits,
    combatSpentUnits,
    territoryBalances,
    minUnitCost,
    isAiTurn,
    freeTowerUsedTiles,
    turn,
  ]);

  useEffect(() => {
    const shouldPulse = shouldPulseEndTurn && !armedEntityId && !ribbonOpen;
    if (shouldPulse) {
      pulseVal.value = withRepeat(
        withSequence(
          withTiming(0.25, { duration: 600 }),
          withTiming(1.0, { duration: 600 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseVal);
      pulseVal.value = withTiming(1.0, { duration: 200 });
    }
    return () => {
      cancelAnimation(pulseVal);
    };
  }, [shouldPulseEndTurn, armedEntityId, ribbonOpen]);

  const endTurnStyle = useAnimatedStyle(() => ({
    opacity: pulseVal.value,
  }));

  return { endTurnStyle };
}
