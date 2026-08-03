import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { buildingDotSuppressed, classifyOwnTilePlacement } from "@/logic/gameLogic";
import {
  areMovementHighlightLayerEqual,
  type MovementHighlightLayerEqualProps,
} from "@/components/layerEquality";

// The prop list lives with the equality function it is compared by, so a new
// prop cannot be added without deciding how the memo compares it.
export type MovementHighlightLayerProps = MovementHighlightLayerEqualProps;

function MovementHighlightLayerInner({
  validMoveTiles,
  validBridgePlacementTiles,
  validImprovementTiles,
  validPlacementAttackTiles,
  validRangedTargets,
  validCitySites,
  selectedTileKeys,
  armedEntityId,
  armedImprovement,
  entities,
  activeTileMap,
  cities,
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
            const tile = activeTileMap.get(key);
            if (!pos || !tile) return null;
            // The same rule the tap handler acts on, so a dot never invites a
            // tap that only error-flashes: a bowman gets no dot on a rebel it
            // cannot overrun, and no unit gets one on a unit it cannot merge with.
            const placement = classifyOwnTilePlacement({
              armedEntityId,
              occupant: entities.get(key),
              tileOwner: tile.owner,
              terrain: tile.terrain,
            });
            if (placement.blocked) return null;
            // A city may only be founded on a legal site: inside the cap and at
            // least three tiles from every city the player already holds.
            if (armedEntityId === "city" && !validCitySites.has(key)) return null;
            // Cities, graveyards and existing fort cover withdraw the dot for
            // buildings only; they sit outside the shared rule, which cannot see
            // those sets.
            if (
              buildingDotSuppressed({
                armedEntityId,
                key,
                cities,
                graveyard,
                fortificationDots,
              })
            )
              return null;
            const isRebelTarget = placement.overwritesRebel;
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
