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

const BTN_H = 36;
const BOTTOM_BAR_H = BTN_H + 16;
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

export default function GameScreen() {
  const params = useLocalSearchParams<{ tileCount: string; opponentCount: string }>();
  const numTiles = Math.min(300, Math.max(40, Number(params.tileCount) || 100));
  const numOpponents = Math.min(5, Math.max(1, Number(params.opponentCount) || 3));
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

  const borderEdges = useMemo<BorderEdge[]>(() => {
    const edges: BorderEdge[] = [];
    // Use mutableTileMap as the authoritative ownership source so borders
    // stay correct across turns even as liveOwnerMap is a per-turn overlay.
    const ownerOf = (key: string, base: HexTile) =>
      mutableTileMap.get(key)?.owner ?? base.owner;

    for (const { tile, cx, cy } of tileData) {
      const liveOwner = ownerOf(tile.key, tile);
      if (tile.terrain === 'mountain' || liveOwner === 'neutral') continue;
      const color = TERRITORY_BORDERS[liveOwner as TerritoryOwner]!;
      if (!color) continue;
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
          neighborLiveOwner === 'neutral' ||
          neighborLiveOwner !== liveOwner;
        if (!needsBorder) continue;
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color, width: BORDER_W });
      }
    }

    for (const { tile, cx, cy } of tileData) {
      if (!tile.cityBuffer && !tile.isCity) continue;
      const liveOwner = ownerOf(tile.key, tile);
      if (liveOwner !== 'neutral') continue;
      for (const { dir: [dq, dr], verts: [va, vb] } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighborBase = tileMap.get(nk);
        const neighborLiveOwner = neighborBase ? ownerOf(nk, neighborBase) : null;
        const neighborIsNeutralCity =
          neighborBase !== undefined &&
          neighborLiveOwner === 'neutral' &&
          (neighborBase.cityBuffer || neighborBase.isCity);
        const needsBorder = !neighborIsNeutralCity && neighborBase?.terrain !== 'mountain';
        if (!needsBorder) continue;
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: CITY_BUFFER_BORDER, width: BORDER_W });
      }
    }

    return edges;
  }, [tileData, tileMap, mutableTileMap, INNER_SIZE]);

  const outerTerritoryEdges = useMemo<BorderEdge[]>(() => {
    const edges: BorderEdge[] = [];
    const ownerOf = (key: string, base: HexTile) =>
      mutableTileMap.get(key)?.owner ?? base.owner;

    for (const { tile, cx, cy } of tileData) {
      const liveOwner = ownerOf(tile.key, tile);
      if (tile.terrain === 'mountain' || liveOwner === 'neutral') continue;
      for (const { dir: [dq, dr], verts: [va, vb] } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighborBase = tileMap.get(nk);
        if (!neighborBase) {
          const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
          edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: '#000000', width: 2 });
          continue;
        }
        const neighborLiveOwner = ownerOf(nk, neighborBase);
        const needsBorder =
          neighborBase.terrain === 'mountain' ||
          neighborLiveOwner === 'neutral' ||
          neighborLiveOwner !== liveOwner;
        if (!needsBorder) continue;
        const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
        edges.push({ x1: ptA.x, y1: ptA.y, x2: ptB.x, y2: ptB.y, color: '#000000', width: 2 });
      }
    }
    return edges;
  }, [tileData, tileMap, mutableTileMap, HEX_SIZE]);

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
  const [moveHistory, setMoveHistory] = useState<Array<{
    entities: Map<string, EntityType>;
    mutableTileMap: Map<string, HexTile>;
    territoryBalances: Map<string, number>;
    spentUnits: Set<string>;
    liveOwnerMap: Map<string, TerritoryOwner>;
    partialMoves: Map<string, number>;
    freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  }>>([]);
  const [isAiTurn, setIsAiTurn] = useState(false);
  const [gameResult, setGameResult] = useState<'victory' | 'defeat' | null>(null);
  const aiTurnRef = useRef<boolean>(false);
  const [graveyard, setGraveyard] = useState<Set<string>>(new Set());
  const [partialMoves, setPartialMoves] = useState<Map<string, number>>(new Map());
  const [isDeveloperModeActive, setIsDeveloperModeActive] = useState(false);
  const [isAiPaused, setIsAiPaused] = useState(false);
  const resumeAiRef = useRef<(() => void) | null>(null);
  const isDeveloperModeRef = useRef(false);
  const [freeTowerUsedTiles, setFreeTowerUsedTiles] = useState<Map<TerritoryOwner, Set<string>>>(new Map());
  const freeTowerUsedTilesRef = useRef<Map<TerritoryOwner, Set<string>>>(new Map());

  useEffect(() => { freeTowerUsedTilesRef.current = freeTowerUsedTiles; }, [freeTowerUsedTiles]);

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
      setPartialMoves(new Map());
      setMutableTileMap(new Map(tileMap));
      setLiveOwnerMap(new Map());
      setGraveyard(new Set());
      setFreeTowerUsedTiles(new Map());

      const initialEntities = new Map<string, EntityType>();
      const owners: TerritoryOwner[] = ['player', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5'];
      for (const tile of tiles) {
        if (!owners.includes(tile.owner)) continue;
        if (tile.terrain === 'mountain') continue;
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
      !Array.from(currentTileMap.values()).some(t => t.owner === ai),
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
  ) => {
    let workingTileMap = new Map(currentTileMap);
    let workingEntities = new Map(currentEntities);
    let workingBalances = new Map(currentBalances);
    let workingLiveOwnerMap = new Map<string, TerritoryOwner>();
    let workingGraveyard = new Set<string>();
    let workingSpentUnits = new Set<string>();
    let workingFreeTowerUsed = new Map(freeTowerUsedTilesRef.current);

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

        // Free tower: each territory with ≥2 tiles may build one free tower
        if (territory.length >= 2) {
          const aiUsedSet = workingFreeTowerUsed.get(aiOwner);
          const hasUsedFreeTower = !!aiUsedSet && territory.some(t => aiUsedSet.has(t.key));
          if (!hasUsedFreeTower) {
            const borderTowerCands: string[] = [];
            const innerTowerCands: string[] = [];
            for (const t of territory) {
              if (t.terrain === 'mountain' || workingEntities.has(t.key)) continue;
              const [tq, tr] = t.key.split(',').map(Number);
              const onBorder = HEX_EDGES.some(({ dir: [dq, dr] }) => {
                const nk = tileKey(tq + dq, tr + dr);
                const nb = workingTileMap.get(nk);
                return !!nb && nb.owner !== aiOwner;
              });
              if (onBorder) borderTowerCands.push(t.key);
              else innerTowerCands.push(t.key);
            }
            const towerCands = borderTowerCands.length > 0 ? borderTowerCands : innerTowerCands;
            if (towerCands.length > 0) {
              const towerKey = towerCands[Math.floor(Math.random() * towerCands.length)];
              workingEntities = new Map(workingEntities);
              workingEntities.set(towerKey, 'tower');
              const newOwnerSet = new Set(workingFreeTowerUsed.get(aiOwner) ?? []);
              for (const t of territory) newOwnerSet.add(t.key);
              workingFreeTowerUsed = new Map(workingFreeTowerUsed);
              workingFreeTowerUsed.set(aiOwner, newOwnerSet);
              setFreeTowerUsedTiles(new Map(workingFreeTowerUsed));
              setEntities(new Map(workingEntities));
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

        const balance = workingBalances.get(territoryId) ?? 0;
        if (balance < 10) continue;

        const territoryKeys = new Set(territory.map(t => t.key));
        const vacantInside = territory.filter(
          t => t.terrain !== 'mountain' && !workingEntities.has(t.key),
        );

        // Find adjacent tiles outside the territory that can be captured,
        // mirroring the same rules the player uses for validPlacementAttackTiles.
        const seenAdjacent = new Set<string>();
        const enemyAdjacentKeys: string[] = [];
        const neutralAdjacentKeys: string[] = [];
        for (const t of territory) {
          if (t.terrain === 'mountain') continue;
          const [q, r] = t.key.split(',').map(Number);
          for (const { dir: [dq, dr] } of HEX_EDGES) {
            const nk = tileKey(q + dq, r + dr);
            if (territoryKeys.has(nk) || seenAdjacent.has(nk)) continue;
            seenAdjacent.add(nk);
            const neighbor = workingTileMap.get(nk);
            if (!neighbor || neighbor.terrain === 'mountain') continue;
            const existingEntity = workingEntities.get(nk);
            if (existingEntity && existingEntity !== 'rebel') continue;
            const enemyZoC = getMaxEnemyZoC(nk, aiOwner, workingEntities, workingTileMap);
            if (1 <= enemyZoC) continue; // simple_unit strength = 1
            if (neighbor.owner !== 'neutral' && neighbor.owner !== aiOwner) {
              enemyAdjacentKeys.push(nk);
            } else {
              neutralAdjacentKeys.push(nk);
            }
          }
        }

        type AiPlacement = { key: string; outside: boolean };
        let candidates: AiPlacement[];
        if (enemyAdjacentKeys.length > 0) {
          candidates = enemyAdjacentKeys.map(k => ({ key: k, outside: true }));
        } else if (neutralAdjacentKeys.length > 0) {
          candidates = neutralAdjacentKeys.map(k => ({ key: k, outside: true }));
        } else {
          candidates = vacantInside.map(t => ({ key: t.key, outside: false }));
        }
        if (candidates.length === 0) continue;

        const target = candidates[Math.floor(Math.random() * candidates.length)];
        workingEntities = new Map(workingEntities);
        workingBalances = new Map(workingBalances);

        if (!target.outside) {
          workingEntities.set(target.key, 'simple_unit');
          workingBalances.set(territoryId, balance - 10);
        } else {
          const previousOwner = (workingTileMap.get(target.key)?.owner ?? 'neutral') as TerritoryOwner;
          const prevSnapshot = new Map(workingTileMap);
          workingTileMap = new Map(workingTileMap);
          const targetTile = workingTileMap.get(target.key);
          if (targetTile) workingTileMap.set(target.key, { ...targetTile, owner: aiOwner });
          workingEntities.delete(target.key);
          workingEntities.set(target.key, 'simple_unit');
          workingBalances = recalculateTerritoriesForCapture(
            target.key, aiOwner, previousOwner, prevSnapshot, workingTileMap, workingBalances,
          );
          const mergedTerritory = getContiguousTerritory(workingTileMap, target.key, aiOwner);
          const mergedId = getTerritoryId(mergedTerritory);
          if (mergedId) workingBalances.set(mergedId, (workingBalances.get(mergedId) ?? 0) - 10);
          workingLiveOwnerMap = new Map(workingLiveOwnerMap);
          workingLiveOwnerMap.set(target.key, aiOwner);
          workingSpentUnits = new Set(workingSpentUnits);
          workingSpentUnits.add(target.key);
          setMutableTileMap(new Map(workingTileMap));
          setLiveOwnerMap(new Map(workingLiveOwnerMap));
        }

        setEntities(new Map(workingEntities));
        setTerritoryBalances(new Map(workingBalances));
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

        const isMergeTarget = (k: string) => {
          const t = workingTileMap.get(k);
          if (!t || t.owner !== aiOwner) return false;
          const e = workingEntities.get(k);
          return !!e && ENTITY_META[e].isUnit;
        };

        const attackMoves = allValidMoves.filter(k => {
          const t = workingTileMap.get(k);
          return t && t.owner !== aiOwner;
        });
        const nonMergeMoves = allValidMoves.filter(k => !isMergeTarget(k));
        const movesPool = nonMergeMoves.length > 0 ? nonMergeMoves : allValidMoves;

        let moveTargets: string[];
        if (attackMoves.length > 0) {
          moveTargets = attackMoves;
        } else {
          const nonAiTiles = Array.from(workingTileMap.values()).filter(t => {
            if (t.owner === aiOwner || t.terrain === 'mountain') return false;
            if (t.owner === 'neutral') return true;
            return getMaxEnemyZoC(t.key, aiOwner, workingEntities, workingTileMap) < unitStrength;
          });
          if (nonAiTiles.length === 0) {
            moveTargets = movesPool;
          } else {
            let closestAfterMove = Infinity;
            let bestMoves: string[] = [];
            for (const mk of movesPool) {
              const [mq, mr] = mk.split(',').map(Number);
              let minD = Infinity;
              for (const t of nonAiTiles) {
                const d = hexDistance(mq, mr, t.q, t.r);
                if (d < minD) minD = d;
              }
              if (minD < closestAfterMove) {
                closestAfterMove = minD;
                bestMoves = [mk];
              } else if (minD === closestAfterMove) {
                bestMoves.push(mk);
              }
            }
            moveTargets = bestMoves.length > 0 ? bestMoves : movesPool;
          }
        }

        const destKey = moveTargets[Math.floor(Math.random() * moveTargets.length)];
        const destTile = workingTileMap.get(destKey);
        if (!destTile) continue;

        const previousOwner = destTile.owner;
        const prevTileMapSnapshot = new Map(workingTileMap);
        workingTileMap = new Map(workingTileMap);
        workingTileMap.set(destKey, { ...destTile, owner: aiOwner });
        workingEntities = new Map(workingEntities);
        const destExisting = workingEntities.get(destKey);
        const isAllyMerge = destExisting && ENTITY_META[destExisting].isUnit && destTile.owner === aiOwner;
        if (isAllyMerge) {
          const merged = mergedUnitType(ENTITY_META[unitEntity].strength, ENTITY_META[destExisting].strength);
          workingEntities.delete(unitKey);
          workingEntities.set(destKey, merged);
        } else {
          workingEntities.delete(destKey);
          workingEntities.delete(unitKey);
          workingEntities.set(destKey, unitEntity);
        }
        workingBalances = recalculateTerritoriesForCapture(
          destKey,
          aiOwner,
          previousOwner,
          prevTileMapSnapshot,
          workingTileMap,
          workingBalances,
        );
        workingLiveOwnerMap = new Map(workingLiveOwnerMap);
        workingLiveOwnerMap.set(destKey, aiOwner);
        workingGraveyard = new Set(workingGraveyard);
        workingGraveyard.delete(destKey);

        setMutableTileMap(new Map(workingTileMap));
        setLiveOwnerMap(new Map(workingLiveOwnerMap));
        setEntities(new Map(workingEntities));
        setTerritoryBalances(new Map(workingBalances));
        setGraveyard(new Set(workingGraveyard));
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

    setIsAiTurn(false);
    aiTurnRef.current = false;
    checkWinLoss(workingTileMap);
  }, [aiOwners, checkWinLoss, awaitStep]);

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
    const remaining = partialMoves.get(selectedEntityKey) ?? 3;
    return getValidMoves(selectedEntityKey, 'player', entities, activeTileMap, spentUnits, remaining);
  }, [selectedEntityKey, entities, activeTileMap, spentUnits, partialMoves]);

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
      if (tile.terrain === 'mountain') continue;
      const [q, r] = tile.key.split(',').map(Number);
      for (const { dir: [dq, dr] } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (selectedTileKeys.has(nk)) continue;
        const neighbor = activeTileMap.get(nk);
        if (!neighbor) continue;
        if (neighbor.terrain === 'mountain') continue;
        const existingEntity = entities.get(nk);
        if (existingEntity && existingEntity !== 'rebel') continue;
        const enemyZoC = getMaxEnemyZoC(nk, 'player', entities, activeTileMap);
        if (meta.strength > enemyZoC) result.add(nk);
      }
    }
    return result;
  }, [armedEntityId, selectedTerritory, selectedTileKeys, activeTileMap, entities]);

  const minUnitCost = useMemo(() => {
    return Math.min(...(Object.values(ENTITY_META).filter(m => m.isUnit).map(m => m.cost)));
  }, []);

  const shouldPulseEndTurn = useMemo(() => {
    if (isAiTurn) return false;
    const hasValidMove = Array.from(entities.entries()).some(([key, entityId]) => {
      const meta = ENTITY_META[entityId];
      if (!meta.isUnit) return false;
      const tile = activeTileMap.get(key);
      if (tile?.owner !== 'player') return false;
      if (spentUnits.has(key)) return false;
      const moves = getValidMoves(key, 'player', entities, activeTileMap, spentUnits);
      return moves.size > 0;
    });
    if (hasValidMove) return false;
    const playerTerritoryIds = new Set<string>();
    const visited = new Set<string>();
    for (const tile of Array.from(activeTileMap.values())) {
      if (tile.owner !== 'player' || visited.has(tile.key)) continue;
      const territory = getContiguousTerritory(activeTileMap, tile.key, 'player');
      for (const t of territory) visited.add(t.key);
      const id = getTerritoryId(territory);
      if (id) playerTerritoryIds.add(id);
    }
    const hasAffordableTerritory = Array.from(playerTerritoryIds).some(
      id => (territoryBalances.get(id) ?? 0) >= minUnitCost,
    );
    if (hasAffordableTerritory) return false;
    return true;
  }, [entities, activeTileMap, spentUnits, territoryBalances, minUnitCost, isAiTurn]);

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
    let desertCount = 0;
    let mountainCount = 0;
    let cityCount = 0;
    const upkeepGroupMap = new Map<EntityType, number>();
    let activeGrassCount = 0;
    let activeCityCount = 0;
    for (const t of selectedTerritory) {
      if (t.terrain === 'grass') grassCount++;
      else if (t.terrain === 'desert') desertCount++;
      else if (t.terrain === 'mountain') mountainCount++;
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
    const grassIncome = grassCount;
    const cityIncome = cityCount * CITY_BONUS;
    const totalIncome = grassIncome + cityIncome;
    const totalUpkeep = upkeepGroups.reduce((s, g) => s + g.total, 0);
    let rebelCount = 0;
    let rebelTotalLoss = 0;
    for (const t of selectedTerritory) {
      if (entities.get(t.key) !== 'rebel') continue;
      rebelCount++;
      if (t.isCity || entities.get(t.key) === 'city') rebelTotalLoss += CITY_BONUS;
      else if (t.terrain === 'grass') rebelTotalLoss += 1;
    }
    const net = totalIncome - totalUpkeep - rebelTotalLoss;
    return { grassCount, desertCount, mountainCount, cityCount, grassIncome, cityIncome, upkeepGroups, totalIncome, totalUpkeep, rebelCount, rebelTotalLoss, net };
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
    for (const tile of Array.from(activeTileMap.values())) {
      if (tile.owner !== 'player' || visited.has(tile.key)) continue;
      const territory = getContiguousTerritory(activeTileMap, tile.key, 'player');
      for (const t of territory) visited.add(t.key);
      const id = getTerritoryId(territory);
      if (!id) continue;
      const balance = territoryBalances.get(id) ?? 0;
      if (balance < 10) continue;
      const cityTile = territory.find(t => (t.isCity || entities.get(t.key) === 'city') && entities.get(t.key) !== 'rebel');
      const centralTile = findCentralTile(territory);
      const candidate = cityTile ?? centralTile;
      if (!candidate) continue;
      const target = entities.get(candidate.key) === 'rebel'
        ? territory.find(t => !entities.has(t.key) && t.terrain !== 'mountain') ?? null
        : candidate;
      if (!target) continue;
      keys.add(target.key);
    }
    return keys;
  }, [activeTileMap, territoryBalances, entities]);

  const devEconomicOverlays = useMemo<Array<{ cx: number; cy: number; label: string }>>(() => {
    if (!isDeveloperModeActive) return [];
    const result: Array<{ cx: number; cy: number; label: string }> = [];
    const visited = new Set<string>();
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
        const central = findCentralTile(territory);
        if (!central) continue;
        const pos = tileDataMap.get(central.key);
        if (!pos) continue;
        result.push({ cx: pos.cx, cy: pos.cy, label });
      }
    }
    return result;
  }, [isDeveloperModeActive, aiOwners, activeTileMap, territoryBalances, entities, tileDataMap]);

  const pushHistory = useCallback(() => {
    setMoveHistory(prev => [
      ...prev,
      {
        entities: new Map(entities),
        mutableTileMap: new Map(mutableTileMap),
        territoryBalances: new Map(territoryBalances),
        spentUnits: new Set(spentUnits),
        liveOwnerMap: new Map(liveOwnerMap),
        partialMoves: new Map(partialMoves),
        freeTowerUsedTiles: new Map([...freeTowerUsedTiles.entries()].map(([k, v]) => [k, new Set(v)])),
      },
    ]);
  }, [entities, mutableTileMap, territoryBalances, spentUnits, liveOwnerMap, partialMoves, freeTowerUsedTiles]);

  const handleDeselect = useCallback(() => {
    if (Date.now() - lastTileTapMs.current < 150) return;
    setSelectedTileKey(null);
    setArmedEntityId(null);
    setSelectedEntityKey(null);
    if (ribbonOpen) closeRibbon();
  }, [ribbonOpen]);

  const handleTileTap = useCallback((key: string) => {
    lastTileTapMs.current = Date.now();
    if (isAiTurn || gameResult !== null) return;
    const tile = activeTileMap.get(key);

    if (selectedEntityKey && validMoveTiles.has(key)) {
      pushHistory();
      const prevTile = activeTileMap.get(key);
      const previousOwner = prevTile?.owner ?? 'neutral';
      const newTileMap = new Map(activeTileMap);
      const targetTile = newTileMap.get(key);
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
        activeTileMap.get(key)?.owner === 'player';

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
      const remainingAfterMove = Math.max(0, prevRemaining - stepsUsed);

      const newSpentUnits = new Set(spentUnits);
      const newPartialMoves = new Map(partialMoves);
      newPartialMoves.delete(selectedEntityKey);
      if (isMerge && remainingAfterMove > 0) {
        newPartialMoves.set(key, remainingAfterMove);
      } else {
        newSpentUnits.add(key);
        newPartialMoves.delete(key);
      }

      const { balances: newBalances } = recalculateTerritories(
        key,
        previousOwner as TerritoryOwner,
        activeTileMap,
        newTileMap,
        territoryBalances,
      );

      const newLiveOwnerMap = new Map(liveOwnerMap);
      newLiveOwnerMap.set(key, 'player');

      setMutableTileMap(newTileMap);
      setLiveOwnerMap(newLiveOwnerMap);
      setEntities(newEntities);
      setSpentUnits(newSpentUnits);
      setPartialMoves(newPartialMoves);
      setTerritoryBalances(newBalances);
      setSelectedEntityKey(null);
      setSelectedTileKey(key);
      setGraveyard(prev => { const next = new Set(prev); next.delete(key); return next; });
      if (ribbonOpen) closeRibbon();
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
      const canMerge = armedIsUnit && existingIsAllyUnit;
      const canOverwriteRebel = armedIsUnit && existingOnTile === 'rebel';
      const alreadyOccupied = !!existingOnTile && !canMerge && !canOverwriteRebel;
      if (!alreadyOccupied && selectedTerritoryId) {
        const meta = ENTITY_META[armedEntityId];
        const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
        const placingTower = armedEntityId === 'tower';
        const playerUsedSet = freeTowerUsedTiles.get('player') ?? new Set<string>();
        const towerIsFree = placingTower
          && selectedTerritory.length >= 2
          && !selectedTerritory.some(t => playerUsedSet.has(t.key));
        const effectiveCost = towerIsFree ? 0 : meta.cost;
        if (balance >= effectiveCost) {
          pushHistory();
          const newEntities = new Map(entities);
          const newSpentUnits = new Set(spentUnits);
          const newPartialMoves = new Map(partialMoves);
          if (canMerge) {
            const merged = mergedUnitType(ENTITY_META[armedEntityId].strength, ENTITY_META[existingOnTile!].strength);
            newEntities.set(key, merged);
            const existingRemaining = newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : 3);
            const mergedRemaining = Math.min(3, existingRemaining);
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
        }
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
        const newLiveOwnerMap = new Map(liveOwnerMap);
        newLiveOwnerMap.set(key, 'player');
        setMutableTileMap(newTileMap);
        setLiveOwnerMap(newLiveOwnerMap);
        setEntities(newEntities);
        setTerritoryBalances(newBalances);
        setSpentUnits(prev => { const next = new Set(prev); next.add(key); return next; });
        setArmedEntityId(null);
        setSelectedEntityKey(null);
        closeRibbon();
        setSelectedTileKey(key);
        checkWinLoss(newTileMap);
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
      setSelectedTileKey(null);
      setArmedEntityId(null);
      setSelectedEntityKey(null);
      if (ribbonOpen) closeRibbon();
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
  }, [activeTileMap, selectedTileKeys, armedEntityId, entities, selectedTerritoryId, territoryBalances, ribbonOpen, selectedEntityKey, validMoveTiles, validPlacementAttackTiles, spentUnits, liveOwnerMap, isAiTurn, gameResult, checkWinLoss, pushHistory]);

  const handleUndo = useCallback(() => {
    if (isAiTurn || gameResult !== null) return;
    setMoveHistory(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setEntities(snapshot.entities);
      setMutableTileMap(snapshot.mutableTileMap);
      setTerritoryBalances(snapshot.territoryBalances);
      setSpentUnits(snapshot.spentUnits);
      setLiveOwnerMap(snapshot.liveOwnerMap);
      setPartialMoves(snapshot.partialMoves);
      setFreeTowerUsedTiles(snapshot.freeTowerUsedTiles);
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
      const newBalance = current + income - upkeep;
      if (newBalance < 0) {
        nextBalances.set(territoryId, 0);
        nextEntities = new Map(nextEntities);
        for (const t of territory) {
          const e = nextEntities.get(t.key);
          if (e && ENTITY_META[e].isUnit) {
            nextEntities.delete(t.key);
            nextGraveyard.add(t.key);
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
        const newBalance = current + income - upkeep;
        if (newBalance < 0) {
          nextBalances.set(territoryId, 0);
          nextEntities = new Map(nextEntities);
          for (const t of territory) {
            const e = nextEntities.get(t.key);
            if (e && ENTITY_META[e].isUnit) {
              nextEntities.delete(t.key);
              nextGraveyard.add(t.key);
            }
          }
        } else {
          nextBalances.set(territoryId, newBalance);
        }
      }
    }

    for (const gravKey of Array.from(graveyard)) {
      if (!nextEntities.has(gravKey) && Math.random() < 0.5) {
        nextEntities = new Map(nextEntities);
        nextEntities.set(gravKey, 'rebel');
      }
    }

    const allOwners: TerritoryOwner[] = ['player', 'ai1', 'ai2', 'ai3', 'ai4', 'ai5'];
    const preSpawnEntities = nextEntities;
    const rebelSpawns = new Map(nextEntities);
    for (const tile of Array.from(activeTileMap.values())) {
      if (!allOwners.includes(tile.owner)) continue;
      if (tile.terrain === 'mountain') continue;
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

    setTerritoryBalances(nextBalances);
    setEntities(nextEntities);
    setGraveyard(nextGraveyard);
    setTurn(t => t + 1);
    setSelectedTileKey(null);
    setArmedEntityId(null);
    setSelectedEntityKey(null);
    setSpentUnits(new Set());
    setPartialMoves(new Map());
    closeRibbon();

    if (!checkWinLoss(activeTileMap)) {
      setIsAiTurn(true);
      aiTurnRef.current = true;
      runAiTurn(new Map(activeTileMap), nextEntities, nextBalances);
    }
  }, [activeTileMap, entities, territoryBalances, isAiTurn, gameResult, aiOwners, checkWinLoss, runAiTurn]);

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
    .enabled(Platform.OS !== 'web')
    .onEnd(e => {
      runOnJS(handleBoardTap)(e.x, e.y, translateX.value, translateY.value, scale.value);
    });

  const gesture = Gesture.Simultaneous(panGesture, pinchGesture, tapGesture);

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
                const liveTile = activeTileMap.get(tile.key) ?? tile;
                const isCityZone = tile.cityBuffer || tile.isCity;
                const fill = hasSelection
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
                    onPress={() => handleTileTap(tile.key)}
                  />
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

              {fortificationDots.size > 0 && Array.from(fortificationDots).map(key => {
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

              {Array.from(entities.entries()).map(([key, entityId]) => {
                if (entityId === 'city') return null;
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                const meta = ENTITY_META[entityId];
                const isRebel = entityId === 'rebel';
                const r = HEX_SIZE * 0.38;
                const isSelected = selectedEntityKey === key;
                const isSpent = spentUnits.has(key);
                const liveTile = activeTileMap.get(key);
                const isPlayerUnit = liveTile?.owner === 'player' && meta.isUnit;
                const isIdleBouncing = isPlayerUnit && !isSpent && !isSelected;
                const bgColor = isRebel
                  ? 'rgba(140,20,20,0.92)'
                  : isSpent && isPlayerUnit
                    ? 'rgba(60,60,80,0.85)'
                    : isSelected
                      ? 'rgba(20,80,20,0.95)'
                      : meta.isUnit
                        ? 'rgba(30,50,120,0.9)'
                        : 'rgba(80,40,10,0.9)';
                const strokeColor = isRebel
                  ? '#FF4040'
                  : isSelected
                    ? '#50FF50'
                    : isSpent && isPlayerUnit
                      ? '#888888'
                      : '#FFD700';
                const strokeWidth = isRebel ? 1.8 : isSelected ? 2.5 : 1.2;
                if (isIdleBouncing) return null;
                return (
                  <React.Fragment key={`entity-${key}`}>
                    <Circle
                      cx={pos.cx}
                      cy={pos.cy}
                      r={r}
                      fill={bgColor}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      opacity={isSpent && isPlayerUnit ? 0.6 : 1.0}
                    />
                    <SvgText
                      x={pos.cx}
                      y={pos.cy + r * 0.35}
                      textAnchor="middle"
                      fontSize={r * 1.2}
                      fill="#fff"
                      opacity={isSpent && isPlayerUnit ? 0.5 : 1.0}
                    >
                      {meta.icon}
                    </SvgText>
                    <Polygon
                      points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                      fill="transparent"
                      onPress={() => handleTileTap(key)}
                    />
                  </React.Fragment>
                );
              })}

              {graveyard.size > 0 && Array.from(graveyard).map(key => {
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                if (entities.has(key)) return null;
                const fs = HEX_SIZE * 0.5;
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

              {validMoveTiles.size > 0 && Array.from(validMoveTiles).map(key => {
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                const tileOwner = activeTileMap.get(key)?.owner ?? 'neutral';
                const isAttack = tileOwner !== 'player';
                const dotColor = isAttack ? '#FF4040' : '#FFD700';
                return (
                  <React.Fragment key={`move-${key}`}>
                    <Polygon
                      points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                      fill="transparent"
                      onPress={() => handleTileTap(key)}
                    />
                    <Circle
                      cx={pos.cx}
                      cy={pos.cy}
                      r={HEX_SIZE * 0.18}
                      fill={dotColor}
                      opacity={0.85}
                      onPress={() => handleTileTap(key)}
                    />
                  </React.Fragment>
                );
              })}

              {armedEntityId && ENTITY_META[armedEntityId].isUnit && Array.from(selectedTileKeys).map(key => {
                const existingDot = entities.get(key);
                if (existingDot && existingDot !== 'rebel') return null;
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                return (
                  <Circle
                    key={`place-${key}`}
                    cx={pos.cx}
                    cy={pos.cy}
                    r={HEX_SIZE * 0.15}
                    fill="#FFD700"
                    opacity={0.7}
                  />
                );
              })}

              {armedEntityId && Array.from(validPlacementAttackTiles).map(key => {
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                return (
                  <Circle
                    key={`atk-${key}`}
                    cx={pos.cx}
                    cy={pos.cy}
                    r={HEX_SIZE * 0.18}
                    fill="#FF4040"
                    opacity={0.85}
                  />
                );
              })}

              {isDeveloperModeActive && devEconomicOverlays.map(({ cx, cy, label }, i) => {
                const fontSize = Math.max(7, Math.min(11, HEX_SIZE * 0.32));
                return (
                  <React.Fragment key={`dev-econ-${i}`}>
                    <Rect
                      x={cx - fontSize * label.length * 0.32}
                      y={cy - fontSize * 0.85}
                      width={fontSize * label.length * 0.64}
                      height={fontSize * 1.4}
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
                  </React.Fragment>
                );
              })}

              {Array.from(flagTileKeys).filter(key => !selectedTileKeys.has(key) && (!entities.has(key) || entities.get(key) === 'city')).map(key => {
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

            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
              {Array.from(entities.entries()).map(([key, entityId]) => {
                if (entityId === 'city' || entityId === 'rebel') return null;
                const meta = ENTITY_META[entityId];
                if (!meta.isUnit) return null;
                const liveTile = activeTileMap.get(key);
                if (liveTile?.owner !== 'player') return null;
                if (spentUnits.has(key)) return null;
                if (selectedEntityKey === key) return null;
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                const r = HEX_SIZE * 0.38;
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
                      borderWidth: 1.2,
                      borderColor: '#FFD700',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }, idleBounceStyle]}
                  >
                    <Text style={{ fontSize: r * 1.1, lineHeight: r * 1.6 }}>{meta.icon}</Text>
                  </Animated.View>
                );
              })}
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
            const cityAlreadyBuilt = item.id === 'city' && territoryHasCity;
            const cityTooSmall = item.id === 'city' && selectedTerritory.length < 6;
            const cityLocked = cityAlreadyBuilt || cityTooSmall;
            const isTower = item.id === 'tower';
            const playerUsedTilesSet = freeTowerUsedTiles.get('player') ?? new Set<string>();
            const playerTowerFree = isTower
              && selectedTerritory.length >= 2
              && !selectedTerritory.some(t => playerUsedTilesSet.has(t.key));
            const effectiveCost = playerTowerFree ? 0 : item.cost;
            const affordable = effectiveCost <= selectedTerritoryBalance;
            const enabled = affordable && !cityLocked;
            const costLabel = cityAlreadyBuilt ? 'BUILT'
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
        <Ionicons name="arrow-back" size={14} color="#A08860" />
        <Text style={styles.menuBtnText}>Menu</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.devBtn, isDeveloperModeActive && styles.devBtnActive, { top: topInset + 4, right: 4, position: 'absolute', zIndex: 20 }]}
        onPress={() => setIsDeveloperModeActive(v => !v)}
      >
        <Text style={[styles.devBtnText, isDeveloperModeActive && styles.devBtnTextActive]}>DEV</Text>
      </TouchableOpacity>

      {selectedEntityKey && (() => {
        const entityId = entities.get(selectedEntityKey);
        const isUnit = entityId ? ENTITY_META[entityId].isUnit : false;
        const upgradeTarget = entityId ? UNIT_UPGRADE[entityId] : undefined;
        const canUpgrade = !!upgradeTarget;
        const isSpent = spentUnits.has(selectedEntityKey);
        const entityTile = activeTileMap.get(selectedEntityKey);
        const entityTerritoryId = entityTile
          ? getTerritoryId(getContiguousTerritory(activeTileMap, selectedEntityKey, 'player'))
          : null;
        const entityTerritoryBalance = entityTerritoryId ? (territoryBalances.get(entityTerritoryId) ?? 0) : 0;
        const removeCost = isUnit ? 0 : 10;
        const upgradeEnabled = canUpgrade && entityTerritoryBalance >= 10 && (!isUnit || !isSpent);
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
                setTerritoryBalances(prev => { const next = new Map(prev); next.set(entityTerritoryId, entityTerritoryBalance - 10); return next; });
                setSelectedEntityKey(null);
              }}
            >
              <Text style={[styles.buildBtnText, !upgradeEnabled && styles.buildBtnTextDisabled]}>
                ⬆ Upgrade {canUpgrade ? '(10g)' : '(Max)'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })()}

      <View style={[styles.bottomBar, { paddingBottom: botInset }]}>
        <View style={styles.bottomBarInner}>
          <TouchableOpacity
            style={[styles.undoBtn, (isAiTurn || gameResult !== null || moveHistory.length === 0) && styles.undoBtnDisabled]}
            onPress={handleUndo}
            activeOpacity={(isAiTurn || gameResult !== null || moveHistory.length === 0) ? 1 : 0.75}
            disabled={isAiTurn || gameResult !== null || moveHistory.length === 0}
          >
            <Ionicons
              name="arrow-back"
              size={16}
              color={(isAiTurn || gameResult !== null || moveHistory.length === 0) ? '#3A2E14' : '#C8A24A'}
            />
          </TouchableOpacity>

          {hasSelection && (
            <TouchableOpacity style={styles.creditsDisplay} onPress={() => setShowEconModal(true)} activeOpacity={0.75}>
              <Text style={styles.creditsIcon}>⚜️</Text>
              <Text style={styles.creditsAmount}>{selectedTerritoryBalance}</Text>
              {econBreakdown !== null && (
                <Text style={[styles.creditsNet, econBreakdown.net >= 0 ? styles.creditsNetPos : styles.creditsNetNeg]}>
                  {econBreakdown.net >= 0 ? `+${econBreakdown.net}` : `${econBreakdown.net}`}/turn
                </Text>
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
                <Ionicons
                  name={mode === 'units' ? 'people' : 'shield'}
                  size={14}
                  color={isActive ? '#0D0A06' : canBuild ? '#C8A24A' : '#3A2E14'}
                />
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
              <Ionicons name="arrow-back" size={13} color="#00FF88" />
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
              <Ionicons name="arrow-forward" size={13} color="#00FF88" />
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
                <Ionicons name="arrow-forward" size={13} color="#F0D080" />
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

      <Modal visible={showEconModal} transparent animationType="fade" onRequestClose={() => setShowEconModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowEconModal(false)}>
          <View style={styles.econCard} onStartShouldSetResponder={() => true}>
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
              style={styles.gameResultBtn}
              onPress={() => {
                aiTurnRef.current = false;
                resumeAiRef.current?.();
                resumeAiRef.current = null;
                aiStepHistoryRef.current = [];
                setAiHistoryIndex(-1);
                setAiHistoryLen(0);
                setGameResult(null);
                setIsAiTurn(false);
                setIsDeveloperModeActive(false);
                setIsAiPaused(false);
                setMoveHistory([]);
                setTurn(1);
                setGameKey(k => k + 1);
              }}
            >
              <Text style={styles.gameResultBtnText}>Restart</Text>
            </TouchableOpacity>
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
  creditsNet: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginLeft: 2,
  },
  creditsNetPos: {
    color: '#70C870',
  },
  creditsNetNeg: {
    color: '#E07060',
  },
  spacer: {
    flex: 1,
  },
  undoBtn: {
    height: BTN_H,
    width: BTN_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#9A7830',
    backgroundColor: '#3A2A10',
  },
  undoBtnDisabled: {
    borderColor: '#4A3A1A',
    backgroundColor: '#2A1E08',
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
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#3A3A3A',
    backgroundColor: '#1A1A1A',
  },
  devBtnActive: {
    borderColor: '#00FF88',
    backgroundColor: '#003322',
  },
  devBtnText: {
    fontSize: 10,
    fontFamily: 'Cinzel_700Bold',
    color: '#5A5A5A',
    letterSpacing: 1,
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
