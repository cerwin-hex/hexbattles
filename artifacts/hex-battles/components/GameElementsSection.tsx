import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Toggle } from "@/components/Toggle";
import {
  enabledVisibleCount,
  visibleGameElements,
  type GameElements,
} from "@/constants/gameElements";

interface GameElementsSectionProps {
  elements: GameElements;
  showBeta: boolean;
  onChange: (next: GameElements) => void;
  /** Start with the list open. Settings opens it; a compact host would not. */
  initiallyExpanded?: boolean;
}

/**
 * The collapsible "Game Elements" list. The header carries an "N of M" summary
 * of the visible elements, so a collapsed section still shows how many parts of
 * the game the next new game will include.
 */
export function GameElementsSection({
  elements,
  showBeta,
  onChange,
  initiallyExpanded = false,
}: GameElementsSectionProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const defs = visibleGameElements(showBeta);
  const { on, total } = enabledVisibleCount(elements, showBeta);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.75}
        onPress={() => {
          Haptics.selectionAsync();
          setExpanded((e) => !e);
        }}
      >
        <Text style={styles.label}>GAME ELEMENTS</Text>
        <View style={styles.headerRight}>
          <Text style={styles.summary}>{`${on} of ${total}`}</Text>
          <Text style={styles.chevron}>{expanded ? "▴" : "▾"}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
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
      )}
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
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summary: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
  },
  chevron: {
    fontSize: 12,
    color: "#C8A24A",
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
