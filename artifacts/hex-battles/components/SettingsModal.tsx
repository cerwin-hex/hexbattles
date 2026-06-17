import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { GestureHandlerRootView, ScrollView } from "react-native-gesture-handler";
import { Slider } from "@/components/Slider";
import { COLOR_PALETTE } from "@/constants/colors";
import {
  COLOR_KEYS,
  type ColorKey,
  type GameSettings,
  MAX_CITY_COUNT,
  MAX_TERRAIN_PCT,
  MIN_CITY_COUNT,
  MIN_TERRAIN_PCT,
} from "@/utils/settings";

interface SettingsModalProps {
  visible: boolean;
  initialSettings: GameSettings;
  onClose: (next: GameSettings) => void;
}

export function SettingsModal({
  visible,
  initialSettings,
  onClose,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<GameSettings>(initialSettings);

  useEffect(() => {
    if (visible) setDraft(initialSettings);
  }, [visible, initialSettings]);

  function update<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleClose() {
    onClose(draft);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <GestureHandlerRootView style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Player Color</Text>
              <View style={styles.swatchRow}>
                {COLOR_KEYS.map((key) => (
                  <ColorSwatch
                    key={key}
                    colorKey={key}
                    active={draft.playerColor === key}
                    onPress={() => {
                      Haptics.selectionAsync();
                      update("playerColor", key);
                    }}
                  />
                ))}
              </View>
            </View>

            <View style={styles.sliderBlock}>
              <Slider
                label="Mountains"
                value={draft.mountainPct}
                min={MIN_TERRAIN_PCT}
                max={MAX_TERRAIN_PCT}
                onChange={(v) => update("mountainPct", v)}
                formatValue={(v) => `${v}%`}
                leftLabel={`${MIN_TERRAIN_PCT}%`}
                rightLabel={`${MAX_TERRAIN_PCT}%`}
              />
            </View>

            <View style={styles.sliderBlock}>
              <Slider
                label="Lakes"
                value={draft.lakePct}
                min={MIN_TERRAIN_PCT}
                max={MAX_TERRAIN_PCT}
                onChange={(v) => update("lakePct", v)}
                formatValue={(v) => `${v}%`}
                leftLabel={`${MIN_TERRAIN_PCT}%`}
                rightLabel={`${MAX_TERRAIN_PCT}%`}
              />
            </View>

            <View style={styles.sliderBlock}>
              <Slider
                label="Desert"
                value={draft.desertPct}
                min={MIN_TERRAIN_PCT}
                max={MAX_TERRAIN_PCT}
                onChange={(v) => update("desertPct", v)}
                formatValue={(v) => `${v}%`}
                leftLabel={`${MIN_TERRAIN_PCT}%`}
                rightLabel={`${MAX_TERRAIN_PCT}%`}
              />
            </View>

            <View style={styles.sliderBlock}>
              <Slider
                label="Forest"
                value={draft.forestPct}
                min={MIN_TERRAIN_PCT}
                max={MAX_TERRAIN_PCT}
                onChange={(v) => update("forestPct", v)}
                formatValue={(v) => `${v}%`}
                leftLabel={`${MIN_TERRAIN_PCT}%`}
                rightLabel={`${MAX_TERRAIN_PCT}%`}
              />
            </View>

            <View style={styles.sliderBlock}>
              <Slider
                label="Neutral Cities"
                value={draft.cityCount}
                min={MIN_CITY_COUNT}
                max={MAX_CITY_COUNT}
                onChange={(v) => update("cityCount", v)}
                leftLabel={String(MIN_CITY_COUNT)}
                rightLabel={String(MAX_CITY_COUNT)}
              />
            </View>
          </ScrollView>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ColorSwatch({
  colorKey,
  active,
  onPress,
}: {
  colorKey: ColorKey;
  active: boolean;
  onPress: () => void;
}) {
  const entry = COLOR_PALETTE[colorKey];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.swatch,
        { backgroundColor: entry.fill, borderColor: active ? "#F0D080" : entry.fill },
        active && styles.swatchActive,
      ]}
    >
      {active && <Text style={styles.swatchCheck}>✓</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  container: {
    width: "100%",
    maxHeight: "88%",
    backgroundColor: "#221A0E",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#7A6030",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#4A3C1E",
    backgroundColor: "#1C1408",
  },
  title: {
    fontSize: 15,
    fontFamily: "Cinzel_700Bold",
    color: "#C8A24A",
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#3A2A10",
    borderWidth: 1,
    borderColor: "#7A6030",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    fontSize: 13,
    color: "#C8A24A",
    fontFamily: "Cinzel_400Regular",
  },
  scroll: {
    padding: 20,
    gap: 24,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: "Cinzel_400Regular",
    color: "#A08A60",
    letterSpacing: 2,
  },
  swatchRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchActive: {
    borderWidth: 3,
  },
  swatchCheck: {
    fontSize: 18,
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
  sliderBlock: {
    // gap handled by ScrollView contentContainerStyle
  },
});
