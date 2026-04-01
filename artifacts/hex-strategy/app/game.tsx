import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Polygon } from 'react-native-svg';

import { TERRAIN_FILLS, TERRITORY_BORDERS, TERRITORY_FILLS } from '@/constants/colors';
import {
  HEX_EDGES,
  HexTile,
  TerritoryOwner,
  generateHexGrid,
  getBoardBounds,
  hexCornerPoint,
  hexCornersString,
  hexToPixel,
  tileKey,
} from '@/utils/hexGrid';

const { width: SW, height: SH } = Dimensions.get('window');

const BOTTOM_BAR_H = 64;
const RIBBON_H = 130;

const PURCHASABLES = [
  { id: 'soldier',  name: 'Soldier',  icon: '⚔️',  cost: 50 },
  { id: 'archer',   name: 'Archer',   icon: '🏹',  cost: 75 },
  { id: 'cavalry',  name: 'Cavalry',  icon: '🐴',  cost: 120 },
  { id: 'mine',     name: 'Mine',     icon: '⛏️',  cost: 150 },
  { id: 'fortress', name: 'Fortress', icon: '🏰',  cost: 250 },
  { id: 'castle',   name: 'Castle',   icon: '🏯',  cost: 750 },
] as const;

function insetEdge(
  ptA: { x: number; y: number },
  ptB: { x: number; y: number },
  cx: number,
  cy: number,
  amount: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const mx = (ptA.x + ptB.x) / 2;
  const my = (ptA.y + ptB.y) / 2;
  const dx = cx - mx;
  const dy = cy - my;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return { x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y };
  const nx = (dx / dist) * amount;
  const ny = (dy / dist) * amount;
  return { x1: ptA.x + nx, y1: ptA.y + ny, x2: ptB.x + nx, y2: ptB.y + ny };
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
  const topInset = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botInset = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

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

  const INSET = HEX_SIZE * 0.13;

  const borderEdges = useMemo<BorderEdge[]>(() => {
    const edges: BorderEdge[] = [];
    for (const { tile, cx, cy } of tileData) {
      if (tile.terrain === 'mountain' || tile.owner === 'neutral') continue;
      const color = TERRITORY_BORDERS[tile.owner as TerritoryOwner]!;
      for (const { dir: [dq, dr], verts: [va, vb] } of HEX_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighbor = tileMap.get(nk);
        const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);

        if (!neighbor || neighbor.terrain === 'mountain' || neighbor.owner === 'neutral') {
          const e = insetEdge(ptA, ptB, cx, cy, INSET * 0.35);
          edges.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, color });
        } else if (neighbor.owner !== tile.owner) {
          const e = insetEdge(ptA, ptB, cx, cy, INSET);
          edges.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, color });
        }
      }
    }
    return edges;
  }, [tileData, tileMap, HEX_SIZE, INSET]);

  const boardW = bounds.width;
  const boardH = bounds.height;

  const availH = SH - topInset - botInset - BOTTOM_BAR_H;
  const fitScale =
    boardW > 0 && boardH > 0 ? Math.min(SW / boardW, availH / boardH) * 0.9 : 1;
  const initX = (SW - fitScale * boardW) / 2;
  const initY = topInset + (availH - fitScale * boardH) / 2;

  const scale = useSharedValue(fitScale);
  const savedScale = useSharedValue(fitScale);
  const translateX = useSharedValue(initX);
  const translateY = useSharedValue(initY);
  const savedX = useSharedValue(initX);
  const savedY = useSharedValue(initY);

  const pulseVal = useSharedValue(1);
  const hasTakenAction = useRef(false);

  useEffect(() => {
    pulseVal.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 550 }),
        withTiming(1.0, { duration: 550 }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulseVal);
  }, []);

  function handleAction() {
    if (!hasTakenAction.current) {
      hasTakenAction.current = true;
      cancelAnimation(pulseVal);
      pulseVal.value = withTiming(1.0, { duration: 200 });
    }
  }

  const [ribbonOpen, setRibbonOpen] = useState(false);
  const ribbonAnim = useSharedValue(RIBBON_H);

  function openRibbon() {
    setRibbonOpen(true);
    ribbonAnim.value = withTiming(0, { duration: 280 });
    handleAction();
  }

  function closeRibbon() {
    ribbonAnim.value = withTiming(RIBBON_H, { duration: 220 });
    setRibbonOpen(false);
  }

  function toggleRibbon() {
    if (ribbonOpen) closeRibbon();
    else openRibbon();
  }

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
      scale.value = Math.max(0.3, Math.min(3, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const gesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const boardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const endTurnStyle = useAnimatedStyle(() => ({
    opacity: pulseVal.value,
  }));

  const ribbonStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ribbonAnim.value }],
  }));

  function getTileFill(tile: HexTile): string {
    if (tile.terrain === 'mountain') return TERRAIN_FILLS.mountain;
    if (tile.owner === 'neutral') return TERRAIN_FILLS[tile.terrain] ?? TERRAIN_FILLS.grass;
    return TERRITORY_FILLS[tile.owner] ?? TERRITORY_FILLS.neutral;
  }

  const credits = 500;

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.board, boardStyle]}>
          <Svg width={boardW} height={boardH}>
            {tileData.map(({ tile, cx, cy }) => (
              <Polygon
                key={tile.key}
                points={hexCornersString(cx, cy, HEX_SIZE)}
                fill={getTileFill(tile)}
                stroke="#030710"
                strokeWidth={0.5}
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
                strokeWidth={2.6}
                strokeLinecap="round"
              />
            ))}
          </Svg>
        </Animated.View>
      </GestureDetector>

      {ribbonOpen && (
        <TouchableOpacity
          style={[
            StyleSheet.absoluteFillObject,
            { bottom: BOTTOM_BAR_H + botInset },
          ]}
          onPress={closeRibbon}
          activeOpacity={1}
        />
      )}

      <Animated.View
        style={[styles.ribbon, { bottom: BOTTOM_BAR_H + botInset }, ribbonStyle]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.ribbonContent}
        >
          {PURCHASABLES.map(item => {
            const affordable = item.cost <= credits;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.ribbonItem, !affordable && styles.ribbonItemDisabled]}
                activeOpacity={affordable ? 0.75 : 1}
              >
                <Text style={styles.ribbonIcon}>{item.icon}</Text>
                <Text style={[styles.ribbonName, !affordable && styles.ribbonDim]}>
                  {item.name}
                </Text>
                <Text style={[styles.ribbonCost, !affordable && styles.ribbonDim]}>
                  💰 {item.cost}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>

      <View style={[styles.bottomBar, { paddingBottom: botInset }]}>
        <View style={styles.bottomBarInner}>
          <TouchableOpacity style={styles.menuBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={15} color="#64748B" />
            <Text style={styles.menuBtnText}>Menu</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.buildBtn, ribbonOpen && styles.buildBtnActive]}
            onPress={toggleRibbon}
          >
            <Ionicons
              name="construct"
              size={15}
              color={ribbonOpen ? '#050A14' : '#F59E0B'}
            />
            <Text style={[styles.buildBtnText, ribbonOpen && styles.buildBtnTextActive]}>
              Build
            </Text>
          </TouchableOpacity>

          <View style={styles.creditsDisplay}>
            <Text style={styles.creditsIcon}>💰</Text>
            <Text style={styles.creditsAmount}>{credits}</Text>
          </View>

          <View style={styles.spacer} />

          <Animated.View style={endTurnStyle}>
            <TouchableOpacity style={styles.endTurnBtn} onPress={() => handleAction()}>
              <Text style={styles.endTurnText}>End Turn</Text>
              <Ionicons name="arrow-forward" size={13} color="#050A14" />
            </TouchableOpacity>
          </Animated.View>
        </View>
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
  ribbon: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: RIBBON_H,
    backgroundColor: 'rgba(8, 13, 24, 0.97)',
    borderTopWidth: 1,
    borderTopColor: '#1E3A5F',
  },
  ribbonContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ribbonItem: {
    width: 82,
    height: RIBBON_H - 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E3A5F',
    backgroundColor: '#0A1220',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  ribbonItemDisabled: {
    borderColor: '#0E1A28',
    backgroundColor: '#060C14',
  },
  ribbonIcon: {
    fontSize: 22,
  },
  ribbonName: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#CBD5E1',
  },
  ribbonCost: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: '#F59E0B',
  },
  ribbonDim: {
    color: '#283040',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(6, 10, 20, 0.97)',
    borderTopWidth: 1,
    borderTopColor: '#1E3A5F',
  },
  bottomBarInner: {
    height: BOTTOM_BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  menuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1A2A40',
    backgroundColor: '#070D1A',
  },
  menuBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: '#64748B',
  },
  buildBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#7C5A15',
    backgroundColor: '#150F04',
  },
  buildBtnActive: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
  },
  buildBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#F59E0B',
  },
  buildBtnTextActive: {
    color: '#050A14',
  },
  creditsDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1A2A40',
    backgroundColor: '#070D1A',
  },
  creditsIcon: {
    fontSize: 13,
  },
  creditsAmount: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#F59E0B',
  },
  spacer: {
    flex: 1,
  },
  endTurnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#22C55E',
  },
  endTurnText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#050A14',
    letterSpacing: 0.2,
  },
});
