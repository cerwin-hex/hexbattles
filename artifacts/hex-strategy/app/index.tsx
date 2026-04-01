import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Difficulty = 'easy' | 'medium' | 'hard';

export default function MainMenuScreen() {
  const insets = useSafeAreaInsets();
  const [tileCount, setTileCount] = useState(100);
  const [rawInput, setRawInput] = useState('100');
  const [opponentCount, setOpponentCount] = useState(1);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  function adjustTiles(delta: number) {
    Haptics.selectionAsync();
    setTileCount(prev => {
      const next = Math.min(200, Math.max(40, prev + delta));
      setRawInput(String(next));
      return next;
    });
  }

  function handleTileInputChange(text: string) {
    setRawInput(text);
  }

  function commitTileInput() {
    const parsed = parseInt(rawInput, 10);
    if (!isNaN(parsed)) {
      const clamped = Math.min(200, Math.max(40, parsed));
      setTileCount(clamped);
      setRawInput(String(clamped));
    } else {
      setRawInput(String(tileCount));
    }
  }

  function handleStart() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: '/game',
      params: { tileCount: String(tileCount), opponentCount: String(opponentCount) },
    });
  }

  const tileProgress = (tileCount - 40) / 160;

  return (
    <LinearGradient
      colors={['#0D0A06', '#130E07', '#1A1208']}
      style={styles.root}
    >
      <View style={[styles.content, { paddingTop: topPad + 24, paddingBottom: botPad + 24 }]}>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>Turn-Based Strategy</Text>
          <Text style={styles.title}>{'HEX\nCONQUEST'}</Text>
          <View style={styles.accentLine} />
        </View>

        <View style={styles.sections}>
          <View style={styles.section}>
            <Text style={styles.label}>Map Size</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => adjustTiles(-10)}
                activeOpacity={0.7}
              >
                <Ionicons name="remove" size={22} color="#C8A24A" />
              </TouchableOpacity>
              <View style={styles.stepValue}>
                <TextInput
                  style={styles.stepInput}
                  value={rawInput}
                  onChangeText={handleTileInputChange}
                  onBlur={commitTileInput}
                  onSubmitEditing={commitTileInput}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  selectTextOnFocus
                  maxLength={3}
                />
                <Text style={styles.stepUnit}>Tiles</Text>
              </View>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => adjustTiles(10)}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={22} color="#C8A24A" />
              </TouchableOpacity>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(tileProgress * 100).toFixed(1)}%` }]} />
            </View>
            <View style={styles.progressLabels}>
              <Text style={styles.progressText}>40</Text>
              <Text style={styles.progressText}>200</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Opponents</Text>
            <View style={styles.pills}>
              {[1, 2, 3].map(n => (
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
            <Text style={styles.label}>Difficulty</Text>
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
        </View>

        <TouchableOpacity style={styles.startOuter} onPress={handleStart} activeOpacity={0.85}>
          <LinearGradient colors={['#6B4A10', '#4A3008', '#3A2208']} style={styles.startInner}>
            <Text style={styles.startText}>Commence Battle</Text>
            <Ionicons name="chevron-forward" size={18} color="#F0D080" />
          </LinearGradient>
        </TouchableOpacity>

      </View>
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
  title: {
    fontSize: 58,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    lineHeight: 64,
    letterSpacing: 1,
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
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepBtn: {
    width: 46,
    height: 46,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#4A3C1E',
    backgroundColor: '#1A1208',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    flex: 1,
    alignItems: 'center',
  },
  stepInput: {
    fontSize: 44,
    fontFamily: 'Inter_700Bold',
    color: '#C8A24A',
    textAlign: 'center',
    minWidth: 80,
  },
  stepUnit: {
    fontSize: 10,
    fontFamily: 'Cinzel_400Regular',
    color: '#786A54',
    letterSpacing: 2,
    marginTop: 2,
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#2A1E0C',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#6B4A10',
    borderRadius: 2,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  progressText: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: '#3A2E14',
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
    borderColor: '#3A2E14',
    backgroundColor: '#140F06',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    borderColor: '#C8A24A',
    backgroundColor: '#1E1608',
  },
  pillText: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#3A2E14',
  },
  pillTextActive: {
    color: '#C8A24A',
  },
  diffPill: {
    flex: 1,
    height: 42,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#3A2E14',
    backgroundColor: '#140F06',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diffPillActive: {
    borderColor: '#786A54',
    backgroundColor: '#1E1608',
  },
  diffText: {
    fontSize: 10,
    fontFamily: 'Cinzel_400Regular',
    color: '#3A2E14',
    letterSpacing: 1.5,
  },
  diffTextActive: {
    color: '#C8A24A',
  },
  startOuter: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#6B4A10',
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
});
