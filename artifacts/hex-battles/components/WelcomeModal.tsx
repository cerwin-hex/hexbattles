import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { INFO_TABLE_ROWS } from '@/constants/gameConstants';
import { UnitIcon } from '@/components/UnitIcon';
import { COLOR_PALETTE } from '@/constants/colors';
import { COLOR_KEYS } from '@/utils/settings';
import { useSettings } from '@/contexts/SettingsContext';

const STORAGE_KEY = 'hex_battles_welcome_seen';

// Reference table for the welcome guide — single source derived from ENTITY_META.
const UNIT_ROWS = INFO_TABLE_ROWS;

export function WelcomeModal() {
  const { playerColor } = useSettings();
  const [visible, setVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val === null) setVisible(true);
    });
  }, []);

  // Persist "seen" only when the player opts out — otherwise the guide
  // reappears on the next launch. Every close path (backdrop tap, the Begin
  // button, hardware back) funnels through here so the checkbox always applies.
  function handleClose() {
    if (dontShowAgain) AsyncStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  }

  const playerEntry = COLOR_PALETTE[playerColor];
  // The AI opponents take the remaining palette colours, in order — mirror that
  // here so the swatches match what the player will actually see on the board.
  const opponentKeys = COLOR_KEYS.filter(k => k !== playerColor);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
        <View style={styles.container}>

          <View style={styles.header}>
            <Text style={styles.headerTitle}>Welcome to Hex Battles</Text>
            <Text style={styles.headerSub}>A quick guide before your first conquest</Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >

            <Section title={`You Are the ${playerEntry.label} Player`}>
              <Text style={styles.body}>
                Your territories are shown in{' '}
                <Text style={[styles.body, { color: playerEntry.fill, fontFamily: 'Inter_700Bold' }]}>
                  {playerEntry.label.toLowerCase()}
                </Text>
                . You start each game with only a few scattered pieces of land and a little gold. Every other colour belongs to an AI opponent — and they all want what's yours. (You can change your colour in Settings.)
              </Text>
              <View style={styles.colorRow}>
                <ColorChip color={playerEntry.fill} label="You" />
                {opponentKeys.map(k => (
                  <ColorChip key={k} color={COLOR_PALETTE[k].fill} label={COLOR_PALETTE[k].label} />
                ))}
              </View>
            </Section>

            <Section title="Pulsating territory = You Can Act There">
              <Text style={styles.body}>
                When a territory glows with a soft pulse, that territory's treasury holds enough gold to buy a unit or building there. Tap the pulsating territory to open the buy menu. No pulse means that territory doesn't have enough money to buy anything — earn more by capturing tiles to grow its income.
              </Text>
            </Section>

            <Section title="Taking Your Turn">
              {[
                { n: '1', text: 'Tap one of your territories to select it.' },
                { n: '2', text: 'Tap a unit inside to arm it — the tiles it can reach light up with small dots.' },
                { n: '3', text: 'Tap a dotted tile to move. Tap an enemy tile to attack and capture it.' },
                { n: '4', text: 'Buy units or buildings in the menu that appears when you tap a territory.' },
                { n: '5', text: 'Press End Turn when you\'re done. All opponents act, then it\'s your turn again.' },
              ].map(s => (
                <View key={s.n} style={styles.stepRow}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepNum}>{s.n}</Text>
                  </View>
                  <Text style={[styles.body, styles.stepText]}>{s.text}</Text>
                </View>
              ))}
            </Section>

            <Section title="Combat">
              <Text style={styles.body}>
                Every unit and building has a strength (1–3). A unit can only capture a tile if its strength is{' '}
                <Text style={styles.highlight}>strictly higher</Text>
                {' '}than whatever defends it. Merge two units of equal strength on the same tile to create a stronger one.
              </Text>
              <Text style={[styles.body, { marginTop: 8 }]}>
                Cavalry — the Scout and Knight — move up to 5 tiles and take{' '}
                <Text style={styles.highlight}>two open tiles per turn</Text>, or strike a unit/rebel{' '}
                <Text style={styles.highlight}>once</Text> and then ride on to one more open tile before stopping. They can't assault towers or castles.
              </Text>
            </Section>

            <Section title="Economy">
              <Text style={styles.body}>
                Gold is held <Text style={styles.highlight}>per territory</Text>, not in one shared purse. Each separate block of land you own keeps its own treasury, earns its own income each turn, and pays its own upkeep for the units and buildings standing on it.
              </Text>
              <Text style={[styles.body, { marginTop: 8 }]}>
                If a territory can't cover its upkeep, it goes bankrupt: its treasury empties, <Text style={styles.highlight}>all of its units are disbanded</Text>, and if upkeep still outweighs income its buildings are demolished too. Keep each front expanding so its income can fund its army.
              </Text>
              <Text style={[styles.body, { marginTop: 8 }]}>
                Big realms get harder to run. Once a single territory grows beyond <Text style={styles.highlight}>20 tiles</Text> it pays an <Text style={styles.highlight}>administrative burden</Text> — extra upkeep of half a gold for every tile above 20. Sprawling empires bleed gold, so don't grow wider than you can govern.
              </Text>
              <View style={styles.incomeBox}>
                <Text style={styles.incomeRow}>Grass / Forest  →  <Text style={styles.gold}>2 gold</Text> per turn</Text>
                <Text style={styles.incomeRow}>Desert  →  <Text style={styles.gold}>1 gold</Text> per turn</Text>
                <Text style={styles.incomeRow}>City  →  <Text style={styles.gold}>+1 gold bonus</Text> on top of terrain</Text>
                <Text style={styles.incomeRow}>Mountain / Lake  →  <Text style={styles.dimGold}>0 gold</Text></Text>
              </View>
            </Section>

            <Section title="Improvements">
              <Text style={styles.body}>
                Once a territory has a <Text style={styles.highlight}>City</Text>, a <Text style={styles.highlight}>Peasant</Text> there can improve the tile it stands on: grass into a <Text style={styles.highlight}>Field</Text> (<Text style={styles.gold}>2 gold</Text>), forest into a <Text style={styles.highlight}>Sawmill</Text> (<Text style={styles.gold}>3 gold</Text>), or desert into a <Text style={styles.highlight}>Mine</Text> (<Text style={styles.gold}>4 gold</Text>). Improving uses up the peasant's action for that turn.
              </Text>
              <Text style={[styles.body, { marginTop: 8 }]}>
                A <Text style={styles.highlight}>Field</Text> earns <Text style={styles.highlight}>+1 gold</Text> every turn, plus an extra <Text style={styles.highlight}>+1</Text> while it sits next to one of your cities. A <Text style={styles.highlight}>Sawmill</Text> earns <Text style={styles.highlight}>+1 gold</Text> and costs only 1 movement to enter. A <Text style={styles.highlight}>Mine</Text> earns <Text style={styles.highlight}>+2 gold</Text>. Founding a city, tower or castle on an improved tile destroys the improvement, so build elsewhere if you want to keep it.
              </Text>
            </Section>

            <Section title="Units & Buildings">
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
            </Section>

            <Section title="Terrain">
              {[
                { name: 'Grass', desc: 'Standard terrain, good income' },
                { name: 'Forest', desc: 'Same income as grass, but costs 2 movement to enter' },
                { name: 'Desert', desc: 'Lower income' },
                { name: 'Mountain', desc: 'Impassable' },
                { name: 'Lake', desc: 'Impassable — build a Bridge to cross' },
              ].map(t => (
                <View key={t.name} style={styles.terrainRow}>
                  <Text style={styles.terrainName}>{t.name}</Text>
                  <Text style={styles.terrainDesc}> — {t.desc}</Text>
                </View>
              ))}
            </Section>

            <Section title="Rebels">
              <Text style={styles.body}>
                Rebels are a hostile neutral force. They spawn on battlefield graves and can spread to adjacent empty tiles. Don't ignore them — a neglected rear can collapse your economy.
              </Text>
            </Section>

            <Section title="Win Condition">
              <Text style={styles.body}>
                Eliminate all enemy territories to claim victory. You lose if your last territory falls. Good luck, Commander.
              </Text>
            </Section>

            <Text style={styles.tipNote}>
              Tip: tap the <Text style={styles.tipQ}>?</Text> button on the main menu any time to revisit these rules.
            </Text>

          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setDontShowAgain(v => !v)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, dontShowAgain && styles.checkboxChecked]}>
                {dontShowAgain && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>Don't show me again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.startBtn} onPress={handleClose} activeOpacity={0.85}>
              <Text style={styles.startBtnText}>Begin Your Conquest  ›</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.divider} />
      {children}
    </View>
  );
}

function ColorChip({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.chipSwatch, { backgroundColor: color }]} />
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.80)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  container: {
    width: '100%',
    maxHeight: '92%',
    backgroundColor: '#1C1408',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#7A6030',
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#4A3C1E',
    backgroundColor: '#161004',
    alignItems: 'center',
    gap: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#786A54',
    textAlign: 'center',
  },
  scroll: {
    padding: 20,
    paddingBottom: 8,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    letterSpacing: 2,
    marginBottom: 6,
  },
  divider: {
    height: 1,
    backgroundColor: '#4A3C1E',
    marginBottom: 10,
  },
  body: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#D4BF96',
    lineHeight: 20,
  },
  blue: {
    color: '#6AAAF4',
    fontFamily: 'Inter_700Bold',
  },
  green: {
    color: '#60CC60',
    fontFamily: 'Inter_700Bold',
  },
  highlight: {
    color: '#F0D080',
    fontFamily: 'Inter_700Bold',
  },
  gold: {
    color: '#C8A24A',
    fontFamily: 'Inter_700Bold',
  },
  dimGold: {
    color: '#786A54',
    fontFamily: 'Inter_400Regular',
  },
  colorRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#221A0E',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#4A3C1E',
  },
  chipSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  chipLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#D4BF96',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#3A2A10',
    borderWidth: 1,
    borderColor: '#9A7030',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  stepNum: {
    fontSize: 11,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    lineHeight: 14,
  },
  stepText: {
    flex: 1,
  },
  incomeBox: {
    marginTop: 10,
    backgroundColor: '#221A0E',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#4A3C1E',
    padding: 12,
    gap: 6,
  },
  incomeRow: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#D4BF96',
    lineHeight: 18,
  },
  table: {
    borderWidth: 1,
    borderColor: '#4A3C1E',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4,
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
  tipNote: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#786A54',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  tipQ: {
    fontFamily: 'Cinzel_700Bold',
    color: '#9A7030',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#4A3C1E',
    backgroundColor: '#161004',
    gap: 14,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#9A7030',
    backgroundColor: '#221A0E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#4A3008',
    borderColor: '#C8A24A',
  },
  checkboxMark: {
    fontSize: 14,
    color: '#F0D080',
    fontFamily: 'Inter_700Bold',
    lineHeight: 16,
  },
  checkboxLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#A08A60',
  },
  startBtn: {
    backgroundColor: '#4A3008',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#9A7030',
    paddingVertical: 15,
    alignItems: 'center',
  },
  startBtnText: {
    fontSize: 14,
    fontFamily: 'Cinzel_700Bold',
    color: '#F0D080',
    letterSpacing: 1.5,
  },
});
