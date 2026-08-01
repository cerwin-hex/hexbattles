import * as Haptics from "expo-haptics";
import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

const THUMB_SIZE = 26;
const TRACK_HEIGHT = 36;
const COMPACT_THUMB_SIZE = 20;
const COMPACT_TRACK_HEIGHT = 26;

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  leftLabel?: string;
  rightLabel?: string;
  /** Shorter track and a smaller value readout, for stacks of many sliders. */
  compact?: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  leftLabel,
  rightLabel,
  compact = false,
}: SliderProps) {
  const thumbSize = compact ? COMPACT_THUMB_SIZE : THUMB_SIZE;
  const trackHeight = compact ? COMPACT_TRACK_HEIGHT : TRACK_HEIGHT;
  const thumbX = useSharedValue(0);
  const startX = useSharedValue(0);
  const trackWShared = useSharedValue(0);
  const lastEmitted = useSharedValue(value);

  const valueToX = useCallback(
    (v: number, width: number) => {
      const maxX = Math.max(0, width - thumbSize);
      const range = max - min || 1;
      return ((v - min) / range) * maxX;
    },
    [min, max, thumbSize],
  );

  const handleTrackLayout = useCallback(
    (width: number) => {
      trackWShared.value = width;
      thumbX.value = valueToX(value, width);
    },
    [valueToX, value, trackWShared, thumbX],
  );

  // `value` MUST be in the dependency list: the prepare worklet captures it by
  // closure, so without it the reaction keeps comparing against the value this
  // slider first mounted with. That is invisible for a slider seeded before it
  // renders, but the menu's sliders get their stored value when settings
  // hydration lands — a frame or two after mount — and the thumb would sit at
  // the default while the readout showed the real number.
  useAnimatedReaction(
    () => ({ v: value, w: trackWShared.value }),
    (curr) => {
      if (curr.w > 0) {
        const maxX = Math.max(0, curr.w - thumbSize);
        const range = max - min || 1;
        thumbX.value = ((curr.v - min) / range) * maxX;
      }
    },
    [min, max, value, thumbSize],
  );

  const emit = useCallback(
    (v: number) => {
      if (v !== lastEmitted.value) {
        lastEmitted.value = v;
        Haptics.selectionAsync();
        onChange(v);
      }
    },
    [onChange, lastEmitted],
  );

  const panGesture = Gesture.Pan()
    .activeOffsetX([-5, 5])
    .failOffsetY([-15, 15])
    .onBegin(() => {
      startX.value = thumbX.value;
    })
    .onUpdate((e) => {
      const maxX = trackWShared.value - thumbSize;
      const newX = Math.max(0, Math.min(maxX, startX.value + e.translationX));
      thumbX.value = newX;
      const frac = maxX > 0 ? newX / maxX : 0;
      const raw = min + frac * (max - min);
      const stepped = Math.round(raw / step) * step;
      const clamped = Math.max(min, Math.min(max, stepped));
      runOnJS(emit)(clamped);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: thumbX.value + thumbSize,
  }));

  const display = formatValue ? formatValue(value) : String(value);

  return (
    <View style={compact ? styles.sectionCompact : styles.section}>
      <View style={styles.labelRow}>
        <Text style={compact ? styles.labelCompact : styles.label}>{label}</Text>
        <Text style={compact ? styles.valueDisplayCompact : styles.valueDisplay}>{display}</Text>
      </View>
      <GestureDetector gesture={panGesture}>
        <View
          style={[styles.track, { height: trackHeight, borderRadius: trackHeight / 2 }]}
          onLayout={(e) => handleTrackLayout(e.nativeEvent.layout.width)}
        >
          <Animated.View style={[styles.fill, { borderRadius: trackHeight / 2 }, fillStyle]} />
          <Animated.View
            style={[
              styles.thumb,
              {
                width: thumbSize,
                height: thumbSize,
                borderRadius: thumbSize / 2,
                top: (trackHeight - thumbSize) / 2,
              },
              thumbStyle,
            ]}
          />
        </View>
      </GestureDetector>
      {(leftLabel || rightLabel) && (
        <View style={styles.endLabels}>
          <Text style={styles.endLabelText}>{leftLabel ?? ""}</Text>
          <Text style={styles.endLabelText}>{rightLabel ?? ""}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  sectionCompact: {
    gap: 4,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 13,
    fontFamily: "Cinzel_400Regular",
    color: "#A08A60",
    letterSpacing: 2,
  },
  labelCompact: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#A08A60",
    letterSpacing: 0,
  },
  valueDisplay: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#C8A24A",
  },
  valueDisplayCompact: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#C8A24A",
  },
  track: {
    backgroundColor: "#2E2210",
    borderWidth: 1,
    borderColor: "#7A6030",
    justifyContent: "center",
    overflow: "hidden",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#7A5418",
  },
  thumb: {
    position: "absolute",
    backgroundColor: "#C8A24A",
    borderWidth: 2,
    borderColor: "#F0D080",
  },
  endLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  endLabelText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#A08A60",
  },
});
