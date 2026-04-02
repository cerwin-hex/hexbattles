import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
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
import Svg, { Circle, Defs, Line, LinearGradient, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { CITY_BUFFER_BORDER, CITY_NEUTRAL_FILL, TERRAIN_FILLS, TERRITORY_BORDERS, TERRITORY_FILLS } from '@/constants/colors';
import {
  CITY_BONUS,
  ENTITY_META,
  EntityType,
  HEX_EDGES,
  HexTile,
  TERRAIN_INCOME,
  TerritoryOwner,
  findCentralTile,
  generateHexGrid,
  getBoardBounds,
  getContiguousTerritory,
  getTerritoryId,
  hexCornerPoint,
  hexCornersString,
  hexToPixel,
  tileKey,
} from '@/utils/hexGrid';

const BTN_H = 36;
const BOTTOM_BAR_H = BTN_H + 16;
const RIBBON_H = 130;

const ORDERED_EDGES: ReadonlyArray<{ dir: [number, number]; verts: [number, number] }> = [
  { dir: [1, 0],   verts: [0, 1] },
  { dir: [0, 1],   verts: [1, 2] },
  { dir: [-1, 1],  verts: [2, 3] },
  { dir: [-1, 0],  verts: [3, 4] },
  { dir: [0, -1],  verts: [4, 5] },
  { dir: [1, -1],  verts: [5, 0] },
];

const PURCHASABLES = (Object.keys(ENTITY_META) as EntityType[]).map(id => ({
  id,
  ...ENTITY_META[id],
}));

interface BorderEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

function initTerritoryBalances(
  tiles: HexTile[],
  tileMap: Map<string, HexTile>,
  owner: TerritoryOwner,
): Map<string, number> {
  const balances = new Map<string, number>();
  const visited = new Set<string>();
  for (const tile of tiles) {
    if (tile.owner !== owner || visited.has(tile.key)) continue;
    const territory = getContiguousTerritory(tileMap, tile.key, owner);
    const id = getTerritoryId(territory);
    if (!id) continue;
    balances.set(id, 0);
    for (const t of territory) visited.add(t.key);
  }
  return balances;
}

export default function GameScreen() {
  const params = useLocalSearchParams<{ tileCount: string; opponentCount: string }>();
  const numTiles = Math.min(300, Math.max(40, Number(params.tileCount) || 100));
  const numOpponents = Math.min(3, Math.max(1, Number(params.opponentCount) || 1));
  const { width: SW, height: SH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const topInset = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botInset = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  const HEX_SIZE = Math.max(20, Math.min(42, Math.floor(280 / Math.sqrt(numTiles))));
  const BORDER_W = 4.0;
  const INNER_SIZE = HEX_SIZE - BORDER_W * 0.65 * (2 / Math.sqrt(3));

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

  const tileDataMap = useMemo(() => {
    const m = new Map<string, { cx: number; cy: number }>();
    for (const { tile, cx, cy } of tileData) m.set(tile.key, { cx, cy });
    return m;
  }, [tileData]);

  const borderEdges = useMemo<BorderEdge[]>(() => {
    const edges: BorderEdge[] = [];

    for (const { tile, cx, cy } of tileData) {
      if (tile.terrain === 'mountain' || tile.owner === 'neutral') continue;
      const color = TERRITORY_BORDERS[tile.owner as TerritoryOwner]!;
      for (const { dir: [dq, dr], verts: [va, vb] } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighbor = tileMap.get(nk);
        const needsBorder =
          !neighbor ||
          neighbor.terrain === 'mountain' ||
          neighbor.owner === 'neutral' ||
          neighbor.owner !== tile.owner;
        if (!needsBorder) continue;
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color, width: BORDER_W });
      }
    }

    for (const { tile, cx, cy } of tileData) {
      if (!tile.cityBuffer) continue;
      for (const { dir: [dq, dr], verts: [va, vb] } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighbor = tileMap.get(nk);
        const needsBorder =
          !neighbor ||
          (!neighbor.cityBuffer && !neighbor.isCity);
        if (!needsBorder) continue;
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: CITY_BUFFER_BORDER, width: BORDER_W });
      }
    }

    return edges;
  }, [tileData, tileMap, INNER_SIZE]);

  const boardW = bounds.width;
  const boardH = bounds.height;
  const availH = SH - topInset - botInset - BOTTOM_BAR_H;
  const fitScale =
    boardW > 0 && boardH > 0 ? Math.min(SW / boardW, availH / boardH) * 0.9 : 1;
  const initX = (SW - boardW) / 2;
  const initY = topInset + (availH - boardH) / 2;

  const scale = useSharedValue(fitScale);
  const savedScale = useSharedValue(fitScale);
  const translateX = useSharedValue(initX);
  const translateY = useSharedValue(initY);
  const savedX = useSharedValue(initX);
  const savedY = useSharedValue(initY);

  useEffect(() => {
    translateX.value = initX;
    translateY.value = initY;
    savedX.value = initX;
    savedY.value = initY;
    scale.value = fitScale;
    savedScale.value = fitScale;
  }, [initX, initY, fitScale]);

  const pulseVal = useSharedValue(1);
  const hasTakenAction = useRef(false);

  useEffect(() => {
    pulseVal.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 600 }),
        withTiming(1.0, { duration: 600 }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(pulseVal);
    };
  }, []);

  function handleAction() {
    if (!hasTakenAction.current) {
      hasTakenAction.current = true;
      cancelAnimation(pulseVal);
      pulseVal.value = withTiming(1.0, { duration: 200 });
    }
  }

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showEconModal, setShowEconModal] = useState(false);
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

  const [selectedTileKey, setSelectedTileKey] = useState<string | null>(null);
  const [armedEntityId, setArmedEntityId] = useState<EntityType | null>(null);
  const [entities, setEntities] = useState<Map<string, EntityType>>(new Map());
  const [territoryBalances, setTerritoryBalances] = useState<Map<string, number>>(new Map());
  const [turn, setTurn] = useState(1);

  useEffect(() => {
    if (tiles.length > 0) {
      setTerritoryBalances(initTerritoryBalances(tiles, tileMap, 'player'));
      setSelectedTileKey(null);
      setArmedEntityId(null);
      setEntities(new Map());
    }
  }, [tiles, tileMap]);

  const selectedTerritory = useMemo<HexTile[]>(() => {
    if (!selectedTileKey) return [];
    const tile = tileMap.get(selectedTileKey);
    if (!tile || tile.owner !== 'player') return [];
    return getContiguousTerritory(tileMap, selectedTileKey, 'player');
  }, [selectedTileKey, tileMap]);

  const selectedTerritoryId = useMemo<string | null>(
    () => getTerritoryId(selectedTerritory),
    [selectedTerritory],
  );

  const selectedTerritoryBalance = useMemo<number>(() => {
    if (selectedTerritoryId) {
      return territoryBalances.get(selectedTerritoryId) ?? 0;
    }
    let max = 0;
    for (const v of territoryBalances.values()) {
      if (v > max) max = v;
    }
    return max;
  }, [selectedTerritoryId, territoryBalances]);

  const selectedTileKeys = useMemo<Set<string>>(
    () => new Set(selectedTerritory.map(t => t.key)),
    [selectedTerritory],
  );

  const canBuild = selectedTerritory.length > 0;

  const territoryHasCity = useMemo(
    () => selectedTerritory.some(t => t.isCity || entities.get(t.key) === 'city'),
    [selectedTerritory, entities],
  );

  const econBreakdown = useMemo(() => {
    if (selectedTerritory.length === 0) return null;
    let grassCount = 0;
    let desertCount = 0;
    let mountainCount = 0;
    let cityCount = 0;
    const upkeepGroupMap = new Map<EntityType, number>();
    for (const t of selectedTerritory) {
      if (t.terrain === 'grass') grassCount++;
      else if (t.terrain === 'desert') desertCount++;
      else if (t.terrain === 'mountain') mountainCount++;
      const entityId = entities.get(t.key);
      if (t.isCity || entityId === 'city') cityCount++;
      if (entityId && entityId !== 'city') {
        const meta = ENTITY_META[entityId];
        if (meta.upkeep > 0) {
          upkeepGroupMap.set(entityId, (upkeepGroupMap.get(entityId) ?? 0) + 1);
        }
      }
    }
    const upkeepGroups = Array.from(upkeepGroupMap.entries()).map(([type, count]) => {
      const meta = ENTITY_META[type];
      return { icon: meta.icon, name: meta.name, count, upkeepPerUnit: meta.upkeep, total: meta.upkeep * count };
    });
    const grassIncome = grassCount;
    const cityIncome = cityCount * CITY_BONUS;
    const totalIncome = grassIncome + cityIncome;
    const totalUpkeep = upkeepGroups.reduce((s, g) => s + g.total, 0);
    const net = totalIncome - totalUpkeep;
    return { grassCount, desertCount, mountainCount, cityCount, grassIncome, cityIncome, upkeepGroups, totalIncome, totalUpkeep, net };
  }, [selectedTerritory, entities]);

  const selectionBorderEdges = useMemo<BorderEdge[]>(() => {
    if (selectedTileKeys.size === 0) return [];
    const edges: BorderEdge[] = [];
    for (const key of selectedTileKeys) {
      const pos = tileDataMap.get(key);
      const tile = tileMap.get(key);
      if (!pos || !tile) continue;
      const { cx, cy } = pos;
      for (const { dir: [dq, dr], verts: [va, vb] } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        if (selectedTileKeys.has(nk)) continue;
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: '#FFFFFF', width: BORDER_W });
      }
    }
    return edges;
  }, [selectedTileKeys, tileDataMap, tileMap, INNER_SIZE]);

  const flagTileKeys = useMemo<Set<string>>(() => {
    const keys = new Set<string>();
    const visited = new Set<string>();
    for (const tile of tiles) {
      if (tile.owner !== 'player' || visited.has(tile.key)) continue;
      const territory = getContiguousTerritory(tileMap, tile.key, 'player');
      for (const t of territory) visited.add(t.key);
      const id = getTerritoryId(territory);
      if (!id) continue;
      const balance = territoryBalances.get(id) ?? 0;
      if (balance < 10) continue;
      const central = findCentralTile(territory);
      if (!central) continue;
      keys.add(central.key);
    }
    return keys;
  }, [tiles, tileMap, territoryBalances, entities]);

  const handleDeselect = useCallback(() => {
    setSelectedTileKey(null);
    setArmedEntityId(null);
    if (ribbonOpen) closeRibbon();
  }, [ribbonOpen]);

  const handleTileTap = useCallback((key: string) => {
    const tile = tileMap.get(key);

    if (armedEntityId && selectedTileKeys.has(key)) {
      const alreadyOccupied = entities.has(key);
      if (!alreadyOccupied && selectedTerritoryId) {
        const meta = ENTITY_META[armedEntityId];
        const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
        if (balance >= meta.cost) {
          setEntities(prev => { const next = new Map(prev); next.set(key, armedEntityId); return next; });
          setTerritoryBalances(prev => {
            const next = new Map(prev);
            next.set(selectedTerritoryId, balance - meta.cost);
            return next;
          });
          setArmedEntityId(null);
          closeRibbon();
          return;
        }
      }
      return;
    }

    if (!tile || tile.owner !== 'player') {
      setSelectedTileKey(null);
      setArmedEntityId(null);
      if (ribbonOpen) closeRibbon();
      return;
    }

    if (selectedTileKeys.has(key)) {
      setSelectedTileKey(null);
      setArmedEntityId(null);
      if (ribbonOpen) closeRibbon();
      return;
    }

    setSelectedTileKey(key);
    setArmedEntityId(null);
    if (ribbonOpen) closeRibbon();
  }, [tileMap, selectedTileKeys, armedEntityId, entities, selectedTerritoryId, territoryBalances, ribbonOpen]);

  const handleEndTurn = useCallback(() => {
    handleAction();
    setTerritoryBalances(prevBalances => {
      const next = new Map(prevBalances);
      const visited = new Set<string>();
      for (const tile of tiles) {
        if (tile.owner !== 'player' || visited.has(tile.key)) continue;
        const territory = getContiguousTerritory(tileMap, tile.key, 'player');
        for (const t of territory) visited.add(t.key);
        const territoryId = getTerritoryId(territory);
        if (!territoryId) continue;
        const income = territory.reduce((s, t) =>
          s + TERRAIN_INCOME[t.terrain] + (t.isCity ? CITY_BONUS : 0) + (entities.get(t.key) === 'city' ? CITY_BONUS : 0), 0);
        const upkeep = territory.reduce((s, t) => {
          const e = entities.get(t.key);
          return s + (e ? ENTITY_META[e].upkeep : 0);
        }, 0);
        const current = next.get(territoryId) ?? 0;
        const newBalance = current + income - upkeep;
        if (newBalance < 0) {
          next.set(territoryId, 0);
          setEntities(prevEntities => {
            const nextE = new Map(prevEntities);
            for (const t of territory) {
              const e = nextE.get(t.key);
              if (e && ENTITY_META[e].isUnit) nextE.delete(t.key);
            }
            return nextE;
          });
        } else {
          next.set(territoryId, newBalance);
        }
      }
      return next;
    });
    setTurn(t => t + 1);
    setSelectedTileKey(null);
    setArmedEntityId(null);
    closeRibbon();
  }, [tiles, tileMap, entities]);

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

  const hasSelection = selectedTerritory.length > 0;

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFillObject}>
          <Svg width={SW} height={SH} style={StyleSheet.absoluteFillObject}>
            <Defs>
              <LinearGradient id="seaGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#081828" stopOpacity="1" />
                <Stop offset="0.5" stopColor="#0C2840" stopOpacity="1" />
                <Stop offset="1" stopColor="#183C58" stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={SW} height={SH} fill="url(#seaGrad)" onPress={handleDeselect} />
          </Svg>

          <Animated.View style={[styles.board, boardStyle, styles.boardElevated]}>
            <Svg width={boardW} height={boardH}>
              <Rect x={0} y={0} width={boardW} height={boardH} fill="transparent" onPress={handleDeselect} />
              {tileData.map(({ tile, cx, cy }) => {
                const fill = hasSelection
                  ? (TERRAIN_FILLS[tile.terrain] ?? TERRAIN_FILLS.grass)
                  : (tile.terrain === 'mountain'
                      ? TERRAIN_FILLS.mountain
                      : (tile.cityBuffer || tile.isCity)
                        ? CITY_NEUTRAL_FILL
                        : (TERRITORY_FILLS[tile.owner] ?? TERRITORY_FILLS.neutral));
                return (
                  <Polygon
                    key={tile.key}
                    points={hexCornersString(cx, cy, HEX_SIZE)}
                    fill={fill}
                    stroke="#080603"
                    strokeWidth={1}
                    onPress={() => handleTileTap(tile.key)}
                  />
                );
              })}

              {hasSelection && borderEdges.map((edge, i) => (
                <Line
                  key={i}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke={edge.color}
                  strokeWidth={edge.width}
                  strokeLinecap="round"
                />
              ))}

              {hasSelection && selectionBorderEdges.map((edge, i) => (
                <Line
                  key={`sel-${i}`}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke={edge.color}
                  strokeWidth={edge.width}
                  strokeLinecap="round"
                />
              ))}

              {Array.from(entities.entries()).map(([key, entityId]) => {
                if (entityId === 'city') return null;
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                const meta = ENTITY_META[entityId];
                const r = HEX_SIZE * 0.38;
                const bgColor = meta.isUnit ? 'rgba(30,50,120,0.9)' : 'rgba(80,40,10,0.9)';
                return (
                  <React.Fragment key={`entity-${key}`}>
                    <Circle
                      cx={pos.cx}
                      cy={pos.cy}
                      r={r}
                      fill={bgColor}
                      stroke="#FFD700"
                      strokeWidth={1.2}
                      onPress={() => handleTileTap(key)}
                    />
                    <SvgText
                      x={pos.cx}
                      y={pos.cy + r * 0.35}
                      textAnchor="middle"
                      fontSize={r * 1.2}
                      fill="#fff"
                    >
                      {meta.icon}
                    </SvgText>
                  </React.Fragment>
                );
              })}

              {tileData.filter(({ tile }) => tile.isCity || entities.get(tile.key) === 'city').map(({ tile, cx, cy }) => (
                <SvgText
                  key={`city-${tile.key}`}
                  x={cx}
                  y={cy + HEX_SIZE * 0.28}
                  textAnchor="middle"
                  fontSize={HEX_SIZE * 0.72}
                  fill="#fff"
                  opacity={0.9}
                  onPress={() => handleTileTap(tile.key)}
                >
                  🏙️
                </SvgText>
              ))}

              {Array.from(flagTileKeys).filter(key => !selectedTileKeys.has(key)).map(key => {
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                const fs = HEX_SIZE * 0.58;
                return (
                  <SvgText
                    key={`flag-${key}`}
                    x={pos.cx}
                    y={pos.cy + fs * 0.38}
                    textAnchor="middle"
                    fontSize={fs}
                  >
                    🚩
                  </SvgText>
                );
              })}
            </Svg>
          </Animated.View>
        </View>
      </GestureDetector>

      <Animated.View
        style={[styles.ribbon, { bottom: BOTTOM_BAR_H + botInset }, ribbonStyle]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.ribbonContent}
        >
          {PURCHASABLES.map(item => {
            const affordable = item.cost <= selectedTerritoryBalance;
            const isArmed = armedEntityId === item.id;
            const cityAlreadyBuilt = item.id === 'city' && territoryHasCity;
            const cityTooSmall = item.id === 'city' && selectedTerritory.length < 10;
            const cityLocked = cityAlreadyBuilt || cityTooSmall;
            const enabled = affordable && !cityLocked;
            const costLabel = cityAlreadyBuilt ? 'Built' : cityTooSmall ? '<10 tiles' : `${item.cost}g`;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.ribbonItem,
                  !enabled && styles.ribbonItemDisabled,
                  isArmed && styles.ribbonItemArmed,
                ]}
                activeOpacity={enabled ? 0.75 : 1}
                onPress={() => {
                  if (!enabled) return;
                  setArmedEntityId(isArmed ? null : item.id);
                }}
              >
                <Text style={styles.ribbonIcon}>{item.icon}</Text>
                <Text style={[styles.ribbonName, !enabled && styles.ribbonDim, isArmed && styles.ribbonNameArmed]}>
                  {item.name}
                </Text>
                <Text style={[styles.ribbonCost, !enabled && styles.ribbonDim, isArmed && styles.ribbonNameArmed]}>
                  {costLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>

      <TouchableOpacity
        style={[styles.menuBtn, { top: topInset + 4, left: 4, position: 'absolute', zIndex: 20 }]}
        onPress={() => setConfirmLeave(true)}
      >
        <Ionicons name="arrow-back" size={14} color="#A08860" />
        <Text style={styles.menuBtnText}>Menu</Text>
      </TouchableOpacity>

      <View style={[styles.bottomBar, { paddingBottom: botInset }]}>
        <View style={styles.bottomBarInner}>
          <TouchableOpacity
            style={[
              styles.buildBtn,
              ribbonOpen && styles.buildBtnActive,
              !canBuild && styles.buildBtnDisabled,
            ]}
            onPress={() => {
              if (!canBuild) return;
              if (ribbonOpen) {
                closeRibbon();
                setArmedEntityId(null);
              } else {
                openRibbon();
              }
            }}
            activeOpacity={canBuild ? 0.75 : 1}
          >
            <Ionicons
              name="hammer"
              size={14}
              color={ribbonOpen ? '#0D0A06' : canBuild ? '#C8A24A' : '#3A2E14'}
            />
            <Text style={[
              styles.buildBtnText,
              ribbonOpen && styles.buildBtnTextActive,
              !canBuild && styles.buildBtnTextDisabled,
            ]}>
              Build
            </Text>
          </TouchableOpacity>

          {hasSelection && (
            <TouchableOpacity style={styles.creditsDisplay} onPress={() => setShowEconModal(true)} activeOpacity={0.75}>
              <Text style={styles.creditsIcon}>⚜️</Text>
              <Text style={styles.creditsAmount}>{selectedTerritoryBalance}</Text>
            </TouchableOpacity>
          )}

          <View style={styles.spacer} />

          <Text style={styles.turnText}>T{turn}</Text>

          <Animated.View style={endTurnStyle}>
            <TouchableOpacity style={styles.endTurnBtn} onPress={handleEndTurn}>
              <Text style={styles.endTurnText}>End Turn</Text>
              <Ionicons name="arrow-forward" size={13} color="#F0D080" />
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>

      <Modal visible={confirmLeave} transparent animationType="fade" onRequestClose={() => setConfirmLeave(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Leave Game?</Text>
            <Text style={styles.modalBody}>Return to the main menu? Your progress will be lost.</Text>
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalStayBtn} onPress={() => setConfirmLeave(false)}>
                <Text style={styles.modalStayText}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalLeaveBtn} onPress={() => { setConfirmLeave(false); router.back(); }}>
                <Text style={styles.modalLeaveText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showEconModal} transparent animationType="fade" onRequestClose={() => setShowEconModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.econCard}>
            <Text style={styles.econTitle}>Economy Breakdown</Text>
            <View style={styles.econSection}>
              <Text style={styles.econSectionLabel}>INCOME / TURN</Text>
              {econBreakdown && econBreakdown.grassCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>🌿 Grass ×{econBreakdown.grassCount} <Text style={styles.econPer}>(+1 each)</Text></Text>
                  <Text style={styles.econRowValue}>+{econBreakdown.grassIncome}</Text>
                </View>
              )}
              {econBreakdown && econBreakdown.desertCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>🏜️ Desert ×{econBreakdown.desertCount} <Text style={styles.econPer}>(+0 each)</Text></Text>
                  <Text style={[styles.econRowValue, { color: '#A09070' }]}>+0</Text>
                </View>
              )}
              {econBreakdown && econBreakdown.mountainCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>⛰️ Mountain ×{econBreakdown.mountainCount} <Text style={styles.econPer}>(+0 each)</Text></Text>
                  <Text style={[styles.econRowValue, { color: '#A09070' }]}>+0</Text>
                </View>
              )}
              {econBreakdown && econBreakdown.cityCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>🏙️ Cities ×{econBreakdown.cityCount} <Text style={styles.econPer}>(+1 each)</Text></Text>
                  <Text style={styles.econRowValue}>+{econBreakdown.cityIncome}</Text>
                </View>
              )}
            </View>
            {econBreakdown && econBreakdown.upkeepGroups.length > 0 && (
              <View style={styles.econSection}>
                <Text style={styles.econSectionLabel}>UPKEEP / TURN</Text>
                {econBreakdown.upkeepGroups.map((g, i) => (
                  <View key={i} style={styles.econRow}>
                    <Text style={styles.econRowLabel}>{g.icon} {g.name} ×{g.count} <Text style={styles.econPer}>(−{g.upkeepPerUnit} each)</Text></Text>
                    <Text style={[styles.econRowValue, { color: '#E07060' }]}>−{g.total}</Text>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.econDivider} />
            <View style={styles.econRow}>
              <Text style={styles.econNetLabel}>Net per turn</Text>
              <Text style={[styles.econNetValue, { color: econBreakdown && econBreakdown.net >= 0 ? '#7EC87E' : '#E07060' }]}>
                {econBreakdown && econBreakdown.net >= 0 ? '+' : ''}{econBreakdown?.net ?? 0}
              </Text>
            </View>
            <View style={styles.econRow}>
              <Text style={styles.econNetLabel}>Current balance</Text>
              <Text style={styles.econNetValue}>⚜️ {selectedTerritoryBalance}</Text>
            </View>
            <TouchableOpacity style={styles.econCloseBtn} onPress={() => setShowEconModal(false)}>
              <Text style={styles.econCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#081828',
    overflow: 'hidden',
  },
  board: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  boardElevated: {
    ...Platform.select({
      web: {
        filter: 'drop-shadow(0px 12px 32px rgba(0,10,30,0.85))',
      } as any,
      default: {
        elevation: 24,
        shadowColor: '#000A1E',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.85,
        shadowRadius: 24,
      },
    }),
  },
  ribbon: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: RIBBON_H,
    overflow: 'hidden',
    backgroundColor: 'rgba(58, 44, 18, 0.98)',
    borderTopWidth: 1,
    borderTopColor: '#8A6A2C',
  },
  ribbonContent: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ribbonItem: {
    width: 82,
    height: RIBBON_H - 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#3A2C12',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  ribbonItemDisabled: {
    borderColor: '#4A3A1A',
    backgroundColor: '#2A200A',
  },
  ribbonItemArmed: {
    borderColor: '#FFD700',
    backgroundColor: '#2A2008',
  },
  ribbonIcon: {
    fontSize: 22,
  },
  ribbonName: {
    fontSize: 10,
    fontFamily: 'Cinzel_400Regular',
    color: '#C8A24A',
  },
  ribbonNameArmed: {
    color: '#FFD700',
  },
  ribbonCost: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: '#A08C68',
  },
  ribbonDim: {
    color: '#3A3020',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(54, 40, 14, 0.98)',
    borderTopWidth: 1,
    borderTopColor: '#8A6A2C',
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
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#3A2A10',
  },
  menuBtnText: {
    fontSize: 11,
    fontFamily: 'Cinzel_400Regular',
    color: '#A08860',
  },
  buildBtn: {
    height: BTN_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#9A7830',
    backgroundColor: '#3A2A10',
  },
  buildBtnActive: {
    backgroundColor: '#C8A24A',
    borderColor: '#C8A24A',
  },
  buildBtnDisabled: {
    borderColor: '#4A3A1A',
    backgroundColor: '#2A1E08',
  },
  buildBtnText: {
    fontSize: 11,
    fontFamily: 'Cinzel_400Regular',
    color: '#C8A24A',
  },
  buildBtnTextActive: {
    color: '#0D0A06',
  },
  buildBtnTextDisabled: {
    color: '#5A4A22',
  },
  creditsDisplay: {
    height: BTN_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#3A2A10',
  },
  creditsIcon: {
    fontSize: 13,
  },
  creditsAmount: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#C8A24A',
  },
  spacer: {
    flex: 1,
  },
  turnText: {
    fontSize: 11,
    fontFamily: 'Cinzel_400Regular',
    color: '#786A54',
  },
  endTurnBtn: {
    height: BTN_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#B08030',
    backgroundColor: '#6A4014',
  },
  endTurnText: {
    fontSize: 12,
    fontFamily: 'Cinzel_700Bold',
    color: '#F0D080',
    letterSpacing: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: 300,
    backgroundColor: '#3A2A10',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9A7830',
    padding: 28,
    gap: 12,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Cinzel_700Bold',
    color: '#F0D080',
    letterSpacing: 0.5,
  },
  modalBody: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#C8A870',
    textAlign: 'center',
    lineHeight: 20,
  },
  modalRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalStayBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#2A1E08',
    alignItems: 'center',
  },
  modalStayText: {
    fontSize: 13,
    fontFamily: 'Cinzel_400Regular',
    color: '#C8A24A',
  },
  modalLeaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#AA3A2A',
    backgroundColor: '#4A1A10',
    alignItems: 'center',
  },
  modalLeaveText: {
    fontSize: 13,
    fontFamily: 'Cinzel_700Bold',
    color: '#F07060',
  },
  econCard: {
    width: 320,
    backgroundColor: '#3A2A10',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9A7830',
    padding: 24,
    gap: 8,
  },
  econTitle: {
    fontSize: 16,
    fontFamily: 'Cinzel_700Bold',
    color: '#F0D080',
    letterSpacing: 0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  econSection: {
    gap: 4,
  },
  econSectionLabel: {
    fontSize: 10,
    fontFamily: 'Cinzel_400Regular',
    color: '#786A54',
    letterSpacing: 1,
    marginBottom: 2,
  },
  econRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  econRowLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#C8A870',
    flex: 1,
  },
  econPer: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: '#786A54',
  },
  econRowValue: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: '#7EC87E',
  },
  econEmpty: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#786A54',
    fontStyle: 'italic',
  },
  econDivider: {
    height: 1,
    backgroundColor: '#6A5020',
    marginVertical: 4,
  },
  econNetLabel: {
    fontSize: 14,
    fontFamily: 'Cinzel_400Regular',
    color: '#D0B880',
  },
  econNetValue: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#C8A24A',
  },
  econCloseBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#2A1E08',
    alignItems: 'center',
  },
  econCloseBtnText: {
    fontSize: 13,
    fontFamily: 'Cinzel_400Regular',
    color: '#C8A24A',
  },
});
