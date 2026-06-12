import React from "react";
import Animated, {
  SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
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
  const r = hexSize * 0.55;
  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        { translateX: (toPos.cx - fromPos.cx) * p },
        { translateY: (toPos.cy - fromPos.cy) * p },
      ],
    };
  });
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
        entityId={entityId}
        borderColor={borderColor}
        borderWidth={3.0}
        opacity={1.0}
      />
    </Animated.View>
  );
}
