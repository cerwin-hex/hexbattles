import * as Haptics from "expo-haptics";
import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

interface ToggleProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
}

/**
 * A small on/off switch in the menu's gold-on-brown style. React Native's own
 * Switch cannot be themed to match, so this is hand-rolled — the app has no
 * other switch today.
 */
export function Toggle({ value, onValueChange, accessibilityLabel }: ToggleProps) {
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.75}
      onPress={() => {
        Haptics.selectionAsync();
        onValueChange(!value);
      }}
      style={[styles.track, value ? styles.trackOn : styles.trackOff]}
    >
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 46,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  trackOn: {
    borderColor: "#C8A24A",
    backgroundColor: "#3A2A10",
  },
  trackOff: {
    borderColor: "#5A4520",
    backgroundColor: "#1E1408",
  },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  knobOn: {
    backgroundColor: "#F0D080",
    alignSelf: "flex-end",
  },
  knobOff: {
    backgroundColor: "#6B5A34",
    alignSelf: "flex-start",
  },
});
