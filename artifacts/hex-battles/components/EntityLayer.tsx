import React from "react";
import { StyleSheet, View } from "react-native";
import { ENTITY_META } from "@/utils/hexGrid";
import { useOwnerColors } from "@/contexts/SettingsContext";
import { UnitToken } from "@/components/UnitToken";
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
      {Array.from(entities.entries()).map(([key, entityId]) => {
        if (entityId === "city") return null;
        if (entityId === "bridge") return null;
        if (animatingUnit && key === animatingUnit.fromKey) return null;
        if (
          animatingUnit &&
          animatingUnit.hideDestination &&
          key === animatingUnit.toKey
        )
          return null;
        const pos = tileDataMap.get(key);
        if (!pos) return null;
        const meta = ENTITY_META[entityId];
        const isRebel = entityId === "rebel";
        const isBuilding = !meta.isUnit && !isRebel;
        const r = HEX_SIZE * 0.5;
        const isSelected = selectedEntityKey === key;
        const isSpent = spentUnits.has(key);
        const liveTile = activeTileMap.get(key);
        const isPlayerUnit = liveTile?.owner === "player" && meta.isUnit;
        // Idle (non-spent, non-selected) player units bounce in IdleUnitLayer.
        const isIdleBouncing = isPlayerUnit && !isSpent && !isSelected;
        if (isIdleBouncing) return null;
        // No background fill — tokens are a bare icon inside a coloured ring,
        // so the ring's hue is the only owner/state cue (gold rebel / green
        // selected / owner colour otherwise).
        const ownerColor =
          TERRITORY_BORDERS[liveTile?.owner ?? ""] ?? "#FFD700";
        const borderColor = isRebel
          ? "#FFD700"
          : isSelected
            ? "#50FF50"
            : ownerColor;
        // Uniform ring weight so player units match the rebel ring; the green
        // colour carries the selection cue.
        const borderWidth = 3.0;
        // Per-state opacity: only a spent player unit dims (to 80%); idle and
        // selected units, rebels and buildings are all fully opaque.
        const opacity = isPlayerUnit && isSpent && !isSelected ? 0.8 : 1.0;
        return (
          <View
            key={`entity-${key}`}
            style={{ position: "absolute", left: pos.cx - r, top: pos.cy - r }}
          >
            <UnitToken
              r={r}
              entityId={entityId}
              borderColor={borderColor}
              borderWidth={borderWidth}
              isBuilding={isBuilding}
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
