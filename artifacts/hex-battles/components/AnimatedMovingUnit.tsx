import React from "react";
import Animated, {
  SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { ENTITY_META } from "@/utils/hexGrid";
import { useOwnerColors } from "@/contexts/SettingsContext";
import { UnitToken } from "@/components/UnitToken";
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
        { position: "absolute", left: fromPos.cx - r, top: fromPos.cy - r },
        animStyle,
      ]}
    >
      <UnitToken
        r={r}
        icon={meta.icon}
        bgColor={bgColor}
        borderColor={borderColor}
        borderWidth={2.2}
        opacity={0.9}
      />
    </Animated.View>
  );
}
