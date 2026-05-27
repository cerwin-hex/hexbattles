import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import {
  ENTITY_META,
  UNIT_UPGRADE,
  getContiguousTerritory,
  getTerritoryId,
} from "@/utils/hexGrid";
import type { EntityType, HexTile } from "@/types";
import { BOTTOM_BAR_H } from "@/constants/gameConstants";
import styles from "@/app/gameStyles";

interface EntityPanelProps {
  selectedEntityKey: string;
  entities: Map<string, EntityType>;
  activeTileMap: Map<string, HexTile>;
  spentUnits: Set<string>;
  territoryBalances: Map<string, number>;
  isAiTurn: boolean;
  gameResult: "victory" | "defeat" | null;
  botInset: number;
  pushHistory: () => void;
  setEntities: (updater: (prev: Map<string, EntityType>) => Map<string, EntityType>) => void;
  setTerritoryBalances: (updater: (prev: Map<string, number>) => Map<string, number>) => void;
  setSelectedEntityKey: (key: string | null) => void;
  onRemoveOverride?: () => void;
}

export default function EntityPanel({
  selectedEntityKey,
  entities,
  activeTileMap,
  spentUnits,
  territoryBalances,
  isAiTurn,
  gameResult,
  botInset,
  pushHistory,
  setEntities,
  setTerritoryBalances,
  setSelectedEntityKey,
  onRemoveOverride,
}: EntityPanelProps) {
  const entityId = entities.get(selectedEntityKey);
  const isUnit = entityId ? ENTITY_META[entityId].isUnit : false;
  const upgradeTarget = entityId ? UNIT_UPGRADE[entityId] : undefined;
  const canUpgrade = !!upgradeTarget;
  const upgradeCost =
    entityId && upgradeTarget
      ? ENTITY_META[upgradeTarget].cost - ENTITY_META[entityId].cost
      : 0;
  const isSpent = spentUnits.has(selectedEntityKey);
  const entityTile = activeTileMap.get(selectedEntityKey);
  const entityTerritoryId = entityTile
    ? getTerritoryId(
        getContiguousTerritory(activeTileMap, selectedEntityKey, "player", entities),
      )
    : null;
  const entityTerritoryBalance = entityTerritoryId
    ? (territoryBalances.get(entityTerritoryId) ?? 0)
    : 0;
  const removeCost = 0;
  const upgradeEnabled =
    canUpgrade &&
    entityTerritoryBalance >= upgradeCost &&
    (!isUnit || !isSpent);
  const removeEnabled = isUnit
    ? !isSpent
    : !!entityTerritoryId && entityTerritoryBalance >= removeCost;

  return (
    <View style={[styles.entityPanel, { bottom: BOTTOM_BAR_H + botInset }]}>
      <TouchableOpacity
        style={[
          styles.buildBtn,
          { borderColor: "#AA3A2A", backgroundColor: "#3A1A10" },
          !removeEnabled && styles.buildBtnDisabled,
        ]}
        activeOpacity={removeEnabled ? 0.75 : 1}
        onPress={() => {
          if (isAiTurn || gameResult !== null) return;
          if (!removeEnabled) return;
          if (onRemoveOverride) {
            onRemoveOverride();
            return;
          }
          if (!entityTerritoryId) return;
          pushHistory();
          setEntities((prev) => {
            const next = new Map(prev);
            // If the unit is standing on a lake tile it must be on a bridge.
            // Restore the bridge entity instead of leaving the lake tile empty,
            // otherwise the tile (and anything connected through it) drops out
            // of the territory.
            const tileUnderUnit = activeTileMap.get(selectedEntityKey);
            if (tileUnderUnit?.terrain === "lake") {
              next.set(selectedEntityKey, "bridge");
            } else {
              next.delete(selectedEntityKey);
            }
            return next;
          });
          if (removeCost > 0) {
            setTerritoryBalances((prev) => {
              const next = new Map(prev);
              next.set(entityTerritoryId, entityTerritoryBalance - removeCost);
              return next;
            });
          }
          setSelectedEntityKey(null);
        }}
      >
        <Text
          style={[
            styles.buildBtnText,
            { color: removeEnabled ? "#F07060" : "#7A3020" },
          ]}
        >
          ✕ Remove{removeCost > 0 ? ` (${removeCost}g)` : ""}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.buildBtn, !upgradeEnabled && styles.buildBtnDisabled]}
        activeOpacity={upgradeEnabled ? 0.75 : 1}
        onPress={() => {
          if (isAiTurn || gameResult !== null) return;
          if (!upgradeEnabled || !entityId || !upgradeTarget || !entityTerritoryId) return;
          pushHistory();
          setEntities((prev) => {
            const next = new Map(prev);
            next.set(selectedEntityKey, upgradeTarget);
            return next;
          });
          setTerritoryBalances((prev) => {
            const next = new Map(prev);
            next.set(entityTerritoryId, entityTerritoryBalance - upgradeCost);
            return next;
          });
        }}
      >
        <Text
          style={[
            styles.buildBtnText,
            !upgradeEnabled && styles.buildBtnTextDisabled,
          ]}
        >
          ⬆ Upgrade {canUpgrade ? `(${upgradeCost}g)` : "(Max)"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
