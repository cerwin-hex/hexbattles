import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Platform,
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

export default function MainMenuScreen() {
  const insets = useSafeAreaInsets();
  const [tileCount, setTileCount] = useState(100);
  const [opponentCount, setOpponentCount] = useState(1);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [trackW, setTrackW] = useState(0);

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
      params: { tileCount: String(tileCount), opponentCount: String(opponentCount) },
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
          <Text style={styles.title}>{'HEX\nCONQUEST'}</Text>
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
    fontSize: 46,
    fontFamily: 'Cinzel_700Bold',
    color: '#C8A24A',
    lineHeight: 52,
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
});
