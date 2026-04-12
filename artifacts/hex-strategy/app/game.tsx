import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
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
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, ClipPath, Defs, Image as SvgImage, Line, LinearGradient, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';

const MOUNTAIN_IMG = require('../assets/images/mountain.webp');
const WATER_IMG = require('../assets/images/water.webp');

import { CITY_BUFFER_BORDER, CITY_NEUTRAL_FILL, TERRAIN_FILLS, TERRITORY_BORDERS, TERRITORY_FILLS } from '@/constants/colors';
import {
  CITY_BONUS,
  ENTITY_META,
  EntityType,
  HEX_EDGES,
  HexTile,
  TERRAIN_INCOME,
  TerritoryOwner,
  UNIT_UPGRADE,
  findCentralTile,
  generateHexGrid,
  getBoardBounds,
  getContiguousTerritory,
  getMaxEnemyZoC,
  getTerritoryId,
  getValidMoves,
  getMoveCost,
  hexCornerPoint,
  hexCornersString,
  hexDistance,
  hexToPixel,
  recalculateTerritories,
  recalculateTerritoriesForCapture,
  tileKey,
} from '@/utils/hexGrid';

const BTN_H = 52;
const BOTTOM_BAR_H = BTN_H + 20;
const RIBBON_H = 130;
const ENTITY_PANEL_H = 56;
const EXTRA_PAN = 150;

const ORDERED_EDGES: ReadonlyArray<{ dir: [number, number]; verts: [number, number] }> = [
  { dir: [1, 0],   verts: [0, 1] },
  { dir: [0, 1],   verts: [1, 2] },
  { dir: [-1, 1],  verts: [2, 3] },
  { dir: [-1, 0],  verts: [3, 4] },
  { dir: [0, -1],  verts: [4, 5] },
  { dir: [1, -1],  verts: [5, 0] },
];

const PURCHASABLES = (Object.keys(ENTITY_META) as EntityType[]).filter(id => id !== 'rebel').map(id => ({
  id,
  ...ENTITY_META[id],
}));
const UNIT_PURCHASABLES = PURCHASABLES.filter(p => p.isUnit);
const BUILDING_PURCHASABLES = PURCHASABLES.filter(p => !p.isUnit);

// Wipe out newly-isolated single-hex territories: zero balance, kill units→graveyard, remove buildings.
// Only fires for tiles that were NOT already lone-hex before the current move (prevTileMap).
function applySingleHexPenalty(
  prevTileMap: Map<string, HexTile>,
  tileMap: Map<string, HexTile>,
  balances: Map<string, number>,
  entities: Map<string, EntityType>,
  graveyard: Set<string>,
  ruins: Set<string>,
): void {
  const allOwners = new Set<TerritoryOwner>(['player', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
  const visited = new Set<string>();
  for (const tile of tileMap.values()) {
    if (!allOwners.has(tile.owner as TerritoryOwner) || visited.has(tile.key)) continue;
    if (tile.terrain === 'mountain' || tile.terrain === 'lake') continue;
    const territory = getContiguousTerritory(tileMap, tile.key, tile.owner as TerritoryOwner);
    for (const t of territory) visited.add(t.key);
    if (territory.length !== 1) continue;
    const singleKey = territory[0].key;
    // Skip if this tile was already isolated before this move — it is not newly cut off
    const prevOwner = prevTileMap.get(singleKey)?.owner;
    if (prevOwner === tile.owner) {
      const prevTerritory = getContiguousTerritory(prevTileMap, singleKey, tile.owner as TerritoryOwner);
      if (prevTerritory.length === 1) continue;
    }
    const id = getTerritoryId(territory);
    if (id) balances.set(id, 0);
    const entity = entities.get(singleKey);
    if (entity) {
      if (ENTITY_META[entity].isUnit) {
        entities.delete(singleKey);
        graveyard.add(singleKey);
      } else if (entity !== 'rebel') {
        entities.delete(singleKey);
        ruins.add(singleKey);
      }
    }
  }
}

const STRENGTH_TO_UNIT: Record<number, EntityType> = {
  1: 'simple_unit',
  2: 'advanced_unit',
  3: 'expert_unit',
};

function mergedUnitType(strA: number, strB: number): EntityType {
  const total = Math.min(strA + strB, 3);
  return STRENGTH_TO_UNIT[total] ?? 'expert_unit';
}

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
): Map<string, number> {
  const balances = new Map<string, number>();
  const visited = new Set<string>();
  const owners: TerritoryOwner[] = ['player', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5'];
  for (const tile of tiles) {
    if (!owners.includes(tile.owner) || visited.has(tile.key)) continue;
    const territory = getContiguousTerritory(tileMap, tile.key, tile.owner);
    const id = getTerritoryId(territory);
    if (!id) continue;
    balances.set(id, territory.length >= 2 ? 10 : 0);
    for (const t of territory) visited.add(t.key);
  }
  return balances;
}

function AnimatedMovingUnit({
  fromPos,
  toPos,
  entityId,
  owner,
  hexSize,
  progress,
}: {
  fromPos: { cx: number; cy: number };
  toPos: { cx: number; cy: number };
  entityId: EntityType;
  owner: TerritoryOwner;
  hexSize: number;
  progress: Animated.SharedValue<number>;
}) {
  const meta = ENTITY_META[entityId];
  const r = hexSize * 0.50;
  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        { translateX: (toPos.cx - fromPos.cx) * p },
        { translateY: (toPos.cy - fromPos.cy) * p },
      ],
    };
  });
  const bgColor = owner === 'player' ? 'rgba(30,50,120,0.9)' : 'rgba(80,20,20,0.9)';
  const borderColor = TERRITORY_BORDERS[owner] ?? TERRITORY_BORDERS['player'];
  return (
    <Animated.View
      style={[{
        position: 'absolute',
        left: fromPos.cx - r,
        top: fromPos.cy - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        backgroundColor: bgColor,
        borderWidth: 2.2,
        borderColor,
        alignItems: 'center',
        justifyContent: 'center',
      }, animStyle]}
    >
      <Text style={{ fontSize: r * 1.1, lineHeight: r * 1.6 }}>{meta.icon}</Text>
    </Animated.View>
  );
}

export default function GameScreen() {
  type Difficulty = 'easy' | 'medium' | 'hard';
  type AiState = 'attacking' | 'defending';

  const params = useLocalSearchParams<{ tileCount: string; opponentCount: string; difficulty: string }>();
  const numTiles = Math.min(300, Math.max(40, Number(params.tileCount) || 100));
  const numOpponents = Math.min(5, Math.max(1, Number(params.opponentCount) || 3));
  const aiDifficulty = (params.difficulty as Difficulty) || 'medium';
  const aiDifficultyRef = useRef<Difficulty>(aiDifficulty);
  useEffect(() => { aiDifficultyRef.current = aiDifficulty; }, [aiDifficulty]);

  const aiStateMapRef = useRef<Map<string, AiState>>(new Map());
  const [aiStateMap, setAiStateMap] = useState<Map<string, AiState>>(new Map());
  const { width: SW, height: SH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const topInset = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const botInset = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  const HEX_SIZE = Math.max(20, Math.min(42, Math.floor(280 / Math.sqrt(numTiles))));
  const BORDER_W = 4.0;
  const INNER_SIZE = HEX_SIZE - BORDER_W * 0.65 * (2 / Math.sqrt(3));

  const [gameKey, setGameKey] = useState(0);

  const tiles = useMemo(
    () => generateHexGrid(numTiles, numOpponents + 1),
    [numTiles, numOpponents, gameKey],
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

  const [liveOwnerMap, setLiveOwnerMap] = useState<Map<string, TerritoryOwner>>(new Map());
  const [mutableTileMap, setMutableTileMap] = useState<Map<string, HexTile>>(new Map());

  const borderEdgesCache = useRef<{
    mutableTileMap: Map<string, HexTile>;
    tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
    INNER_SIZE: number;
    perTileEdges: Map<string, BorderEdge[]>;
    result: BorderEdge[];
  } | null>(null);

  const borderEdges = useMemo<BorderEdge[]>(() => {
    const ownerOf = (key: string, base: HexTile) =>
      mutableTileMap.get(key)?.owner ?? base.owner;

    const prev = borderEdgesCache.current;
    const isNewBoard = !prev || prev.tileData !== tileData || prev.INNER_SIZE !== INNER_SIZE;

    const perTileEdges: Map<string, BorderEdge[]> = isNewBoard ? new Map() : new Map(prev!.perTileEdges);

    const changedKeys = new Set<string>();
    if (isNewBoard) {
      for (const { tile } of tileData) changedKeys.add(tile.key);
    } else {
      for (const [key, tile] of mutableTileMap) {
        if (prev!.mutableTileMap.get(key)?.owner !== tile.owner) {
          changedKeys.add(key);
          for (const { dir: [dq, dr] } of ORDERED_EDGES) {
            const [q, r] = key.split(',').map(Number);
            changedKeys.add(tileKey(q + dq, r + dr));
          }
        }
      }
      for (const [key] of prev!.mutableTileMap) {
        if (!mutableTileMap.has(key)) {
          changedKeys.add(key);
          for (const { dir: [dq, dr] } of ORDERED_EDGES) {
            const [q, r] = key.split(',').map(Number);
            changedKeys.add(tileKey(q + dq, r + dr));
          }
        }
      }
    }

    const computeEdgesForTile = (tile: HexTile, cx: number, cy: number): BorderEdge[] => {
      const edges: BorderEdge[] = [];
      const liveOwner = ownerOf(tile.key, tile);
      if (tile.terrain === 'mountain' || tile.terrain === 'lake' || liveOwner === 'neutral') {
        if ((tile.cityBuffer || tile.isCity) && liveOwner === 'neutral') {
          for (const { dir: [dq, dr], verts: [va, vb] } of ORDERED_EDGES) {
            const nk = tileKey(tile.q + dq, tile.r + dr);
            const neighborBase = tileMap.get(nk);
            const neighborLiveOwner = neighborBase ? ownerOf(nk, neighborBase) : null;
            const neighborIsNeutralCity =
              neighborBase !== undefined &&
              neighborLiveOwner === 'neutral' &&
              (neighborBase.cityBuffer || neighborBase.isCity);
            if (neighborIsNeutralCity) continue;
            const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
            const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
            edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: CITY_BUFFER_BORDER, width: BORDER_W });
          }
        }
        return edges;
      }
      const color = TERRITORY_BORDERS[liveOwner as TerritoryOwner]!;
      if (!color) return edges;
      for (const { dir: [dq, dr], verts: [va, vb] } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighborBase = tileMap.get(nk);
        if (!neighborBase) {
          const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
          edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color, width: BORDER_W });
          continue;
        }
        const neighborLiveOwner = ownerOf(nk, neighborBase);
        const needsBorder =
          neighborBase.terrain === 'mountain' ||
          neighborBase.terrain === 'lake' ||
          neighborLiveOwner === 'neutral' ||
          neighborLiveOwner !== liveOwner;
        if (!needsBorder) continue;
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color, width: BORDER_W });
      }
      return edges;
    };

    for (const key of changedKeys) {
      const baseTile = tileMap.get(key);
      const pos = tileDataMap.get(key);
      if (!baseTile || !pos) { perTileEdges.delete(key); continue; }
      perTileEdges.set(key, computeEdgesForTile(baseTile, pos.cx, pos.cy));
    }

    const allEdges: BorderEdge[] = [];
    for (const { tile } of tileData) {
      const tileEdges = perTileEdges.get(tile.key);
      if (tileEdges) for (const e of tileEdges) allEdges.push(e);
    }

    borderEdgesCache.current = { mutableTileMap, tileData, INNER_SIZE, perTileEdges, result: allEdges };
    return allEdges;
  }, [tileData, tileMap, tileDataMap, mutableTileMap, INNER_SIZE]);

  const outerEdgesCache = useRef<{
    mutableTileMap: Map<string, HexTile>;
    tileData: Array<{ tile: HexTile; cx: number; cy: number }>;
    HEX_SIZE: number;
    perTileEdges: Map<string, BorderEdge[]>;
    result: BorderEdge[];
  } | null>(null);

  const outerTerritoryEdges = useMemo<BorderEdge[]>(() => {
    const ownerOf = (key: string, base: HexTile) =>
      mutableTileMap.get(key)?.owner ?? base.owner;

    const prev = outerEdgesCache.current;
    const isNewBoard = !prev || prev.tileData !== tileData || prev.HEX_SIZE !== HEX_SIZE;

    const perTileEdges: Map<string, BorderEdge[]> = isNewBoard ? new Map() : new Map(prev!.perTileEdges);

    const changedKeys = new Set<string>();
    if (isNewBoard) {
      for (const { tile } of tileData) changedKeys.add(tile.key);
    } else {
      for (const [key, tile] of mutableTileMap) {
        if (prev!.mutableTileMap.get(key)?.owner !== tile.owner) {
          changedKeys.add(key);
          for (const { dir: [dq, dr] } of ORDERED_EDGES) {
            const [q, r] = key.split(',').map(Number);
            changedKeys.add(tileKey(q + dq, r + dr));
          }
        }
      }
      for (const [key] of prev!.mutableTileMap) {
        if (!mutableTileMap.has(key)) {
          changedKeys.add(key);
          for (const { dir: [dq, dr] } of ORDERED_EDGES) {
            const [q, r] = key.split(',').map(Number);
            changedKeys.add(tileKey(q + dq, r + dr));
          }
        }
      }
    }

    const computeOuterEdgesForTile = (tile: HexTile, cx: number, cy: number): BorderEdge[] => {
      const edges: BorderEdge[] = [];
      const liveOwner = ownerOf(tile.key, tile);
      const isImpassable = tile.terrain === 'mountain' || tile.terrain === 'lake';
      if (!isImpassable && liveOwner === 'neutral') return edges;

      for (const { dir: [dq, dr], verts: [va, vb] } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighborBase = tileMap.get(nk);

        if (!neighborBase) {
          const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
          edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: '#000000', width: 2 });
          continue;
        }

        if (isImpassable) {
          if (neighborBase.terrain === tile.terrain) continue;
          const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
          edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: '#000000', width: 2 });
        } else {
          const neighborLiveOwner = ownerOf(nk, neighborBase);
          const needsBorder =
            neighborBase.terrain === 'mountain' ||
            neighborBase.terrain === 'lake' ||
            neighborLiveOwner === 'neutral' ||
            neighborLiveOwner !== liveOwner;
          if (!needsBorder) continue;
          const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
          edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: '#000000', width: 2 });
        }
      }
      return edges;
    };

    for (const key of changedKeys) {
      const baseTile = tileMap.get(key);
      const pos = tileDataMap.get(key);
      if (!baseTile || !pos) { perTileEdges.delete(key); continue; }
      perTileEdges.set(key, computeOuterEdgesForTile(baseTile, pos.cx, pos.cy));
    }

    const allEdges: BorderEdge[] = [];
    for (const { tile } of tileData) {
      const tileEdges = perTileEdges.get(tile.key);
      if (tileEdges) for (const e of tileEdges) allEdges.push(e);
    }

    outerEdgesCache.current = { mutableTileMap, tileData, HEX_SIZE, perTileEdges, result: allEdges };
    return allEdges;
  }, [tileData, tileMap, tileDataMap, mutableTileMap, HEX_SIZE]);

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
  const territoryPulseVal = useSharedValue(0);

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showEconModal, setShowEconModal] = useState(false);
  const [ribbonMode, setRibbonMode] = useState<'units' | 'buildings' | null>(null);
  const ribbonOpen = ribbonMode !== null;
  const ribbonAnim = useSharedValue(RIBBON_H);
  const ribbonScrollRef = useRef<ScrollView>(null);

  function openRibbon(mode: 'units' | 'buildings') {
    setRibbonMode(mode);
    ribbonAnim.value = withTiming(0, { duration: 280 });
    ribbonScrollRef.current?.scrollTo({ x: 0, animated: false });
  }

  function closeRibbon() {
    ribbonAnim.value = withTiming(RIBBON_H, { duration: 220 });
    setRibbonMode(null);
  }

  const [selectedTileKey, setSelectedTileKey] = useState<string | null>(null);
  const [armedEntityId, setArmedEntityId] = useState<EntityType | null>(null);
  const lastTileTapMs = useRef(0);
  const [entities, setEntities] = useState<Map<string, EntityType>>(new Map());
  const [territoryBalances, setTerritoryBalances] = useState<Map<string, number>>(new Map());
  const [turn, setTurn] = useState(1);
  const [selectedEntityKey, setSelectedEntityKey] = useState<string | null>(null);
  const [spentUnits, setSpentUnits] = useState<Set<string>>(new Set());
  const [combatSpentUnits, setCombatSpentUnits] = useState<Set<string>>(new Set());
  const [moveHistory, setMoveHistory] = useState<Array<{
    entities: Map<string, EntityType>;
    mutableTileMap: Map<string, HexTile>;
    territoryBalances: Map<string, number>;
    spentUnits: Set<string>;
    combatSpentUnits: Set<string>;
    liveOwnerMap: Map<string, TerritoryOwner>;
    partialMoves: Map<string, number>;
    freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
    lakeUnitFunds: Map<string, number>;
    selectedTileKey: string | null;
  }>>([]);
  const [isAiTurn, setIsAiTurn] = useState(false);
  const [gameResult, setGameResult] = useState<'victory' | 'defeat' | null>(null);
  const aiTurnRef = useRef<boolean>(false);
  const [graveyard, setGraveyard] = useState<Set<string>>(new Set());
  const [ruins, setRuins] = useState<Set<string>>(new Set());
  const [partialMoves, setPartialMoves] = useState<Map<string, number>>(new Map());
  const [isDeveloperModeActive, setIsDeveloperModeActive] = useState(false);
  const [isAiPaused, setIsAiPaused] = useState(false);
  const resumeAiRef = useRef<(() => void) | null>(null);
  const isDeveloperModeRef = useRef(false);
  const [freeTowerUsedTiles, setFreeTowerUsedTiles] = useState<Map<TerritoryOwner, Set<string>>>(new Map());
  const freeTowerUsedTilesRef = useRef<Map<TerritoryOwner, Set<string>>>(new Map());
  const [lakeUnitFunds, setLakeUnitFunds] = useState<Map<string, number>>(new Map());
  const lakeUnitFundsRef = useRef<Map<string, number>>(new Map());
  const graveyardRef = useRef<Set<string>>(new Set());
  const ruinsRef = useRef<Set<string>>(new Set());
  const [pendingLakeMove, setPendingLakeMove] = useState<{
    fromKey: string;
    toKey: string;
    sourceTerrId: string;
    maxAmount: number;
    minAmount: number;
  } | null>(null);
  const [lakeTransferAmount, setLakeTransferAmount] = useState(6);
  const [sliderTrackWidth, setSliderTrackWidth] = useState(220);

  const [errorTileKey, setErrorTileKey] = useState<string | null>(null);
  const errorTileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animUnitProgress = useSharedValue(0);
  const [animatingUnit, setAnimatingUnit] = useState<{
    fromKey: string;
    toKey: string;
    entityId: EntityType;
    owner: TerritoryOwner;
    hideDestination: boolean;
  } | null>(null);
  const triggerErrorFlash = useCallback((key: string) => {
    if (errorTileTimer.current) clearTimeout(errorTileTimer.current);
    setErrorTileKey(key);
    errorTileTimer.current = setTimeout(() => {
      setErrorTileKey(null);
      errorTileTimer.current = null;
    }, 150);
  }, []);

  const triggerUnitAnimation = useCallback((fromKey: string, toKey: string, entityId: EntityType, owner: TerritoryOwner = 'player', hideDestination = true, onDone?: () => void) => {
    animUnitProgress.value = 0;
    setAnimatingUnit({ fromKey, toKey, entityId, owner, hideDestination });
    const handleDone = () => {
      onDone?.();
      setAnimatingUnit(null);
    };
    animUnitProgress.value = withTiming(1, { duration: 280, easing: Easing.inOut(Easing.quad) }, (finished) => {
      if (finished) runOnJS(handleDone)();
    });
  }, [animUnitProgress]);

  useEffect(() => () => { if (errorTileTimer.current) clearTimeout(errorTileTimer.current); }, []);

  useEffect(() => { freeTowerUsedTilesRef.current = freeTowerUsedTiles; }, [freeTowerUsedTiles]);
  useEffect(() => { lakeUnitFundsRef.current = lakeUnitFunds; }, [lakeUnitFunds]);
  useEffect(() => { graveyardRef.current = graveyard; }, [graveyard]);
  useEffect(() => { ruinsRef.current = ruins; }, [ruins]);

  type AiStepSnapshot = {
    entities: Map<string, EntityType>;
    mutableTileMap: Map<string, HexTile>;
    territoryBalances: Map<string, number>;
    liveOwnerMap: Map<string, TerritoryOwner>;
    graveyard: Set<string>;
    freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  };
  const aiStepHistoryRef = useRef<AiStepSnapshot[]>([]);
  const [aiHistoryIndex, setAiHistoryIndex] = useState(-1);
  const [aiHistoryLen, setAiHistoryLen] = useState(0);

  useEffect(() => {
    isDeveloperModeRef.current = isDeveloperModeActive;
    if (!isDeveloperModeActive && isAiPaused) {
      resumeAiRef.current?.();
      resumeAiRef.current = null;
    }
  }, [isDeveloperModeActive, isAiPaused]);

  const restoreAiSnapshot = useCallback((snap: AiStepSnapshot) => {
    setEntities(snap.entities);
    setMutableTileMap(snap.mutableTileMap);
    setTerritoryBalances(snap.territoryBalances);
    setLiveOwnerMap(snap.liveOwnerMap);
    setGraveyard(snap.graveyard);
    setFreeTowerUsedTiles(snap.freeTowerUsedTiles);
  }, []);

  const handleAiStepNext = useCallback(() => {
    const currentLen = aiStepHistoryRef.current.length;
    const next = aiHistoryIndex + 1;
    if (next < currentLen) {
      restoreAiSnapshot(aiStepHistoryRef.current[next]);
      setAiHistoryIndex(next);
    } else {
      resumeAiRef.current?.();
      resumeAiRef.current = null;
    }
  }, [aiHistoryIndex, restoreAiSnapshot]);

  const handleAiStepBack = useCallback(() => {
    const prev = aiHistoryIndex - 1;
    if (prev < 0) return;
    restoreAiSnapshot(aiStepHistoryRef.current[prev]);
    setAiHistoryIndex(prev);
  }, [aiHistoryIndex, restoreAiSnapshot]);

  const idleBounceY = useSharedValue(0);
  useEffect(() => {
    if (isAiTurn) {
      cancelAnimation(idleBounceY);
      idleBounceY.value = withTiming(0, { duration: 150 });
      return;
    }
    idleBounceY.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 550, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 550, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => { cancelAnimation(idleBounceY); };
  }, [isAiTurn]);

  const idleBounceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: idleBounceY.value }],
  }));

  useEffect(() => {
    if (tiles.length > 0) {
      setTerritoryBalances(initTerritoryBalances(tiles, tileMap));
      setSelectedTileKey(null);
      setArmedEntityId(null);
      setSelectedEntityKey(null);
      setSpentUnits(new Set());
      setCombatSpentUnits(new Set());
      setPartialMoves(new Map());
      setMutableTileMap(new Map(tileMap));
      setLiveOwnerMap(new Map());
      setGraveyard(new Set());
      setRuins(new Set());
      setFreeTowerUsedTiles(new Map());
      setLakeUnitFunds(new Map());
      setPendingLakeMove(null);
      setLakeTransferAmount(6);

      const initialEntities = new Map<string, EntityType>();
      const owners: TerritoryOwner[] = ['player', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5'];
      for (const tile of tiles) {
        if (!owners.includes(tile.owner)) continue;
        if (tile.terrain === 'mountain' || tile.terrain === 'lake') continue;
        if (initialEntities.has(tile.key)) continue;
        if (Math.random() < 0.10) {
          initialEntities.set(tile.key, 'rebel');
        }
      }
      setEntities(initialEntities);
    }
  }, [tiles, tileMap]);

  const activeTileMap = mutableTileMap.size > 0 ? mutableTileMap : tileMap;

  const aiOwners = useMemo<TerritoryOwner[]>(() => {
    const all: TerritoryOwner[] = ['ai1', 'ai2', 'ai3', 'ai4', 'ai5'];
    return all.slice(0, numOpponents);
  }, [numOpponents]);

  const checkWinLoss = useCallback((currentTileMap: Map<string, HexTile>) => {
    const playerTiles = Array.from(currentTileMap.values()).filter(t => t.owner === 'player');
    if (playerTiles.length === 0) {
      setGameResult('defeat');
      return true;
    }
    const allAiEliminated = aiOwners.every(ai =>
      !Array.from(currentTileMap.values()).some(t => t.owner === ai && t.terrain !== 'lake'),
    );
    if (allAiEliminated) {
      setGameResult('victory');
      return true;
    }
    return false;
  }, [aiOwners]);

  const delay = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

  const awaitStep = useCallback(async (afterSnap: AiStepSnapshot) => {
    const newHistory = [...aiStepHistoryRef.current, afterSnap];
    aiStepHistoryRef.current = newHistory;
    const newIdx = newHistory.length - 1;
    setAiHistoryIndex(newIdx);
    setAiHistoryLen(newHistory.length);
    if (isDeveloperModeRef.current) {
      setIsAiPaused(true);
      await new Promise<void>(resolve => { resumeAiRef.current = resolve; });
      resumeAiRef.current = null;
      setIsAiPaused(false);
    } else {
      await delay(200);
    }
  }, []);

  const runAiTurn = useCallback(async (
    currentTileMap: Map<string, HexTile>,
    currentEntities: Map<string, EntityType>,
    currentBalances: Map<string, number>,
    initialLakeFunds?: Map<string, number>,
    currentTurn?: number,
    initialGraveyard?: Set<string>,
    initialRuins?: Set<string>,
  ) => {
    let workingTileMap = new Map(currentTileMap);
    let workingEntities = new Map(currentEntities);
    let workingBalances = new Map(currentBalances);
    let workingLiveOwnerMap = new Map<string, TerritoryOwner>();
    let workingGraveyard = new Set(initialGraveyard ?? graveyardRef.current);
    let workingRuins = new Set(initialRuins ?? ruinsRef.current);
    let workingSpentUnits = new Set<string>();
    let workingFreeTowerUsed = new Map(freeTowerUsedTilesRef.current);
    let workingLakeFunds = new Map(initialLakeFunds ?? lakeUnitFundsRef.current);

    aiStepHistoryRef.current = [];
    setAiHistoryIndex(-1);
    setAiHistoryLen(0);

    for (const aiOwner of aiOwners) {
      if (aiTurnRef.current === false) return;

      const visited = new Set<string>();
      const aiTiles = Array.from(workingTileMap.values()).filter(t => t.owner === aiOwner);
      if (aiTiles.length === 0) continue;

      for (const startTile of aiTiles) {
        if (visited.has(startTile.key)) continue;
        const territory = getContiguousTerritory(workingTileMap, startTile.key, aiOwner);
        for (const t of territory) visited.add(t.key);
        const territoryId = getTerritoryId(territory);
        if (!territoryId) continue;

        // Free tower: each territory with ≥2 tiles may build one free tower, round 1 only
        if (territory.length >= 2 && currentTurn === 1) {
          const aiUsedSet = workingFreeTowerUsed.get(aiOwner);
          const hasUsedFreeTower = !!aiUsedSet && territory.some(t => aiUsedSet.has(t.key));
          if (!hasUsedFreeTower) {
            const borderTowerCands: string[] = [];
            const innerTowerCands: string[] = [];
            for (const t of territory) {
              if (t.terrain === 'mountain' || t.terrain === 'lake' || workingEntities.has(t.key) || workingGraveyard.has(t.key)) continue;
              const [tq, tr] = t.key.split(',').map(Number);
              const onBorder = HEX_EDGES.some(({ dir: [dq, dr] }) => {
                const nk = tileKey(tq + dq, tr + dr);
                const nb = workingTileMap.get(nk);
                return !!nb && nb.owner !== aiOwner;
              });
              if (onBorder) borderTowerCands.push(t.key);
              else innerTowerCands.push(t.key);
            }
            const towerCandsRaw = borderTowerCands.length > 0 ? borderTowerCands : innerTowerCands;
            // Apply building spacing: prefer ≥2 tile gap from existing towers/castles
            const towerCandsSpaced = (() => {
              const scored = towerCandsRaw.map(k => {
                const [tq2, tr2] = k.split(',').map(Number);
                let minD = 99;
                for (const [ek, ee] of workingEntities) {
                  if (ee !== 'tower' && ee !== 'castle') continue;
                  const [eq, er] = ek.split(',').map(Number);
                  const d = hexDistance(tq2, tr2, eq, er);
                  if (d < minD) minD = d;
                }
                return { k, gap: minD };
              });
              const ideal = scored.filter(x => x.gap >= 2).map(x => x.k);
              const acceptable = scored.filter(x => x.gap >= 1).map(x => x.k);
              return ideal.length > 0 ? ideal : acceptable.length > 0 ? acceptable : towerCandsRaw;
            })();
            if (towerCandsSpaced.length > 0) {
              const towerKey = towerCandsSpaced[Math.floor(Math.random() * towerCandsSpaced.length)];
              workingEntities = new Map(workingEntities);
              workingEntities.set(towerKey, 'tower');
              const newOwnerSet = new Set(workingFreeTowerUsed.get(aiOwner) ?? []);
              for (const t of territory) newOwnerSet.add(t.key);
              workingFreeTowerUsed = new Map(workingFreeTowerUsed);
              workingFreeTowerUsed.set(aiOwner, newOwnerSet);
              setFreeTowerUsedTiles(new Map(workingFreeTowerUsed));
              setEntities(new Map(workingEntities));
              setAiStateMap(new Map(aiStateMapRef.current));
              await awaitStep({
                entities: new Map(workingEntities),
                mutableTileMap: new Map(workingTileMap),
                territoryBalances: new Map(workingBalances),
                liveOwnerMap: new Map(workingLiveOwnerMap),
                graveyard: new Set(workingGraveyard),
                freeTowerUsedTiles: new Map([...workingFreeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)])),
              });
              if (!aiTurnRef.current) return;
            }
          }
        }

        // Round 1: only the free tower is allowed — no other purchases
        if (currentTurn === 1) continue;

        // --- Compute AI state for this territory (done before rebel clearing so state is live at every awaitStep) ---
        const difficulty = aiDifficultyRef.current;

        const enemyTilesNearTerritory = territory.some(t => {
          const [tq, tr] = t.key.split(',').map(Number);
          for (const { dir: [dq, dr] } of HEX_EDGES) {
            const nk = tileKey(tq + dq, tr + dr);
            const nb = workingTileMap.get(nk);
            if (nb && nb.owner !== aiOwner && nb.owner !== 'neutral') return true;
          }
          return false;
        });

        // Hard difficulty: if any enemy unit within 4 tiles of an AI city, set defending
        let forcedDefend = false;
        if (difficulty === 'hard') {
          const aiCities = territory.filter(t => t.isCity || workingEntities.get(t.key) === 'city');
          for (const city of aiCities) {
            const [cq, cr] = city.key.split(',').map(Number);
            for (const [ek, ee] of workingEntities) {
              if (!ENTITY_META[ee].isUnit) continue;
              const et = workingTileMap.get(ek);
              if (!et || et.owner === aiOwner) continue;
              const [eq, er] = ek.split(',').map(Number);
              if (hexDistance(cq, cr, eq, er) <= 4) { forcedDefend = true; break; }
            }
            if (forcedDefend) break;
          }
        }

        const currentAiState: AiState = (!forcedDefend && enemyTilesNearTerritory) ? 'attacking' : 'defending';
        aiStateMapRef.current = new Map(aiStateMapRef.current);
        aiStateMapRef.current.set(territoryId, currentAiState);
        setAiStateMap(new Map(aiStateMapRef.current));

        // Detect if this territory can merge with another AI territory of the same owner
        // Used to prioritize merging over rebel clearing and other lower-priority actions
        const mergeCheckKeys = new Set(territory.map(t => t.key));
        const hasMergeOpportunity = territory.some(t => {
          const [tq, tr] = t.key.split(',').map(Number);
          return HEX_EDGES.some(({ dir: [dq, dr] }) => {
            const mk = tileKey(tq + dq, tr + dr);
            const mt = workingTileMap.get(mk);
            if (!mt || mt.owner === aiOwner || mt.terrain === 'mountain' || mt.terrain === 'lake') return false;
            const [mq, mr] = mk.split(',').map(Number);
            return HEX_EDGES.some(({ dir: [dq2, dr2] }) => {
              const nk2 = tileKey(mq + dq2, mr + dr2);
              const nt2 = workingTileMap.get(nk2);
              return nt2 && nt2.owner === aiOwner && !mergeCheckKeys.has(nk2);
            });
          });
        });

        // --- Rebel clearing: move an existing unit onto rebel tile, or buy a simple_unit onto it ---
        // Territory merging is higher priority — don't spend combat units or credits on rebels if merging is possible
        {
          const rebelTiles = territory.filter(t => {
            if (workingEntities.get(t.key) !== 'rebel') return false;
            const tileIncome = (TERRAIN_INCOME[t.terrain] ?? 0) + (t.isCity ? CITY_BONUS : 0);
            return tileIncome > 0;
          });
          for (const rebelTile of rebelTiles) {
            if (!aiTurnRef.current) return;
            const aiUnitsNow = Array.from(workingEntities.entries()).filter(([k, e]) => {
              const tile = workingTileMap.get(k);
              return tile?.owner === aiOwner && ENTITY_META[e].isUnit && !workingSpentUnits.has(k);
            });
            let cleared = false;
            for (const [unitKey, unitEntity] of aiUnitsNow) {
              const validMoves = getValidMoves(unitKey, aiOwner, workingEntities, workingTileMap, workingSpentUnits);
              if (!validMoves.has(rebelTile.key)) continue;
              // If a merge is possible, preserve units that could reach a bridge tile for merging instead
              if (hasMergeOpportunity) {
                const canReachBridge = Array.from(validMoves).some(mk => {
                  const mt = workingTileMap.get(mk);
                  if (!mt || mt.owner === aiOwner || mt.terrain === 'mountain' || mt.terrain === 'lake') return false;
                  const [mq, mr] = mk.split(',').map(Number);
                  return HEX_EDGES.some(({ dir: [dq2, dr2] }) => {
                    const nk2 = tileKey(mq + dq2, mr + dr2);
                    const nt2 = workingTileMap.get(nk2);
                    return nt2 && nt2.owner === aiOwner && !mergeCheckKeys.has(nk2);
                  });
                });
                if (canReachBridge) continue;
              }
              // Move this unit to the rebel tile
              workingEntities = new Map(workingEntities);
              workingEntities.delete(rebelTile.key);
              workingEntities.delete(unitKey);
              workingEntities.set(rebelTile.key, unitEntity);
              workingSpentUnits = new Set(workingSpentUnits);
              workingSpentUnits.add(rebelTile.key);
              workingGraveyard = new Set(workingGraveyard);
              workingGraveyard.delete(rebelTile.key);
              workingBalances = recalculateTerritoriesForCapture(
                rebelTile.key, aiOwner, aiOwner, workingTileMap, workingTileMap, workingBalances,
              );
              setEntities(new Map(workingEntities));
              setTerritoryBalances(new Map(workingBalances));
              setGraveyard(new Set(workingGraveyard));
              setAiStateMap(new Map(aiStateMapRef.current));
              await awaitStep({
                entities: new Map(workingEntities),
                mutableTileMap: new Map(workingTileMap),
                territoryBalances: new Map(workingBalances),
                liveOwnerMap: new Map(workingLiveOwnerMap),
                graveyard: new Set(workingGraveyard),
                freeTowerUsedTiles: new Map([...workingFreeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)])),
              });
              if (!aiTurnRef.current) return;
              cleared = true;
              break;
            }
            // Only buy a unit for rebel clearing if merging is not possible (credits better spent on merging)
            if (!cleared && !hasMergeOpportunity) {
              const currentBalance = workingBalances.get(territoryId) ?? 0;
              if (currentBalance >= 10) {
                workingEntities = new Map(workingEntities);
                workingEntities.delete(rebelTile.key);
                workingEntities.set(rebelTile.key, 'simple_unit');
                workingBalances = new Map(workingBalances);
                workingBalances.set(territoryId, currentBalance - 10);
                workingGraveyard = new Set(workingGraveyard);
                workingGraveyard.delete(rebelTile.key);
                workingSpentUnits = new Set(workingSpentUnits);
                workingSpentUnits.add(rebelTile.key);
                setEntities(new Map(workingEntities));
                setTerritoryBalances(new Map(workingBalances));
                setGraveyard(new Set(workingGraveyard));
                setAiStateMap(new Map(aiStateMapRef.current));
                await awaitStep({
                  entities: new Map(workingEntities),
                  mutableTileMap: new Map(workingTileMap),
                  territoryBalances: new Map(workingBalances),
                  liveOwnerMap: new Map(workingLiveOwnerMap),
                  graveyard: new Set(workingGraveyard),
                  freeTowerUsedTiles: new Map([...workingFreeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)])),
                });
                if (!aiTurnRef.current) return;
              }
            }
          }
        }

        let balance = workingBalances.get(territoryId) ?? 0;

        // Hard keeps a 7-credit reserve; Medium/Easy spend full budget (skip chance handles restraint)
        const creditReserve = difficulty === 'hard' ? 7 : 0;
        if (balance < 10 || balance <= creditReserve) continue;

        // --- Budget-exhaustion buying loop: all personalities loop until no affordable action ---
        // Skip chance per action: Hard=0%, Medium=20%, Easy=40% — same base strategy, just fewer actions taken
        type AiAction =
          | { kind: 'upgrade'; key: string; from: EntityType; to: EntityType; cost: number }
          | { kind: 'buy'; unitType: EntityType; key: string; outside: boolean; cost: number };

        let buyLoopBalance = workingBalances.get(territoryId) ?? 0;
        let buyLoopIter = 0;
        while (buyLoopIter++ < 50) {
          buyLoopBalance = workingBalances.get(territoryId) ?? 0;
          balance = buyLoopBalance; // refresh balance from source of truth each iteration
          if (buyLoopBalance < 10 || buyLoopBalance <= creditReserve) break;

        // Recompute territory each iteration (captures can expand territory boundary)
        const freshTerritory = getContiguousTerritory(workingTileMap, startTile.key, aiOwner);
        const currentTerritory = freshTerritory.length > 0 ? freshTerritory : territory;
        const territoryKeys = new Set(currentTerritory.map(t => t.key));
        const vacantInside = currentTerritory.filter(
          t => t.terrain !== 'mountain' && t.terrain !== 'lake' && !workingEntities.has(t.key),
        );

        // Border tiles (adjacent to non-AI tiles)
        const borderVacant = vacantInside.filter(t => {
          const [tq, tr] = t.key.split(',').map(Number);
          return HEX_EDGES.some(({ dir: [dq, dr] }) => {
            const nk = tileKey(tq + dq, tr + dr);
            const nb = workingTileMap.get(nk);
            return nb && nb.owner !== aiOwner;
          });
        });

        // Territory economics — used for upgrade safety check each iteration
        const territoryIncome = currentTerritory.reduce((s, t) => {
          if (workingEntities.get(t.key) === 'rebel') return s;
          return s + (TERRAIN_INCOME[t.terrain] ?? 0) + (t.isCity ? CITY_BONUS : 0) + (workingEntities.get(t.key) === 'city' ? CITY_BONUS : 0);
        }, 0);
        const territoryUpkeep = currentTerritory.reduce((s, t) => {
          const e = workingEntities.get(t.key);
          return s + (e ? ENTITY_META[e].upkeep : 0);
        }, 0);

        // Building spacing: sort placement candidates to prefer ≥2 tile gap from existing towers/castles
        // Ideal: 2+ tiles (no ZoC overlap); acceptable: 1 tile (partial overlap); avoid: 0 (adjacent, wasteful)
        const buildingSpacingSort = (tiles: HexTile[]): HexTile[] => {
          if (tiles.length <= 1) return tiles;
          const scored = tiles.map(t => {
            const [bq, br] = t.key.split(',').map(Number);
            let minD = 99;
            for (const [ek, ee] of workingEntities) {
              if (ee !== 'tower' && ee !== 'castle') continue;
              const [eq, er] = ek.split(',').map(Number);
              const d = hexDistance(bq, br, eq, er);
              if (d < minD) minD = d;
            }
            return { t, gap: minD };
          });
          const ideal = scored.filter(x => x.gap >= 2).map(x => x.t);
          const acceptable = scored.filter(x => x.gap >= 1).map(x => x.t);
          return ideal.length > 0 ? ideal : acceptable.length > 0 ? acceptable : tiles;
        };

        const upgradeActions: AiAction[] = [];
        for (const t of currentTerritory) {
          if (t.terrain === 'mountain' || t.terrain === 'lake') continue;
          const existing = workingEntities.get(t.key);
          if (!existing) continue;
          const upgradeTo = UNIT_UPGRADE[existing];
          if (!upgradeTo) continue;
          const cost = ENTITY_META[upgradeTo].cost - ENTITY_META[existing].cost;
          if (balance - cost >= creditReserve && balance >= cost) {
            upgradeActions.push({ kind: 'upgrade', key: t.key, from: existing, to: upgradeTo, cost });
          }
        }

        // --- Placement attacks for each affordable unit type (ZoC-aware) ---
        // Build a map of which outside tiles are reachable per unit strength
        const outsideTilesByStrength = new Map<number, { enemy: string[]; neutral: string[] }>();
        const seenAdjacent = new Set<string>();
        for (const t of currentTerritory) {
          if (t.terrain === 'mountain' || t.terrain === 'lake') continue;
          const [q, r] = t.key.split(',').map(Number);
          for (const { dir: [dq, dr] } of HEX_EDGES) {
            const nk = tileKey(q + dq, r + dr);
            if (territoryKeys.has(nk) || seenAdjacent.has(nk)) continue;
            seenAdjacent.add(nk);
            const neighbor = workingTileMap.get(nk);
            if (!neighbor || neighbor.terrain === 'mountain' || neighbor.terrain === 'lake') continue;
            if (neighbor.owner === aiOwner) continue;
            const existingEntity = workingEntities.get(nk);
            if (existingEntity && existingEntity !== 'rebel') continue;
            const enemyZoC = getMaxEnemyZoC(nk, aiOwner, workingEntities, workingTileMap);
            const requiredStrength = enemyZoC + 1;
            if (!outsideTilesByStrength.has(requiredStrength)) {
              outsideTilesByStrength.set(requiredStrength, { enemy: [], neutral: [] });
            }
            const bucket = outsideTilesByStrength.get(requiredStrength)!;
            if (neighbor.owner !== 'neutral' && neighbor.owner !== aiOwner) {
              bucket.enemy.push(nk);
            } else {
              bucket.neutral.push(nk);
            }
          }
        }

        // Build list of purchasable unit types and their placement options
        const purchasableUnits: Array<{ unitType: EntityType; cost: number; strength: number }> = [
          { unitType: 'simple_unit',   cost: ENTITY_META.simple_unit.cost,   strength: ENTITY_META.simple_unit.strength },
          { unitType: 'advanced_unit', cost: ENTITY_META.advanced_unit.cost, strength: ENTITY_META.advanced_unit.strength },
          { unitType: 'expert_unit',   cost: ENTITY_META.expert_unit.cost,   strength: ENTITY_META.expert_unit.strength },
        ];

        const buyActions: AiAction[] = [];

        // RULE: Upgrade ASAP — always upgrade if affordable AND economy stays non-negative after upgrade
        // Castle prerequisite: an advanced_unit or expert_unit must exist in or adjacent to this territory
        const hasAdvancedUnitNearby = currentTerritory.some(t => {
          const e = workingEntities.get(t.key);
          if (e === 'advanced_unit' || e === 'expert_unit') return true;
          const [tq, tr] = t.key.split(',').map(Number);
          return HEX_EDGES.some(({ dir: [dq, dr] }) => {
            const nk = tileKey(tq + dq, tr + dr);
            const nt = workingTileMap.get(nk);
            const ne = workingEntities.get(nk);
            return nt && nt.owner === aiOwner && (ne === 'advanced_unit' || ne === 'expert_unit');
          });
        });

        const economySafeUpgrades = upgradeActions.filter(a => {
          const upkeepDelta = ENTITY_META[a.to].upkeep - ENTITY_META[a.from].upkeep;
          if (territoryIncome - territoryUpkeep - upkeepDelta < 0) return false;
          if (a.to === 'castle' && !hasAdvancedUnitNearby) return false;
          return true;
        });
        if (economySafeUpgrades.length > 0) {
          buyActions.push(economySafeUpgrades[Math.floor(Math.random() * economySafeUpgrades.length)]);
        } else {
          // Unified buying: strategic decisions based on actual situation

          // Compute threat score for a given AI tile: max ZoC projected by adjacent enemy tiles
          // Higher score = stronger enemy presence → place stronger defenses there
          const tileBorderThreat = (aiTileKey: string): number => {
            const [bq, br] = aiTileKey.split(',').map(Number);
            let maxThreat = 0;
            for (const { dir: [dq, dr] } of HEX_EDGES) {
              const nk = tileKey(bq + dq, br + dr);
              const nt = workingTileMap.get(nk);
              if (!nt || nt.owner === aiOwner || nt.owner === 'neutral') continue;
              const zoc = getMaxEnemyZoC(nk, aiOwner, workingEntities, workingTileMap);
              if (zoc > maxThreat) maxThreat = zoc;
            }
            return maxThreat;
          };

          // Find territory merge bridges: tiles outside current territory that, if captured,
          // would connect this territory to another AI territory of the same owner
          const territoryKeys = new Set(currentTerritory.map(t => t.key));
          const mergeBridgeTiles: string[] = [];
          for (const t of currentTerritory) {
            const [tq, tr] = t.key.split(',').map(Number);
            for (const { dir: [dq, dr] } of HEX_EDGES) {
              const mk = tileKey(tq + dq, tr + dr);
              const mt = workingTileMap.get(mk);
              if (!mt || mt.owner === aiOwner || mt.terrain === 'mountain' || mt.terrain === 'lake') continue;
              const [mq, mr] = mk.split(',').map(Number);
              const bridgesToOtherAi = HEX_EDGES.some(({ dir: [dq2, dr2] }) => {
                const nk2 = tileKey(mq + dq2, mr + dr2);
                const nt2 = workingTileMap.get(nk2);
                return nt2 && nt2.owner === aiOwner && !territoryKeys.has(nk2);
              });
              if (bridgesToOtherAi && !mergeBridgeTiles.includes(mk)) mergeBridgeTiles.push(mk);
            }
          }

          // Priority A: Territory merge — place cheapest unit on bridge tile to consolidate territories
          if (mergeBridgeTiles.length > 0) {
            const cheapAffordable = purchasableUnits
              .filter(u => balance - u.cost >= creditReserve && balance >= u.cost)
              .sort((a, b) => a.cost - b.cost);
            if (cheapAffordable.length > 0) {
              const unit = cheapAffordable[0];
              const validBridges = mergeBridgeTiles.filter(mk => {
                const enemyZoC = getMaxEnemyZoC(mk, aiOwner, workingEntities, workingTileMap);
                return unit.strength > enemyZoC;
              });
              if (validBridges.length > 0) {
                buyActions.push({ kind: 'buy', unitType: unit.unitType, key: validBridges[Math.floor(Math.random() * validBridges.length)], outside: true, cost: unit.cost });
              }
            }
          }

          if (buyActions.length === 0) {
            // Priority B: Expansion — buy a unit to capture adjacent non-AI tiles if economy stays non-negative
            // Expanding territory is more strategic than placing defensive buildings
            // Account for income gained from the captured tile (minimum: 1 from desert)
            const minCaptureIncome = 1;
            const expansionUnits = purchasableUnits.filter(u => {
              if (balance - u.cost < creditReserve || balance < u.cost) return false;
              return (territoryIncome + minCaptureIncome) - (territoryUpkeep + u.upkeep) >= 0;
            });
            if (expansionUnits.length > 0) {
              const unit = expansionUnits.reduce((a, b) => b.strength > a.strength ? b : a);
              const { unitType, cost, strength } = unit;
              const enemyOpts: string[] = [];
              const neutralOpts: string[] = [];
              for (const [reqStr, { enemy, neutral }] of outsideTilesByStrength) {
                if (strength >= reqStr) { enemyOpts.push(...enemy); neutralOpts.push(...neutral); }
              }
              const outsideOpts = currentAiState === 'attacking'
                ? (enemyOpts.length > 0 ? enemyOpts : neutralOpts)
                : (neutralOpts.length > 0 ? neutralOpts : enemyOpts);
              if (outsideOpts.length > 0) {
                buyActions.push({ kind: 'buy', unitType, key: outsideOpts[Math.floor(Math.random() * outsideOpts.length)], outside: true, cost });
              }
            }
          }

          if (buyActions.length === 0) {
            // Priority C: Threat-directed buildings — tower/castle on the most threatened border tile
            // Castle requires an advanced unit already present nearby (prerequisite check)
            const bldCandidates = borderVacant.length > 0 ? borderVacant : vacantInside;
            const threatScored = bldCandidates.map(t => ({ t, threat: tileBorderThreat(t.key) }));
            const maxThreat = Math.max(0, ...threatScored.map(x => x.threat));
            if (maxThreat >= 1) {
              const highThreatTiles = threatScored.filter(x => x.threat >= maxThreat).map(x => x.t);
              const spacedTiles = buildingSpacingSort(highThreatTiles);
              if (spacedTiles.length > 0) {
                if (maxThreat >= 2 && hasAdvancedUnitNearby && balance - ENTITY_META.castle.cost >= creditReserve && balance >= ENTITY_META.castle.cost) {
                  buyActions.push({ kind: 'buy', unitType: 'castle', key: spacedTiles[Math.floor(Math.random() * spacedTiles.length)].key, outside: false, cost: ENTITY_META.castle.cost });
                } else if (balance - ENTITY_META.tower.cost >= creditReserve && balance >= ENTITY_META.tower.cost) {
                  buyActions.push({ kind: 'buy', unitType: 'tower', key: spacedTiles[Math.floor(Math.random() * spacedTiles.length)].key, outside: false, cost: ENTITY_META.tower.cost });
                }
              }
            }
          }

          if (buyActions.length === 0) {
            // Priority D: Strength-matched unit as fallback (no adjacent expansion possible, no building needed)
            const allCandidates = borderVacant.length > 0 ? borderVacant : vacantInside;
            const maxThreatForUnit = Math.max(0, ...allCandidates.map(t => tileBorderThreat(t.key)));
            const targetStrength = maxThreatForUnit + 1;
            const affordableUnits = purchasableUnits.filter(u => balance - u.cost >= creditReserve && balance >= u.cost);
            const matchedUnits = affordableUnits.filter(u => u.strength >= targetStrength);
            const unitPool = matchedUnits.length > 0 ? matchedUnits : affordableUnits;
            if (unitPool.length > 0) {
              const chosenUnit = unitPool.reduce((a, b) => b.strength > a.strength ? b : a);
              const { unitType, cost, strength } = chosenUnit;
              const enemyOpts: string[] = [];
              const neutralOpts: string[] = [];
              for (const [reqStr, { enemy, neutral }] of outsideTilesByStrength) {
                if (strength >= reqStr) { enemyOpts.push(...enemy); neutralOpts.push(...neutral); }
              }
              const outsideOpts = currentAiState === 'attacking'
                ? (enemyOpts.length > 0 ? enemyOpts : neutralOpts)
                : (neutralOpts.length > 0 ? neutralOpts : enemyOpts);
              if (outsideOpts.length > 0) {
                buyActions.push({ kind: 'buy', unitType, key: outsideOpts[Math.floor(Math.random() * outsideOpts.length)], outside: true, cost });
              } else if (vacantInside.length > 0) {
                buyActions.push({ kind: 'buy', unitType, key: vacantInside[Math.floor(Math.random() * vacantInside.length)].key, outside: false, cost });
              }
            }
          }

          if (buyActions.length === 0 && upgradeActions.length > 0) {
            buyActions.push(upgradeActions[Math.floor(Math.random() * upgradeActions.length)]);
          }
        }

        const allBuyableActions: AiAction[] = buyActions;
        if (allBuyableActions.length === 0) break; // no affordable actions — exit buy loop

        // Apply difficulty skip chance: Hard=0%, Medium=20%, Easy=40%
        // Each iteration independently rolls — simulates imperfect play without changing strategy
        const buySkipChance = difficulty === 'easy' ? 0.4 : difficulty === 'medium' ? 0.2 : 0;
        if (buySkipChance > 0 && Math.random() < buySkipChance) continue;

        const chosenAction = allBuyableActions[Math.floor(Math.random() * allBuyableActions.length)];
        workingEntities = new Map(workingEntities);
        workingBalances = new Map(workingBalances);
        balance = workingBalances.get(territoryId) ?? 0;

        if (chosenAction.kind === 'upgrade') {
          workingEntities.set(chosenAction.key, chosenAction.to);
          workingBalances.set(territoryId, balance - chosenAction.cost);
        } else {
          // Buy: chosenAction.kind === 'buy'
          const { unitType, key: target, outside } = chosenAction;
          if (!outside) {
            workingEntities.set(target, unitType);
            workingBalances.set(territoryId, balance - chosenAction.cost);
          } else {
            const previousOwner = (workingTileMap.get(target)?.owner ?? 'neutral') as TerritoryOwner;
            const prevSnapshot = new Map(workingTileMap);
            workingTileMap = new Map(workingTileMap);
            const targetTile = workingTileMap.get(target);
            if (targetTile) workingTileMap.set(target, { ...targetTile, owner: aiOwner });
            workingEntities.delete(target);
            workingEntities.set(target, unitType);
            workingBalances = recalculateTerritoriesForCapture(
              target, aiOwner, previousOwner, prevSnapshot, workingTileMap, workingBalances,
            );
            const mergedTerritory = getContiguousTerritory(workingTileMap, target, aiOwner);
            const mergedId = getTerritoryId(mergedTerritory);
            if (mergedId) workingBalances.set(mergedId, (workingBalances.get(mergedId) ?? 0) - chosenAction.cost);
            applySingleHexPenalty(prevSnapshot, workingTileMap, workingBalances, workingEntities, workingGraveyard, workingRuins);
            setRuins(new Set(workingRuins));
            workingLiveOwnerMap = new Map(workingLiveOwnerMap);
            workingLiveOwnerMap.set(target, aiOwner);
            workingSpentUnits = new Set(workingSpentUnits);
            workingSpentUnits.add(target);
            setMutableTileMap(new Map(workingTileMap));
            setLiveOwnerMap(new Map(workingLiveOwnerMap));
          }
        }

        setEntities(new Map(workingEntities));
        setTerritoryBalances(new Map(workingBalances));
        setAiStateMap(new Map(aiStateMapRef.current));
        await awaitStep({
          entities: new Map(workingEntities),
          mutableTileMap: new Map(workingTileMap),
          territoryBalances: new Map(workingBalances),
          liveOwnerMap: new Map(workingLiveOwnerMap),
          graveyard: new Set(workingGraveyard),
          freeTowerUsedTiles: new Map([...workingFreeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)])),
        });
        if (!aiTurnRef.current) return;

        } // end buy loop
      }

      const aiUnits = Array.from(workingEntities.entries()).filter(([key, entityId]) => {
        const tile = workingTileMap.get(key);
        return tile?.owner === aiOwner && ENTITY_META[entityId].isUnit;
      });

      for (const [unitKey] of aiUnits) {
        if (!aiTurnRef.current) return;
        const unitEntity = workingEntities.get(unitKey);
        if (!unitEntity) continue;
        const unitStrength = ENTITY_META[unitEntity].strength;

        const allValidMoves = Array.from(
          getValidMoves(unitKey, aiOwner, workingEntities, workingTileMap, workingSpentUnits),
        );
        if (allValidMoves.length === 0) continue;

        // Look up AI state for this unit's territory to drive movement heuristics
        const movDifficulty = aiDifficultyRef.current;
        const unitTerritoryForState = getContiguousTerritory(workingTileMap, unitKey, aiOwner);
        const unitTerritoryIdForState = getTerritoryId(unitTerritoryForState);
        const movAiState: AiState = (unitTerritoryIdForState ? aiStateMapRef.current.get(unitTerritoryIdForState) : null) ?? 'defending';

        // Movement skip chance: Hard=0%, Medium=20%, Easy=40%
        // Never skip if there are adjacent non-AI tiles to capture (expansion/attack opportunity)
        const moveSkipChance = movDifficulty === 'easy' ? 0.4 : movDifficulty === 'medium' ? 0.2 : 0;
        if (moveSkipChance > 0) {
          const hasAdjacentOpportunity = allValidMoves.some(k => {
            const t = workingTileMap.get(k);
            return t && t.owner !== aiOwner;
          });
          if (!hasAdjacentOpportunity && Math.random() < moveSkipChance) continue;
        }

        const isMergeTarget = (k: string) => {
          const t = workingTileMap.get(k);
          if (!t || t.owner !== aiOwner) return false;
          const e = workingEntities.get(k);
          return !!e && ENTITY_META[e].isUnit;
        };

        const attackMovesAll = allValidMoves.filter(k => {
          const t = workingTileMap.get(k);
          return t && t.owner !== aiOwner && t.owner !== 'neutral';
        });
        const neutralMoves = allValidMoves.filter(k => {
          const t = workingTileMap.get(k);
          return t && t.owner === 'neutral';
        });
        const nonMergeMoves = allValidMoves.filter(k => !isMergeTarget(k));
        const movesPool = nonMergeMoves.length > 0 ? nonMergeMoves : allValidMoves;

        // Hard: BFS split-detection — prefer moves that INCREASE player territory fragmentation
        // Returns delta: (clusters after capture) - (clusters before capture); only positive deltas are meaningful
        const countPlayerClusters = (tileMap: Map<string, HexTile>): number => {
          const playerTiles = Array.from(tileMap.values()).filter(t => t.owner === 'player' && t.terrain !== 'mountain' && t.terrain !== 'lake');
          const visitedBfs = new Set<string>();
          let clusterCount = 0;
          for (const startT of playerTiles) {
            if (visitedBfs.has(startT.key)) continue;
            clusterCount++;
            const queue = [startT.key];
            visitedBfs.add(startT.key);
            while (queue.length > 0) {
              const curr = queue.shift()!;
              const [cq, cr] = curr.split(',').map(Number);
              for (const { dir: [dq, dr] } of HEX_EDGES) {
                const nk = tileKey(cq + dq, cr + dr);
                if (visitedBfs.has(nk)) continue;
                const nt = tileMap.get(nk);
                if (nt && nt.owner === 'player' && nt.terrain !== 'mountain' && nt.terrain !== 'lake') {
                  visitedBfs.add(nk);
                  queue.push(nk);
                }
              }
            }
          }
          return clusterCount;
        };
        const getSplitScore = (moveKey: string): number => {
          const [mq, mr] = moveKey.split(',').map(Number);
          // Only meaningful if the capture tile is adjacent to at least 2 different player tiles
          const adjPlayerKeys = HEX_EDGES
            .map(({ dir: [dq, dr] }) => tileKey(mq + dq, mr + dr))
            .filter(nk => { const nb = workingTileMap.get(nk); return nb && nb.owner === 'player'; });
          if (adjPlayerKeys.length < 2) return 0;
          // Count clusters before and after simulated capture
          const baselineClusters = countPlayerClusters(workingTileMap);
          const simulatedMap = new Map(workingTileMap);
          const moveTile = simulatedMap.get(moveKey);
          if (moveTile) simulatedMap.set(moveKey, { ...moveTile, owner: aiOwner });
          const afterClusters = countPlayerClusters(simulatedMap);
          // Return delta: only moves that actually increase fragmentation are preferred
          return afterClusters - baselineClusters;
        };

        // Hard: BFS pathfinding helper — returns best immediate move step toward a target key
        // Uses BFS from current unit position through AI-owned tiles to find the first step
        const hardBfsFirstStep = (targetKey: string): string | null => {
          // Self-target guard: if target is the current unit position, no move needed
          if (targetKey === unitKey) return null;
          if (movesPool.includes(targetKey)) return targetKey;
          // BFS from unitKey through reachable tiles to find path to target
          const bfsPrev = new Map<string, string>();
          const bfsVisited = new Set<string>([unitKey]);
          const bfsQueue: string[] = [unitKey];
          while (bfsQueue.length > 0) {
            const curr = bfsQueue.shift()!;
            const [cq, cr] = curr.split(',').map(Number);
            for (const { dir: [dq, dr] } of HEX_EDGES) {
              const nk = tileKey(cq + dq, cr + dr);
              if (bfsVisited.has(nk)) continue;
              const nt = workingTileMap.get(nk);
              if (!nt || nt.terrain === 'mountain' || nt.terrain === 'lake') continue;
              bfsVisited.add(nk);
              bfsPrev.set(nk, curr);
              if (nk === targetKey) {
                // Trace back to find first step from unitKey
                let step = nk;
                while (bfsPrev.get(step) !== unitKey) {
                  const prev = bfsPrev.get(step);
                  if (!prev) break;
                  step = prev;
                }
                // Return only if step is a valid legal move
                return movesPool.includes(step) ? step : null;
              }
              bfsQueue.push(nk);
            }
          }
          return null;
        };

        // Moves that would reduce an enemy territory to exactly 1 tile (triggers auto-dissolve)
        const getSingleTileKillMove = (): string | null => {
          const validAttacks = attackMovesAll.filter(k => {
            const enemyZoC = getMaxEnemyZoC(k, aiOwner, workingEntities, workingTileMap);
            return unitStrength > enemyZoC;
          });
          for (const mk of validAttacks) {
            const movTile = workingTileMap.get(mk);
            if (!movTile || movTile.owner === aiOwner || movTile.owner === 'neutral') continue;
            const enemyOwner = movTile.owner;
            const simMap = new Map(workingTileMap);
            simMap.set(mk, { ...movTile, owner: aiOwner });
            const enemyTilesLeft = Array.from(simMap.values()).filter(t => t.owner === enemyOwner);
            const visitedSim = new Set<string>();
            for (const et of enemyTilesLeft) {
              if (visitedSim.has(et.key)) continue;
              const comp: string[] = [et.key];
              const q2: string[] = [et.key];
              visitedSim.add(et.key);
              while (q2.length > 0) {
                const curr2 = q2.shift()!;
                const [cq2, cr2] = curr2.split(',').map(Number);
                for (const { dir: [dq2, dr2] } of HEX_EDGES) {
                  const nk2 = tileKey(cq2 + dq2, cr2 + dr2);
                  if (visitedSim.has(nk2)) continue;
                  const nt2 = simMap.get(nk2);
                  if (nt2 && nt2.owner === enemyOwner) { visitedSim.add(nk2); q2.push(nk2); comp.push(nk2); }
                }
              }
              if (comp.length === 1) return mk;
            }
          }
          return null;
        };
        const singleTileKill = getSingleTileKillMove();

        // Moves targeting enemy buildings (tower/castle) that this unit's strength can beat
        // strength 2 → beats tower (str 1); strength 3 → beats castle (str 2)
        const beatableEnemyBuildingMoves = attackMovesAll.filter(k => {
          const enemyZoC = getMaxEnemyZoC(k, aiOwner, workingEntities, workingTileMap);
          if (unitStrength <= enemyZoC) return false;
          const e = workingEntities.get(k);
          return !!e && !ENTITY_META[e].isUnit && ENTITY_META[e].strength > 0;
        });

        // Hard: city defense — identify threatened cities and if THIS unit is nearest to guard it
        let hardDefendTarget: string | null = null;
        if (movDifficulty === 'hard') {
          const aiCitiesAll = Array.from(workingTileMap.values()).filter(t =>
            t.owner === aiOwner && (t.isCity || workingEntities.get(t.key) === 'city')
          );
          const [uq, ur] = unitKey.split(',').map(Number);
          for (const city of aiCitiesAll) {
            // Check if any enemy unit is within 4 tiles of this city
            const cityThreatened = Array.from(workingEntities.entries()).some(([ek, ee]) => {
              if (!ENTITY_META[ee].isUnit) return false;
              const et = workingTileMap.get(ek);
              if (!et || et.owner === aiOwner) return false;
              const [eq, er] = ek.split(',').map(Number);
              return hexDistance(city.q, city.r, eq, er) <= 4;
            });
            if (!cityThreatened) continue;
            // Only redirect this unit if it is the nearest AI unit to the city
            const unitDistToCity = hexDistance(uq, ur, city.q, city.r);
            const isNearestFriendly = !Array.from(workingEntities.entries()).some(([ek, ee]) => {
              if (ek === unitKey || !ENTITY_META[ee].isUnit) return false;
              const et = workingTileMap.get(ek);
              if (!et || et.owner !== aiOwner) return false;
              const [eq, er] = ek.split(',').map(Number);
              return hexDistance(eq, er, city.q, city.r) < unitDistToCity;
            });
            if (isNearestFriendly) {
              // Use BFS pathfinding to find best immediate step toward the city
              hardDefendTarget = hardBfsFirstStep(city.key);
              break;
            }
          }
        }

        let moveTargets: string[];

        if (hardDefendTarget) {
          moveTargets = [hardDefendTarget];
        } else if (singleTileKill !== null) {
          // Highest priority: capture that reduces an enemy territory to 1 tile → auto-dissolve
          moveTargets = [singleTileKill];
        } else if (beatableEnemyBuildingMoves.length > 0 && unitStrength >= 2) {
          // Strong units (str≥2) aggressively target enemy defensive structures they can beat:
          // advanced_unit (str2) → towers (str1); expert_unit (str3) → castles (str2)
          // Weaker units then mop up the now-undefended land on subsequent moves
          moveTargets = beatableEnemyBuildingMoves;
        } else {
          // Unified movement: strength-matched targeting + territory merging
          const [uq, ur] = unitKey.split(',').map(Number);

          // Strength-matched attacks: unit must exceed enemy ZoC to capture
          // Prefer targets where the fight is challenging but winnable (ZoC = unitStrength - 1)
          const validAttacks = attackMovesAll.filter(k => {
            const enemyZoC = getMaxEnemyZoC(k, aiOwner, workingEntities, workingTileMap);
            return unitStrength > enemyZoC;
          });
          const idealAttacks = validAttacks.filter(k => {
            const enemyZoC = getMaxEnemyZoC(k, aiOwner, workingEntities, workingTileMap);
            return enemyZoC === unitStrength - 1;
          });
          const preferredAttacks = idealAttacks.length > 0 ? idealAttacks : validAttacks;

          // Territory merge: find tiles outside this territory that bridge to another AI territory
          const unitTerritoryTiles = new Set(unitTerritoryForState.map(t => t.key));
          const mergeBridgeDest: string[] = [];
          for (const t of unitTerritoryForState) {
            const [tq, tr] = t.key.split(',').map(Number);
            for (const { dir: [dq, dr] } of HEX_EDGES) {
              const mk = tileKey(tq + dq, tr + dr);
              const mt = workingTileMap.get(mk);
              if (!mt || mt.owner === aiOwner || mt.terrain === 'mountain' || mt.terrain === 'lake') continue;
              const [mq, mr] = mk.split(',').map(Number);
              const bridgesToOther = HEX_EDGES.some(({ dir: [dq2, dr2] }) => {
                const nk2 = tileKey(mq + dq2, mr + dr2);
                const nt2 = workingTileMap.get(nk2);
                return nt2 && nt2.owner === aiOwner && !unitTerritoryTiles.has(nk2);
              });
              if (bridgesToOther && !mergeBridgeDest.includes(mk)) mergeBridgeDest.push(mk);
            }
          }

          // Small or isolated territory: prioritize merging before attacking
          const isTinyTerritory = unitTerritoryForState.length <= 3;
          if (isTinyTerritory && mergeBridgeDest.length > 0) {
            // Directly capture bridge tiles if possible; otherwise move toward them
            const capturable = mergeBridgeDest.filter(mk => {
              const enemyZoC = getMaxEnemyZoC(mk, aiOwner, workingEntities, workingTileMap);
              return unitStrength > enemyZoC;
            });
            moveTargets = capturable.length > 0 ? capturable : mergeBridgeDest;
          } else if (movAiState === 'attacking') {
            if (preferredAttacks.length > 0) {
              moveTargets = preferredAttacks;
            } else {
              // No immediate capture: advance toward nearest enemy territory
              const enemyTiles = Array.from(workingTileMap.values()).filter(t =>
                t.owner !== aiOwner && t.owner !== 'neutral' && t.terrain !== 'mountain' && t.terrain !== 'lake'
              );
              if (enemyTiles.length > 0) {
                let nearest = enemyTiles[0];
                let nearestD = hexDistance(uq, ur, nearest.q, nearest.r);
                for (const t of enemyTiles) {
                  const d = hexDistance(uq, ur, t.q, t.r);
                  if (d < nearestD) { nearestD = d; nearest = t; }
                }
                if (movDifficulty === 'hard') {
                  const bfsStep = hardBfsFirstStep(nearest.key);
                  moveTargets = bfsStep ? [bfsStep] : movesPool;
                } else {
                  let bestDist = Infinity;
                  let bestMoves: string[] = [];
                  for (const mk of movesPool) {
                    const [mq, mr] = mk.split(',').map(Number);
                    let minD = Infinity;
                    for (const t of enemyTiles) {
                      const d = hexDistance(mq, mr, t.q, t.r);
                      if (d < minD) minD = d;
                    }
                    if (minD < bestDist) { bestDist = minD; bestMoves = [mk]; }
                    else if (minD === bestDist) bestMoves.push(mk);
                  }
                  moveTargets = bestMoves.length > 0 ? bestMoves : movesPool;
                }
              } else {
                moveTargets = movesPool;
              }
            }
          } else {
            // Defending: retreat to city if threatened; otherwise take safe attacks or expand
            const aiCities = Array.from(workingTileMap.values()).filter(t =>
              t.owner === aiOwner && (t.isCity || workingEntities.get(t.key) === 'city')
            );
            const cityThreatened = aiCities.some(city => {
              const [cq, cr] = city.key.split(',').map(Number);
              return Array.from(workingEntities.entries()).some(([ek, ee]) => {
                if (!ENTITY_META[ee].isUnit) return false;
                const et = workingTileMap.get(ek);
                if (!et || et.owner === aiOwner) return false;
                const [eq, er] = ek.split(',').map(Number);
                return hexDistance(cq, cr, eq, er) <= 3;
              });
            });
            if (cityThreatened && aiCities.length > 0) {
              let nearest = aiCities[0];
              let nearestD = hexDistance(uq, ur, nearest.q, nearest.r);
              for (const city of aiCities) {
                const d = hexDistance(uq, ur, city.q, city.r);
                if (d < nearestD) { nearestD = d; nearest = city; }
              }
              moveTargets = [nearest.key];
            } else if (preferredAttacks.length > 0) {
              moveTargets = preferredAttacks;
            } else {
              // Move toward nearest non-AI tile (neutral or enemy) to expand
              const nonAiTiles = Array.from(workingTileMap.values()).filter(t =>
                t.owner !== aiOwner && t.terrain !== 'mountain' && t.terrain !== 'lake'
              );
              if (nonAiTiles.length > 0) {
                let nearest = nonAiTiles[0];
                let nearestD = hexDistance(uq, ur, nearest.q, nearest.r);
                for (const t of nonAiTiles) {
                  const d = hexDistance(uq, ur, t.q, t.r);
                  if (d < nearestD) { nearestD = d; nearest = t; }
                }
                moveTargets = [nearest.key];
              } else {
                moveTargets = movesPool;
              }
            }
          }
        }

        // Split-detection overrides other move targets if splitting the enemy's territory is possible
        if (!hardDefendTarget) {
          const splitCandidates = movesPool.map(k => ({ k, s: getSplitScore(k) }));
          const maxSplit = Math.max(...splitCandidates.map(x => x.s));
          if (maxSplit > 0) {
            moveTargets = splitCandidates.filter(x => x.s === maxSplit).map(x => x.k);
          }
        }

        // Resolve distant destination tiles to immediate moves:
        // Hard: BFS pathfinding (accurate first step); Non-hard: greedy one-step (closest movesPool tile)
        if (movDifficulty === 'hard') {
          const hardTargets = moveTargets
            .map(k => (movesPool.includes(k) ? k : hardBfsFirstStep(k)))
            .filter((k): k is string => k !== null);
          // Fallback: if all BFS mappings returned null, use movesPool to prevent illegal moves
          moveTargets = hardTargets.length > 0 ? hardTargets : movesPool;
        } else {
          // For Easy/Medium: if any target is a distant destination (not in movesPool), resolve to best immediate step
          const hasDistantTarget = moveTargets.some(k => !movesPool.includes(k));
          if (hasDistantTarget) {
            let bestDist = Infinity;
            let bestMoves: string[] = [];
            for (const mk of movesPool) {
              const [mq, mr] = mk.split(',').map(Number);
              let minD = Infinity;
              for (const dest of moveTargets) {
                const [dq, dr] = dest.split(',').map(Number);
                const d = hexDistance(mq, mr, dq, dr);
                if (d < minD) minD = d;
              }
              if (minD < bestDist) { bestDist = minD; bestMoves = [mk]; }
              else if (minD === bestDist) bestMoves.push(mk);
            }
            if (bestMoves.length > 0) moveTargets = bestMoves;
          }
        }

        const srcTile = workingTileMap.get(unitKey);
        const movingFromLake = srcTile?.terrain === 'lake';

        const filteredMoveTargets = moveTargets.filter(k => {
          const t = workingTileMap.get(k);
          if (!t || t.terrain !== 'lake') return true;
          const srcTerritory = getContiguousTerritory(workingTileMap, unitKey, aiOwner);
          const srcId = getTerritoryId(srcTerritory);
          if (!srcId) return false;
          return (workingBalances.get(srcId) ?? 0) >= 4;
        });
        if (filteredMoveTargets.length === 0) continue;

        // Final validation: destKey must be a legal move; skip if not in allValidMoves
        const legalMoveTargets = filteredMoveTargets.filter(k => allValidMoves.includes(k));
        if (legalMoveTargets.length === 0) continue;
        const destKey = legalMoveTargets[Math.floor(Math.random() * legalMoveTargets.length)];
        const destTile = workingTileMap.get(destKey);
        if (!destTile) continue;
        const movingToLake = destTile.terrain === 'lake';

        const previousOwner = destTile.owner as TerritoryOwner;
        const prevTileMapSnapshot = new Map(workingTileMap);
        workingTileMap = new Map(workingTileMap);
        workingTileMap.set(destKey, { ...destTile, owner: aiOwner });
        workingEntities = new Map(workingEntities);
        const destExisting = workingEntities.get(destKey);
        const isAllyMerge = destExisting && ENTITY_META[destExisting].isUnit && destTile.owner === aiOwner
          && ENTITY_META[unitEntity].strength + ENTITY_META[destExisting].strength <= 3;
        if (isAllyMerge) {
          const merged = mergedUnitType(ENTITY_META[unitEntity].strength, ENTITY_META[destExisting].strength);
          workingEntities.delete(unitKey);
          workingEntities.set(destKey, merged);
        } else {
          workingEntities.delete(destKey);
          workingEntities.delete(unitKey);
          workingEntities.set(destKey, unitEntity);
        }

        workingLakeFunds = new Map(workingLakeFunds);
        if (movingToLake && !movingFromLake) {
          const srcTerritory = getContiguousTerritory(prevTileMapSnapshot, unitKey, aiOwner);
          const srcId = getTerritoryId(srcTerritory);
          if (srcId) {
            const lakeAmount = Math.min(workingBalances.get(srcId) ?? 0, 15);
            workingBalances = new Map(workingBalances);
            workingBalances.set(srcId, (workingBalances.get(srcId) ?? 0) - lakeAmount);
            workingLakeFunds.set(destKey, lakeAmount);
          }
        } else if (movingFromLake && movingToLake) {
          const fund = workingLakeFunds.get(unitKey) ?? 0;
          workingLakeFunds.delete(unitKey);
          workingLakeFunds.set(destKey, fund);
          workingTileMap.set(unitKey, { ...srcTile!, owner: 'neutral' });
          workingLiveOwnerMap = new Map(workingLiveOwnerMap);
          workingLiveOwnerMap.delete(unitKey);
        } else if (movingFromLake && !movingToLake) {
          const fund = workingLakeFunds.get(unitKey) ?? 0;
          workingLakeFunds.delete(unitKey);
          workingTileMap.set(unitKey, { ...srcTile!, owner: 'neutral' });
          workingLiveOwnerMap = new Map(workingLiveOwnerMap);
          workingLiveOwnerMap.delete(unitKey);
          workingBalances = recalculateTerritoriesForCapture(destKey, aiOwner, previousOwner, prevTileMapSnapshot, workingTileMap, workingBalances);
          if (fund > 0) {
            const newTerritory = getContiguousTerritory(workingTileMap, destKey, aiOwner);
            const newId = getTerritoryId(newTerritory);
            if (newId) {
              workingBalances = new Map(workingBalances);
              workingBalances.set(newId, (workingBalances.get(newId) ?? 0) + fund);
            }
          }
        } else {
          workingBalances = recalculateTerritoriesForCapture(
            destKey,
            aiOwner,
            previousOwner,
            prevTileMapSnapshot,
            workingTileMap,
            workingBalances,
          );
        }

        workingLiveOwnerMap = new Map(workingLiveOwnerMap);
        workingLiveOwnerMap.set(destKey, aiOwner);
        workingGraveyard = new Set(workingGraveyard);
        workingGraveyard.delete(destKey);
        applySingleHexPenalty(prevTileMapSnapshot, workingTileMap, workingBalances, workingEntities, workingGraveyard, workingRuins);
        setRuins(new Set(workingRuins));

        if (!isDeveloperModeRef.current) {
          await new Promise<void>(resolve => {
            triggerUnitAnimation(unitKey, destKey, unitEntity, aiOwner as TerritoryOwner, true, () => {
              setMutableTileMap(new Map(workingTileMap));
              setLiveOwnerMap(new Map(workingLiveOwnerMap));
              setEntities(new Map(workingEntities));
              setTerritoryBalances(new Map(workingBalances));
              setGraveyard(new Set(workingGraveyard));
              resolve();
            });
          });
        } else {
          setMutableTileMap(new Map(workingTileMap));
          setLiveOwnerMap(new Map(workingLiveOwnerMap));
          setEntities(new Map(workingEntities));
          setTerritoryBalances(new Map(workingBalances));
          setGraveyard(new Set(workingGraveyard));
        }

        // Recompute and publish AI state at each awaitStep boundary so Dev label stays live
        const movedUnitTerritory = getContiguousTerritory(workingTileMap, destKey, aiOwner);
        const movedTerritoryId = getTerritoryId(movedUnitTerritory);
        if (movedTerritoryId) {
          const mEnemyNear = movedUnitTerritory.some(t => {
            const [tq, tr] = t.key.split(',').map(Number);
            return HEX_EDGES.some(({ dir: [dq, dr] }) => {
              const nk = tileKey(tq + dq, tr + dr);
              const nb = workingTileMap.get(nk);
              return nb && nb.owner !== aiOwner && nb.owner !== 'neutral';
            });
          });
          const updatedState: AiState = mEnemyNear ? 'attacking' : 'defending';
          aiStateMapRef.current = new Map(aiStateMapRef.current);
          aiStateMapRef.current.set(movedTerritoryId, updatedState);
          setAiStateMap(new Map(aiStateMapRef.current));
        }

        await awaitStep({
          entities: new Map(workingEntities),
          mutableTileMap: new Map(workingTileMap),
          territoryBalances: new Map(workingBalances),
          liveOwnerMap: new Map(workingLiveOwnerMap),
          graveyard: new Set(workingGraveyard),
          freeTowerUsedTiles: new Map([...workingFreeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)])),
        });
        if (!aiTurnRef.current) return;
      }
    }

    setLakeUnitFunds(new Map(workingLakeFunds));
    setIsAiTurn(false);
    aiTurnRef.current = false;
    checkWinLoss(workingTileMap);
  }, [aiOwners, checkWinLoss, awaitStep, triggerUnitAnimation]);

  const selectedTerritory = useMemo<HexTile[]>(() => {
    if (!selectedTileKey) return [];
    const tile = activeTileMap.get(selectedTileKey);
    if (!tile || tile.owner !== 'player') return [];
    return getContiguousTerritory(activeTileMap, selectedTileKey, 'player');
  }, [selectedTileKey, activeTileMap]);

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

  const validMoveTiles = useMemo<Set<string>>(() => {
    if (!selectedEntityKey) return new Set();
    const tile = activeTileMap.get(selectedEntityKey);
    if (!tile || tile.owner !== 'player') return new Set();
    const entityId = entities.get(selectedEntityKey);
    if (!entityId || !ENTITY_META[entityId].isUnit) return new Set();
    const movingStrength = ENTITY_META[entityId].strength;
    const remaining = partialMoves.get(selectedEntityKey) ?? 3;
    const raw = getValidMoves(selectedEntityKey, 'player', entities, activeTileMap, spentUnits, remaining);
    // Remove ally unit tiles where merge is invalid: combined strength > 3, or dest is combat-spent
    for (const k of raw) {
      const destTile = activeTileMap.get(k);
      if (destTile?.owner !== 'player') continue;
      const destEntity = entities.get(k);
      if (!destEntity || !ENTITY_META[destEntity].isUnit) continue;
      if (movingStrength + ENTITY_META[destEntity].strength > 3) raw.delete(k);
      else if (combatSpentUnits.has(k)) raw.delete(k);
    }
    return raw;
  }, [selectedEntityKey, entities, activeTileMap, spentUnits, partialMoves, combatSpentUnits]);

  const fortificationDots = useMemo<Set<string>>(() => {
    let territory: HexTile[];
    if (selectedEntityKey) {
      const selEntity = entities.get(selectedEntityKey);
      if (!selEntity || ENTITY_META[selEntity].isUnit || selEntity === 'city') return new Set();
      territory = getContiguousTerritory(activeTileMap, selectedEntityKey, 'player');
    } else if (armedEntityId && !ENTITY_META[armedEntityId].isUnit && armedEntityId !== 'city') {
      territory = selectedTerritory;
    } else {
      return new Set();
    }
    const territoryKeys = new Set(territory.map(t => t.key));
    const dots = new Set<string>();
    for (const t of territory) {
      const e = entities.get(t.key);
      if (!e || ENTITY_META[e].isUnit || e === 'city' || e === 'rebel') continue;
      dots.add(t.key);
      const [q, r] = t.key.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (territoryKeys.has(nk)) dots.add(nk);
      }
    }
    return dots;
  }, [selectedEntityKey, armedEntityId, selectedTerritory, entities, activeTileMap]);

  const validPlacementAttackTiles = useMemo<Set<string>>(() => {
    if (!armedEntityId) return new Set();
    const meta = ENTITY_META[armedEntityId];
    if (!meta.isUnit) return new Set();
    const result = new Set<string>();
    for (const tile of selectedTerritory) {
      if (tile.terrain === 'mountain' || tile.terrain === 'lake') continue;
      const [q, r] = tile.key.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (selectedTileKeys.has(nk)) continue;
        const neighbor = activeTileMap.get(nk);
        if (!neighbor) continue;
        if (neighbor.terrain === 'mountain' || neighbor.terrain === 'lake') continue;
        const existingEntity = entities.get(nk);
        if (existingEntity && existingEntity !== 'rebel') {
          // buildings with higher strength can't be captured
          if (!ENTITY_META[existingEntity].isUnit && meta.strength < ENTITY_META[existingEntity].strength) continue;
        }
        const enemyZoC = getMaxEnemyZoC(nk, 'player', entities, activeTileMap);
        if (meta.strength > enemyZoC) result.add(nk);
      }
    }
    return result;
  }, [armedEntityId, selectedTerritory, selectedTileKeys, activeTileMap, entities]);

  const minUnitCost = useMemo(() => {
    return Math.min(...(Object.values(ENTITY_META).filter(m => m.isUnit).map(m => m.cost)));
  }, []);

  const [, startPulseTransition] = useTransition();
  const [shouldPulseEndTurn, setShouldPulseEndTurn] = useState(false);
  const prevPulseInputs = useRef<{
    entities: Map<string, EntityType>;
    activeTileMap: Map<string, HexTile>;
    spentUnits: Set<string>;
    territoryBalances: Map<string, number>;
    freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
    isAiTurn: boolean;
    turn: number;
  } | null>(null);

  useEffect(() => {
    const prev = prevPulseInputs.current;
    if (
      prev &&
      prev.entities === entities &&
      prev.activeTileMap === activeTileMap &&
      prev.spentUnits === spentUnits &&
      prev.territoryBalances === territoryBalances &&
      prev.freeTowerUsedTiles === freeTowerUsedTiles &&
      prev.isAiTurn === isAiTurn &&
      prev.turn === turn
    ) return;
    prevPulseInputs.current = { entities, activeTileMap, spentUnits, territoryBalances, freeTowerUsedTiles, isAiTurn, turn };
    startPulseTransition(() => {
      if (isAiTurn) { setShouldPulseEndTurn(false); return; }
      const hasValidMove = Array.from(entities.entries()).some(([key, entityId]) => {
        const meta = ENTITY_META[entityId];
        if (!meta.isUnit) return false;
        const tile = activeTileMap.get(key);
        if (tile?.owner !== 'player') return false;
        if (spentUnits.has(key)) return false;
        const moves = getValidMoves(key, 'player', entities, activeTileMap, spentUnits);
        return moves.size > 0;
      });
      if (hasValidMove) { setShouldPulseEndTurn(false); return; }
      const playerFreeTowerUsed = freeTowerUsedTiles.get('player') ?? new Set<string>();
      const visited = new Set<string>();
      for (const tile of Array.from(activeTileMap.values())) {
        if (tile.owner !== 'player' || visited.has(tile.key)) continue;
        const territory = getContiguousTerritory(activeTileMap, tile.key, 'player');
        for (const t of territory) visited.add(t.key);
        const id = getTerritoryId(territory);
        if (!id) continue;
        const balance = territoryBalances.get(id) ?? 0;
        const towerFree = territory.length >= 2 && !territory.some(t => playerFreeTowerUsed.has(t.key));
        const canAfford = turn === 1 ? towerFree : balance >= minUnitCost;
        if (canAfford) { setShouldPulseEndTurn(false); return; }
      }
      setShouldPulseEndTurn(true);
    });
  }, [entities, activeTileMap, spentUnits, territoryBalances, minUnitCost, isAiTurn, freeTowerUsedTiles, turn]);

  useEffect(() => {
    const shouldPulse = shouldPulseEndTurn && !armedEntityId && !ribbonOpen;
    if (shouldPulse) {
      pulseVal.value = withRepeat(
        withSequence(
          withTiming(0.25, { duration: 600 }),
          withTiming(1.0, { duration: 600 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseVal);
      pulseVal.value = withTiming(1.0, { duration: 200 });
    }
    return () => { cancelAnimation(pulseVal); };
  }, [shouldPulseEndTurn, armedEntityId, ribbonOpen]);

  const canBuild = selectedTerritory.length > 0;

  const territoryHasCity = useMemo(
    () => selectedTerritory.some(t => t.isCity || entities.get(t.key) === 'city'),
    [selectedTerritory, entities],
  );

  const econBreakdown = useMemo(() => {
    if (selectedTerritory.length === 0) return null;
    let grassCount = 0;
    let forestCount = 0;
    let desertCount = 0;
    let mountainCount = 0;
    let lakeCount = 0;
    let cityCount = 0;
    const upkeepGroupMap = new Map<EntityType, number>();
    let activeGrassCount = 0;
    let activeCityCount = 0;
    for (const t of selectedTerritory) {
      if (t.terrain === 'grass') grassCount++;
      else if (t.terrain === 'forest') forestCount++;
      else if (t.terrain === 'desert') desertCount++;
      else if (t.terrain === 'mountain') mountainCount++;
      else if (t.terrain === 'lake') lakeCount++;
      const entityId = entities.get(t.key);
      const hasRebel = entityId === 'rebel';
      if (t.isCity || entityId === 'city') cityCount++;
      if (!hasRebel) {
        if (t.terrain === 'grass') activeGrassCount++;
        if (t.isCity || entityId === 'city') activeCityCount++;
      }
      if (entityId && entityId !== 'city' && entityId !== 'rebel') {
        const meta = ENTITY_META[entityId];
        if (meta.upkeep > 0) {
          upkeepGroupMap.set(entityId, (upkeepGroupMap.get(entityId) ?? 0) + 1);
        }
      }
    }
    const UPKEEP_ORDER: EntityType[] = ['simple_unit', 'advanced_unit', 'expert_unit', 'tower', 'castle'];
    const upkeepGroups = UPKEEP_ORDER
      .filter(type => upkeepGroupMap.has(type))
      .map(type => {
        const count = upkeepGroupMap.get(type)!;
        const meta = ENTITY_META[type];
        return { icon: meta.icon, name: meta.name, count, upkeepPerUnit: meta.upkeep, total: meta.upkeep * count };
      });
    const grassIncome = grassCount * 2;
    const forestIncome = forestCount * 2;
    const desertIncome = desertCount * 1;
    const cityIncome = cityCount * CITY_BONUS;
    const totalIncome = grassIncome + forestIncome + desertIncome + cityIncome;
    const totalUpkeep = upkeepGroups.reduce((s, g) => s + g.total, 0);
    let rebelCount = 0;
    let rebelTotalLoss = 0;
    for (const t of selectedTerritory) {
      if (entities.get(t.key) !== 'rebel') continue;
      rebelCount++;
      if (t.isCity || entities.get(t.key) === 'city') rebelTotalLoss += CITY_BONUS;
      else rebelTotalLoss += TERRAIN_INCOME[t.terrain];
    }
    const net = totalIncome - totalUpkeep - rebelTotalLoss;
    return { grassCount, forestCount, desertCount, cityCount, grassIncome, forestIncome, desertIncome, cityIncome, upkeepGroups, totalIncome, totalUpkeep, rebelCount, rebelTotalLoss, net };
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

  const affordableTerritoryCache = useRef<{
    activeTileMap: Map<string, HexTile>;
    territoryBalances: Map<string, number>;
    freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
    isAiTurn: boolean;
    gameResult: unknown;
    turn: number;
    result: Set<string>;
  } | null>(null);

  const affordableTerritoryTileKeys = useMemo<Set<string>>(() => {
    if (isAiTurn || gameResult !== null) return new Set();
    const cached = affordableTerritoryCache.current;
    if (
      cached &&
      cached.activeTileMap === activeTileMap &&
      cached.territoryBalances === territoryBalances &&
      cached.freeTowerUsedTiles === freeTowerUsedTiles &&
      cached.isAiTurn === isAiTurn &&
      cached.gameResult === gameResult &&
      cached.turn === turn
    ) return cached.result;
    const keys = new Set<string>();
    const visited = new Set<string>();
    const playerFreeTowerUsed = freeTowerUsedTiles.get('player') ?? new Set<string>();
    for (const tile of Array.from(activeTileMap.values())) {
      if (tile.owner !== 'player' || visited.has(tile.key)) continue;
      const territory = getContiguousTerritory(activeTileMap, tile.key, 'player');
      for (const t of territory) visited.add(t.key);
      const id = getTerritoryId(territory);
      if (!id) continue;
      const balance = territoryBalances.get(id) ?? 0;
      const towerFree = territory.length >= 2 && !territory.some(t => playerFreeTowerUsed.has(t.key));
      // In round 1, only the free tower can be placed — balance spending is locked
      const canAfford = turn === 1 ? towerFree : balance >= minUnitCost;
      if (!canAfford) continue;
      for (const t of territory) keys.add(t.key);
    }
    affordableTerritoryCache.current = { activeTileMap, territoryBalances, freeTowerUsedTiles, isAiTurn, gameResult, turn, result: keys };
    return keys;
  }, [activeTileMap, territoryBalances, minUnitCost, freeTowerUsedTiles, isAiTurn, gameResult, turn]);

  const hasAffordableTerritories = affordableTerritoryTileKeys.size > 0;
  useEffect(() => {
    if (hasAffordableTerritories && !armedEntityId && !isAiTurn && gameResult === null) {
      territoryPulseVal.value = withRepeat(
        withTiming(0.28, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(territoryPulseVal);
      territoryPulseVal.value = withTiming(0, { duration: 300 });
    }
    return () => { cancelAnimation(territoryPulseVal); };
  }, [hasAffordableTerritories, armedEntityId, isAiTurn, gameResult]);

  const devEconomicOverlays = useMemo<Array<{ cx: number; cy: number; label: string; aiLabel?: string }>>(() => {
    if (!isDeveloperModeActive) return [];
    const result: Array<{ cx: number; cy: number; label: string; aiLabel?: string }> = [];
    const visited = new Set<string>();
    const diffLabel = aiDifficulty === 'hard' ? 'Hrd' : aiDifficulty === 'medium' ? 'Med' : 'Esy';
    for (const aiOwner of aiOwners) {
      for (const tile of Array.from(activeTileMap.values())) {
        if (tile.owner !== aiOwner || visited.has(tile.key)) continue;
        const territory = getContiguousTerritory(activeTileMap, tile.key, aiOwner);
        for (const t of territory) visited.add(t.key);
        const territoryId = getTerritoryId(territory);
        if (!territoryId) continue;
        const balance = territoryBalances.get(territoryId) ?? 0;
        const income = territory.reduce((s, t) => {
          if (entities.get(t.key) === 'rebel') return s;
          return s + TERRAIN_INCOME[t.terrain] + (t.isCity ? CITY_BONUS : 0) + (entities.get(t.key) === 'city' ? CITY_BONUS : 0);
        }, 0);
        const upkeep = territory.reduce((s, t) => {
          const e = entities.get(t.key);
          return s + (e ? ENTITY_META[e].upkeep : 0);
        }, 0);
        const net = income - upkeep;
        const label = net >= 0 ? `${balance}(+${net})` : `${balance}(${net})`;
        const stateVal = aiStateMap.get(territoryId);
        const stateLabel = stateVal === 'attacking' ? 'Atk' : 'Def';
        const aiLabel = `${diffLabel}·${stateLabel}`;
        const central = findCentralTile(territory);
        if (!central) continue;
        const pos = tileDataMap.get(central.key);
        if (!pos) continue;
        result.push({ cx: pos.cx, cy: pos.cy, label, aiLabel });
      }
    }
    for (const [lakeKey, fund] of lakeUnitFunds) {
      const pos = tileDataMap.get(lakeKey);
      const entity = entities.get(lakeKey);
      if (!pos || !entity || !ENTITY_META[entity].isUnit) continue;
      const upkeep = ENTITY_META[entity].upkeep;
      const label = `⚓${fund} (-${upkeep}/t)`;
      result.push({ cx: pos.cx, cy: pos.cy, label });
    }
    return result;
  }, [isDeveloperModeActive, aiOwners, activeTileMap, territoryBalances, entities, tileDataMap, lakeUnitFunds, aiDifficulty, aiStateMap]);

  const pushHistory = useCallback(() => {
    setMoveHistory(prev => [
      ...prev,
      {
        entities: new Map(entities),
        mutableTileMap: new Map(mutableTileMap),
        territoryBalances: new Map(territoryBalances),
        spentUnits: new Set(spentUnits),
        combatSpentUnits: new Set(combatSpentUnits),
        liveOwnerMap: new Map(liveOwnerMap),
        partialMoves: new Map(partialMoves),
        freeTowerUsedTiles: new Map([...freeTowerUsedTiles.entries()].map(([k, v]) => [k, new Set(v)])),
        lakeUnitFunds: new Map(lakeUnitFunds),
        selectedTileKey,
      },
    ]);
  }, [entities, mutableTileMap, territoryBalances, spentUnits, combatSpentUnits, liveOwnerMap, partialMoves, freeTowerUsedTiles, lakeUnitFunds, selectedTileKey]);

  const handleDeselect = useCallback(() => {
    if (Date.now() - lastTileTapMs.current < 150) return;
    setSelectedTileKey(null);
    setArmedEntityId(null);
    setSelectedEntityKey(null);
    if (ribbonOpen) closeRibbon();
  }, [ribbonOpen]);

  const commitPendingLakeMove = useCallback((transferAmount: number) => {
    if (!pendingLakeMove) return;
    const { fromKey, toKey, sourceTerrId, maxAmount, minAmount } = pendingLakeMove;
    const amount = Math.min(maxAmount, Math.max(minAmount, transferAmount));
    setPendingLakeMove(null);

    pushHistory();
    const destTile = activeTileMap.get(toKey);
    const previousOwner = destTile?.owner ?? 'neutral';
    const newTileMap = new Map(activeTileMap);
    if (destTile) newTileMap.set(toKey, { ...destTile, owner: 'player' });

    const newEntities = new Map(entities);
    const movingUnit = newEntities.get(fromKey)!;
    newEntities.delete(fromKey);
    newEntities.set(toKey, movingUnit);

    const newSpentUnits = new Set(spentUnits);
    const newPartialMoves = new Map(partialMoves);
    newPartialMoves.delete(fromKey);
    newSpentUnits.add(toKey);
    newPartialMoves.delete(toKey);

    const { balances: newBalances } = recalculateTerritories(
      toKey,
      previousOwner as TerritoryOwner,
      activeTileMap,
      newTileMap,
      territoryBalances,
    );
    newBalances.set(sourceTerrId, (newBalances.get(sourceTerrId) ?? 0) - amount);

    const newLiveOwnerMap = new Map(liveOwnerMap);
    newLiveOwnerMap.set(toKey, 'player');

    const newLakeFunds = new Map(lakeUnitFunds);
    newLakeFunds.set(toKey, amount);

    setMutableTileMap(newTileMap);
    setLiveOwnerMap(newLiveOwnerMap);
    setEntities(newEntities);
    setSpentUnits(newSpentUnits);
    setPartialMoves(newPartialMoves);
    setTerritoryBalances(newBalances);
    setLakeUnitFunds(newLakeFunds);
    setSelectedEntityKey(null);
    setSelectedTileKey(toKey);
    setGraveyard(prev => { const next = new Set(prev); next.delete(toKey); return next; });
    checkWinLoss(newTileMap);
    if (ribbonOpen) closeRibbon();
    if (movingUnit) {
      triggerUnitAnimation(fromKey, toKey, movingUnit);
    }
  }, [pendingLakeMove, activeTileMap, entities, spentUnits, partialMoves, territoryBalances, liveOwnerMap, lakeUnitFunds, pushHistory, ribbonOpen, checkWinLoss, triggerUnitAnimation]);

  const handleTileTap = useCallback((key: string) => {
    const now = Date.now();
    if (now - lastTileTapMs.current < 50) return;
    lastTileTapMs.current = now;
    if (isAiTurn || gameResult !== null) return;
    const tile = activeTileMap.get(key);

    if (selectedEntityKey && validMoveTiles.has(key)) {
      const targetTile = activeTileMap.get(key);
      const movingToLake = targetTile?.terrain === 'lake';
      const fromTile = activeTileMap.get(selectedEntityKey);
      const fromLake = fromTile?.terrain === 'lake';

      if (movingToLake && !fromLake) {
        const sourceTerritory = getContiguousTerritory(activeTileMap, selectedEntityKey, 'player');
        const sourceTerrId = getTerritoryId(sourceTerritory);
        if (!sourceTerrId) return;
        const sourceBalance = territoryBalances.get(sourceTerrId) ?? 0;
        const movingEntityType = entities.get(selectedEntityKey);
        const minAmount = movingEntityType ? ENTITY_META[movingEntityType].upkeep : 2;
        if (sourceBalance < minAmount) {
          triggerErrorFlash(key);
          return;
        }
        const defaultAmount = Math.min(sourceBalance, Math.max(minAmount, Math.ceil(sourceBalance * 0.5)));
        setLakeTransferAmount(defaultAmount);
        setPendingLakeMove({ fromKey: selectedEntityKey, toKey: key, sourceTerrId, maxAmount: sourceBalance, minAmount });
        return;
      }

      const movingEntityId = entities.get(selectedEntityKey);
      const fromKeyForAnim = selectedEntityKey;

      pushHistory();
      const prevTile = activeTileMap.get(key);
      const previousOwner = prevTile?.owner ?? 'neutral';
      const newTileMap = new Map(activeTileMap);
      if (targetTile) {
        newTileMap.set(key, { ...targetTile, owner: 'player' });
      }
      const newEntities = new Map(entities);
      const movingUnit = newEntities.get(selectedEntityKey)!;
      const existingUnit = newEntities.get(key);
      const isMerge =
        !!existingUnit &&
        existingUnit !== 'city' &&
        existingUnit !== 'rebel' &&
        ENTITY_META[existingUnit].isUnit &&
        activeTileMap.get(key)?.owner === 'player' &&
        ENTITY_META[movingUnit].strength + ENTITY_META[existingUnit].strength <= 3 &&
        !combatSpentUnits.has(key);

      if (isMerge) {
        const merged = mergedUnitType(ENTITY_META[movingUnit].strength, ENTITY_META[existingUnit!].strength);
        newEntities.delete(selectedEntityKey);
        newEntities.set(key, merged);
      } else {
        newEntities.delete(key);
        newEntities.delete(selectedEntityKey);
        newEntities.set(key, movingUnit);
      }

      const stepsUsed = getMoveCost(selectedEntityKey, key, activeTileMap);
      const prevRemaining = partialMoves.get(selectedEntityKey) ?? 3;
      const remainingAfterMove = movingToLake ? 0 : Math.max(0, prevRemaining - stepsUsed);

      const newSpentUnits = new Set(spentUnits);
      const newPartialMoves = new Map(partialMoves);
      newPartialMoves.delete(selectedEntityKey);
      if (isMerge) {
        const destRemaining = newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : 3);
        // Merged unit inherits the remaining steps of whichever unit had fewer left (the one that moved more)
        const mergedRemaining = Math.min(remainingAfterMove, destRemaining);
        newSpentUnits.delete(key);
        newPartialMoves.delete(key);
        if (mergedRemaining <= 0) {
          newSpentUnits.add(key);
        } else if (mergedRemaining < 3) {
          newPartialMoves.set(key, mergedRemaining);
        }
      } else {
        newSpentUnits.add(key);
        newPartialMoves.delete(key);
      }

      // A move is "combat" if it defeated an entity or captured a non-neutral tile
      const isCombatMove = !isMerge && (previousOwner !== 'neutral' || existingUnit !== undefined);
      const newCombatSpentUnits = isCombatMove
        ? new Set([...combatSpentUnits, key])
        : combatSpentUnits;

      const { balances: newBalances } = recalculateTerritories(
        key,
        previousOwner as TerritoryOwner,
        activeTileMap,
        newTileMap,
        territoryBalances,
      );

      const newGraveyard = new Set(graveyard);
      const newRuins = new Set(ruins);
      newGraveyard.delete(key);
      applySingleHexPenalty(activeTileMap, newTileMap, newBalances, newEntities, newGraveyard, newRuins);

      const newLiveOwnerMap = new Map(liveOwnerMap);
      newLiveOwnerMap.set(key, 'player');

      const newLakeFunds = new Map(lakeUnitFunds);
      if (fromLake && movingToLake) {
        const fund = newLakeFunds.get(selectedEntityKey) ?? 0;
        newLakeFunds.delete(selectedEntityKey);
        newLakeFunds.set(key, fund);
        if (fromTile) {
          newTileMap.set(selectedEntityKey, { ...fromTile, owner: 'neutral' });
          newLiveOwnerMap.delete(selectedEntityKey);
        }
      } else if (fromLake && !movingToLake) {
        const fund = newLakeFunds.get(selectedEntityKey) ?? 0;
        newLakeFunds.delete(selectedEntityKey);
        const newTerritory = getContiguousTerritory(newTileMap, key, 'player');
        const newTerrId = getTerritoryId(newTerritory);
        if (newTerrId && fund > 0) {
          newBalances.set(newTerrId, (newBalances.get(newTerrId) ?? 0) + fund);
        }
        if (fromTile) {
          newTileMap.set(selectedEntityKey, { ...fromTile, owner: 'neutral' });
          newLiveOwnerMap.delete(selectedEntityKey);
        }
      }

      setMutableTileMap(newTileMap);
      setLiveOwnerMap(newLiveOwnerMap);
      setEntities(newEntities);
      setSpentUnits(newSpentUnits);
      setCombatSpentUnits(newCombatSpentUnits);
      setPartialMoves(newPartialMoves);
      setTerritoryBalances(newBalances);
      setLakeUnitFunds(newLakeFunds);
      setSelectedEntityKey(null);
      setSelectedTileKey(key);
      setGraveyard(newGraveyard);
      setRuins(newRuins);
      checkWinLoss(newTileMap);
      if (ribbonOpen) closeRibbon();
      if (movingEntityId) {
        triggerUnitAnimation(fromKeyForAnim, key, movingEntityId);
      }
      return;
    }

    if (armedEntityId && selectedTileKeys.has(key)) {
      const existingOnTile = entities.get(key);
      const armedIsUnit = ENTITY_META[armedEntityId].isUnit;
      const existingIsAllyUnit =
        !!existingOnTile &&
        existingOnTile !== 'rebel' &&
        existingOnTile !== 'city' &&
        ENTITY_META[existingOnTile].isUnit &&
        activeTileMap.get(key)?.owner === 'player';
      const canMerge = armedIsUnit && existingIsAllyUnit
        && ENTITY_META[armedEntityId].strength + ENTITY_META[existingOnTile!].strength <= 3;
      const canOverwriteRebel = armedIsUnit && existingOnTile === 'rebel';
      const existingIsBuilding = !!existingOnTile && !ENTITY_META[existingOnTile].isUnit && existingOnTile !== 'rebel';
      const existingBuildingIsOwn = existingIsBuilding && activeTileMap.get(key)?.owner === 'player';
      const canOverwriteBuilding = armedIsUnit && existingIsBuilding && !existingBuildingIsOwn
        && ENTITY_META[armedEntityId].strength >= ENTITY_META[existingOnTile as EntityType].strength;
      const alreadyOccupied = !!existingOnTile && !canMerge && !canOverwriteRebel && !canOverwriteBuilding;
      if (!alreadyOccupied && selectedTerritoryId) {
        const meta = ENTITY_META[armedEntityId];
        const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
        const placingTower = armedEntityId === 'tower';
        const playerUsedSet = freeTowerUsedTiles.get('player') ?? new Set<string>();
        const towerIsFree = placingTower
          && turn === 1
          && selectedTerritory.length >= 2
          && !selectedTerritory.some(t => playerUsedSet.has(t.key));
        const blockedByGraveyard = !meta.isUnit && graveyard.has(key);
        const effectiveCost = towerIsFree ? 0 : meta.cost;
        if (balance >= effectiveCost && !blockedByGraveyard) {
          pushHistory();
          const newEntities = new Map(entities);
          const newSpentUnits = new Set(spentUnits);
          const newPartialMoves = new Map(partialMoves);
          if (canMerge) {
            const merged = mergedUnitType(ENTITY_META[armedEntityId].strength, ENTITY_META[existingOnTile!].strength);
            newEntities.set(key, merged);
            const existingRemaining = newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : 3);
            const mergedRemaining = Math.min(3, existingRemaining);
            newSpentUnits.delete(key);
            newPartialMoves.delete(key);
            if (mergedRemaining <= 0) {
              newSpentUnits.add(key);
            } else if (mergedRemaining < 3) {
              newPartialMoves.set(key, mergedRemaining);
            }
          } else {
            newEntities.set(key, armedEntityId);
            if (canOverwriteRebel) {
              newSpentUnits.add(key);
            }
          }
          setEntities(newEntities);
          setTerritoryBalances(prev => { const next = new Map(prev); next.set(selectedTerritoryId, balance - effectiveCost); return next; });
          if (towerIsFree) {
            setFreeTowerUsedTiles(prev => {
              const next = new Map(prev);
              const ownerSet = new Set(prev.get('player') ?? []);
              for (const t of selectedTerritory) ownerSet.add(t.key);
              next.set('player', ownerSet);
              return next;
            });
          }
          setSpentUnits(newSpentUnits);
          setPartialMoves(newPartialMoves);
          setArmedEntityId(null);
          setSelectedEntityKey(null);
          closeRibbon();
          return;
        } else {
          triggerErrorFlash(key);
        }
      } else if (alreadyOccupied) {
        triggerErrorFlash(key);
      }
      return;
    }

    if (armedEntityId && validPlacementAttackTiles.has(key)) {
      if (!selectedTerritoryId) return;
      const meta = ENTITY_META[armedEntityId];
      const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
      if (balance >= meta.cost) {
        pushHistory();
        const previousOwner = (activeTileMap.get(key)?.owner ?? 'neutral') as TerritoryOwner;
        const newTileMap = new Map(activeTileMap);
        const targetTile = newTileMap.get(key);
        if (targetTile) newTileMap.set(key, { ...targetTile, owner: 'player' });
        const newEntities = new Map(entities);
        newEntities.delete(key);
        newEntities.set(key, armedEntityId);
        const newBalances = recalculateTerritoriesForCapture(
          key, 'player', previousOwner, activeTileMap, newTileMap, territoryBalances,
        );
        const mergedTerritory = getContiguousTerritory(newTileMap, key, 'player');
        const mergedId = getTerritoryId(mergedTerritory);
        if (mergedId) newBalances.set(mergedId, (newBalances.get(mergedId) ?? 0) - meta.cost);
        const newGraveyard2 = new Set(graveyard);
        const newRuins2 = new Set(ruins);
        applySingleHexPenalty(activeTileMap, newTileMap, newBalances, newEntities, newGraveyard2, newRuins2);
        const newLiveOwnerMap = new Map(liveOwnerMap);
        newLiveOwnerMap.set(key, 'player');
        // Placing a unit via attack counts as combat — it cannot be merged with this turn
        const newCombatSpent2 = new Set([...combatSpentUnits, key]);
        setMutableTileMap(newTileMap);
        setLiveOwnerMap(newLiveOwnerMap);
        setEntities(newEntities);
        setTerritoryBalances(newBalances);
        setGraveyard(newGraveyard2);
        setRuins(newRuins2);
        setCombatSpentUnits(newCombatSpent2);
        setSpentUnits(prev => { const next = new Set(prev); next.add(key); return next; });
        setArmedEntityId(null);
        setSelectedEntityKey(null);
        closeRibbon();
        setSelectedTileKey(key);
        checkWinLoss(newTileMap);
      } else {
        triggerErrorFlash(key);
      }
      return;
    }

    const entityOnTile = entities.get(key);
    const isSelectableEntity = entityOnTile && entityOnTile !== 'city' && entityOnTile !== 'rebel' && tile?.owner === 'player';
    if (isSelectableEntity) {
      if (selectedEntityKey === key) {
        setSelectedEntityKey(null);
        setSelectedTileKey(key);
      } else {
        setSelectedEntityKey(key);
        setSelectedTileKey(key);
        setArmedEntityId(null);
        if (ribbonOpen) closeRibbon();
      }
      return;
    }

    if (!tile || tile.owner !== 'player') {
      if (armedEntityId || selectedEntityKey) {
        triggerErrorFlash(key);
        return;
      }
      setSelectedTileKey(null);
      return;
    }

    if (selectedTileKeys.has(key) && !selectedEntityKey) {
      setSelectedTileKey(null);
      setArmedEntityId(null);
      if (ribbonOpen) closeRibbon();
      return;
    }

    setSelectedTileKey(key);
    setSelectedEntityKey(null);
    setArmedEntityId(null);
    if (ribbonOpen) closeRibbon();
  }, [activeTileMap, selectedTileKeys, armedEntityId, entities, selectedTerritoryId, territoryBalances, ribbonOpen, selectedEntityKey, validMoveTiles, validPlacementAttackTiles, spentUnits, combatSpentUnits, liveOwnerMap, lakeUnitFunds, isAiTurn, gameResult, graveyard, turn, freeTowerUsedTiles, checkWinLoss, pushHistory, triggerErrorFlash]);

  const handleUndo = useCallback(() => {
    if (isAiTurn || gameResult !== null) return;
    setMoveHistory(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setEntities(snapshot.entities);
      setMutableTileMap(snapshot.mutableTileMap);
      setTerritoryBalances(snapshot.territoryBalances);
      setSpentUnits(snapshot.spentUnits);
      setCombatSpentUnits(snapshot.combatSpentUnits ?? new Set());
      setLiveOwnerMap(snapshot.liveOwnerMap);
      setPartialMoves(snapshot.partialMoves);
      setFreeTowerUsedTiles(snapshot.freeTowerUsedTiles);
      setLakeUnitFunds(snapshot.lakeUnitFunds);
      setSelectedTileKey(snapshot.selectedTileKey);
      setSelectedEntityKey(null);
      setArmedEntityId(null);
      if (ribbonOpen) closeRibbon();
      return prev.slice(0, -1);
    });
  }, [isAiTurn, gameResult, ribbonOpen]);

  const handleEndTurn = useCallback(() => {
    if (isAiTurn || gameResult !== null) return;
    setMoveHistory([]);

    const nextBalances = new Map(territoryBalances);
    let nextEntities = new Map(entities);
    const visited = new Set<string>();
    const nextGraveyard = new Set<string>();
    const nextRuins = new Set<string>();

    // Income and upkeep are suspended in round 1
    if (turn !== 1) {
      for (const tile of Array.from(activeTileMap.values())) {
        if (tile.owner !== 'player' || visited.has(tile.key)) continue;
        const territory = getContiguousTerritory(activeTileMap, tile.key, 'player');
        for (const t of territory) visited.add(t.key);
        const territoryId = getTerritoryId(territory);
        if (!territoryId) continue;
        const income = territory.reduce((s, t) => {
          if (nextEntities.get(t.key) === 'rebel') return s;
          return s + TERRAIN_INCOME[t.terrain] + (t.isCity ? CITY_BONUS : 0) + (nextEntities.get(t.key) === 'city' ? CITY_BONUS : 0);
        }, 0);
        const upkeep = territory.reduce((s, t) => {
          const e = nextEntities.get(t.key);
          return s + (e ? ENTITY_META[e].upkeep : 0);
        }, 0);
        const current = nextBalances.get(territoryId) ?? 0;
        const delta = income - upkeep;
        const newBalance = current + delta;
        if (newBalance < 0) {
          nextBalances.set(territoryId, 0);
          nextEntities = new Map(nextEntities);
          // First pass: kill units, accumulate saved upkeep
          let unitUpkeepSaved = 0;
          for (const t of territory) {
            const e = nextEntities.get(t.key);
            if (e && ENTITY_META[e].isUnit) {
              unitUpkeepSaved += ENTITY_META[e].upkeep;
              nextEntities.delete(t.key);
              nextGraveyard.add(t.key);
            }
          }
          // Second pass: if ongoing delta is STILL negative after units die, demolish buildings
          if (delta + unitUpkeepSaved < 0) {
            for (const t of territory) {
              const e = nextEntities.get(t.key);
              if (e && !ENTITY_META[e].isUnit && e !== 'rebel') {
                nextEntities.delete(t.key);
                nextRuins.add(t.key);
              }
            }
          }
        } else {
          nextBalances.set(territoryId, newBalance);
        }
      }

      for (const aiOwner of aiOwners) {
        const aiVisited = new Set<string>();
        for (const tile of Array.from(activeTileMap.values())) {
          if (tile.owner !== aiOwner || aiVisited.has(tile.key)) continue;
          const territory = getContiguousTerritory(activeTileMap, tile.key, aiOwner);
          for (const t of territory) aiVisited.add(t.key);
          const territoryId = getTerritoryId(territory);
          if (!territoryId) continue;
          if (!nextBalances.has(territoryId)) nextBalances.set(territoryId, 0);
          const income = territory.reduce((s, t) => {
            if (nextEntities.get(t.key) === 'rebel') return s;
            return s + TERRAIN_INCOME[t.terrain] + (t.isCity ? CITY_BONUS : 0) + (nextEntities.get(t.key) === 'city' ? CITY_BONUS : 0);
          }, 0);
          const upkeep = territory.reduce((s, t) => {
            const e = nextEntities.get(t.key);
            return s + (e ? ENTITY_META[e].upkeep : 0);
          }, 0);
          const current = nextBalances.get(territoryId) ?? 0;
          const delta = income - upkeep;
          const newBalance = current + delta;
          if (newBalance < 0) {
            nextBalances.set(territoryId, 0);
            nextEntities = new Map(nextEntities);
            // First pass: kill units, accumulate saved upkeep
            let unitUpkeepSaved = 0;
            for (const t of territory) {
              const e = nextEntities.get(t.key);
              if (e && ENTITY_META[e].isUnit) {
                unitUpkeepSaved += ENTITY_META[e].upkeep;
                nextEntities.delete(t.key);
                nextGraveyard.add(t.key);
              }
            }
            // Second pass: if ongoing delta is STILL negative after units die, demolish buildings
            if (delta + unitUpkeepSaved < 0) {
              for (const t of territory) {
                const e = nextEntities.get(t.key);
                if (e && !ENTITY_META[e].isUnit && e !== 'rebel') {
                  nextEntities.delete(t.key);
                  nextRuins.add(t.key);
                }
              }
            }
          } else {
            nextBalances.set(territoryId, newBalance);
          }
        }
      }
    }

    // Rebel spawning and spreading is suspended in round 1
    if (turn !== 1) {
      for (const gravKey of Array.from(graveyard)) {
        const gravTile = activeTileMap.get(gravKey);
        if (gravTile?.terrain === 'lake') continue;
        if (!nextEntities.has(gravKey) && Math.random() < 0.75) {
          nextEntities = new Map(nextEntities);
          nextEntities.set(gravKey, 'rebel');
        }
      }
      for (const ruinKey of Array.from(ruins)) {
        const ruinTile = activeTileMap.get(ruinKey);
        if (ruinTile?.terrain === 'lake') continue;
        if (!nextEntities.has(ruinKey) && Math.random() < 0.75) {
          nextEntities = new Map(nextEntities);
          nextEntities.set(ruinKey, 'rebel');
        }
      }

      const allOwners: TerritoryOwner[] = ['player', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5'];
      const preSpawnEntities = nextEntities;
      const rebelSpawns = new Map(nextEntities);
      for (const tile of Array.from(activeTileMap.values())) {
        if (!allOwners.includes(tile.owner)) continue;
        if (tile.terrain === 'mountain' || tile.terrain === 'lake') continue;
        if (preSpawnEntities.has(tile.key)) continue;
        const [tq, tr] = tile.key.split(',').map(Number);
        const neighborRebelCount = HEX_EDGES.filter(({ dir: [dq, dr] }) => {
          const nk = tileKey(tq + dq, tr + dr);
          return preSpawnEntities.get(nk) === 'rebel';
        }).length;
        const chance = neighborRebelCount >= 2 ? 0.10 : neighborRebelCount === 1 ? 0.075 : 0.02;
        if (Math.random() < chance) {
          rebelSpawns.set(tile.key, 'rebel');
        }
      }
      nextEntities = rebelSpawns;
    }

    const nextMutableTileMap = new Map(mutableTileMap);
    const nextLiveOwnerMap = new Map(liveOwnerMap);
    const nextLakeFunds = new Map(lakeUnitFunds);
    for (const [lakeKey, fund] of lakeUnitFunds) {
      const entity = nextEntities.get(lakeKey);
      if (!entity || !ENTITY_META[entity].isUnit) {
        nextLakeFunds.delete(lakeKey);
        const t = nextMutableTileMap.get(lakeKey);
        if (t) nextMutableTileMap.set(lakeKey, { ...t, owner: 'neutral' });
        nextLiveOwnerMap.delete(lakeKey);
        continue;
      }
      const upkeep = ENTITY_META[entity].upkeep;
      const newFund = fund - upkeep;
      if (newFund < 0) {
        nextEntities = new Map(nextEntities);
        nextEntities.delete(lakeKey);
        nextGraveyard.add(lakeKey);
        nextLakeFunds.delete(lakeKey);
        const t = nextMutableTileMap.get(lakeKey);
        if (t) nextMutableTileMap.set(lakeKey, { ...t, owner: 'neutral' });
        nextLiveOwnerMap.delete(lakeKey);
      } else {
        nextLakeFunds.set(lakeKey, newFund);
      }
    }

    setTerritoryBalances(nextBalances);
    setEntities(nextEntities);
    setGraveyard(nextGraveyard);
    setRuins(nextRuins);
    setLakeUnitFunds(nextLakeFunds);
    setMutableTileMap(nextMutableTileMap);
    setLiveOwnerMap(nextLiveOwnerMap);
    setTurn(t => t + 1);
    setSelectedTileKey(null);
    setArmedEntityId(null);
    setSelectedEntityKey(null);
    setSpentUnits(new Set());
    setCombatSpentUnits(new Set());
    setPartialMoves(new Map());
    closeRibbon();

    if (!checkWinLoss(nextMutableTileMap)) {
      setIsAiTurn(true);
      aiTurnRef.current = true;
      runAiTurn(nextMutableTileMap, nextEntities, nextBalances, nextLakeFunds, turn, nextGraveyard, nextRuins);
    }
  }, [activeTileMap, entities, territoryBalances, lakeUnitFunds, mutableTileMap, liveOwnerMap, isAiTurn, gameResult, aiOwners, graveyard, ruins, turn, checkWinLoss, runAiTurn]);

  // React Native scales around the element's centre, so the board's screen edges are:
  //   left  = tx + boardW/2 - scaledW/2
  //   right = tx + boardW/2 + scaledW/2
  //   top   = ty + boardH/2 - scaledH/2
  //   bottom= ty + boardH/2 + scaledH/2
  // Solving for tx/ty that keeps each edge inside the viewport gives the ranges below.
  const clampXY = (x: number, y: number, s: number) => {
    'worklet';
    const scaledW = boardW * s;
    const scaledH = boardH * s;
    // centred position keeps board centre aligned with viewport centre (independent of scale)
    const centeredX = (SW - boardW) / 2;
    const centeredY = topInset + (availH - boardH) / 2;
    let clampedX: number;
    let clampedY: number;
    if (scaledW <= SW) {
      clampedX = Math.max(centeredX - EXTRA_PAN, Math.min(centeredX + EXTRA_PAN, x));
    } else {
      clampedX = Math.max(SW - (boardW + scaledW) / 2 - EXTRA_PAN, Math.min((scaledW - boardW) / 2 + EXTRA_PAN, x));
    }
    if (scaledH <= availH) {
      clampedY = Math.max(centeredY - EXTRA_PAN, Math.min(centeredY + EXTRA_PAN, y));
    } else {
      clampedY = Math.max(
        topInset + availH - (boardH + scaledH) / 2 - EXTRA_PAN,
        Math.min(topInset + (scaledH - boardH) / 2 + EXTRA_PAN, y),
      );
    }
    return { x: clampedX, y: clampedY };
  };

  const panGesture = Gesture.Pan()
    .minDistance(10)
    .onUpdate(e => {
      const raw = { x: savedX.value + e.translationX, y: savedY.value + e.translationY };
      const clamped = clampXY(raw.x, raw.y, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate(e => {
      const newScale = Math.max(0.3, Math.min(3, savedScale.value * e.scale));
      scale.value = newScale;
      const clamped = clampXY(translateX.value, translateY.value, newScale);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      const clamped = clampXY(translateX.value, translateY.value, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
      savedX.value = clamped.x;
      savedY.value = clamped.y;
    });

  const handleBoardTap = useCallback((touchX: number, touchY: number, tx: number, ty: number, s: number) => {
    const boardX = boardW / 2 + (touchX - tx - boardW / 2) / s;
    const boardY = boardH / 2 + (touchY - ty - boardH / 2) / s;
    const hx = boardX + bounds.minX;
    const hy = boardY + bounds.minY;
    const fq = (2 / 3) * hx / HEX_SIZE;
    const fr = hy / (HEX_SIZE * Math.sqrt(3)) - fq / 2;
    const fs = -fq - fr;
    let rq = Math.round(fq);
    let rr = Math.round(fr);
    let rs = Math.round(fs);
    const qd = Math.abs(rq - fq), rd = Math.abs(rr - fr), sd = Math.abs(rs - fs);
    if (qd > rd && qd > sd) rq = -rr - rs;
    else if (rd > sd) rr = -rq - rs;
    const key = tileKey(rq, rr);
    if (activeTileMap.has(key)) handleTileTap(key);
    else handleDeselect();
  }, [boardW, boardH, bounds, HEX_SIZE, activeTileMap, handleTileTap, handleDeselect]);

  const tapGesture = Gesture.Tap()
    .maxDistance(5)
    .onEnd(e => {
      runOnJS(handleBoardTap)(e.x, e.y, translateX.value, translateY.value, scale.value);
    });

  const gesture = Gesture.Race(tapGesture, Gesture.Simultaneous(panGesture, pinchGesture));

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

  const territoryPulseStyle = useAnimatedStyle(() => ({
    opacity: territoryPulseVal.value,
  }));

  const ribbonStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ribbonAnim.value }],
  }));

  const hasSelection = selectedTerritory.length > 0;
  const selectedLakeFund: number | null = useMemo(() => {
    if (!selectedTileKey) return null;
    const t = activeTileMap.get(selectedTileKey);
    if (t?.terrain !== 'lake') return null;
    return lakeUnitFunds.has(selectedTileKey) ? (lakeUnitFunds.get(selectedTileKey) ?? null) : null;
  }, [selectedTileKey, activeTileMap, lakeUnitFunds]);
  const showCredits = hasSelection || selectedLakeFund !== null;
  const creditsDisplayValue = selectedLakeFund !== null ? selectedLakeFund : selectedTerritoryBalance;
  const selectedLakeEntity = selectedTileKey ? entities.get(selectedTileKey) : undefined;
  const lakeUpkeepPerTurn = (selectedLakeFund !== null && selectedLakeEntity && ENTITY_META[selectedLakeEntity].isUnit)
    ? ENTITY_META[selectedLakeEntity].upkeep : null;

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
            <Rect x={0} y={0} width={SW} height={SH} fill="url(#seaGrad)" />
          </Svg>

          <Animated.View style={[styles.board, boardStyle, styles.boardElevated]}>
            <Svg width={boardW} height={boardH}>
              <Defs>
                {tileData.filter(({ tile }) => tile.terrain === 'lake').map(({ tile, cx, cy }) => (
                  <ClipPath key={`clip-def-${tile.key}`} id={`lclip-${tile.key}`}>
                    <Polygon points={hexCornersString(cx, cy, HEX_SIZE)} />
                  </ClipPath>
                ))}
                {tileData.filter(({ tile }) => tile.terrain === 'mountain').map(({ tile, cx, cy }) => (
                  <ClipPath key={`mclip-def-${tile.key}`} id={`mclip-${tile.key}`}>
                    <Polygon points={hexCornersString(cx, cy, HEX_SIZE)} />
                  </ClipPath>
                ))}
              </Defs>
              <Rect x={0} y={0} width={boardW} height={boardH} fill="transparent" />
              {tileData.map(({ tile, cx, cy }) => {
                const liveTile = activeTileMap.get(tile.key) ?? tile;
                const isCityZone = tile.cityBuffer || tile.isCity;
                const fill = tile.terrain === 'lake'
                  ? '#5BAFD6'
                  : hasSelection
                    ? (TERRAIN_FILLS[tile.terrain] ?? TERRAIN_FILLS.grass)
                    : (tile.terrain === 'mountain'
                        ? TERRAIN_FILLS.mountain
                        : (isCityZone && liveTile.owner === 'neutral')
                          ? CITY_NEUTRAL_FILL
                          : (TERRITORY_FILLS[liveTile.owner] ?? TERRITORY_FILLS.neutral));
                return (
                  <Polygon
                    key={tile.key}
                    points={hexCornersString(cx, cy, HEX_SIZE)}
                    fill={fill}
                  />
                );
              })}

              {tileData.filter(({ tile }) => tile.terrain === 'lake').map(({ tile, cx, cy }) => {
                const s = HEX_SIZE * 2;
                return (
                  <SvgImage
                    key={`lake-img-${tile.key}`}
                    href={WATER_IMG}
                    x={cx - HEX_SIZE}
                    y={cy - HEX_SIZE}
                    width={s}
                    height={s}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#lclip-${tile.key})`}
                  />
                );
              })}

              {tileData.filter(({ tile }) => tile.terrain === 'mountain').map(({ tile, cx, cy }) => {
                const s = HEX_SIZE * 2;
                return (
                  <SvgImage
                    key={`mtn-${tile.key}`}
                    href={MOUNTAIN_IMG}
                    x={cx - HEX_SIZE}
                    y={cy - HEX_SIZE}
                    width={s}
                    height={s}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#mclip-${tile.key})`}
                  />
                );
              })}

              {tileData.filter(({ tile }) => tile.isCity || entities.get(tile.key) === 'city').map(({ tile, cx, cy }) => {
                const liveTile = activeTileMap.get(tile.key) ?? tile;
                const cityBorderColor = TERRITORY_BORDERS[liveTile.owner] ?? '#888888';
                const cr = HEX_SIZE * 0.46;
                return (
                  <React.Fragment key={`city-${tile.key}`}>
                    <Rect
                      x={cx - cr}
                      y={cy - cr}
                      width={cr * 2}
                      height={cr * 2}
                      rx={4}
                      fill="rgba(0,0,0,0.25)"
                      stroke={cityBorderColor}
                      strokeWidth={3.2}
                    />
                    <SvgText
                      x={cx}
                      y={cy + HEX_SIZE * 0.28}
                      textAnchor="middle"
                      fontSize={HEX_SIZE * 0.72}
                      fill="#fff"
                      opacity={0.9}
                    >
                      🏙️
                    </SvgText>
                  </React.Fragment>
                );
              })}

              {outerTerritoryEdges.map((edge, i) => (
                <Line
                  key={`outer-${i}`}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke={edge.color}
                  strokeWidth={edge.width}
                  strokeLinecap="round"
                />
              ))}

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


              {graveyard.size > 0 && Array.from(graveyard).map(key => {
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                if (entities.has(key)) return null;
                const fs = HEX_SIZE * 0.7;
                return (
                  <SvgText
                    key={`grave-${key}`}
                    x={pos.cx}
                    y={pos.cy + fs * 0.38}
                    textAnchor="middle"
                    fontSize={fs}
                    opacity={0.85}
                  >
                    ☠️
                  </SvgText>
                );
              })}

              {ruins.size > 0 && Array.from(ruins).map(key => {
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                if (entities.has(key)) return null;
                const fs = HEX_SIZE * 0.7;
                return (
                  <SvgText
                    key={`ruin-${key}`}
                    x={pos.cx}
                    y={pos.cy + fs * 0.38}
                    textAnchor="middle"
                    fontSize={fs}
                    opacity={0.85}
                  >
                    🏚️
                  </SvgText>
                );
              })}

              {validMoveTiles.size > 0 && Array.from(validMoveTiles).map(key => {
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                return (
                  <Polygon
                    key={`move-tap-${key}`}
                    points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                    fill="transparent"
                  />
                );
              })}

              {armedEntityId && Array.from(validPlacementAttackTiles).map(key => {
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                return (
                  <Polygon
                    key={`atk-tap-${key}`}
                    points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                    fill="transparent"
                  />
                );
              })}

              {errorTileKey && (() => {
                const pos = tileDataMap.get(errorTileKey);
                if (!pos) return null;
                return (
                  <Polygon
                    key={`err-${errorTileKey}`}
                    points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                    fill="rgba(0,0,0,0.55)"
                  />
                );
              })()}

            </Svg>

            <Animated.View style={[StyleSheet.absoluteFillObject, territoryPulseStyle]} pointerEvents="none">
              <Svg width={boardW} height={boardH}>
                {Array.from(affordableTerritoryTileKeys).map(key => {
                  const pos = tileDataMap.get(key);
                  if (!pos) return null;
                  const tile = activeTileMap.get(key);
                  if (!tile || tile.terrain === 'mountain' || tile.terrain === 'lake') return null;
                  return (
                    <Polygon
                      key={`afford-${key}`}
                      points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                      fill="white"
                    />
                  );
                })}
              </Svg>
            </Animated.View>

            <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
              <Svg width={boardW} height={boardH}>
                {Array.from(entities.entries()).map(([key, entityId]) => {
                  if (entityId === 'city') return null;
                  if (animatingUnit && key === animatingUnit.fromKey) return null;
                  if (animatingUnit && animatingUnit.hideDestination && key === animatingUnit.toKey) return null;
                  const pos = tileDataMap.get(key);
                  if (!pos) return null;
                  const meta = ENTITY_META[entityId];
                  const isRebel = entityId === 'rebel';
                  const isBuilding = !meta.isUnit && !isRebel;
                  const r = HEX_SIZE * 0.50;
                  const isSelected = selectedEntityKey === key;
                  const isSpent = spentUnits.has(key);
                  const liveTile = activeTileMap.get(key);
                  const isPlayerUnit = liveTile?.owner === 'player' && meta.isUnit;
                  const isIdleBouncing = isPlayerUnit && !isSpent && !isSelected;
                  if (isIdleBouncing) return null;
                  const bgColor = isRebel
                    ? 'rgba(140,20,20,0.92)'
                    : isSelected
                      ? 'rgba(20,80,20,0.95)'
                      : meta.isUnit
                        ? 'rgba(30,50,120,0.9)'
                        : 'rgba(80,40,10,0.9)';
                  const ownerColor = TERRITORY_BORDERS[liveTile?.owner ?? ''] ?? '#FFD700';
                  const strokeColor = isRebel
                    ? '#FFD700'
                    : isSelected
                      ? '#50FF50'
                      : ownerColor;
                  const strokeWidth = isRebel ? 3.0 : isSelected ? 4.0 : 3.2;
                  const unitOpacity = isSpent && isPlayerUnit ? 0.6 : 1.0;
                  return (
                    <React.Fragment key={`entity-${key}`}>
                      {isBuilding ? (
                        <Rect
                          x={pos.cx - r}
                          y={pos.cy - r}
                          width={r * 2}
                          height={r * 2}
                          rx={4}
                          fill={bgColor}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                        />
                      ) : (
                        <Circle
                          cx={pos.cx}
                          cy={pos.cy}
                          r={r}
                          fill={bgColor}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          opacity={unitOpacity}
                        />
                      )}
                      <SvgText
                        x={pos.cx}
                        y={pos.cy + r * 0.35}
                        textAnchor="middle"
                        fontSize={r * 1.1}
                        fill="#fff"
                        opacity={unitOpacity}
                      >
                        {meta.icon}
                      </SvgText>
                      <Polygon
                        points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                        fill="transparent"
                      />
                    </React.Fragment>
                  );
                })}
              </Svg>
            </View>

            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
              {animatingUnit && (() => {
                const fromPos = tileDataMap.get(animatingUnit.fromKey);
                const toPos = tileDataMap.get(animatingUnit.toKey);
                if (!fromPos || !toPos) return null;
                return (
                  <AnimatedMovingUnit
                    fromPos={fromPos}
                    toPos={toPos}
                    entityId={animatingUnit.entityId}
                    owner={animatingUnit.owner}
                    hexSize={HEX_SIZE}
                    progress={animUnitProgress}
                  />
                );
              })()}
              {Array.from(entities.entries()).map(([key, entityId]) => {
                if (entityId === 'city' || entityId === 'rebel') return null;
                if (animatingUnit && key === animatingUnit.fromKey) return null;
                if (animatingUnit && animatingUnit.hideDestination && key === animatingUnit.toKey) return null;
                const meta = ENTITY_META[entityId];
                if (!meta.isUnit) return null;
                const liveTile = activeTileMap.get(key);
                if (liveTile?.owner !== 'player') return null;
                if (spentUnits.has(key)) return null;
                if (selectedEntityKey === key) return null;
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                const r = HEX_SIZE * 0.50;
                return (
                  <Animated.View
                    key={`bounce-${key}`}
                    style={[{
                      position: 'absolute',
                      left: pos.cx - r,
                      top: pos.cy - r,
                      width: r * 2,
                      height: r * 2,
                      borderRadius: r,
                      backgroundColor: 'rgba(30,50,120,0.9)',
                      borderWidth: 2.2,
                      borderColor: TERRITORY_BORDERS['player'],
                      alignItems: 'center',
                      justifyContent: 'center',
                    }, idleBounceStyle]}
                  >
                    <Text style={{ fontSize: r * 1.1, lineHeight: r * 1.6 }}>{meta.icon}</Text>
                  </Animated.View>
                );
              })}
            </View>

            {fortificationDots.size > 0 && (
              <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <Svg width={boardW} height={boardH}>
                  {Array.from(fortificationDots).map(key => {
                    const pos = tileDataMap.get(key);
                    if (!pos) return null;
                    return (
                      <Circle
                        key={`fort-${key}`}
                        cx={pos.cx}
                        cy={pos.cy}
                        r={HEX_SIZE * 0.15}
                        fill="#4488FF"
                        opacity={0.75}
                      />
                    );
                  })}
                </Svg>
              </View>
            )}

            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
              <Svg width={boardW} height={boardH}>

                {Array.from(validMoveTiles).map(key => {
                  const pos = tileDataMap.get(key);
                  if (!pos) return null;
                  const tileOwner = activeTileMap.get(key)?.owner;
                  const hasRebel = entities.get(key) === 'rebel';
                  const isAttackMove = (tileOwner !== 'player' && tileOwner !== undefined) || hasRebel;
                  return (
                    <Circle
                      key={`move-dot-${key}`}
                      cx={pos.cx}
                      cy={pos.cy}
                      r={HEX_SIZE * 0.18}
                      fill={isAttackMove ? 'rgba(220,40,40,0.85)' : 'rgba(255,220,0,0.85)'}
                    />
                  );
                })}

                {armedEntityId && Array.from(selectedTileKeys).map(key => {
                  const pos = tileDataMap.get(key);
                  if (!pos) return null;
                  // For buildings: only show dot on empty, non-graveyard tiles not already showing a blue fortification dot
                  if (armedEntityId && !ENTITY_META[armedEntityId].isUnit) {
                    if (entities.get(key) || graveyard.has(key) || fortificationDots.has(key)) return null;
                  }
                  // For units: skip tiles occupied by own buildings (tower/castle/city) — can't place there
                  if (armedEntityId && ENTITY_META[armedEntityId].isUnit) {
                    const existingEntity = entities.get(key);
                    if (existingEntity && !ENTITY_META[existingEntity].isUnit && existingEntity !== 'rebel' && activeTileMap.get(key)?.owner === 'player') return null;
                  }
                  const isRebelTarget = ENTITY_META[armedEntityId].isUnit && entities.get(key) === 'rebel';
                  return (
                    <Circle
                      key={`place-dot-${key}`}
                      cx={pos.cx}
                      cy={pos.cy}
                      r={HEX_SIZE * 0.18}
                      fill={isRebelTarget ? 'rgba(220,40,40,0.85)' : 'rgba(255,220,0,0.85)'}
                    />
                  );
                })}

                {armedEntityId && Array.from(validPlacementAttackTiles).map(key => {
                  const pos = tileDataMap.get(key);
                  if (!pos) return null;
                  return (
                    <Circle
                      key={`atk-dot-${key}`}
                      cx={pos.cx}
                      cy={pos.cy}
                      r={HEX_SIZE * 0.18}
                      fill="rgba(220,40,40,0.85)"
                    />
                  );
                })}

                {isDeveloperModeActive && devEconomicOverlays.map(({ cx, cy, label, aiLabel }, i) => {
                  const fontSize = Math.max(7, Math.min(11, HEX_SIZE * 0.32));
                  const maxLen = aiLabel ? Math.max(label.length, aiLabel.length) : label.length;
                  const totalHeight = aiLabel ? fontSize * 2.8 : fontSize * 1.4;
                  return (
                    <React.Fragment key={`dev-econ-${i}`}>
                      <Rect
                        x={cx - fontSize * maxLen * 0.32}
                        y={cy - fontSize * 0.85}
                        width={fontSize * maxLen * 0.64}
                        height={totalHeight}
                        fill="rgba(0,0,0,0.65)"
                        rx={2}
                      />
                      <SvgText
                        x={cx}
                        y={cy + fontSize * 0.42}
                        textAnchor="middle"
                        fontSize={fontSize}
                        fill="#00FF88"
                        fontWeight="bold"
                      >
                        {label}
                      </SvgText>
                      {aiLabel && (
                        <SvgText
                          x={cx}
                          y={cy + fontSize * 0.42 + fontSize * 1.4}
                          textAnchor="middle"
                          fontSize={fontSize}
                          fill="#FFD700"
                          fontWeight="bold"
                        >
                          {aiLabel}
                        </SvgText>
                      )}
                    </React.Fragment>
                  );
                })}

              </Svg>
            </View>

          </Animated.View>
        </View>
      </GestureDetector>

      <Animated.View
        style={[styles.ribbon, { bottom: BOTTOM_BAR_H + botInset + (selectedEntityKey ? ENTITY_PANEL_H : 0) }, ribbonStyle]}
      >
        <ScrollView
          ref={ribbonScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.ribbonContent}
        >
          {(ribbonMode === 'units' ? UNIT_PURCHASABLES : BUILDING_PURCHASABLES).map(item => {
            const isArmed = armedEntityId === item.id;
            const isTower = item.id === 'tower';
            const round1Locked = turn === 1 && !isTower;
            const cityAlreadyBuilt = item.id === 'city' && territoryHasCity;
            const cityTooSmall = item.id === 'city' && selectedTerritory.length < 6;
            const cityLocked = cityAlreadyBuilt || cityTooSmall;
            const playerUsedTilesSet = freeTowerUsedTiles.get('player') ?? new Set<string>();
            const playerTowerFree = isTower
              && turn === 1
              && selectedTerritory.length >= 2
              && !selectedTerritory.some(t => playerUsedTilesSet.has(t.key));
            const effectiveCost = playerTowerFree ? 0 : item.cost;
            const affordable = effectiveCost <= selectedTerritoryBalance;
            const enabled = affordable && !cityLocked && !round1Locked;
            const costLabel = round1Locked ? 'Round 2+'
              : cityAlreadyBuilt ? 'BUILT'
              : cityTooSmall ? '<6 tiles'
              : playerTowerFree ? 'FREE'
              : `${item.cost}g`;
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
                <Text style={[styles.ribbonCost, !enabled && styles.ribbonDim, isArmed && styles.ribbonNameArmed, playerTowerFree && styles.ribbonCostFree, cityAlreadyBuilt && styles.ribbonCostBuilt]}>
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
        <Text style={{ fontSize: 14, color: '#A08860' }}>←</Text>
        <Text style={styles.menuBtnText}>Menu</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.devBtn, isDeveloperModeActive ? styles.devBtnActive : styles.devBtnInactive, { top: topInset + 4, right: 4, position: 'absolute', zIndex: 20 }]}
        onPress={() => setIsDeveloperModeActive(v => !v)}
      >
        <Text style={[styles.devBtnText, isDeveloperModeActive ? styles.devBtnTextActive : styles.devBtnTextInactive]}>DEV</Text>
      </TouchableOpacity>

      {selectedEntityKey && (() => {
        const entityId = entities.get(selectedEntityKey);
        const isUnit = entityId ? ENTITY_META[entityId].isUnit : false;
        const upgradeTarget = entityId ? UNIT_UPGRADE[entityId] : undefined;
        const canUpgrade = !!upgradeTarget;
        const upgradeCost = (entityId && upgradeTarget)
          ? ENTITY_META[upgradeTarget].cost - ENTITY_META[entityId].cost
          : 0;
        const isSpent = spentUnits.has(selectedEntityKey);
        const entityTile = activeTileMap.get(selectedEntityKey);
        const entityTerritoryId = entityTile
          ? getTerritoryId(getContiguousTerritory(activeTileMap, selectedEntityKey, 'player'))
          : null;
        const entityTerritoryBalance = entityTerritoryId ? (territoryBalances.get(entityTerritoryId) ?? 0) : 0;
        const removeCost = isUnit ? 0 : 5;
        const upgradeEnabled = canUpgrade && entityTerritoryBalance >= upgradeCost && (!isUnit || !isSpent);
        const removeEnabled = isUnit ? !isSpent : (!!entityTerritoryId && entityTerritoryBalance >= removeCost);
        return (
          <View style={[styles.entityPanel, { bottom: BOTTOM_BAR_H + botInset }]}>
            <TouchableOpacity
              style={[styles.buildBtn, { borderColor: '#AA3A2A', backgroundColor: '#3A1A10' }, !removeEnabled && styles.buildBtnDisabled]}
              activeOpacity={removeEnabled ? 0.75 : 1}
              onPress={() => {
                if (isAiTurn || gameResult !== null) return;
                if (!removeEnabled || !entityTerritoryId) return;
                pushHistory();
                setEntities(prev => { const next = new Map(prev); next.delete(selectedEntityKey); return next; });
                if (removeCost > 0) {
                  setTerritoryBalances(prev => { const next = new Map(prev); next.set(entityTerritoryId, entityTerritoryBalance - removeCost); return next; });
                }
                setSelectedEntityKey(null);
              }}
            >
              <Text style={[styles.buildBtnText, { color: removeEnabled ? '#F07060' : '#7A3020' }]}>
                ✕ Remove{removeCost > 0 ? ` (${removeCost}g)` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buildBtn, !upgradeEnabled && styles.buildBtnDisabled]}
              activeOpacity={upgradeEnabled ? 0.75 : 1}
              onPress={() => {
                if (isAiTurn || gameResult !== null) return;
                if (!upgradeEnabled || !entityId || !upgradeTarget || !entityTerritoryId) return;
                pushHistory();
                setEntities(prev => { const next = new Map(prev); next.set(selectedEntityKey, upgradeTarget); return next; });
                setTerritoryBalances(prev => { const next = new Map(prev); next.set(entityTerritoryId, entityTerritoryBalance - upgradeCost); return next; });
              }}
            >
              <Text style={[styles.buildBtnText, !upgradeEnabled && styles.buildBtnTextDisabled]}>
                ⬆ Upgrade {canUpgrade ? `(${upgradeCost}g)` : '(Max)'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })()}

      <View style={[styles.bottomBar, { paddingBottom: botInset }]}>
        <View style={styles.bottomBarInner}>
          {(() => {
            const undoDisabled = isAiTurn || gameResult !== null || moveHistory.length === 0;
            return (
              <TouchableOpacity
                style={[styles.undoBtn, undoDisabled && styles.undoBtnDisabled]}
                onPress={handleUndo}
                activeOpacity={undoDisabled ? 1 : 0.75}
                disabled={undoDisabled}
              >
                <Text style={[styles.undoBtnLabel, undoDisabled && styles.undoBtnLabelDisabled]}>Undo</Text>
                <Text style={[styles.undoBtnIcon, undoDisabled && styles.undoBtnIconDisabled]}>↺</Text>
              </TouchableOpacity>
            );
          })()}

          {showCredits && (
            <TouchableOpacity
              style={styles.creditsDisplay}
              onPress={() => { if (hasSelection) setShowEconModal(true); }}
              activeOpacity={hasSelection ? 0.75 : 1}
            >
              <View style={styles.creditsTopRow}>
                <Text style={styles.creditsIcon}>⚜️</Text>
                <Text style={styles.creditsAmount}>{creditsDisplayValue}</Text>
              </View>
              {selectedLakeFund !== null && lakeUpkeepPerTurn !== null ? (
                <Text style={[styles.creditsNet, styles.creditsNetNeg]}>
                  -{lakeUpkeepPerTurn}/turn
                </Text>
              ) : hasSelection && econBreakdown !== null ? (
                <Text style={[styles.creditsNet, econBreakdown.net >= 0 ? styles.creditsNetPos : styles.creditsNetNeg]}>
                  {econBreakdown.net >= 0 ? `+${econBreakdown.net}` : `${econBreakdown.net}`}/turn
                </Text>
              ) : (
                <Text style={[styles.creditsNet, { color: 'transparent' }]}>+0/turn</Text>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.spacer} />

          {canBuild && (['units', 'buildings'] as const).map(mode => {
            const isActive = ribbonMode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.buildBtn,
                  isActive && styles.buildBtnActive,
                  !canBuild && styles.buildBtnDisabled,
                ]}
                onPress={() => {
                  if (isAiTurn || gameResult !== null || !canBuild) return;
                  setSelectedEntityKey(null);
                  if (isActive) {
                    closeRibbon();
                    setArmedEntityId(null);
                  } else {
                    openRibbon(mode);
                    setArmedEntityId(null);
                  }
                }}
                activeOpacity={canBuild ? 0.75 : 1}
              >
                <Text style={{ fontSize: 13, color: isActive ? '#0D0A06' : canBuild ? '#C8A24A' : '#3A2E14' }}>
                  {mode === 'units' ? '⚔' : '🏛'}
                </Text>
                <Text style={[
                  styles.buildBtnText,
                  isActive && styles.buildBtnTextActive,
                  !canBuild && styles.buildBtnTextDisabled,
                ]}>
                  {mode === 'units' ? 'Units' : 'Builds'}
                </Text>
              </TouchableOpacity>
            );
          })}

          {isDeveloperModeActive && isAiPaused && aiHistoryIndex > 0 && (
            <TouchableOpacity style={styles.prevActionBtn} onPress={handleAiStepBack}>
              <Text style={{ fontSize: 13, color: '#00FF88' }}>←</Text>
              <Text style={styles.nextActionBtnText}>Prev</Text>
            </TouchableOpacity>
          )}

          {isDeveloperModeActive && isAiPaused && (
            <TouchableOpacity
              style={styles.nextActionBtn}
              onPress={handleAiStepNext}
            >
              <Text style={styles.nextActionBtnText}>
                {aiHistoryIndex < aiHistoryLen - 1 ? 'Next ▶' : 'Next'}
              </Text>
              <Text style={{ fontSize: 13, color: '#00FF88' }}>→</Text>
            </TouchableOpacity>
          )}

          {isAiTurn ? (
            <View style={[styles.endTurnBtn, styles.aiTurnBtn]}>
              <Text style={styles.aiTurnText}>AI Turn...</Text>
            </View>
          ) : (
            <Animated.View style={endTurnStyle}>
              <TouchableOpacity style={styles.endTurnBtn} onPress={handleEndTurn} disabled={gameResult !== null}>
                <Text style={styles.endTurnText}>End Turn</Text>
                <Text style={styles.endTurnArrow}>→</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
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

      {pendingLakeMove && (
        <Modal visible={true} transparent animationType="fade" onRequestClose={() => setPendingLakeMove(null)}>
          <View style={styles.lakeModalOverlay}>
            <View style={styles.lakeModalBox}>
              <Text style={styles.lakeModalTitle}>⚓ Naval Supply</Text>
              <Text style={styles.lakeModalSubtitle}>
                How many credits to provision this unit?{'\n'}
                (minimum {pendingLakeMove.minAmount}, max {pendingLakeMove.maxAmount})
              </Text>

              <Text style={styles.lakeModalAmount}>{lakeTransferAmount}</Text>

              <View style={styles.lakeSliderRow}>
                <TouchableOpacity
                  style={styles.lakeStepBtn}
                  onPress={() => setLakeTransferAmount(prev => Math.max(pendingLakeMove.minAmount, prev - 1))}
                >
                  <Text style={styles.lakeStepText}>−</Text>
                </TouchableOpacity>

                <View
                  style={styles.lakeTrack}
                  onLayout={e => setSliderTrackWidth(e.nativeEvent.layout.width)}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={e => {
                    const x = e.nativeEvent.locationX;
                    const pct = Math.max(0, Math.min(1, x / sliderTrackWidth));
                    const range = pendingLakeMove.maxAmount - pendingLakeMove.minAmount;
                    setLakeTransferAmount(pendingLakeMove.minAmount + Math.round(pct * range));
                  }}
                  onResponderMove={e => {
                    const x = e.nativeEvent.locationX;
                    const pct = Math.max(0, Math.min(1, x / sliderTrackWidth));
                    const range = pendingLakeMove.maxAmount - pendingLakeMove.minAmount;
                    setLakeTransferAmount(pendingLakeMove.minAmount + Math.round(pct * range));
                  }}
                >
                  <View
                    style={[
                      styles.lakeTrackFill,
                      {
                        width: `${pendingLakeMove.maxAmount <= pendingLakeMove.minAmount ? 100 : Math.round(((lakeTransferAmount - pendingLakeMove.minAmount) / (pendingLakeMove.maxAmount - pendingLakeMove.minAmount)) * 100)}%`,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.lakeThumb,
                      {
                        left: pendingLakeMove.maxAmount <= pendingLakeMove.minAmount
                          ? sliderTrackWidth - 12
                          : Math.round(((lakeTransferAmount - pendingLakeMove.minAmount) / (pendingLakeMove.maxAmount - pendingLakeMove.minAmount)) * (sliderTrackWidth - 12)),
                      },
                    ]}
                  />
                </View>

                <TouchableOpacity
                  style={styles.lakeStepBtn}
                  onPress={() => setLakeTransferAmount(prev => Math.min(pendingLakeMove.maxAmount, prev + 1))}
                >
                  <Text style={styles.lakeStepText}>+</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.lakePresetRow}>
                <TouchableOpacity
                  style={styles.lakePresetBtn}
                  onPress={() => setLakeTransferAmount(pendingLakeMove.minAmount)}
                >
                  <Text style={styles.lakePresetText}>min.</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.lakePresetBtn}
                  onPress={() => setLakeTransferAmount(pendingLakeMove.maxAmount)}
                >
                  <Text style={styles.lakePresetText}>max.</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.lakeModalButtons}>
                <TouchableOpacity style={styles.lakeCancelBtn} onPress={() => setPendingLakeMove(null)}>
                  <Text style={styles.lakeCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.lakeConfirmBtn} onPress={() => commitPendingLakeMove(lakeTransferAmount)}>
                  <Text style={styles.lakeConfirmText}>Dispatch ⚓</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <Modal visible={showEconModal} transparent animationType="fade" onRequestClose={() => setShowEconModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowEconModal(false)}>
          <View style={styles.econCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.econTitle}>Economy Breakdown</Text>
            <View style={styles.econSection}>
              <Text style={styles.econSectionLabel}>INCOME / TURN</Text>
              {econBreakdown && econBreakdown.grassCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>🌿 Grass ×{econBreakdown.grassCount} <Text style={styles.econPer}>(+2 each)</Text></Text>
                  <Text style={styles.econRowValue}>+{econBreakdown.grassIncome}</Text>
                </View>
              )}
              {econBreakdown && econBreakdown.forestCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>🌲 Forest ×{econBreakdown.forestCount} <Text style={styles.econPer}>(+2 each)</Text></Text>
                  <Text style={styles.econRowValue}>+{econBreakdown.forestIncome}</Text>
                </View>
              )}
              {econBreakdown && econBreakdown.desertCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>🏜️ Desert ×{econBreakdown.desertCount} <Text style={styles.econPer}>(+1 each)</Text></Text>
                  <Text style={styles.econRowValue}>+{econBreakdown.desertIncome}</Text>
                </View>
              )}
              {econBreakdown && econBreakdown.cityCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>🏙️ Cities ×{econBreakdown.cityCount} <Text style={styles.econPer}>(+{CITY_BONUS} each)</Text></Text>
                  <Text style={styles.econRowValue}>+{econBreakdown.cityIncome}</Text>
                </View>
              )}
            </View>
            {econBreakdown && (econBreakdown.upkeepGroups.length > 0 || econBreakdown.rebelTotalLoss > 0) && (
              <View style={styles.econSection}>
                <Text style={styles.econSectionLabel}>UPKEEP / TURN</Text>
                {econBreakdown.upkeepGroups.map((g, i) => (
                  <View key={i} style={styles.econRow}>
                    <Text style={styles.econRowLabel}>{g.icon} {g.name} ×{g.count} <Text style={styles.econPer}>(−{g.upkeepPerUnit} each)</Text></Text>
                    <Text style={[styles.econRowValue, { color: '#E07060' }]}>−{g.total}</Text>
                  </View>
                ))}
                {econBreakdown.rebelTotalLoss > 0 && (
                  <View style={styles.econRow}>
                    <Text style={styles.econRowLabel}>✊ Rebels ×{econBreakdown.rebelCount}</Text>
                    <Text style={[styles.econRowValue, { color: '#E07060' }]}>−{econBreakdown.rebelTotalLoss}</Text>
                  </View>
                )}
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
        </TouchableOpacity>
      </Modal>

      <Modal visible={gameResult !== null} transparent animationType="fade">
        <View style={styles.gameResultOverlay}>
          <View style={styles.gameResultCard}>
            <Text style={styles.gameResultEmoji}>
              {gameResult === 'victory' ? '🏆' : '💀'}
            </Text>
            <Text style={[styles.gameResultTitle, gameResult === 'victory' ? styles.gameResultVictoryTitle : styles.gameResultDefeatTitle]}>
              {gameResult === 'victory' ? 'Victory!' : 'Game Over'}
            </Text>
            <Text style={styles.gameResultBody}>
              {gameResult === 'victory'
                ? 'All opponents have been eliminated. The realm is yours!'
                : 'Your territory has been conquered. The campaign is lost.'}
            </Text>
            <TouchableOpacity
              style={[styles.gameResultBtn, styles.gameResultMenuBtn]}
              onPress={() => {
                setGameResult(null);
                setIsDeveloperModeActive(false);
                setIsAiPaused(false);
                resumeAiRef.current = null;
                router.back();
              }}
            >
              <Text style={[styles.gameResultBtnText, styles.gameResultMenuBtnText]}>Return to Main Menu</Text>
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
  entityPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ENTITY_PANEL_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    backgroundColor: 'rgba(18, 12, 4, 0.97)',
    borderTopWidth: 1,
    borderTopColor: '#6A4A1C',
    zIndex: 18,
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
  ribbonCostFree: {
    color: '#44DD88',
    fontFamily: 'Cinzel_700Bold',
  },
  ribbonCostBuilt: {
    color: '#E04040',
    fontFamily: 'Cinzel_700Bold',
  },
  ribbonDim: {
    color: '#786848',
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
    paddingHorizontal: 8,
    gap: 6,
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
    gap: 4,
    paddingHorizontal: 10,
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
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#3A2A10',
  },
  creditsTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  creditsIcon: {
    fontSize: 12,
  },
  creditsAmount: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#C8A24A',
  },
  creditsNet: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
  },
  creditsNetPos: {
    color: '#70C870',
  },
  creditsNetNeg: {
    color: '#E07060',
  },
  lakeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lakeModalBox: {
    backgroundColor: '#1E1A10',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#4A7FA5',
    padding: 24,
    width: 320,
    alignItems: 'center',
  },
  lakeModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#7EC8E3',
    marginBottom: 6,
  },
  lakeModalSubtitle: {
    fontSize: 12,
    color: '#8C9BAB',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  lakeModalAmount: {
    fontSize: 44,
    fontWeight: '800',
    color: '#C8D8E8',
    marginBottom: 12,
  },
  lakeSliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 14,
    gap: 8,
  },
  lakeStepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2A3A4A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#4A7FA5',
  },
  lakeStepText: {
    fontSize: 20,
    color: '#7EC8E3',
    lineHeight: 24,
  },
  lakeTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2A3A4A',
    position: 'relative',
    overflow: 'visible',
  },
  lakeTrackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#4A7FA5',
    borderRadius: 4,
  },
  lakeThumb: {
    position: 'absolute',
    top: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#7EC8E3',
    marginLeft: -12,
    borderWidth: 2,
    borderColor: '#1E1A10',
  },
  lakePresetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  lakePresetBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#2A3A4A',
    borderWidth: 1,
    borderColor: '#4A7FA5',
  },
  lakePresetText: {
    fontSize: 12,
    color: '#7EC8E3',
    fontWeight: '600',
  },
  lakeModalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  lakeCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2A2218',
    borderWidth: 1,
    borderColor: '#5A4A2A',
    alignItems: 'center',
  },
  lakeCancelText: {
    color: '#8A7A5A',
    fontWeight: '600',
    fontSize: 15,
  },
  lakeConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1A3A5A',
    borderWidth: 1,
    borderColor: '#4A7FA5',
    alignItems: 'center',
  },
  lakeConfirmText: {
    color: '#7EC8E3',
    fontWeight: '700',
    fontSize: 15,
  },
  spacer: {
    flex: 1,
  },
  undoBtn: {
    height: BTN_H,
    width: BTN_H,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 1,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#9A7830',
    backgroundColor: '#3A2A10',
  },
  undoBtnDisabled: {
    borderColor: '#6A5A28',
    backgroundColor: '#2E2208',
  },
  undoBtnLabel: {
    fontSize: 9,
    fontFamily: 'Cinzel_400Regular',
    color: '#C8A24A',
    letterSpacing: 0.5,
  },
  undoBtnLabelDisabled: {
    color: '#6A5828',
  },
  undoBtnIcon: {
    fontSize: 17,
    color: '#C8A24A',
  },
  undoBtnIconDisabled: {
    color: '#6A5828',
  },
  endTurnBtn: {
    height: BTN_H,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#B08030',
    backgroundColor: '#6A4014',
  },
  endTurnText: {
    fontSize: 11,
    fontFamily: 'Cinzel_700Bold',
    color: '#F0D080',
    letterSpacing: 0.5,
  },
  endTurnArrow: {
    fontSize: 13,
    color: '#F0D080',
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
  aiTurnBtn: {
    backgroundColor: '#1A1A3A',
    borderColor: '#4A4A8A',
  },
  aiTurnText: {
    fontSize: 12,
    fontFamily: 'Cinzel_400Regular',
    color: '#8888CC',
    letterSpacing: 0.5,
  },
  devBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#7A6030',
    backgroundColor: '#3A2A10',
  },
  devBtnInactive: {
    borderColor: '#8A2222',
    backgroundColor: '#3A0808',
  },
  devBtnActive: {
    borderColor: '#00FF88',
    backgroundColor: '#003322',
  },
  devBtnText: {
    fontSize: 11,
    fontFamily: 'Cinzel_400Regular',
    letterSpacing: 0.5,
  },
  devBtnTextInactive: {
    color: '#CC4444',
  },
  devBtnTextActive: {
    color: '#00FF88',
  },
  prevActionBtn: {
    height: BTN_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#00BB66',
    backgroundColor: '#002211',
  },
  nextActionBtn: {
    height: BTN_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#00FF88',
    backgroundColor: '#003322',
  },
  nextActionBtnText: {
    fontSize: 11,
    fontFamily: 'Cinzel_700Bold',
    color: '#00FF88',
    letterSpacing: 0.5,
  },
  gameResultOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.80)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameResultCard: {
    width: 320,
    backgroundColor: '#1E1608',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#9A7830',
    padding: 36,
    alignItems: 'center',
    gap: 16,
  },
  gameResultEmoji: {
    fontSize: 56,
  },
  gameResultTitle: {
    fontSize: 28,
    fontFamily: 'Cinzel_700Bold',
    letterSpacing: 1,
  },
  gameResultVictoryTitle: {
    color: '#F0D060',
  },
  gameResultDefeatTitle: {
    color: '#E06050',
  },
  gameResultBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#C8A870',
    textAlign: 'center',
    lineHeight: 22,
  },
  gameResultBtn: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#9A7830',
    backgroundColor: '#3A2A10',
    alignItems: 'center',
  },
  gameResultBtnText: {
    fontSize: 14,
    fontFamily: 'Cinzel_700Bold',
    color: '#F0D080',
    letterSpacing: 0.5,
  },
  gameResultMenuBtn: {
    backgroundColor: '#2A1E08',
    borderColor: '#6A5020',
  },
  gameResultMenuBtnText: {
    color: '#C8A24A',
    fontSize: 12,
  },
});
