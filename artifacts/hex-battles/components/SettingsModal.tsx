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
import { COLOR_PALETTE } from "@/constants/colors";
import {
  cityCountForMap,
  cityPctForCount,
  COLOR_KEYS,
  type ColorKey,
  type GameSettings,
  MAX_TERRAIN_PCT,
  maxCitiesForMap,
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

  // Cities are stored as a density but chosen as whole cities, against the map
  // size picked in the menu: pick 3 cities on a 100-tile map, grow the map to
  // 200, and the slider reads 6 next time it opens.
  const mapTiles = draft.tileCount;
  const cityMax = maxCitiesForMap(mapTiles);
  const cityValue = cityCountForMap(draft.cityPct, mapTiles);

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
              onChange={(next) => update("elements", next)}
            />

            {/* Terrain and cities share one heading but keep a box each. The
                percentage range in the header belongs to the terrain sliders;
                the city slider next to it reads out in whole cities. */}
            <View style={styles.section}>
              <View style={styles.terrainHeader}>
                <Text style={styles.sectionLabel}>Terrain &amp; Cities</Text>
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
              <View style={styles.terrainBlock}>
                <Slider
                  compact
                  label="Neutral Cities"
                  value={cityValue}
                  min={0}
                  max={cityMax}
                  onChange={(v) => update("cityPct", cityPctForCount(v, mapTiles))}
                  formatValue={(v) => (v === 1 ? "1 city" : `${v} cities`)}
                />
                <Text style={styles.blockHint}>
                  {`Scales with map size · ${mapTiles} tiles`}
                </Text>
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
  blockHint: {
    fontSize: 10,
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
