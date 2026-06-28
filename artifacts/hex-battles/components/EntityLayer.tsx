import React from "react";
import { StyleSheet, View } from "react-native";
import { ENTITY_META } from "@/utils/hexGrid";
import { useOwnerColors } from "@/contexts/SettingsContext";
import { UnitToken } from "@/components/UnitToken";
import { SELECTED_UNIT_RING } from "@/constants/colors";
import type { EntityType, HexTile, TerritoryOwner } from "@/types";

export interface EntityLayerProps {
  entities: Map<string, EntityType>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  activeTileMap: Map<string, HexTile>;
  selectedEntityKey: string | null;
  spentUnits: Set<string>;
  animatingUnit: {
    fromKey: string;
    toKey: string;
    entityId: EntityType;
    owner: TerritoryOwner;
    hideDestination: boolean;
  } | null;
  boardW: number;
  boardH: number;
  HEX_SIZE: number;
}

// Non-player entities (enemy units, rebels, buildings) never change visual
// state when selectedEntityKey changes, so they live in their own memoized
// component that skips re-renders on selection taps.
function NonPlayerEntityLayerInner({
  entities,
  tileDataMap,
  activeTileMap,
  animatingUnit,
  HEX_SIZE,
}: Pick<EntityLayerProps, "entities" | "tileDataMap" | "activeTileMap" | "animatingUnit" | "HEX_SIZE">) {
  const { borders: TERRITORY_BORDERS } = useOwnerColors();
  return (
    <>
      {Array.from(entities.entries()).map(([key, entityId]) => {
        const meta = ENTITY_META[entityId];
        if (entityId === "city") return null;
        if (entityId === "bridge") return null;
        if (animatingUnit && key === animatingUnit.fromKey) return null;
        if (animatingUnit && animatingUnit.hideDestination && key === animatingUnit.toKey) return null;
        const liveTile = activeTileMap.get(key);
        // Player units are handled by PlayerEntityLayer
        if (liveTile?.owner === "player" && meta.isUnit) return null;
        const pos = tileDataMap.get(key);
        if (!pos) return null;
        const isRebel = entityId === "rebel";
        const isBuilding = !meta.isUnit && !isRebel;
        const r = HEX_SIZE * (isBuilding ? 0.6 : isRebel ? 0.45 : 0.55);
        const ownerColor = TERRITORY_BORDERS[liveTile?.owner ?? ""] ?? "#FFD700";
        const borderColor = isRebel ? "#FFD700" : ownerColor;
        const isEnemyUnit = meta.isUnit && liveTile?.owner !== "player";
        const opacity = isEnemyUnit ? 0.9 : 1.0;
        return (
          <View
            key={`entity-${key}-${entityId}`}
            style={{ position: "absolute", left: pos.cx - r, top: pos.cy - r }}
          >
            <UnitToken
              r={r}
              entityId={entityId}
              borderColor={borderColor}
              borderWidth={3.0}
              isBuilding={isBuilding}
              opacity={opacity}
            />
          </View>
        );
      })}
    </>
  );
}

const NonPlayerEntityLayer = React.memo(
  NonPlayerEntityLayerInner,
  (prev, next) =>
    prev.entities === next.entities &&
    prev.activeTileMap === next.activeTileMap &&
    prev.tileDataMap === next.tileDataMap &&
    prev.animatingUnit === next.animatingUnit &&
    prev.HEX_SIZE === next.HEX_SIZE,
);

function EntityLayerInner({
  entities,
  tileDataMap,
  activeTileMap,
  selectedEntityKey,
  spentUnits,
  animatingUnit,
  HEX_SIZE,
}: EntityLayerProps) {
  const { borders: TERRITORY_BORDERS } = useOwnerColors();
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <NonPlayerEntityLayer
        entities={entities}
        tileDataMap={tileDataMap}
        activeTileMap={activeTileMap}
        animatingUnit={animatingUnit}
        HEX_SIZE={HEX_SIZE}
      />
      {Array.from(entities.entries()).map(([key, entityId]) => {
        const meta = ENTITY_META[entityId];
        if (entityId === "city") return null;
        if (entityId === "bridge") return null;
        if (animatingUnit && key === animatingUnit.fromKey) return null;
        if (animatingUnit && animatingUnit.hideDestination && key === animatingUnit.toKey) return null;
        const liveTile = activeTileMap.get(key);
        // Only player units are rendered here; non-player entities are in NonPlayerEntityLayer
        if (liveTile?.owner !== "player" || !meta.isUnit) return null;
        const pos = tileDataMap.get(key);
        if (!pos) return null;
        const isSelected = selectedEntityKey === key;
        const isSpent = spentUnits.has(key);
        // Idle (non-spent, non-selected) player units bounce in IdleUnitLayer
        if (!isSpent && !isSelected) return null;
        const r = HEX_SIZE * 0.55;
        const borderColor = isSelected ? SELECTED_UNIT_RING : (TERRITORY_BORDERS["player"] ?? "#FFD700");
        const opacity = isSpent && !isSelected ? 0.7 : 1.0;
        return (
          <View
            key={`entity-${key}-${entityId}`}
            style={{ position: "absolute", left: pos.cx - r, top: pos.cy - r }}
          >
            <UnitToken
              r={r}
              entityId={entityId}
              borderColor={borderColor}
              borderWidth={3.0}
              opacity={opacity}
            />
          </View>
        );
      })}
    </View>
  );
}

function areEntityLayerEqual(
  prev: EntityLayerProps,
  next: EntityLayerProps,
): boolean {
  return (
    prev.entities === next.entities &&
    prev.tileDataMap === next.tileDataMap &&
    prev.activeTileMap === next.activeTileMap &&
    prev.selectedEntityKey === next.selectedEntityKey &&
    prev.spentUnits === next.spentUnits &&
    prev.animatingUnit === next.animatingUnit &&
    prev.boardW === next.boardW &&
    prev.boardH === next.boardH &&
    prev.HEX_SIZE === next.HEX_SIZE
  );
}

export const EntityLayer = React.memo(EntityLayerInner, areEntityLayerEqual);
