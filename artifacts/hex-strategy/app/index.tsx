import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Difficulty = 'easy' | 'medium' | 'hard';

export default function MainMenuScreen() {
  const insets = useSafeAreaInsets();
  const [tileCount, setTileCount] = useState(100);
  const [opponentCount, setOpponentCount] = useState(1);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  const topPad = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  function adjustTiles(delta: number) {
    Haptics.selectionAsync();
    setTileCount(prev => Math.min(200, Math.max(40, prev + delta)));
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
      colors={['#030710', '#070E1C', '#0A1628']}
      style={styles.root}
    >
      <View style={[styles.content, { paddingTop: topPad + 24, paddingBottom: botPad + 24 }]}>

        <View style={styles.header}>
          <Text style={styles.eyebrow}>TURN-BASED STRATEGY</Text>
          <Text style={styles.title}>HEX{'\n'}CONQUEST</Text>
          <View style={styles.accentLine} />
        </View>

        <View style={styles.sections}>
          <View style={styles.section}>
            <Text style={styles.label}>MAP SIZE</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => adjustTiles(-10)}
                activeOpacity={0.7}
              >
                <Ionicons name="remove" size={22} color="#F59E0B" />
              </TouchableOpacity>
              <View style={styles.stepValue}>
                <Text style={styles.stepNumber}>{tileCount}</Text>
                <Text style={styles.stepUnit}>TILES</Text>
              </View>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => adjustTiles(10)}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={22} color="#F59E0B" />
              </TouchableOpacity>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${tileProgress * 100}%` as any }]} />
            </View>
            <View style={styles.progressLabels}>
              <Text style={styles.progressText}>40</Text>
              <Text style={styles.progressText}>200</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>OPPONENTS</Text>
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
            <Text style={styles.label}>DIFFICULTY</Text>
            <View style={styles.pills}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.diffPill, difficulty === d && styles.diffPillActive]}
                  onPress={() => { Haptics.selectionAsync(); setDifficulty(d); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.diffText, difficulty === d && styles.diffTextActive]}>
                    {d.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.startOuter} onPress={handleStart} activeOpacity={0.85}>
          <LinearGradient colors={['#F59E0B', '#B45309']} style={styles.startInner}>
            <Text style={styles.startText}>START GAME</Text>
            <Ionicons name="chevron-forward" size={20} color="#050A14" />
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
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#F59E0B',
    letterSpacing: 4,
  },
  title: {
    fontSize: 58,
    fontFamily: 'Inter_700Bold',
    color: '#E2E8F0',
    lineHeight: 62,
    letterSpacing: -1,
  },
  accentLine: {
    width: 44,
    height: 2.5,
    backgroundColor: '#F59E0B',
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
    fontFamily: 'Inter_600SemiBold',
    color: '#475569',
    letterSpacing: 3,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    backgroundColor: '#0A1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    flex: 1,
    alignItems: 'center',
  },
  stepNumber: {
    fontSize: 44,
    fontFamily: 'Inter_700Bold',
    color: '#E2E8F0',
    lineHeight: 48,
  },
  stepUnit: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: '#475569',
    letterSpacing: 3,
    marginTop: 2,
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#1E3A5F',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
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
    color: '#334155',
  },
  pills: {
    flexDirection: 'row',
    gap: 10,
  },
  pill: {
    flex: 1,
    height: 54,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    backgroundColor: '#080F1C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    borderColor: '#F59E0B',
    backgroundColor: '#150E04',
  },
  pillText: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#334155',
  },
  pillTextActive: {
    color: '#F59E0B',
  },
  diffPill: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    backgroundColor: '#080F1C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diffPillActive: {
    borderColor: '#64748B',
    backgroundColor: '#111827',
  },
  diffText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#334155',
    letterSpacing: 1.5,
  },
  diffTextActive: {
    color: '#CBD5E1',
  },
  startOuter: {
    borderRadius: 14,
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
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#050A14',
    letterSpacing: 1.5,
  },
});
