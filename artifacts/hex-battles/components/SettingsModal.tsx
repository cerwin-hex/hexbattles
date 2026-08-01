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
import { GameElementsSection } from "@/components/GameElementsSection";
import { Slider } from "@/components/Slider";
import { Toggle } from "@/components/Toggle";
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

            <GameElementsSection
              elements={draft.elements}
              showBeta={draft.showBetaElements}
              onChange={(next) => update("elements", next)}
            />

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Beta Elements</Text>
              <View style={styles.betaRow}>
                <Text style={styles.betaBlurb}>
                  Show unfinished features in the game elements list
                </Text>
                <Toggle
                  value={draft.showBetaElements}
                  accessibilityLabel="Show beta elements"
                  onValueChange={(v) => update("showBetaElements", v)}
                />
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.terrainHeader}>
                <Text style={styles.sectionLabel}>Terrain</Text>
                <Text style={styles.terrainRange}>
                  {`${MIN_TERRAIN_PCT}–${MAX_TERRAIN_PCT}%`}
                </Text>
              </View>
              <View style={styles.terrainBlock}>
                {([
                  ["Mountains", "mountainPct"],
                  ["Lakes", "lakePct"],
                  ["Desert", "desertPct"],
                  ["Forest", "forestPct"],
                ] as [string, "mountainPct" | "lakePct" | "desertPct" | "forestPct"][]).map(
                  ([label, key]) => (
                    <Slider
                      key={key}
                      compact
                      label={label}
                      value={draft[key]}
                      min={MIN_TERRAIN_PCT}
                      max={MAX_TERRAIN_PCT}
                      onChange={(v) => update(key, v)}
                      formatValue={(v) => `${v}%`}
                    />
                  ),
                )}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Neutral Cities</Text>
              <View style={styles.terrainBlock}>
                <Slider
                  compact
                  label="On the map"
                  value={draft.cityCount}
                  min={MIN_CITY_COUNT}
                  max={MAX_CITY_COUNT}
                  onChange={(v) => update("cityCount", v)}
                />
              </View>
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
  betaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  betaBlurb: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
    lineHeight: 18,
  },
  terrainHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  terrainRange: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
  },
  terrainBlock: {
    gap: 12,
    borderWidth: 1,
    borderColor: "#4A3C1E",
    borderRadius: 5,
    backgroundColor: "#1E1408",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
});
