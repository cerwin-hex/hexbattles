import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { ENTITY_META } from "@/utils/hexGrid";
import { TERRITORY_BORDERS } from "@/constants/colors";
import { hexCornersString } from "@/utils/hexMath";
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
  boardW,
  boardH,
  HEX_SIZE,
}: EntityLayerProps) {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      <Svg width={boardW} height={boardH}>
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
          const isIdleBouncing = isPlayerUnit && !isSpent && !isSelected;
          if (isIdleBouncing) return null;
          const bgColor = isRebel
            ? "rgba(140,20,20,0.92)"
            : isSelected
              ? "rgba(20,80,20,0.95)"
              : meta.isUnit
                ? "rgba(30,50,120,0.9)"
                : "rgba(80,40,10,0.9)";
          const ownerColor =
            TERRITORY_BORDERS[liveTile?.owner ?? ""] ?? "#FFD700";
          const strokeColor = isRebel
            ? "#FFD700"
            : isSelected
              ? "#50FF50"
              : ownerColor;
          const strokeWidth = isRebel ? 3.0 : isSelected ? 4.0 : 3.2;
          const unitOpacity = isSpent && isPlayerUnit ? 0.6 : 1.0;
          return (
            <React.Fragment key={`entity-${key}`}>
              {isBuilding ? (
                <Rect
                  x={pos.cx - r}
                  y={pos.cy - r}
                  width={r * 2}
                  height={r * 2}
                  rx={4}
                  fill={bgColor}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                />
              ) : (
                <Circle
                  cx={pos.cx}
                  cy={pos.cy}
                  r={r}
                  fill={bgColor}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  opacity={unitOpacity}
                />
              )}
              <SvgText
                x={pos.cx}
                y={pos.cy + r * 0.35}
                textAnchor="middle"
                fontSize={r * 1.1}
                fill="#fff"
                opacity={unitOpacity}
              >
                {meta.icon}
              </SvgText>
              <Polygon
                points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                fill="transparent"
              />
            </React.Fragment>
          );
        })}
      </Svg>
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
