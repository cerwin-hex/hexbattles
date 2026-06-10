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
        // Background alpha is uniform (0.9) across every status; only the hue
        // changes (red rebel / green selected / blue unit / brown building) so
        // tokens don't drift in apparent opacity from one state to the next.
        const bgColor = isRebel
          ? "rgba(140,20,20,0.9)"
          : isSelected
            ? "rgba(20,80,20,1)" // selected unit is fully opaque
            : meta.isUnit
              ? "rgba(30,50,120,0.9)"
              : "rgba(80,40,10,0.9)";
        const ownerColor =
          TERRITORY_BORDERS[liveTile?.owner ?? ""] ?? "#FFD700";
        const borderColor = isRebel
          ? "#FFD700"
          : isSelected
            ? "#50FF50"
            : ownerColor;
        // Selection ring is only slightly heavier than a normal token (was 4.0,
        // which read as too thick); the green colour carries the cue.
        const borderWidth = isRebel ? 3.0 : isSelected ? 2.6 : 2.2;
        // Per-state unit opacity: selected 100%, spent (player) 60%, any other
        // unit 90%. Non-units (buildings, rebels) stay fully opaque.
        const opacity = !meta.isUnit
          ? 1.0
          : isSelected
            ? 1.0
            : isSpent && isPlayerUnit
              ? 0.6
              : 0.9;
        return (
          <View
            key={`entity-${key}`}
            style={{ position: "absolute", left: pos.cx - r, top: pos.cy - r }}
          >
            <UnitToken
              r={r}
              icon={meta.icon}
              bgColor={bgColor}
              borderColor={borderColor}
              borderWidth={borderWidth}
              square={isBuilding}
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
