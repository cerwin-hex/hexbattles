import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { ENTITY_META } from "@/utils/hexGrid";
import { areMovementHighlightLayerEqual } from "@/components/layerEquality";
import type { EntityType, HexTile, TerrainType } from "@/types";

export interface MovementHighlightLayerProps {
  validMoveTiles: Set<string>;
  validBridgePlacementTiles: Set<string>;
  validImprovementTiles: Set<string>;
  validPlacementAttackTiles: Set<string>;
  validRangedTargets: Set<string>;
  selectedTileKeys: Set<string>;
  armedEntityId: EntityType | null;
  armedImprovement: TerrainType | null;
  entities: Map<string, EntityType>;
  activeTileMap: Map<string, HexTile>;
  graveyard: Set<string>;
  fortificationDots: Set<string>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  boardW: number;
  boardH: number;
  HEX_SIZE: number;
}

function MovementHighlightLayerInner({
  validMoveTiles,
  validBridgePlacementTiles,
  validImprovementTiles,
  validPlacementAttackTiles,
  validRangedTargets,
  selectedTileKeys,
  armedEntityId,
  armedImprovement,
  entities,
  activeTileMap,
  graveyard,
  fortificationDots,
  tileDataMap,
  boardW,
  boardH,
  HEX_SIZE,
}: MovementHighlightLayerProps) {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Svg width={boardW} height={boardH}>
        {Array.from(validMoveTiles).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          const tileOwner = activeTileMap.get(key)?.owner;
          const hasRebel = entities.get(key) === "rebel";
          const isAttackMove =
            (tileOwner !== "player" && tileOwner !== undefined) || hasRebel;
          return (
            <Circle
              key={`move-dot-${key}`}
              cx={pos.cx}
              cy={pos.cy}
              r={HEX_SIZE * 0.18}
              fill={isAttackMove ? "rgba(220,40,40,0.85)" : "rgba(255,220,0,0.85)"}
            />
          );
        })}

        {Array.from(validRangedTargets).map((key) => {
          const pos = tileDataMap.get(key);
          if (!pos) return null;
          // A stroked ring, not a filled dot: a shot is not a move, and the two
          // must never be confused at a glance.
          return (
            <Circle
              key={`shot-ring-${key}`}
              cx={pos.cx}
              cy={pos.cy}
              r={HEX_SIZE * 0.34}
              fill="none"
              stroke="rgba(220,40,40,0.95)"
              strokeWidth={HEX_SIZE * 0.09}
            />
          );
        })}

        {armedEntityId === "bridge" &&
          Array.from(validBridgePlacementTiles).map((key) => {
            const pos = tileDataMap.get(key);
            if (!pos) return null;
            return (
              <Circle
                key={`bridge-dot-${key}`}
                cx={pos.cx}
                cy={pos.cy}
                r={HEX_SIZE * 0.18}
                fill="rgba(255,220,0,0.85)"
              />
            );
          })}

        {armedImprovement &&
          Array.from(validImprovementTiles).map((key) => {
            const pos = tileDataMap.get(key);
            if (!pos) return null;
            return (
              <Circle
                key={`improve-dot-${key}`}
                cx={pos.cx}
                cy={pos.cy}
                r={HEX_SIZE * 0.18}
                fill="rgba(255,220,0,0.85)"
              />
            );
          })}

        {armedEntityId &&
          armedEntityId !== "bridge" &&
          Array.from(selectedTileKeys).map((key) => {
            const pos = tileDataMap.get(key);
            if (!pos) return null;
            if (armedEntityId && !ENTITY_META[armedEntityId].isUnit) {
              if (entities.get(key) || graveyard.has(key) || fortificationDots.has(key))
                return null;
            }
            if (armedEntityId && ENTITY_META[armedEntityId].isUnit) {
              const existingEntity = entities.get(key);
              if (
                existingEntity &&
                !ENTITY_META[existingEntity].isUnit &&
                existingEntity !== "rebel" &&
                existingEntity !== "bridge" &&
                activeTileMap.get(key)?.owner === "player"
              )
                return null;
            }
            const isRebelTarget =
              ENTITY_META[armedEntityId].isUnit && entities.get(key) === "rebel";
            return (
              <Circle
                key={`place-dot-${key}`}
                cx={pos.cx}
                cy={pos.cy}
                r={HEX_SIZE * 0.18}
                fill={isRebelTarget ? "rgba(220,40,40,0.85)" : "rgba(255,220,0,0.85)"}
              />
            );
          })}

        {armedEntityId &&
          Array.from(validPlacementAttackTiles).map((key) => {
            const pos = tileDataMap.get(key);
            if (!pos) return null;
            return (
              <Circle
                key={`atk-dot-${key}`}
                cx={pos.cx}
                cy={pos.cy}
                r={HEX_SIZE * 0.18}
                fill="rgba(220,40,40,0.85)"
              />
            );
          })}
      </Svg>
    </View>
  );
}

export const MovementHighlightLayer = React.memo(
  MovementHighlightLayerInner,
  areMovementHighlightLayerEqual,
);
