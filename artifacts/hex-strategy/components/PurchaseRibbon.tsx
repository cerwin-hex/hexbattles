import React from "react";
import { ScrollView, StyleProp, Text, TouchableOpacity, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { nextDefenseUpkeep } from "@/utils/hexGrid";
import type { HexTile, TerritoryOwner, EntityType } from "@/types";
import {
  UNIT_PURCHASABLES,
  BUILDING_PURCHASABLES,
  ENTITY_PANEL_H,
  BOTTOM_BAR_H,
} from "@/constants/gameConstants";
import styles from "@/app/gameStyles";

interface PurchaseRibbonProps {
  ribbonStyle: StyleProp<ViewStyle>;
  ribbonScrollRef: React.RefObject<ScrollView | null>;
  ribbonMode: "units" | "buildings" | null;
  botInset: number;
  selectedEntityKey: string | null;
  turn: number;
  selectedTerritory: HexTile[];
  selectedTerritoryBalance: number;
  selectedTerritoryDefenseCounts: { tower: number; castle: number };
  territoryHasCity: boolean;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  armedEntityId: EntityType | null;
  setArmedEntityId: (id: EntityType | null) => void;
  hasBridgePlacementAvailable: boolean;
}

export default function PurchaseRibbon({
  ribbonStyle,
  ribbonScrollRef,
  ribbonMode,
  botInset,
  selectedEntityKey,
  turn,
  selectedTerritory,
  selectedTerritoryBalance,
  selectedTerritoryDefenseCounts,
  territoryHasCity,
  freeTowerUsedTiles,
  armedEntityId,
  setArmedEntityId,
  hasBridgePlacementAvailable,
}: PurchaseRibbonProps) {
  return (
    <Animated.View
      style={[
        styles.ribbon,
        {
          bottom:
            BOTTOM_BAR_H +
            botInset +
            (selectedEntityKey ? ENTITY_PANEL_H : 0),
        },
        ribbonStyle,
      ]}
    >
      <ScrollView
        ref={ribbonScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.ribbonContent}
      >
        {(ribbonMode === "units"
          ? UNIT_PURCHASABLES
          : BUILDING_PURCHASABLES
        ).map((item) => {
          const isArmed = armedEntityId === item.id;
          const isTower = item.id === "tower";
          const isCastle = item.id === "castle";
          const isBridge = item.id === "bridge";
          const round1Locked = turn === 1 && !isTower;
          const cityAlreadyBuilt = item.id === "city" && territoryHasCity;
          const cityTooSmall = item.id === "city" && selectedTerritory.length < 6;
          const cityLocked = cityAlreadyBuilt || cityTooSmall;
          const bridgeLocked = isBridge && !hasBridgePlacementAvailable;
          const playerUsedTilesSet = freeTowerUsedTiles.get("player") ?? new Set<string>();
          const playerTowerFree =
            isTower &&
            turn === 1 &&
            selectedTerritory.length >= 2 &&
            !selectedTerritory.some((t) => playerUsedTilesSet.has(t.key));
          const effectiveCost = playerTowerFree ? 0 : item.cost;
          const affordable = effectiveCost <= selectedTerritoryBalance;
          const enabled = affordable && !cityLocked && !round1Locked && !bridgeLocked;
          const costLabel = round1Locked
            ? "Round 2+"
            : bridgeLocked
              ? "No water"
            : cityAlreadyBuilt
              ? "BUILT"
              : cityTooSmall
                ? "<6 tiles"
                : playerTowerFree
                  ? "FREE"
                  : `${item.cost}g`;
          const nextUpkeepLabel = (() => {
            if (isTower) {
              const cost = nextDefenseUpkeep("tower", selectedTerritoryDefenseCounts.tower);
              return `${cost}/turn`;
            }
            if (isCastle) {
              const cost = nextDefenseUpkeep("castle", selectedTerritoryDefenseCounts.castle);
              return `${cost}/turn`;
            }
            return null;
          })();
          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.ribbonItem,
                !enabled && styles.ribbonItemDisabled,
                isArmed && styles.ribbonItemArmed,
              ]}
              activeOpacity={enabled ? 0.75 : 1}
              onPress={() => {
                if (!enabled) return;
                setArmedEntityId(isArmed ? null : (item.id as EntityType));
              }}
            >
              <Text style={styles.ribbonIcon}>{item.icon}</Text>
              <Text
                style={[
                  styles.ribbonName,
                  !enabled && styles.ribbonDim,
                  isArmed && styles.ribbonNameArmed,
                ]}
              >
                {item.name}
              </Text>
              <Text
                style={[
                  styles.ribbonCost,
                  !enabled && styles.ribbonDim,
                  isArmed && styles.ribbonNameArmed,
                  playerTowerFree && styles.ribbonCostFree,
                  cityAlreadyBuilt && styles.ribbonCostBuilt,
                ]}
              >
                {costLabel}
              </Text>
              {nextUpkeepLabel && (
                <Text
                  style={[
                    styles.ribbonCost,
                    !enabled && styles.ribbonDim,
                    { fontSize: 10, marginTop: 1 },
                  ]}
                >
                  {nextUpkeepLabel}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
}
