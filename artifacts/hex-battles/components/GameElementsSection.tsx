import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Toggle } from "@/components/Toggle";
import {
  GAME_ELEMENTS,
  enabledElementCount,
  type GameElements,
} from "@/constants/gameElements";

interface GameElementsSectionProps {
  elements: GameElements;
  onChange: (next: GameElements) => void;
}

/**
 * The "Game Elements" list in Settings: one toggle per part of the game a new
 * game can be started with. The header carries an "N of M" summary so the count
 * is readable without counting the switches. Unfinished elements are listed
 * like the rest, marked BETA and off until switched on.
 */
export function GameElementsSection({
  elements,
  onChange,
}: GameElementsSectionProps) {
  const defs = GAME_ELEMENTS;
  const { on, total } = enabledElementCount(elements);

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.label}>Game Elements</Text>
        <Text style={styles.summary}>{`${on} of ${total}`}</Text>
      </View>

      <View style={styles.list}>
        {defs.map((def) => (
          <View key={def.id} style={styles.row}>
            <View style={styles.rowText}>
              <View style={styles.rowTitleLine}>
                <Text style={styles.rowTitle}>{def.name}</Text>
                {def.beta && <Text style={styles.betaChip}>BETA</Text>}
              </View>
              <Text style={styles.rowBlurb}>{def.blurb}</Text>
            </View>
            <Toggle
              value={elements[def.id]}
              accessibilityLabel={def.name}
              onValueChange={(v) => onChange({ ...elements, [def.id]: v })}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 13,
    fontFamily: "Cinzel_400Regular",
    color: "#A08A60",
    letterSpacing: 2,
  },
  summary: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
  },
  list: {
    borderWidth: 1,
    borderColor: "#4A3C1E",
    borderRadius: 5,
    backgroundColor: "#1E1408",
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#D4BF96",
  },
  betaChip: {
    fontSize: 8,
    fontFamily: "Inter_700Bold",
    color: "#C8A24A",
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: "#7A6030",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  rowBlurb: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
  },
});
