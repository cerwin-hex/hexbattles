import React from "react";
import { ScrollView, StyleProp, Text, TouchableOpacity, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { nextDefenseUpkeep, ENTITY_META, CITY_BONUS } from "@/utils/hexGrid";
import type { HexTile, TerritoryOwner, EntityType } from "@/types";
import {
  UNIT_PURCHASABLES,
  BUILDING_PURCHASABLES,
  ENTITY_PANEL_H,
  BOTTOM_BAR_H,
} from "@/constants/gameConstants";
import styles from "@/app/gameStyles";
import { UnitIcon, CoinValue } from "@/components/UnitIcon";

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
                  : `${item.cost}`;
          // Only the bare numeric cost is a money value (gets a coin icon); the
          // status labels ("Round 2+", "BUILT", "FREE", …) stay plain text.
          const costIsMoney =
            !round1Locked &&
            !bridgeLocked &&
            !cityAlreadyBuilt &&
            !cityTooSmall &&
            !playerTowerFree;
          const nextUpkeepLabel = (() => {
            if (isTower) {
              const cost = nextDefenseUpkeep("tower", selectedTerritoryDefenseCounts.tower);
              return { value: `-${cost}`, income: false };
            }
            if (isCastle) {
              const cost = nextDefenseUpkeep("castle", selectedTerritoryDefenseCounts.castle);
              return { value: `-${cost}`, income: false };
            }
            if (item.id === "city") {
              return { value: `+${CITY_BONUS}`, income: true };
            }
            const upkeep = ENTITY_META[item.id as EntityType].upkeep;
            if (upkeep > 0) {
              return { value: `-${upkeep}`, income: false };
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
              <UnitIcon entityId={item.id as EntityType} size={28} />
              <Text
                style={[
                  styles.ribbonName,
                  !enabled && styles.ribbonDim,
                  isArmed && styles.ribbonNameArmed,
                ]}
              >
                {item.name}
              </Text>
              {costIsMoney ? (
                <CoinValue
                  value={costLabel}
                  size={13}
                  textStyle={[
                    styles.ribbonCost,
                    !enabled && styles.ribbonDim,
                    isArmed && styles.ribbonNameArmed,
                  ]}
                />
              ) : (
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
              )}
              {nextUpkeepLabel && (
                <CoinValue
                  value={nextUpkeepLabel.value}
                  suffix="/turn"
                  size={11}
                  style={{ marginTop: 1 }}
                  textStyle={[
                    styles.ribbonCost,
                    !enabled && styles.ribbonDim,
                    { fontSize: 10 },
                    !nextUpkeepLabel.income && enabled && { color: "#E07060" },
                    nextUpkeepLabel.income && enabled && { color: "#70C870" },
                  ]}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
}
