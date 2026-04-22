import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import Svg, { Circle, G, Text as SvgText } from "react-native-svg";
import { ENTITY_META } from "@/utils/hexGrid";
import { TERRITORY_BORDERS } from "@/constants/colors";
import type { EntityType, HexTile, TerritoryOwner } from "@/types";
import AnimatedMovingUnit from "@/components/AnimatedMovingUnit";

const AnimatedG = Animated.createAnimatedComponent(G);

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
  boardW: number;
  boardH: number;
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
  boardW,
  boardH,
}: IdleUnitLayerProps) {
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

  const bounceAnimatedProps = useAnimatedProps(() => ({
    transform: [{ translateY: idleBounceY.value }],
  }));

  const animFromPos = animatingUnit
    ? tileDataMap.get(animatingUnit.fromKey)
    : null;
  const animToPos = animatingUnit
    ? tileDataMap.get(animatingUnit.toKey)
    : null;

  const r = HEX_SIZE * 0.5;
  const playerBorderColor = TERRITORY_BORDERS["player"];

  const idleUnits: Array<{
    key: string;
    icon: string;
    cx: number;
    cy: number;
  }> = [];

  for (const [key, entityId] of entities) {
    if (entityId === "city" || entityId === "rebel") continue;
    if (animatingUnit && key === animatingUnit.fromKey) continue;
    if (
      animatingUnit &&
      animatingUnit.hideDestination &&
      key === animatingUnit.toKey
    )
      continue;
    const meta = ENTITY_META[entityId];
    if (!meta.isUnit) continue;
    const liveTile = activeTileMap.get(key);
    if (liveTile?.owner !== "player") continue;
    if (spentUnits.has(key)) continue;
    if (selectedEntityKey === key) continue;
    const pos = tileDataMap.get(key);
    if (!pos) continue;
    idleUnits.push({ key, icon: meta.icon, cx: pos.cx, cy: pos.cy });
  }

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
      <Svg
        width={boardW}
        height={boardH}
        style={StyleSheet.absoluteFillObject}
      >
        <AnimatedG animatedProps={bounceAnimatedProps}>
          {idleUnits.map(({ key, icon, cx, cy }) => (
            <React.Fragment key={`idle-${key}`}>
              <Circle
                cx={cx}
                cy={cy}
                r={r}
                fill="rgba(30,50,120,0.9)"
                stroke={playerBorderColor}
                strokeWidth={2.2}
              />
              <SvgText
                x={cx}
                y={cy + r * 0.35}
                textAnchor="middle"
                fontSize={r * 1.1}
                fill="#fff"
              >
                {icon}
              </SvgText>
            </React.Fragment>
          ))}
        </AnimatedG>
      </Svg>
    </View>
  );
}
