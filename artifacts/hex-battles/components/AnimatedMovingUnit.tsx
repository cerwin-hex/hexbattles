import React from "react";
import { Text } from "react-native";
import Animated, {
  SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { ENTITY_META } from "@/utils/hexGrid";
import { useOwnerColors } from "@/contexts/SettingsContext";
import type { EntityType, TerritoryOwner } from "@/types";

interface AnimatedMovingUnitProps {
  fromPos: { cx: number; cy: number };
  toPos: { cx: number; cy: number };
  entityId: EntityType;
  owner: TerritoryOwner;
  hexSize: number;
  progress: SharedValue<number>;
}

export default function AnimatedMovingUnit({
  fromPos,
  toPos,
  entityId,
  owner,
  hexSize,
  progress,
}: AnimatedMovingUnitProps) {
  const { borders: TERRITORY_BORDERS } = useOwnerColors();
  const meta = ENTITY_META[entityId];
  const r = hexSize * 0.5;
  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        { translateX: (toPos.cx - fromPos.cx) * p },
        { translateY: (toPos.cy - fromPos.cy) * p },
      ],
    };
  });
  const bgColor =
    owner === "player" ? "rgba(30,50,120,0.9)" : "rgba(80,20,20,0.9)";
  const borderColor = TERRITORY_BORDERS[owner] ?? TERRITORY_BORDERS["player"];
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: fromPos.cx - r,
          top: fromPos.cy - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: bgColor,
          borderWidth: 2.2,
          borderColor,
          alignItems: "center",
          justifyContent: "center",
        },
        animStyle,
      ]}
    >
      <Text style={{ fontSize: r * 1.1, lineHeight: r * 1.6 }}>
        {meta.icon}
      </Text>
    </Animated.View>
  );
}
