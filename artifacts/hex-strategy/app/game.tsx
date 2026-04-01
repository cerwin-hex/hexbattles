import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import {
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Polygon } from 'react-native-svg';

import {
  TERRAIN_FILLS,
  TERRITORY_BORDERS,
  TERRITORY_FILLS,
} from '@/constants/colors';
import {
  HexTile,
  HEX_EDGES,
  TerritoryOwner,
  generateHexGrid,
  getBoardBounds,
  hexCornerPoint,
  hexCornersString,
  hexToPixel,
  tileKey,
} from '@/utils/hexGrid';

const { width: SW, height: SH } = Dimensions.get('window');

function getTileFill(tile: HexTile): string {
  if (tile.terrain === 'mountain') return TERRAIN_FILLS.mountain;
  if (tile.owner === 'neutral') return TERRAIN_FILLS[tile.terrain] ?? TERRAIN_FILLS.grass;
  return TERRITORY_FILLS[tile.owner] ?? TERRITORY_FILLS.neutral;
}

interface BorderEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export default function GameScreen() {
  const params = useLocalSearchParams<{ tileCount: string; opponentCount: string }>();
  const numTiles = Math.min(200, Math.max(40, Number(params.tileCount) || 100));
  const numOpponents = Math.min(3, Math.max(1, Number(params.opponentCount) || 1));
  const insets = useSafeAreaInsets();

  const HEX_SIZE = Math.max(20, Math.min(42, Math.floor(280 / Math.sqrt(numTiles))));

  const tiles = useMemo(
    () => generateHexGrid(numTiles, numOpponents + 1),
    [numTiles, numOpponents],
  );

  const tileMap = useMemo(() => {
    const m = new Map<string, HexTile>();
    for (const t of tiles) m.set(t.key, t);
    return m;
  }, [tiles]);

  const bounds = useMemo(() => getBoardBounds(tiles, HEX_SIZE), [tiles, HEX_SIZE]);

  const tileData = useMemo(() => {
    return tiles.map(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, HEX_SIZE);
      const cx = x - bounds.minX;
      const cy = y - bounds.minY;
      return { tile, cx, cy };
    });
  }, [tiles, bounds, HEX_SIZE]);

  const borderEdges = useMemo<BorderEdge[]>(() => {
    const edges: BorderEdge[] = [];
    for (const { tile, cx, cy } of tileData) {
      if (tile.owner === 'neutral' || tile.terrain === 'mountain') continue;
      const borderColor = TERRITORY_BORDERS[tile.owner as TerritoryOwner] ?? '#FFFFFF';
      for (const { dir: [dq, dr], verts: [va, vb] } of HEX_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighbor = tileMap.get(nk);
        if (!neighbor || neighbor.owner !== tile.owner) {
          const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
          edges.push({
            x1: ptA.x, y1: ptA.y,
            x2: ptB.x, y2: ptB.y,
            color: borderColor,
          });
        }
      }
    }
    return edges;
  }, [tileData, tileMap, HEX_SIZE]);

  const boardW = bounds.width;
  const boardH = bounds.height;

  const topInset = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botInset = insets.bottom + (Platform.OS === 'web' ? 34 : 0);
  const availH = SH - topInset - botInset - 56;
  const fitScale = boardW > 0 && boardH > 0
    ? Math.min(SW / boardW, availH / boardH) * 0.9
    : 1;
  const initX = (SW - fitScale * boardW) / 2;
  const initY = topInset + 56 + (availH - fitScale * boardH) / 2;

  const scale = useSharedValue(fitScale);
  const savedScale = useSharedValue(fitScale);
  const translateX = useSharedValue(initX);
  const translateY = useSharedValue(initY);
  const savedX = useSharedValue(initX);
  const savedY = useSharedValue(initY);

  const panGesture = Gesture.Pan()
    .onUpdate(e => {
      translateX.value = savedX.value + e.translationX;
      translateY.value = savedY.value + e.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.max(0.3, Math.min(5, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const gesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const ownerCounts: Record<string, number> = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tile of tiles) {
      if (tile.owner !== 'neutral' && tile.terrain !== 'mountain') {
        counts[tile.owner] = (counts[tile.owner] ?? 0) + 1;
      }
    }
    return counts;
  }, [tiles]);

  const legendEntries = useMemo(() => {
    const entries: { key: TerritoryOwner; label: string; color: string; count: number }[] = [
      { key: 'player', label: 'You', color: TERRITORY_BORDERS.player, count: ownerCounts['player'] ?? 0 },
    ];
    for (let i = 1; i <= numOpponents; i++) {
      const k = `ai${i}` as TerritoryOwner;
      const labels: Record<string, string> = { ai1: 'Red', ai2: 'Green', ai3: 'Orange' };
      entries.push({ key: k, label: labels[k] ?? k, color: TERRITORY_BORDERS[k], count: ownerCounts[k] ?? 0 });
    }
    return entries;
  }, [numOpponents, ownerCounts]);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.board, animatedStyle]}>
          <Svg width={boardW} height={boardH}>
            {tileData.map(({ tile, cx, cy }) => (
              <Polygon
                key={tile.key}
                points={hexCornersString(cx, cy, HEX_SIZE)}
                fill={getTileFill(tile)}
                stroke="#040810"
                strokeWidth={0.6}
              />
            ))}
            {borderEdges.map((edge, i) => (
              <Line
                key={i}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke={edge.color}
                strokeWidth={2.8}
                strokeLinecap="round"
              />
            ))}
          </Svg>
        </Animated.View>
      </GestureDetector>

      <View style={[styles.topBar, { paddingTop: topInset + 10 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#E2E8F0" />
        </TouchableOpacity>
        <Text style={styles.topLabel}>
          {numTiles} TILES  ·  {numOpponents} OPPONENT{numOpponents > 1 ? 'S' : ''}
        </Text>
      </View>

      <View style={[styles.legend, { bottom: botInset + 16 }]}>
        {legendEntries.map(entry => (
          <View key={entry.key} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: entry.color }]} />
            <Text style={styles.legendLabel}>{entry.label}</Text>
            <Text style={styles.legendCount}>{entry.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#040810',
    overflow: 'hidden',
  },
  board: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
    backgroundColor: 'rgba(4, 8, 16, 0.75)',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(14, 25, 45, 0.9)',
    borderWidth: 1,
    borderColor: '#1E3A5F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#475569',
    letterSpacing: 2,
  },
  legend: {
    position: 'absolute',
    right: 16,
    backgroundColor: 'rgba(8, 15, 28, 0.88)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: '#94A3B8',
    flex: 1,
  },
  legendCount: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#E2E8F0',
    minWidth: 24,
    textAlign: 'right',
  },
});
