import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import {
  ENTITY_META,
  UNIT_UPGRADE,
  getContiguousTerritory,
  getTerritoryId,
  isRanged,
} from "@/utils/hexGrid";
import type { EntityType, HexTile } from "@/types";
import { BOTTOM_BAR_H } from "@/constants/gameConstants";
import styles from "@/app/gameStyles";

interface EntityPanelProps {
  selectedEntityKey: string;
  entities: Map<string, EntityType>;
  activeTileMap: Map<string, HexTile>;
  spentUnits: Set<string>;
  firedUnits: Set<string>;
  territoryBalances: Map<string, number>;
  isAiTurn: boolean;
  gameResult: "victory" | "defeat" | null;
  botInset: number;
  pushHistory: () => void;
  setEntities: (updater: (prev: Map<string, EntityType>) => Map<string, EntityType>) => void;
  setFiredUnits: (updater: (prev: Set<string>) => Set<string>) => void;
  setTerritoryBalances: (updater: (prev: Map<string, number>) => Map<string, number>) => void;
  setSelectedEntityKey: (key: string | null) => void;
  onRemoveOverride?: () => void;
}

export default function EntityPanel({
  selectedEntityKey,
  entities,
  activeTileMap,
  spentUnits,
  firedUnits,
  territoryBalances,
  isAiTurn,
  gameResult,
  botInset,
  pushHistory,
  setEntities,
  setFiredUnits,
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
  const entityTerritory = entityTile
    ? getContiguousTerritory(activeTileMap, selectedEntityKey, "player", entities)
    : [];
  const entityTerritoryId = entityTile ? getTerritoryId(entityTerritory) : null;
  const entityTerritoryBalance = entityTerritoryId
    ? (territoryBalances.get(entityTerritoryId) ?? 0)
    : 0;
  const removeCost = 0;
  // A spent unit can still be upgraded, mirroring how a fresh unit may be merged
  // into a spent one: the upgrade just swaps the entity type and never touches
  // spentUnits, so the upgraded unit stays spent for the rest of the turn.
  const upgradeEnabled = canUpgrade && entityTerritoryBalance >= upgradeCost;
  const removeEnabled = isUnit
    ? !isSpent
    : !!entityTerritoryId && entityTerritoryBalance >= removeCost;
  // Bridges, cities and rebels are all 0/0 in ENTITY_META — a strength readout
  // for them would be noise at best and misleading at worst, so the line is
  // driven off the data rather than off an entity allow-list.
  const hasStrength = entityId
    ? ENTITY_META[entityId].offStrength > 0 || ENTITY_META[entityId].defStrength > 0
    : false;

  return (
    <View style={[styles.entityPanel, { bottom: BOTTOM_BAR_H + botInset }]}>
      {entityId && hasStrength && (
        // flexShrink so the readout gives way on a narrow screen instead of
        // pushing the Upgrade button off the fixed-width row (the buttons are
        // content-sized, so without this the row simply overflows).
        <View style={{ justifyContent: "center", paddingHorizontal: 8, flexShrink: 1 }}>
          <Text style={[styles.buildBtnText, { fontSize: 12 }]}>
            {`Atk ${ENTITY_META[entityId].offStrength} · Def ${ENTITY_META[entityId].defStrength}`}
          </Text>
          {isRanged(entityId) && (
            <Text
              style={[
                styles.buildBtnText,
                { fontSize: 11 },
                // The actionable state carries the full colour; the spent one is
                // dimmed, matching how every other affordance in the UI reads.
                firedUnits.has(selectedEntityKey) && styles.buildBtnTextDisabled,
              ]}
            >
              {firedUnits.has(selectedEntityKey) ? "Shot used" : "Shot ready"}
            </Text>
          )}
        </View>
      )}
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
          // firedUnits is keyed by tile, not by unit, so the removed unit's flag
          // would otherwise be inherited by whatever is bought onto the tile
          // next — a fresh bowman reading "Shot used" before it ever fired. The
          // move path clears the destination the same way (advanceFired).
          setFiredUnits((prev) => {
            if (!prev.has(selectedEntityKey)) return prev;
            const next = new Set(prev);
            next.delete(selectedEntityKey);
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
          ✕ Remove{removeCost > 0 ? ` (${removeCost})` : ""}
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
          ⬆ Upgrade {canUpgrade ? `(${upgradeCost})` : "(Max)"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
