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
}: SliderProps) {
  const thumbX = useSharedValue(0);
  const startX = useSharedValue(0);
  const trackWShared = useSharedValue(0);
  const lastEmitted = useSharedValue(value);

  const valueToX = useCallback(
    (v: number, width: number) => {
      const maxX = Math.max(0, width - THUMB_SIZE);
      const range = max - min || 1;
      return ((v - min) / range) * maxX;
    },
    [min, max],
  );

  const handleTrackLayout = useCallback(
    (width: number) => {
      trackWShared.value = width;
      thumbX.value = valueToX(value, width);
    },
    [valueToX, value, trackWShared, thumbX],
  );

  useAnimatedReaction(
    () => ({ v: value, w: trackWShared.value }),
    (curr) => {
      if (curr.w > 0) {
        thumbX.value = valueToX(curr.v, curr.w);
      }
    },
    [valueToX, value],
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
    .onBegin(() => {
      startX.value = thumbX.value;
    })
    .onUpdate((e) => {
      const maxX = trackWShared.value - THUMB_SIZE;
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
    width: thumbX.value + THUMB_SIZE,
  }));

  const display = formatValue ? formatValue(value) : String(value);

  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.valueDisplay}>{display}</Text>
      </View>
      <GestureDetector gesture={panGesture}>
        <View
          style={styles.track}
          onLayout={(e) => handleTrackLayout(e.nativeEvent.layout.width)}
        >
          <Animated.View style={[styles.fill, fillStyle]} />
          <Animated.View style={[styles.thumb, thumbStyle]} />
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
  valueDisplay: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#C8A24A",
  },
  track: {
    height: TRACK_HEIGHT,
    backgroundColor: "#2E2210",
    borderRadius: 18,
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
    borderRadius: 18,
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: "#C8A24A",
    borderWidth: 2,
    borderColor: "#F0D080",
    top: (TRACK_HEIGHT - THUMB_SIZE) / 2,
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
