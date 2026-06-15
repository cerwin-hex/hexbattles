import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useState } from 'react';
import { WelcomeModal } from '@/components/WelcomeModal';
import { SettingsModal } from '@/components/SettingsModal';
import { Slider } from '@/components/Slider';
import { useSettings } from '@/contexts/SettingsContext';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Difficulty } from '@/types';
import {
  clearSavedGame,
  hasSavedGameSync,
  hydrateSavedGame,
  isHydrated,
} from '@/utils/savedGame';
import { INFO_TABLE_ROWS } from '@/constants/gameConstants';
import { UnitIcon } from '@/components/UnitIcon';

const TILE_MIN = 40;
const TILE_MAX = 200;

// Reference table for the rules modal — single source derived from ENTITY_META.
const UNIT_ROWS = INFO_TABLE_ROWS;

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
                Hex Battles is a turn-based strategy game where you fight to conquer and defend territories on a hexagonal map. You start with a few small areas and must expand, build your economy, and eliminate all opponents, while keeping an eye on the rebels.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Economy</Text>
              <View style={styles.ruleDivider} />
              <Text style={styles.ruleBody}>
                Gold is held per territory, not in one shared purse. Each separate block of land you own keeps its own treasury, earns its own income, and pays its own upkeep. You can only buy something in a territory that can afford it outright.
              </Text>
              <Text style={[styles.ruleBody, { marginTop: 8 }]}>
                At the end of every turn each territory collects income from its tiles (grass/forest 2, desert 1, +2 per city, mountain/lake 0) and pays upkeep for its units and buildings. If a territory cannot cover its bill, it goes bankrupt: its treasury drains to zero, all of its units are disbanded, and — if upkeep still exceeds income — its buildings are demolished too.
              </Text>
              <Text style={[styles.ruleBody, { marginTop: 8 }]}>
                Large realms also pay an administrative burden. Once a single territory exceeds 20 tiles, it owes extra upkeep of half a gold for every tile above that threshold, so spreading too wide eats into your profits.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Improvements</Text>
              <View style={styles.ruleDivider} />
              <Text style={styles.ruleBody}>
                A Peasant can improve the tile it stands on for 3 gold, turning grass into a Field and forest into a Sawmill. Improving uses up the peasant's action for that turn.
              </Text>
              <Text style={[styles.ruleBody, { marginTop: 8 }]}>
                An improved tile earns +1 gold per turn, plus another +1 while it borders one of your cities. Founding a city, tower or castle on an improved tile destroys the improvement.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Combat & Movement</Text>
              <View style={styles.ruleDivider} />
              <Text style={styles.ruleBody}>
                Units and buildings have a strength value from 1 to 3. A unit can only move onto a tile if its strength is higher than that of the enemy. Move a unit onto an enemy tile to capture it.
              </Text>
              <Text style={[styles.ruleBody, { marginTop: 8 }]}>
                Cavalry — the Scout and Knight — move up to 5 tiles and take two open tiles per turn, or strike a unit/rebel once and then ride on to one more open tile before stopping. They can't assault towers or castles, and cannot be merged with infantry.
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
                    <View style={[styles.tableCell, styles.tableCellIcon, styles.tableCellIconBox]}>
                      <UnitIcon entityId={row.id} size={22} />
                    </View>
                    <Text style={[styles.tableCell, styles.tableCellName, styles.tableBodyText]}>{row.name}</Text>
                    <Text style={[styles.tableCell, styles.tableCellNum, styles.tableBodyText]}>{row.cost}</Text>
                    <Text style={[styles.tableCell, styles.tableCellNum, styles.tableBodyText]}>{row.upkeep}</Text>
                    <Text style={[styles.tableCell, styles.tableCellNum, styles.tableBodyText]}>{row.strength === 0 ? '—' : row.strength}</Text>
                  </View>
                ))}
              </View>

              <Text style={[styles.ruleBody, { marginTop: 10 }]}>
                You can merge two units of the same strength on the same tile into one stronger unit, and you can upgrade existing units by paying the cost difference.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Bridges</Text>
              <View style={styles.ruleDivider} />
              <Text style={styles.ruleBody}>
                Build a Bridge on any lake tile adjacent to your territory for 5 gold (1 upkeep per turn). Bridges become part of your territory and allow units to cross the water. Enemies can capture or destroy your bridges, cutting off connections.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Rebels</Text>
              <View style={styles.ruleDivider} />
              <Text style={styles.ruleBody}>
                Rebels are a hostile neutral force. They spawn randomly and on tiles where units have fallen in battle and can spread to adjacent empty tiles.
              </Text>
            </View>

            <View style={styles.ruleSection}>
              <Text style={styles.ruleSectionTitle}>Terrain</Text>
              <View style={styles.ruleDivider} />
              {[
                { name: 'Grass', desc: 'Standard terrain with good income' },
                { name: 'Forest', desc: 'Good income like grass, but costs 2 movement to enter' },
                { name: 'Desert', desc: 'Lower income' },
                { name: 'Mountain', desc: 'Impassable' },
                { name: 'Lake', desc: 'Impassable unless you build a Bridge' },
              ].map(t => (
                <View key={t.name} style={styles.terrainRow}>
                  <Text style={styles.terrainName}>{t.name}</Text>
                  <Text style={styles.terrainDesc}> — {t.desc}</Text>
                </View>
              ))}
            </View>

            <View style={[styles.ruleSection, { marginBottom: 8 }]}>
              <Text style={styles.ruleSectionTitle}>Difficulty</Text>
              <View style={styles.ruleDivider} />
              {[
                { name: 'Easy', desc: 'The AI plays sloppily and skips many of its available moves (about 40%), making it predictable and easy to outmanoeuvre.' },
                { name: 'Medium', desc: 'The AI occasionally skips a move (about 20%) but still builds and expands steadily. A fair challenge for most players.' },
                { name: 'Hard', desc: 'The AI uses a strategic decision tree and smart pathfinding to attack, defend, and expand as efficiently as possible, never skipping a move.' },
                { name: 'Super Hard', desc: 'Plays like Hard, but also earns bonus income from every land hex it controls each round, giving it a growing economic edge over time.' },
              ].map(d => (
                <View key={d.name} style={[styles.terrainRow, { marginBottom: 4 }]}>
                  <Text style={[styles.terrainName, { fontWeight: '700' }]}>{d.name}</Text>
                  <Text style={[styles.terrainDesc, { flexShrink: 1 }]}> — {d.desc}</Text>
                </View>
              ))}
            </View>

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function MainMenu() {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();
  const [tileCount, setTileCount] = useState(100);
  const [opponentCount, setOpponentCount] = useState(3);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [rulesVisible, setRulesVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [hasSaved, setHasSaved] = useState<boolean>(() => hasSavedGameSync());
  const [confirmNewGame, setConfirmNewGame] = useState(false);

  // Only refresh hasSaved when the menu actually gains focus — never live.
  // This prevents the "New Game" variant from flashing into view during the
  // transition into a freshly-started game (when game.tsx's first auto-save
  // would otherwise toggle hasSaved while the menu is still mounted behind).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        if (!isHydrated()) await hydrateSavedGame();
        if (!cancelled) setHasSaved(hasSavedGameSync());
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  function startNewGame() {
    clearSavedGame();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: '/game',
      params: {
        tileCount: String(tileCount),
        opponentCount: String(opponentCount),
        difficulty,
        mountainPct: String(settings.mountainPct),
        lakePct: String(settings.lakePct),
        desertPct: String(settings.desertPct),
        forestPct: String(settings.forestPct),
        cityCount: String(settings.cityCount),
      },
    });
  }

  function handleStart() {
    if (hasSaved) {
      setConfirmNewGame(true);
      return;
    }
    startNewGame();
  }

  function handleResume() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({ pathname: '/game', params: { resume: '1' } });
  }

  return (
    <LinearGradient
      colors={['#2E2214', '#382A18', '#44341E']}
      style={styles.root}
    >
      <View style={[styles.content, { paddingTop: topPad + 24, paddingBottom: botPad + 24 }]}>

        <View style={styles.header}>
          <View style={styles.helpRow}>
            <TouchableOpacity
              style={styles.helpBtn}
              onPress={() => { Haptics.selectionAsync(); setRulesVisible(true); }}
              activeOpacity={0.75}
            >
              <Text style={styles.helpBtnText}>?</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.helpBtn}
              onPress={() => { Haptics.selectionAsync(); setSettingsVisible(true); }}
              activeOpacity={0.75}
            >
              <Text style={styles.helpBtnText}>⚙</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.title}>HEX BATTLES</Text>
          <View style={styles.accentLine} />
        </View>

        <View style={styles.sections}>
          <Slider
            label="Map Size"
            value={tileCount}
            min={TILE_MIN}
            max={TILE_MAX}
            onChange={setTileCount}
            formatValue={(v) => `${v} Tiles`}
            leftLabel={String(TILE_MIN)}
            rightLabel={String(TILE_MAX)}
          />

          <View style={styles.section}>
            <Text style={styles.label}>AI Opponents</Text>
            <View style={styles.pills}>
              {[1, 2, 3, 4].map(n => (
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
            {([
              [
                ['easy', null, 'Easy'],
                ['medium', null, 'Medium'],
                ['hard', null, 'Hard'],
                ['super_hard', 'Super', 'Hard'],
              ],
              [
                ['expert', null, 'Expert'],
                ['super_expert', 'Super', 'Expert'],
              ],
            ] as [Difficulty, string | null, string][][]).map((row, rowIdx) => (
              <View key={rowIdx} style={[styles.pills, rowIdx > 0 && styles.pillsRowGap]}>
                {row.map(([d, top, bottom]) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.diffPill, difficulty === d && styles.diffPillActive]}
                    onPress={() => { Haptics.selectionAsync(); setDifficulty(d); }}
                    activeOpacity={0.7}
                  >
                    {top && (
                      <Text style={[styles.diffText, styles.diffTextSuper, difficulty === d && styles.diffTextActive]}>
                        {top}
                      </Text>
                    )}
                    <Text style={[styles.diffText, difficulty === d && styles.diffTextActive]}>
                      {bottom}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>

        </View>

        <View style={styles.startStack}>
          {hasSaved && (
            <TouchableOpacity style={styles.startOuter} onPress={handleResume} activeOpacity={0.85}>
              <LinearGradient colors={['#6B4A10', '#4A3008', '#3A2208']} style={styles.startInner}>
                <Text style={styles.startText}>Resume Game</Text>
                <Text style={{ fontSize: 18, color: '#F0D080' }}>›</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={hasSaved ? styles.newGameOuter : styles.startOuter}
            onPress={handleStart}
            activeOpacity={0.85}
          >
            {hasSaved ? (
              <View style={styles.newGameInner}>
                <Text style={styles.newGameText}>New Game</Text>
              </View>
            ) : (
              <LinearGradient colors={['#6B4A10', '#4A3008', '#3A2208']} style={styles.startInner}>
                <Text style={styles.startText}>Commence Battle</Text>
                <Text style={{ fontSize: 18, color: '#F0D080' }}>›</Text>
              </LinearGradient>
            )}
          </TouchableOpacity>
        </View>

      </View>

      <RulesModal visible={rulesVisible} onClose={() => setRulesVisible(false)} />
      <SettingsModal
        visible={settingsVisible}
        initialSettings={settings}
        onClose={(next) => {
          updateSettings(next);
          setSettingsVisible(false);
        }}
      />
      <WelcomeModal />

      <Modal
        visible={confirmNewGame}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmNewGame(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Start New Game?</Text>
            <Text style={styles.confirmBody}>
              You have a game in progress. Starting a new game will discard it
              permanently.
            </Text>
            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={styles.confirmStayBtn}
                onPress={() => setConfirmNewGame(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmStayText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmGoBtn}
                onPress={() => {
                  setConfirmNewGame(false);
                  startNewGame();
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmGoText}>Discard & Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  helpRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  title: {
    fontSize: 46,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    letterSpacing: 1,
    textAlign: 'center',
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
    alignSelf: 'center',
  },
  sections: {
    gap: 28,
  },
  section: {
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Cinzel_400Regular',
    color: '#A08A60',
    letterSpacing: 2,
  },
  pillsRowGap: {
    marginTop: 6,
  },
  pills: {
    flexDirection: 'row',
    gap: 6,
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
    height: 54,
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
    fontSize: 12,
    fontFamily: 'Cinzel_400Regular',
    color: '#A08A60',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  diffTextSuper: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
  diffTextActive: {
    color: '#C8A24A',
  },
  startStack: {
    gap: 10,
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
  newGameOuter: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#5A4520',
    overflow: 'hidden',
  },
  newGameInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    backgroundColor: '#1E1408',
  },
  newGameText: {
    fontSize: 12,
    fontFamily: 'Cinzel_400Regular',
    color: '#A08860',
    letterSpacing: 1.5,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#221A0E',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#7A6030',
    padding: 22,
  },
  confirmTitle: {
    fontSize: 16,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  confirmBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#D4BF96',
    lineHeight: 20,
    marginBottom: 18,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmStayBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#2A1E0C',
    alignItems: 'center',
  },
  confirmStayText: {
    fontSize: 12,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    letterSpacing: 1.5,
  },
  confirmGoBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#8A3A20',
    backgroundColor: '#3A1A10',
    alignItems: 'center',
  },
  confirmGoText: {
    fontSize: 12,
    fontFamily: 'Cinzel_700Bold',
    color: '#E08868',
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
  tableCellIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
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
