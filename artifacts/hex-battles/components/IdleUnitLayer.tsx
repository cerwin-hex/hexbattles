import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { ENTITY_META } from "@/utils/hexGrid";
import { useOwnerColors } from "@/contexts/SettingsContext";
import type { EntityType, HexTile, TerritoryOwner } from "@/types";
import AnimatedMovingUnit from "@/components/AnimatedMovingUnit";
import { UnitToken } from "@/components/UnitToken";

interface AnimatingUnit {
  fromKey: string;
  toKey: string;
  entityId: EntityType;
  owner: TerritoryOwner;
  hideDestination: boolean;
}

export interface IdleUnitLayerProps {
  entities: Map<string, EntityType>;
  activeTileMap: Map<string, HexTile>;
  tileDataMap: Map<string, { cx: number; cy: number }>;
  spentUnits: Set<string>;
  selectedEntityKey: string | null;
  animatingUnit: AnimatingUnit | null;
  animUnitProgress: SharedValue<number>;
  HEX_SIZE: number;
  isAiTurn: boolean;
}

export function IdleUnitLayer({
  entities,
  activeTileMap,
  tileDataMap,
  spentUnits,
  selectedEntityKey,
  animatingUnit,
  animUnitProgress,
  HEX_SIZE,
  isAiTurn,
}: IdleUnitLayerProps) {
  const { borders: TERRITORY_BORDERS } = useOwnerColors();
  const idleBounceY = useSharedValue(0);

  useEffect(() => {
    if (isAiTurn) {
      cancelAnimation(idleBounceY);
      idleBounceY.value = withTiming(0, { duration: 150 });
      return;
    }
    idleBounceY.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 550, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 550, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(idleBounceY);
    };
  }, [isAiTurn]);

  const idleBounceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: idleBounceY.value }],
  }));

  const animFromPos = animatingUnit
    ? tileDataMap.get(animatingUnit.fromKey)
    : null;
  const animToPos = animatingUnit
    ? tileDataMap.get(animatingUnit.toKey)
    : null;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {animatingUnit && animFromPos && animToPos && (
        <AnimatedMovingUnit
          fromPos={animFromPos}
          toPos={animToPos}
          entityId={animatingUnit.entityId}
          owner={animatingUnit.owner}
          hexSize={HEX_SIZE}
          progress={animUnitProgress}
        />
      )}
      {Array.from(entities.entries()).map(([key, entityId]) => {
        if (entityId === "city" || entityId === "rebel") return null;
        if (animatingUnit && key === animatingUnit.fromKey) return null;
        if (
          animatingUnit &&
          animatingUnit.hideDestination &&
          key === animatingUnit.toKey
        )
          return null;
        const meta = ENTITY_META[entityId];
        if (!meta.isUnit) return null;
        const liveTile = activeTileMap.get(key);
        if (liveTile?.owner !== "player") return null;
        if (spentUnits.has(key)) return null;
        if (selectedEntityKey === key) return null;
        const pos = tileDataMap.get(key);
        if (!pos) return null;
        const r = HEX_SIZE * 0.5;
        return (
          <Animated.View
            key={`bounce-${key}`}
            style={[
              { position: "absolute", left: pos.cx - r, top: pos.cy - r },
              idleBounceStyle,
            ]}
          >
            <UnitToken
              r={r}
              icon={meta.icon}
              bgColor="rgba(30,50,120,0.9)"
              borderColor={TERRITORY_BORDERS["player"]}
              borderWidth={2.2}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}
