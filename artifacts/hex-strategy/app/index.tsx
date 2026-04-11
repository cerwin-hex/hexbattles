import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TILE_MIN = 40;
const TILE_MAX = 300;
const THUMB_SIZE = 26;

type Difficulty = 'easy' | 'medium' | 'hard';
type Personality = 'defensive' | 'balanced' | 'warlike';

const UNIT_ROWS = [
  { icon: '⚔️', name: 'Basic Unit', cost: 10, upkeep: 3, strength: 1 },
  { icon: '🛡️', name: 'Advanced Unit', cost: 20, upkeep: 9, strength: 2 },
  { icon: '🗡️', name: 'Expert Unit', cost: 30, upkeep: 27, strength: 3 },
  { icon: '🗼', name: 'Tower', cost: 15, upkeep: 1, strength: 1 },
  { icon: '🏰', name: 'Castle', cost: 30, upkeep: 5, strength: 2 },
  { icon: '🏙️', name: 'City', cost: 10, upkeep: 0, strength: 0 },
];

function RulesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>How to Play</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>About the Game</Text>
              <View style={styles.ruleDivider} />
              <Text style={styles.ruleBody}>
                Hex Strategy is a turn-based strategy game where you fight to conquer and defend territories on a hexagonal map. You start with a small area and must expand, build your economy, and eliminate all opponents, while keeping an eye on the rebels.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Combat & Movement</Text>
              <View style={styles.ruleDivider} />
              <Text style={styles.ruleBody}>
                Units and buildings have a strength value from 1 to 3. A unit can only move onto a tile if its strength is higher than that of the enemy. Move a unit onto an enemy tile to capture it.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Units & Buildings</Text>
              <View style={styles.ruleDivider} />

              <View style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeaderRow]}>
                  <Text style={[styles.tableCell, styles.tableCellIcon, styles.tableHeaderText]}> </Text>
                  <Text style={[styles.tableCell, styles.tableCellName, styles.tableHeaderText]}>Name</Text>
                  <Text style={[styles.tableCell, styles.tableCellNum, styles.tableHeaderText]}>Cost</Text>
                  <Text style={[styles.tableCell, styles.tableCellNum, styles.tableHeaderText]}>Upkeep</Text>
                  <Text style={[styles.tableCell, styles.tableCellNum, styles.tableHeaderText]}>Str</Text>
                </View>
                {UNIT_ROWS.map((row, i) => (
                  <View key={row.name} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
                    <Text style={[styles.tableCell, styles.tableCellIcon]}>{row.icon}</Text>
                    <Text style={[styles.tableCell, styles.tableCellName, styles.tableBodyText]}>{row.name}</Text>
                    <Text style={[styles.tableCell, styles.tableCellNum, styles.tableBodyText]}>{row.cost}</Text>
                    <Text style={[styles.tableCell, styles.tableCellNum, styles.tableBodyText]}>{row.upkeep}</Text>
                    <Text style={[styles.tableCell, styles.tableCellNum, styles.tableBodyText]}>{row.strength}</Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.ruleBody, { marginTop: 10 }]}>
                You can merge two units of the same strength on the same tile into one stronger unit, and you can upgrade existing units by paying the cost difference.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Rebels</Text>
              <View style={styles.ruleDivider} />
              <Text style={styles.ruleBody}>
                Rebels (✊) are a hostile neutral force. They spawn randomly and on tiles where units have fallen in battle and can spread to adjacent empty tiles.
              </Text>
            </View>

            <View style={[styles.ruleSection, { marginBottom: 8 }]}>
              <Text style={styles.ruleSectionTitle}>Terrain</Text>
              <View style={styles.ruleDivider} />
              {[
                { name: 'Grass', desc: 'Standard terrain with good income' },
                { name: 'Desert', desc: 'Lower income' },
                { name: 'Mountain', desc: 'Impassable' },
                { name: 'Lake', desc: 'Can be entered, but requires a reserve fund' },
              ].map(t => (
                <View key={t.name} style={styles.terrainRow}>
                  <Text style={styles.terrainName}>{t.name}</Text>
                  <Text style={styles.terrainDesc}> — {t.desc}</Text>
                </View>
              ))}
            </View>

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function MainMenuScreen() {
  const insets = useSafeAreaInsets();
  const [tileCount, setTileCount] = useState(100);
  const [opponentCount, setOpponentCount] = useState(3);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [personality, setPersonality] = useState<Personality>('balanced');
  const [trackW, setTrackW] = useState(0);
  const [rulesVisible, setRulesVisible] = useState(false);

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  const thumbX = useSharedValue(0);
  const startX = useSharedValue(0);

  function countToX(count: number, width: number): number {
    const maxX = Math.max(0, width - THUMB_SIZE);
    return ((count - TILE_MIN) / (TILE_MAX - TILE_MIN)) * maxX;
  }

  useEffect(() => {
    if (trackW > 0) {
      thumbX.value = countToX(tileCount, trackW);
    }
  }, [trackW]);

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      startX.value = thumbX.value;
    })
    .onUpdate(e => {
      const maxX = trackW - THUMB_SIZE;
      const newX = Math.max(0, Math.min(maxX, startX.value + e.translationX));
      thumbX.value = newX;
      const frac = maxX > 0 ? newX / maxX : 0;
      const tiles = Math.round(TILE_MIN + frac * (TILE_MAX - TILE_MIN));
      runOnJS(setTileCount)(tiles);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: thumbX.value + THUMB_SIZE / 2,
  }));

  function handleStart() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: '/game',
      params: { tileCount: String(tileCount), opponentCount: String(opponentCount), personality },
    });
  }

  return (
    <LinearGradient
      colors={['#2E2214', '#382A18', '#44341E']}
      style={styles.root}
    >
      <View style={[styles.content, { paddingTop: topPad + 24, paddingBottom: botPad + 24 }]}>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>Turn-Based Strategy</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{'HEX\nCONQUEST'}</Text>
            <TouchableOpacity
              style={styles.helpBtn}
              onPress={() => { Haptics.selectionAsync(); setRulesVisible(true); }}
              activeOpacity={0.75}
            >
              <Text style={styles.helpBtnText}>?</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.accentLine} />
        </View>

        <View style={styles.sections}>
          <View style={styles.section}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Map Size</Text>
              <Text style={styles.tileCountDisplay}>{tileCount} Tiles</Text>
            </View>
            <GestureDetector gesture={panGesture}>
              <View
                style={styles.sliderTrack}
                onLayout={e => setTrackW(e.nativeEvent.layout.width)}
              >
                <Animated.View style={[styles.sliderFill, fillStyle]} />
                <Animated.View style={[styles.sliderThumb, thumbStyle]} />
              </View>
            </GestureDetector>
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabelText}>{TILE_MIN}</Text>
              <Text style={styles.sliderLabelText}>{TILE_MAX}</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>AI Opponents</Text>
            <View style={styles.pills}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity
                  key={n}
                  style={[styles.pill, opponentCount === n && styles.pillActive]}
                  onPress={() => { Haptics.selectionAsync(); setOpponentCount(n); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pillText, opponentCount === n && styles.pillTextActive]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>AI Difficulty</Text>
            <View style={styles.pills}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.diffPill, difficulty === d && styles.diffPillActive]}
                  onPress={() => { Haptics.selectionAsync(); setDifficulty(d); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.diffText, difficulty === d && styles.diffTextActive]}>
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>AI Personality</Text>
            <View style={styles.pills}>
              {(['defensive', 'balanced', 'warlike'] as Personality[]).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.diffPill, personality === p && styles.diffPillActive]}
                  onPress={() => { Haptics.selectionAsync(); setPersonality(p); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.diffText, personality === p && styles.diffTextActive]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.startOuter} onPress={handleStart} activeOpacity={0.85}>
          <LinearGradient colors={['#6B4A10', '#4A3008', '#3A2208']} style={styles.startInner}>
            <Text style={styles.startText}>Commence Battle</Text>
            <Text style={{ fontSize: 18, color: '#F0D080' }}>›</Text>
          </LinearGradient>
        </TouchableOpacity>

      </View>

      <RulesModal visible={rulesVisible} onClose={() => setRulesVisible(false)} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  header: {
    gap: 8,
  },
  eyebrow: {
    fontSize: 11,
    fontFamily: 'Cinzel_400Regular',
    color: '#786A54',
    letterSpacing: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 46,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    lineHeight: 52,
    letterSpacing: 1,
  },
  helpBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#9A7030',
    backgroundColor: '#2A1E0C',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  helpBtnText: {
    fontSize: 16,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    lineHeight: 20,
  },
  accentLine: {
    width: 54,
    height: 2,
    backgroundColor: '#6B4A10',
    marginTop: 4,
  },
  sections: {
    gap: 28,
  },
  section: {
    gap: 10,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Cinzel_400Regular',
    color: '#786A54',
    letterSpacing: 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  tileCountDisplay: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#C8A24A',
  },
  sliderTrack: {
    height: 36,
    backgroundColor: '#2E2210',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#7A6030',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#7A5418',
    borderRadius: 18,
  },
  sliderThumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#C8A24A',
    borderWidth: 2,
    borderColor: '#F0D080',
    top: (36 - THUMB_SIZE) / 2,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sliderLabelText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: '#786A54',
  },
  pills: {
    flexDirection: 'row',
    gap: 10,
  },
  pill: {
    flex: 1,
    height: 54,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#2A1E0C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    borderColor: '#C8A24A',
    backgroundColor: '#3A2A10',
  },
  pillText: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#A08A60',
  },
  pillTextActive: {
    color: '#C8A24A',
  },
  diffPill: {
    flex: 1,
    height: 42,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#2A1E0C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diffPillActive: {
    borderColor: '#C8A24A',
    backgroundColor: '#3A2A10',
  },
  diffText: {
    fontSize: 10,
    fontFamily: 'Cinzel_400Regular',
    color: '#A08A60',
    letterSpacing: 1.5,
  },
  diffTextActive: {
    color: '#C8A24A',
  },
  startOuter: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#9A7030',
    overflow: 'hidden',
  },
  startInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  startText: {
    fontSize: 14,
    fontFamily: 'Cinzel_700Bold',
    color: '#F0D080',
    letterSpacing: 1.5,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxHeight: '88%',
    backgroundColor: '#221A0E',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#7A6030',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#4A3C1E',
    backgroundColor: '#1C1408',
  },
  modalTitle: {
    fontSize: 15,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#3A2A10',
    borderWidth: 1,
    borderColor: '#7A6030',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13,
    color: '#C8A24A',
    fontFamily: 'Cinzel_400Regular',
  },
  modalScroll: {
    padding: 20,
  },
  ruleSection: {
    marginBottom: 22,
  },
  ruleSectionTitle: {
    fontSize: 11,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    letterSpacing: 2,
    marginBottom: 6,
  },
  ruleDivider: {
    height: 1,
    backgroundColor: '#4A3C1E',
    marginBottom: 10,
  },
  ruleBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#D4BF96',
    lineHeight: 20,
  },
  table: {
    borderWidth: 1,
    borderColor: '#4A3C1E',
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  tableHeaderRow: {
    backgroundColor: '#2A1E0C',
    borderBottomWidth: 1,
    borderBottomColor: '#4A3C1E',
  },
  tableRowAlt: {
    backgroundColor: '#1E1408',
  },
  tableCell: {
    paddingHorizontal: 4,
  },
  tableCellIcon: {
    width: 30,
    fontSize: 16,
    textAlign: 'center',
  },
  tableCellName: {
    flex: 1,
  },
  tableCellNum: {
    width: 48,
    textAlign: 'center',
  },
  tableHeaderText: {
    fontSize: 9,
    fontFamily: 'Cinzel_400Regular',
    color: '#786A54',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tableBodyText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#D4BF96',
  },
  terrainRow: {
    flexDirection: 'row',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  terrainName: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#C8A24A',
  },
  terrainDesc: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#D4BF96',
  },
});
