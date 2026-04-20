import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Image as SvgImage,
  Line,
  LinearGradient,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

const MOUNTAIN_IMG = require("../assets/images/mountain.webp");
const WATER_IMG = require("../assets/images/water.webp");

import {
  CITY_NEUTRAL_FILL,
  TERRAIN_FILLS,
  TERRITORY_BORDERS,
  TERRITORY_FILLS,
} from "@/constants/colors";
import type {
  EntityType,
  HexTile,
  TerritoryOwner,
  BorderEdge,
  AiStepSnapshot,
  Difficulty,
  AiState,
  MoveHistorySnapshot,
  GameResult,
} from "@/types";
import {
  HEX_EDGES,
  getBoardBounds,
  hexCornersString,
  hexDistance,
  hexToPixel,
  tileKey,
} from "@/utils/hexMath";
import {
  CITY_BONUS,
  ENTITY_META,
  TERRAIN_INCOME,
  UNIT_UPGRADE,
  calcDefenseUpkeep,
  nextDefenseUpkeep,
  findCentralTile,
  generateHexGrid,
  getContiguousTerritory,
  getMaxEnemyZoC,
  getTerritoryId,
  getValidMoves,
  getMoveCost,
  recalculateTerritories,
  recalculateTerritoriesForCapture,
} from "@/utils/hexGrid";
import {
  BTN_H,
  BOTTOM_BAR_H,
  RIBBON_H,
  ENTITY_PANEL_H,
  EXTRA_PAN,
} from "@/constants/gameConstants";
import {
  calcTerritoryUpkeep,
  applySingleHexPenalty,
  initTerritoryBalances,
  mergedUnitType,
} from "@/logic/gameLogic";
import {
  runAiTurn as runAiTurnOrchestration,
  type AiWorkingState,
  type AiTurnCallbacks,
} from "@/logic/aiStrategy";
import styles from "@/app/gameStyles";
import PurchaseRibbon from "@/components/PurchaseRibbon";
import EntityPanel from "@/components/EntityPanel";
import GameModals from "@/components/GameModals";
import type { EconBreakdown } from "@/components/GameModals";
import { HexCell } from "@/components/HexCell";
import BottomActionMenu from "@/components/BottomActionMenu";
import { DevModeOverlay, DevEconomicSvgOverlays } from "@/components/DevModeOverlay";

import AnimatedMovingUnit from "@/components/AnimatedMovingUnit";
import { EntityLayer } from "@/components/EntityLayer";
import { BorderEdgeLayer } from "@/components/BorderEdgeLayer";
import { MovementHighlightTapTargets } from "@/components/MovementHighlightTapTargets";
import { MovementHighlightLayer } from "@/components/MovementHighlightLayer";
import { FortificationDotLayer } from "@/components/FortificationDotLayer";
import { CityOverlayLayer } from "@/components/CityOverlayLayer";
import { GraveyardLayer } from "@/components/GraveyardLayer";
import { AffordableTerritoryLayer } from "@/components/AffordableTerritoryLayer";
import { LakeImageLayer } from "@/components/LakeImageLayer";
import { MountainImageLayer } from "@/components/MountainImageLayer";
import {
  computeBorderEdges,
  computeOuterTerritoryEdges,
  type BorderEdgesCache,
  type OuterEdgesCache,
} from "@/utils/borderEdges";
import { useSelectionState } from "@/hooks/useSelectionState";
import { handleTileTapLogic } from "@/logic/tileTapHandler";
import { handleEndTurnLogic } from "@/logic/endTurnHandler";

export default function GameScreen() {

  const params = useLocalSearchParams<{
    tileCount: string;
    opponentCount: string;
    difficulty: string;
  }>();
  const numTiles = Math.min(300, Math.max(40, Number(params.tileCount) || 100));
  const numOpponents = Math.min(
    5,
    Math.max(1, Number(params.opponentCount) || 3),
  );
  const aiDifficulty = (params.difficulty as Difficulty) || "medium";
  const aiDifficultyRef = useRef<Difficulty>(aiDifficulty);
  useEffect(() => {
    aiDifficultyRef.current = aiDifficulty;
  }, [aiDifficulty]);

  const aiStateMapRef = useRef<Map<string, AiState>>(new Map());
  const [aiStateMap, setAiStateMap] = useState<Map<string, AiState>>(new Map());
  const { width: SW, height: SH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const topInset = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botInset = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const HEX_SIZE = Math.max(
    20,
    Math.min(42, Math.floor(280 / Math.sqrt(numTiles))),
  );
  const BORDER_W = 4.0;
  const INNER_SIZE = HEX_SIZE - BORDER_W * 0.65 * (2 / Math.sqrt(3));

  const [gameKey, setGameKey] = useState(0);

  const [showSplash, setShowSplash] = useState(true);
  const splashOpacity = useSharedValue(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      splashOpacity.value = withTiming(0, { duration: 600 }, (finished) => {
        if (finished) {
          runOnJS(setShowSplash)(false);
        }
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const splashAnimStyle = useAnimatedStyle(() => ({
    opacity: splashOpacity.value,
  }));

  const tiles = useMemo(
    () => generateHexGrid(numTiles, numOpponents + 1),
    [numTiles, numOpponents, gameKey],
  );

  const tileMap = useMemo(() => {
    const m = new Map<string, HexTile>();
    for (const t of tiles) m.set(t.key, t);
    return m;
  }, [tiles]);

  const bounds = useMemo(
    () => getBoardBounds(tiles, HEX_SIZE),
    [tiles, HEX_SIZE],
  );

  const tileData = useMemo(() => {
    return tiles.map((tile) => {
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

  const [liveOwnerMap, setLiveOwnerMap] = useState<Map<string, TerritoryOwner>>(
    new Map(),
  );
  const [mutableTileMap, setMutableTileMap] = useState<Map<string, HexTile>>(
    new Map(),
  );

  const borderEdgesCache = useRef<BorderEdgesCache>(null);

  const borderEdges = useMemo<BorderEdge[]>(
    () => computeBorderEdges(borderEdgesCache, tileData, tileMap, tileDataMap, mutableTileMap, INNER_SIZE, BORDER_W),
    [tileData, tileMap, tileDataMap, mutableTileMap, INNER_SIZE],
  );

  const outerEdgesCache = useRef<OuterEdgesCache>(null);

  const outerTerritoryEdges = useMemo<BorderEdge[]>(
    () => computeOuterTerritoryEdges(outerEdgesCache, tileData, tileMap, tileDataMap, mutableTileMap, HEX_SIZE),
    [tileData, tileMap, tileDataMap, mutableTileMap, HEX_SIZE],
  );

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
  const [ribbonMode, setRibbonMode] = useState<"units" | "buildings" | null>(
    null,
  );
  const ribbonOpen = ribbonMode !== null;
  const ribbonAnim = useSharedValue(RIBBON_H);
  const ribbonScrollRef = useRef<ScrollView>(null);

  function openRibbon(mode: "units" | "buildings") {
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
  const [territoryBalances, setTerritoryBalances] = useState<
    Map<string, number>
  >(new Map());
  const [turn, setTurn] = useState(1);
  const [selectedEntityKey, setSelectedEntityKey] = useState<string | null>(
    null,
  );
  const [spentUnits, setSpentUnits] = useState<Set<string>>(new Set());
  const [combatSpentUnits, setCombatSpentUnits] = useState<Set<string>>(
    new Set(),
  );
  const [moveHistory, setMoveHistory] = useState<MoveHistorySnapshot[]>([]);
  const [isAiTurn, setIsAiTurn] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult>(null);
  const [showDominancePopup, setShowDominancePopup] = useState(false);
  const dominanceShownRef = useRef(false);
  const aiTurnRef = useRef<boolean>(false);
  const [graveyard, setGraveyard] = useState<Set<string>>(new Set());
  const [ruins, setRuins] = useState<Set<string>>(new Set());
  // cities is completely separate from entities — a permanent Set of tile keys
  // that have a city (pre-placed OR player/AI built). Units can freely occupy
  // city tiles without touching this set. Cities are never removed once placed.
  const [cities, setCities] = useState<Set<string>>(new Set());
  const citiesRef = useRef<Set<string>>(new Set());
  useEffect(() => { citiesRef.current = cities; }, [cities]);
  const [partialMoves, setPartialMoves] = useState<Map<string, number>>(
    new Map(),
  );
  const [isDeveloperModeActive, setIsDeveloperModeActive] = useState(false);
  const [isAiPaused, setIsAiPaused] = useState(false);
  const [isAiTurnDone, setIsAiTurnDone] = useState(false);
  const resumeAiRef = useRef<(() => void) | null>(null);
  const resumeAfterAiRef = useRef<(() => void) | null>(null);
  const isDeveloperModeRef = useRef(false);
  const [freeTowerUsedTiles, setFreeTowerUsedTiles] = useState<
    Map<TerritoryOwner, Set<string>>
  >(new Map());
  const freeTowerUsedTilesRef = useRef<Map<TerritoryOwner, Set<string>>>(
    new Map(),
  );
  const [lakeUnitFunds, setLakeUnitFunds] = useState<Map<string, number>>(
    new Map(),
  );
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
  const sliderTrackPageX = useRef(0);

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

  const triggerUnitAnimation = useCallback(
    (
      fromKey: string,
      toKey: string,
      entityId: EntityType,
      owner: TerritoryOwner = "player",
      hideDestination = true,
      onDone?: () => void,
    ) => {
      animUnitProgress.value = 0;
      setAnimatingUnit({ fromKey, toKey, entityId, owner, hideDestination });
      const handleDone = () => {
        onDone?.();
        setAnimatingUnit(null);
      };
      animUnitProgress.value = withTiming(
        1,
        { duration: 280, easing: Easing.inOut(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(handleDone)();
        },
      );
    },
    [animUnitProgress],
  );

  useEffect(
    () => () => {
      if (errorTileTimer.current) clearTimeout(errorTileTimer.current);
    },
    [],
  );

  useEffect(() => {
    freeTowerUsedTilesRef.current = freeTowerUsedTiles;
  }, [freeTowerUsedTiles]);
  useEffect(() => {
    lakeUnitFundsRef.current = lakeUnitFunds;
  }, [lakeUnitFunds]);
  useEffect(() => {
    graveyardRef.current = graveyard;
  }, [graveyard]);
  useEffect(() => {
    ruinsRef.current = ruins;
  }, [ruins]);

  const aiStepHistoryRef = useRef<AiStepSnapshot[]>([]);
  const [aiHistoryIndex, setAiHistoryIndex] = useState(-1);
  const [aiHistoryLen, setAiHistoryLen] = useState(0);

  useEffect(() => {
    isDeveloperModeRef.current = isDeveloperModeActive;
    if (!isDeveloperModeActive && isAiPaused) {
      resumeAiRef.current?.();
      resumeAiRef.current = null;
    }
    if (!isDeveloperModeActive && isAiTurnDone) {
      resumeAfterAiRef.current?.();
      resumeAfterAiRef.current = null;
    }
  }, [isDeveloperModeActive, isAiPaused, isAiTurnDone]);

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

  const handleEndAiTurn = useCallback(() => {
    resumeAfterAiRef.current?.();
    resumeAfterAiRef.current = null;
  }, []);

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
    return () => {
      cancelAnimation(idleBounceY);
    };
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
      // Cities are tracked purely via the cities Set<string> (permanent tile keys).
      // No "city" entity is stored in the entities map — units can occupy city
      // tiles without erasing the city, and built cities work identically.
      const initialCities = new Set(tiles.filter((t) => t.isCity).map((t) => t.key));
      setCities(initialCities);
      const owners: TerritoryOwner[] = [
        "player",
        "ai1",
        "ai2",
        "ai3",
        "ai4",
        "ai5",
      ];
      for (const tile of tiles) {
        if (!owners.includes(tile.owner)) continue;
        if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
        if (initialEntities.has(tile.key)) continue;
        if (Math.random() < 0.1) {
          initialEntities.set(tile.key, "rebel");
        }
      }
      setEntities(initialEntities);
    }
  }, [tiles, tileMap]);

  const activeTileMap = mutableTileMap.size > 0 ? mutableTileMap : tileMap;

  const aiOwners = useMemo<TerritoryOwner[]>(() => {
    const all: TerritoryOwner[] = ["ai1", "ai2", "ai3", "ai4", "ai5"];
    return all.slice(0, numOpponents);
  }, [numOpponents]);

  const checkWinLoss = useCallback(
    (currentTileMap: Map<string, HexTile>) => {
      const playerTiles = Array.from(currentTileMap.values()).filter(
        (t) => t.owner === "player",
      );
      if (playerTiles.length === 0) {
        setGameResult("defeat");
        return true;
      }
      const allAiEliminated = aiOwners.every(
        (ai) =>
          !Array.from(currentTileMap.values()).some(
            (t) => t.owner === ai && t.terrain !== "lake",
          ),
      );
      if (allAiEliminated) {
        setGameResult("victory");
        return true;
      }
      // 70% dominance check — show once per game
      if (!dominanceShownRef.current) {
        const playableTiles = Array.from(currentTileMap.values()).filter(
          (t) => t.terrain !== "mountain" && t.terrain !== "lake",
        );
        const playerPlayable = playableTiles.filter(
          (t) => t.owner === "player",
        ).length;
        if (
          playableTiles.length > 0 &&
          playerPlayable / playableTiles.length >= 0.7
        ) {
          dominanceShownRef.current = true;
          setShowDominancePopup(true);
        }
      }
      return false;
    },
    [aiOwners],
  );

  const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

  const awaitStep = useCallback(async (afterSnap: AiStepSnapshot) => {
    const newHistory = [...aiStepHistoryRef.current, afterSnap];
    aiStepHistoryRef.current = newHistory;
    const newIdx = newHistory.length - 1;
    setAiHistoryIndex(newIdx);
    setAiHistoryLen(newHistory.length);
    if (isDeveloperModeRef.current) {
      setIsAiPaused(true);
      await new Promise<void>((resolve) => {
        resumeAiRef.current = resolve;
      });
      resumeAiRef.current = null;
      setIsAiPaused(false);
    } else {
      await delay(200);
    }
  }, []);

  const runAiTurn = useCallback(
    async (
      currentTileMap: Map<string, HexTile>,
      currentEntities: Map<string, EntityType>,
      currentBalances: Map<string, number>,
      initialLakeFunds?: Map<string, number>,
      currentTurn?: number,
      initialGraveyard?: Set<string>,
      initialRuins?: Set<string>,
      initialCities?: Set<string>,
    ) => {
      const ws: AiWorkingState = {
        tileMap: new Map(currentTileMap),
        entities: new Map(currentEntities),
        balances: new Map(currentBalances),
        liveOwnerMap: new Map<string, TerritoryOwner>(),
        graveyard: new Set(initialGraveyard ?? graveyardRef.current),
        ruins: new Set(initialRuins ?? ruinsRef.current),
        cities: new Set(initialCities ?? citiesRef.current),
        spentUnits: new Set<string>(),
        partialMoves: new Map<string, number>(),
        freeTowerUsed: new Map(freeTowerUsedTilesRef.current),
        lakeFunds: new Map(initialLakeFunds ?? lakeUnitFundsRef.current),
      };

      const cbs: AiTurnCallbacks = {
        state: {
          setEntities,
          setMutableTileMap,
          setTerritoryBalances,
          setGraveyard,
          setRuins,
          setLiveOwnerMap,
          setCities,
          setFreeTowerUsedTiles,
          setAiStateMap,
          setLakeUnitFunds,
          setIsAiTurn,
        },
        refs: {
          getAiStateMap: () => aiStateMapRef.current,
          setAiStateMap: (v) => { aiStateMapRef.current = v; },
          isTurnActive: () => aiTurnRef.current,
          isDeveloperMode: () => isDeveloperModeRef.current,
          setAiTurn: (v) => { aiTurnRef.current = v; },
        },
        initStepHistory: (snap) => {
          aiStepHistoryRef.current = [snap];
          setAiHistoryIndex(0);
          setAiHistoryLen(1);
        },
        awaitStep,
        awaitPreAiResume: async () => {
          if (isDeveloperModeRef.current) {
            setIsAiPaused(true);
            await new Promise<void>((resolve) => {
              resumeAiRef.current = resolve;
            });
            resumeAiRef.current = null;
            setIsAiPaused(false);
          }
        },
        awaitPostAiResume: async () => {
          if (isDeveloperModeRef.current) {
            setIsAiTurnDone(true);
            await new Promise<void>((resolve) => {
              resumeAfterAiRef.current = resolve;
            });
            resumeAfterAiRef.current = null;
            setIsAiTurnDone(false);
          }
        },
        triggerUnitAnimation,
        recalculateTerritoriesForCapture,
        applySingleHexPenalty,
        checkWinLoss,
      };

      await runAiTurnOrchestration(ws, cbs, aiOwners, currentTurn ?? 0, aiDifficultyRef.current);
    },
    [aiOwners, checkWinLoss, awaitStep, triggerUnitAnimation],
  );

  const {
    selectedTerritory,
    selectedTerritoryId,
    selectedTerritoryBalance,
    selectedTileKeys,
    selectedTerritoryDefenseCounts,
    validMoveTiles,
    fortificationDots,
    validPlacementAttackTiles,
    minUnitCost,
    territoryHasCity,
    selectionBorderEdges,
    affordableTerritoryTileKeys,
  } = useSelectionState({
    selectedTileKey,
    selectedEntityKey,
    armedEntityId,
    activeTileMap,
    entities,
    spentUnits,
    combatSpentUnits,
    partialMoves,
    territoryBalances,
    cities,
    freeTowerUsedTiles,
    isAiTurn,
    gameResult,
    turn,
    tileDataMap,
    tileMap,
    INNER_SIZE,
    BORDER_W,
  });

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
    )
      return;
    prevPulseInputs.current = {
      entities,
      activeTileMap,
      spentUnits,
      territoryBalances,
      freeTowerUsedTiles,
      isAiTurn,
      turn,
    };
    startPulseTransition(() => {
      if (isAiTurn) {
        setShouldPulseEndTurn(false);
        return;
      }
      const hasValidMove = Array.from(entities.entries()).some(
        ([key, entityId]) => {
          const meta = ENTITY_META[entityId];
          if (!meta.isUnit) return false;
          const tile = activeTileMap.get(key);
          if (tile?.owner !== "player") return false;
          if (spentUnits.has(key)) return false;
          const moves = getValidMoves(
            key,
            "player",
            entities,
            activeTileMap,
            spentUnits,
          );
          return moves.size > 0;
        },
      );
      if (hasValidMove) {
        setShouldPulseEndTurn(false);
        return;
      }
      const playerFreeTowerUsed =
        freeTowerUsedTiles.get("player") ?? new Set<string>();
      const visited = new Set<string>();
      for (const tile of Array.from(activeTileMap.values())) {
        if (tile.owner !== "player" || visited.has(tile.key)) continue;
        const territory = getContiguousTerritory(
          activeTileMap,
          tile.key,
          "player",
        );
        for (const t of territory) visited.add(t.key);
        const id = getTerritoryId(territory);
        if (!id) continue;
        const balance = territoryBalances.get(id) ?? 0;
        const towerFree =
          territory.length >= 2 &&
          !territory.some((t) => playerFreeTowerUsed.has(t.key));
        const canAfford = turn === 1 ? towerFree : balance >= minUnitCost;
        if (canAfford) {
          setShouldPulseEndTurn(false);
          return;
        }
      }
      setShouldPulseEndTurn(true);
    });
  }, [
    entities,
    activeTileMap,
    spentUnits,
    territoryBalances,
    minUnitCost,
    isAiTurn,
    freeTowerUsedTiles,
    turn,
  ]);

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
    return () => {
      cancelAnimation(pulseVal);
    };
  }, [shouldPulseEndTurn, armedEntityId, ribbonOpen]);

  const canBuild = selectedTerritory.length > 0;

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
      if (t.terrain === "grass") grassCount++;
      else if (t.terrain === "forest") forestCount++;
      else if (t.terrain === "desert") desertCount++;
      else if (t.terrain === "mountain") mountainCount++;
      else if (t.terrain === "lake") lakeCount++;
      const entityId = entities.get(t.key);
      const hasRebel = entityId === "rebel";
      const isCity = cities.has(t.key);
      if (isCity) cityCount++;
      if (!hasRebel) {
        if (t.terrain === "grass") activeGrassCount++;
        if (isCity) activeCityCount++;
      }
      if (entityId && entityId !== "rebel") {
        const meta = ENTITY_META[entityId];
        if (meta.upkeep > 0) {
          upkeepGroupMap.set(entityId, (upkeepGroupMap.get(entityId) ?? 0) + 1);
        }
      }
    }
    const UPKEEP_ORDER: EntityType[] = [
      "simple_unit",
      "advanced_unit",
      "expert_unit",
      "tower",
      "castle",
    ];
    const upkeepGroups = UPKEEP_ORDER.filter((type) =>
      upkeepGroupMap.has(type),
    ).map((type) => {
      const count = upkeepGroupMap.get(type)!;
      const meta = ENTITY_META[type];
      const isDefense = type === "tower" || type === "castle";
      const total = isDefense
        ? calcDefenseUpkeep(type as "tower" | "castle", count)
        : meta.upkeep * count;
      const mostExpensiveCost = isDefense
        ? nextDefenseUpkeep(type as "tower" | "castle", count - 1)
        : null;
      return {
        icon: meta.icon,
        name: meta.name,
        count,
        upkeepPerUnit: isDefense ? null : meta.upkeep,
        mostExpensiveCost,
        total,
      };
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
      if (entities.get(t.key) !== "rebel") continue;
      rebelCount++;
      rebelTotalLoss += TERRAIN_INCOME[t.terrain];
    }
    const net = totalIncome - totalUpkeep - rebelTotalLoss;
    return {
      grassCount,
      forestCount,
      desertCount,
      cityCount,
      grassIncome,
      forestIncome,
      desertIncome,
      cityIncome,
      upkeepGroups,
      totalIncome,
      totalUpkeep,
      rebelCount,
      rebelTotalLoss,
      net,
    };
  }, [selectedTerritory, entities, cities]);

  const hasAffordableTerritories = affordableTerritoryTileKeys.size > 0;
  useEffect(() => {
    if (
      hasAffordableTerritories &&
      !armedEntityId &&
      !isAiTurn &&
      gameResult === null
    ) {
      territoryPulseVal.value = withRepeat(
        withTiming(0.28, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(territoryPulseVal);
      territoryPulseVal.value = withTiming(0, { duration: 300 });
    }
    return () => {
      cancelAnimation(territoryPulseVal);
    };
  }, [hasAffordableTerritories, armedEntityId, isAiTurn, gameResult]);

  const devEconomicOverlays = useMemo<
    Array<{ cx: number; cy: number; label: string; aiLabel?: string }>
  >(() => {
    if (!isDeveloperModeActive) return [];
    const result: Array<{
      cx: number;
      cy: number;
      label: string;
      aiLabel?: string;
    }> = [];
    const visited = new Set<string>();
    const diffLabel =
      aiDifficulty === "super_hard"
        ? "S.Hrd"
        : aiDifficulty === "hard"
          ? "Hrd"
          : aiDifficulty === "medium"
            ? "Med"
            : aiDifficulty === "easy"
              ? "Esy"
              : "S.Esy";
    for (const aiOwner of aiOwners) {
      for (const tile of Array.from(activeTileMap.values())) {
        if (tile.owner !== aiOwner || visited.has(tile.key)) continue;
        const territory = getContiguousTerritory(
          activeTileMap,
          tile.key,
          aiOwner,
        );
        for (const t of territory) visited.add(t.key);
        const territoryId = getTerritoryId(territory);
        if (!territoryId) continue;
        const balance = territoryBalances.get(territoryId) ?? 0;
        const income = territory.reduce((s, t) => {
          if (entities.get(t.key) === "rebel") return s;
          return (
            s +
            TERRAIN_INCOME[t.terrain] +
            (cities.has(t.key) ? CITY_BONUS : 0)
          );
        }, 0);
        const upkeep = calcTerritoryUpkeep(territory, entities);
        const net = income - upkeep;
        const label = net >= 0 ? `${balance}(+${net})` : `${balance}(${net})`;
        const stateVal = aiStateMap.get(territoryId);
        const stateLabel = stateVal === "attacking" ? "Atk" : "Def";
        const aiLabel = `${diffLabel}·${stateLabel}`;
        const central = findCentralTile(territory);
        if (!central) continue;
        // Pick label position: vacant tile closest to center → tower tile → central tile
        const [centQ, centR] = central.key.split(",").map(Number);
        const vacantTiles = territory.filter(
          (t) =>
            t.terrain !== "mountain" &&
            t.terrain !== "lake" &&
            !entities.has(t.key),
        );
        const towerTiles = territory.filter(
          (t) => entities.get(t.key) === "tower",
        );
        const labelCandidates =
          vacantTiles.length > 0
            ? vacantTiles
            : towerTiles.length > 0
              ? towerTiles
              : [central];
        let labelTile = labelCandidates[0];
        let labelDist = hexDistance(centQ, centR, labelTile.q, labelTile.r);
        for (const t of labelCandidates) {
          const d = hexDistance(centQ, centR, t.q, t.r);
          if (d < labelDist) {
            labelDist = d;
            labelTile = t;
          }
        }
        const pos = tileDataMap.get(labelTile.key);
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
  }, [
    isDeveloperModeActive,
    aiOwners,
    activeTileMap,
    territoryBalances,
    entities,
    tileDataMap,
    lakeUnitFunds,
    aiDifficulty,
    aiStateMap,
  ]);

  const pushHistory = useCallback(() => {
    setMoveHistory((prev) => [
      ...prev,
      {
        entities: new Map(entities),
        cities: new Set(cities),
        mutableTileMap: new Map(mutableTileMap),
        territoryBalances: new Map(territoryBalances),
        spentUnits: new Set(spentUnits),
        combatSpentUnits: new Set(combatSpentUnits),
        liveOwnerMap: new Map(liveOwnerMap),
        partialMoves: new Map(partialMoves),
        freeTowerUsedTiles: new Map(
          [...freeTowerUsedTiles.entries()].map(([k, v]) => [k, new Set(v)]),
        ),
        lakeUnitFunds: new Map(lakeUnitFunds),
        selectedTileKey,
      },
    ]);
  }, [
    entities,
    cities,
    mutableTileMap,
    territoryBalances,
    spentUnits,
    combatSpentUnits,
    liveOwnerMap,
    partialMoves,
    freeTowerUsedTiles,
    lakeUnitFunds,
    selectedTileKey,
  ]);

  const handleDeselect = useCallback(() => {
    if (Date.now() - lastTileTapMs.current < 150) return;
    setSelectedTileKey(null);
    setArmedEntityId(null);
    setSelectedEntityKey(null);
    if (ribbonOpen) closeRibbon();
  }, [ribbonOpen]);

  const commitPendingLakeMove = useCallback(
    (transferAmount: number) => {
      if (!pendingLakeMove) return;
      const { fromKey, toKey, sourceTerrId, maxAmount, minAmount } =
        pendingLakeMove;
      const amount = Math.min(maxAmount, Math.max(minAmount, transferAmount));
      setPendingLakeMove(null);

      pushHistory();
      const destTile = activeTileMap.get(toKey);
      const previousOwner = destTile?.owner ?? "neutral";
      const newTileMap = new Map(activeTileMap);
      if (destTile) newTileMap.set(toKey, { ...destTile, owner: "player" });

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
      newBalances.set(
        sourceTerrId,
        (newBalances.get(sourceTerrId) ?? 0) - amount,
      );

      const newLiveOwnerMap = new Map(liveOwnerMap);
      newLiveOwnerMap.set(toKey, "player");

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
      setGraveyard((prev) => {
        const next = new Set(prev);
        next.delete(toKey);
        return next;
      });
      checkWinLoss(newTileMap);
      if (ribbonOpen) closeRibbon();
      if (movingUnit) {
        triggerUnitAnimation(fromKey, toKey, movingUnit);
      }
    },
    [
      pendingLakeMove,
      activeTileMap,
      entities,
      spentUnits,
      partialMoves,
      territoryBalances,
      liveOwnerMap,
      lakeUnitFunds,
      pushHistory,
      ribbonOpen,
      checkWinLoss,
      triggerUnitAnimation,
    ],
  );

  const handleTileTap = useCallback(
    (key: string) => {
      handleTileTapLogic({
        key,
        lastTileTapMs,
        isAiTurn,
        gameResult,
        activeTileMap,
        selectedEntityKey,
        validMoveTiles,
        armedEntityId,
        selectedTileKeys,
        selectedTerritoryId,
        selectedTerritory,
        entities,
        territoryBalances,
        freeTowerUsedTiles,
        turn,
        graveyard,
        ruins,
        liveOwnerMap,
        lakeUnitFunds,
        combatSpentUnits,
        spentUnits,
        partialMoves,
        validPlacementAttackTiles,
        ribbonOpen,
        cities,
        setMutableTileMap,
        setLiveOwnerMap,
        setEntities,
        setSpentUnits,
        setCombatSpentUnits,
        setPartialMoves,
        setTerritoryBalances,
        setLakeUnitFunds,
        setSelectedEntityKey,
        setSelectedTileKey,
        setGraveyard,
        setRuins,
        setArmedEntityId,
        setFreeTowerUsedTiles,
        setLakeTransferAmount,
        setPendingLakeMove,
        setCities,
        checkWinLoss,
        pushHistory,
        triggerErrorFlash,
        triggerUnitAnimation,
        closeRibbon,
      });
    },
    [
      activeTileMap,
      selectedTileKeys,
      armedEntityId,
      entities,
      selectedTerritoryId,
      selectedTerritory,
      territoryBalances,
      ribbonOpen,
      selectedEntityKey,
      validMoveTiles,
      validPlacementAttackTiles,
      spentUnits,
      combatSpentUnits,
      liveOwnerMap,
      lakeUnitFunds,
      isAiTurn,
      gameResult,
      graveyard,
      ruins,
      turn,
      freeTowerUsedTiles,
      cities,
      checkWinLoss,
      pushHistory,
      triggerErrorFlash,
      triggerUnitAnimation,
      closeRibbon,
    ],
  );

  const handleUndo = useCallback(() => {
    if (isAiTurn || gameResult !== null) return;
    setMoveHistory((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setEntities(snapshot.entities);
      setCities(snapshot.cities ?? new Set());
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
    handleEndTurnLogic({
      isAiTurn,
      gameResult,
      territoryBalances,
      entities,
      turn,
      activeTileMap,
      cities,
      aiOwners,
      aiDifficulty,
      graveyard,
      ruins,
      mutableTileMap,
      liveOwnerMap,
      lakeUnitFunds,
      aiTurnRef,
      setMoveHistory,
      setTerritoryBalances,
      setEntities,
      setGraveyard,
      setRuins,
      setLakeUnitFunds,
      setMutableTileMap,
      setLiveOwnerMap,
      setTurn,
      setSelectedTileKey,
      setArmedEntityId,
      setSelectedEntityKey,
      setSpentUnits,
      setCombatSpentUnits,
      setPartialMoves,
      setIsAiTurn,
      checkWinLoss,
      runAiTurn,
      closeRibbon,
    });
  }, [
    activeTileMap,
    entities,
    territoryBalances,
    lakeUnitFunds,
    mutableTileMap,
    liveOwnerMap,
    isAiTurn,
    gameResult,
    aiOwners,
    aiDifficulty,
    graveyard,
    ruins,
    turn,
    cities,
    checkWinLoss,
    runAiTurn,
    closeRibbon,
  ]);

  // React Native scales around the element's centre, so the board's screen edges are:
  //   left  = tx + boardW/2 - scaledW/2
  //   right = tx + boardW/2 + scaledW/2
  //   top   = ty + boardH/2 - scaledH/2
  //   bottom= ty + boardH/2 + scaledH/2
  // Solving for tx/ty that keeps each edge inside the viewport gives the ranges below.
  const clampXY = (x: number, y: number, s: number) => {
    "worklet";
    const scaledW = boardW * s;
    const scaledH = boardH * s;
    // centred position keeps board centre aligned with viewport centre (independent of scale)
    const centeredX = (SW - boardW) / 2;
    const centeredY = topInset + (availH - boardH) / 2;
    let clampedX: number;
    let clampedY: number;
    if (scaledW <= SW) {
      clampedX = Math.max(
        centeredX - EXTRA_PAN,
        Math.min(centeredX + EXTRA_PAN, x),
      );
    } else {
      clampedX = Math.max(
        SW - (boardW + scaledW) / 2 - EXTRA_PAN,
        Math.min((scaledW - boardW) / 2 + EXTRA_PAN, x),
      );
    }
    if (scaledH <= availH) {
      clampedY = Math.max(
        centeredY - EXTRA_PAN,
        Math.min(centeredY + EXTRA_PAN, y),
      );
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
    .onUpdate((e) => {
      const raw = {
        x: savedX.value + e.translationX,
        y: savedY.value + e.translationY,
      };
      const clamped = clampXY(raw.x, raw.y, scale.value);
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
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

  const handleBoardTap = useCallback(
    (touchX: number, touchY: number, tx: number, ty: number, s: number) => {
      const boardX = boardW / 2 + (touchX - tx - boardW / 2) / s;
      const boardY = boardH / 2 + (touchY - ty - boardH / 2) / s;
      const hx = boardX + bounds.minX;
      const hy = boardY + bounds.minY;
      const fq = ((2 / 3) * hx) / HEX_SIZE;
      const fr = hy / (HEX_SIZE * Math.sqrt(3)) - fq / 2;
      const fs = -fq - fr;
      let rq = Math.round(fq);
      let rr = Math.round(fr);
      let rs = Math.round(fs);
      const qd = Math.abs(rq - fq),
        rd = Math.abs(rr - fr),
        sd = Math.abs(rs - fs);
      if (qd > rd && qd > sd) rq = -rr - rs;
      else if (rd > sd) rr = -rq - rs;
      const key = tileKey(rq, rr);
      if (activeTileMap.has(key)) handleTileTap(key);
      else handleDeselect();
    },
    [
      boardW,
      boardH,
      bounds,
      HEX_SIZE,
      activeTileMap,
      handleTileTap,
      handleDeselect,
    ],
  );

  const tapGesture = Gesture.Tap()
    .maxDistance(5)
    .onEnd((e) => {
      runOnJS(handleBoardTap)(
        e.x,
        e.y,
        translateX.value,
        translateY.value,
        scale.value,
      );
    });

  const gesture = Gesture.Race(
    tapGesture,
    Gesture.Simultaneous(panGesture, pinchGesture),
  );

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
    if (t?.terrain !== "lake") return null;
    return lakeUnitFunds.has(selectedTileKey)
      ? (lakeUnitFunds.get(selectedTileKey) ?? null)
      : null;
  }, [selectedTileKey, activeTileMap, lakeUnitFunds]);
  const showCredits = hasSelection || selectedLakeFund !== null;
  const creditsDisplayValue =
    selectedLakeFund !== null ? selectedLakeFund : selectedTerritoryBalance;
  const selectedLakeEntity = selectedTileKey
    ? entities.get(selectedTileKey)
    : undefined;
  const lakeUpkeepPerTurn =
    selectedLakeFund !== null &&
    selectedLakeEntity &&
    ENTITY_META[selectedLakeEntity].isUnit
      ? ENTITY_META[selectedLakeEntity].upkeep
      : null;

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

          <Animated.View
            style={[styles.board, boardStyle, styles.boardElevated]}
          >
            <Svg width={boardW} height={boardH}>
              <Rect
                x={0}
                y={0}
                width={boardW}
                height={boardH}
                fill="transparent"
              />
              {tileData.map(({ tile, cx, cy }) => {
                const liveTile = activeTileMap.get(tile.key) ?? tile;
                const isCityZone = tile.cityBuffer || cities.has(tile.key);
                const liveOwner = liveTile.owner;
                const terrain = tile.terrain;
                const fill =
                  terrain === "lake"
                    ? "#5BAFD6"
                    : hasSelection
                      ? (TERRAIN_FILLS[terrain] ?? TERRAIN_FILLS.grass)
                      : terrain === "mountain"
                        ? TERRAIN_FILLS.mountain
                        : isCityZone && liveOwner === "neutral"
                          ? CITY_NEUTRAL_FILL
                          : (TERRITORY_FILLS[liveOwner] ?? TERRITORY_FILLS.neutral);
                return (
                  <HexCell
                    key={tile.key}
                    tileKey={tile.key}
                    cx={cx}
                    cy={cy}
                    hexSize={HEX_SIZE}
                    fill={fill}
                  />
                );
              })}

              <LakeImageLayer tileData={tileData} HEX_SIZE={HEX_SIZE} />

              <MountainImageLayer tileData={tileData} HEX_SIZE={HEX_SIZE} />

              <CityOverlayLayer
                cities={cities}
                activeTileMap={activeTileMap}
                tileDataMap={tileDataMap}
                HEX_SIZE={HEX_SIZE}
              />

              <BorderEdgeLayer
                outerEdges={outerTerritoryEdges}
                innerEdges={borderEdges}
                hasSelection={hasSelection}
                selectionEdges={selectionBorderEdges}
              />

              <GraveyardLayer
                graveyard={graveyard}
                ruins={ruins}
                entities={entities}
                tileDataMap={tileDataMap}
                HEX_SIZE={HEX_SIZE}
              />

              <MovementHighlightTapTargets
                validMoveTiles={validMoveTiles}
                validPlacementAttackTiles={validPlacementAttackTiles}
                armedEntityId={armedEntityId}
                tileDataMap={tileDataMap}
                HEX_SIZE={HEX_SIZE}
              />

            </Svg>

            <AffordableTerritoryLayer
              affordableTerritoryTileKeys={affordableTerritoryTileKeys}
              tileDataMap={tileDataMap}
              activeTileMap={activeTileMap}
              boardW={boardW}
              boardH={boardH}
              HEX_SIZE={HEX_SIZE}
              territoryPulseStyle={territoryPulseStyle}
            />

            {errorTileKey && (() => {
              const pos = tileDataMap.get(errorTileKey);
              if (!pos) return null;
              return (
                <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                  <Svg width={boardW} height={boardH}>
                    <Polygon
                      points={hexCornersString(pos.cx, pos.cy, HEX_SIZE)}
                      fill="rgba(0,0,0,0.55)"
                    />
                  </Svg>
                </View>
              );
            })()}

            <EntityLayer
              entities={entities}
              tileDataMap={tileDataMap}
              activeTileMap={activeTileMap}
              selectedEntityKey={selectedEntityKey}
              spentUnits={spentUnits}
              animatingUnit={animatingUnit}
              boardW={boardW}
              boardH={boardH}
              HEX_SIZE={HEX_SIZE}
            />

            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
              {animatingUnit &&
                (() => {
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
                if (entityId === "city" || entityId === "rebel") return null;
                if (animatingUnit && key === animatingUnit.fromKey) return null;
                if (
                  animatingUnit &&
                  animatingUnit.hideDestination &&
                  key === animatingUnit.toKey
                )
                  return null;
                const meta = ENTITY_META[entityId];
                if (!meta.isUnit) return null;
                const liveTile = activeTileMap.get(key);
                if (liveTile?.owner !== "player") return null;
                if (spentUnits.has(key)) return null;
                if (selectedEntityKey === key) return null;
                const pos = tileDataMap.get(key);
                if (!pos) return null;
                const r = HEX_SIZE * 0.5;
                return (
                  <Animated.View
                    key={`bounce-${key}`}
                    style={[
                      {
                        position: "absolute",
                        left: pos.cx - r,
                        top: pos.cy - r,
                        width: r * 2,
                        height: r * 2,
                        borderRadius: r,
                        backgroundColor: "rgba(30,50,120,0.9)",
                        borderWidth: 2.2,
                        borderColor: TERRITORY_BORDERS["player"],
                        alignItems: "center",
                        justifyContent: "center",
                      },
                      idleBounceStyle,
                    ]}
                  >
                    <Text style={{ fontSize: r * 1.1, lineHeight: r * 1.6 }}>
                      {meta.icon}
                    </Text>
                  </Animated.View>
                );
              })}
            </View>

            <FortificationDotLayer
              fortificationDots={fortificationDots}
              tileDataMap={tileDataMap}
              boardW={boardW}
              boardH={boardH}
              HEX_SIZE={HEX_SIZE}
            />

            <MovementHighlightLayer
              validMoveTiles={validMoveTiles}
              validPlacementAttackTiles={validPlacementAttackTiles}
              selectedTileKeys={selectedTileKeys}
              armedEntityId={armedEntityId}
              entities={entities}
              activeTileMap={activeTileMap}
              graveyard={graveyard}
              fortificationDots={fortificationDots}
              tileDataMap={tileDataMap}
              boardW={boardW}
              boardH={boardH}
              HEX_SIZE={HEX_SIZE}
            />

            <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
              <Svg width={boardW} height={boardH}>
                <DevEconomicSvgOverlays
                  isDeveloperModeActive={isDeveloperModeActive}
                  devEconomicOverlays={devEconomicOverlays}
                  hexSize={HEX_SIZE}
                />
              </Svg>
            </View>
          </Animated.View>
        </View>
      </GestureDetector>

      <PurchaseRibbon
        ribbonStyle={ribbonStyle}
        ribbonScrollRef={ribbonScrollRef}
        ribbonMode={ribbonMode}
        botInset={botInset}
        selectedEntityKey={selectedEntityKey}
        turn={turn}
        selectedTerritory={selectedTerritory}
        selectedTerritoryBalance={selectedTerritoryBalance}
        selectedTerritoryDefenseCounts={selectedTerritoryDefenseCounts}
        territoryHasCity={territoryHasCity}
        freeTowerUsedTiles={freeTowerUsedTiles}
        armedEntityId={armedEntityId}
        setArmedEntityId={setArmedEntityId}
      />

      <TouchableOpacity
        style={[
          styles.menuBtn,
          { top: topInset + 4, left: 4, position: "absolute", zIndex: 20 },
        ]}
        onPress={() => setConfirmLeave(true)}
      >
        <Text style={{ fontSize: 14, color: "#A08860" }}>←</Text>
        <Text style={styles.menuBtnText}>Menu</Text>
      </TouchableOpacity>

      <DevModeOverlay
        isDeveloperModeActive={isDeveloperModeActive}
        setIsDeveloperModeActive={setIsDeveloperModeActive}
        topInset={topInset}
      />

      {selectedEntityKey && (
        <EntityPanel
          selectedEntityKey={selectedEntityKey}
          entities={entities}
          activeTileMap={activeTileMap}
          spentUnits={spentUnits}
          territoryBalances={territoryBalances}
          isAiTurn={isAiTurn}
          gameResult={gameResult}
          botInset={botInset}
          pushHistory={pushHistory}
          setEntities={setEntities}
          setTerritoryBalances={setTerritoryBalances}
          setSelectedEntityKey={setSelectedEntityKey}
        />
      )}

      <BottomActionMenu
        botInset={botInset}
        isAiTurn={isAiTurn}
        gameResult={gameResult}
        moveHistory={moveHistory}
        handleUndo={handleUndo}
        showCredits={showCredits}
        hasSelection={hasSelection}
        setShowEconModal={setShowEconModal}
        creditsDisplayValue={creditsDisplayValue}
        selectedLakeFund={selectedLakeFund}
        lakeUpkeepPerTurn={lakeUpkeepPerTurn}
        econBreakdown={econBreakdown as EconBreakdown | null}
        canBuild={canBuild}
        ribbonMode={ribbonMode}
        setSelectedEntityKey={setSelectedEntityKey}
        closeRibbon={closeRibbon}
        setArmedEntityId={setArmedEntityId}
        openRibbon={openRibbon}
        isDeveloperModeActive={isDeveloperModeActive}
        isAiPaused={isAiPaused}
        isAiTurnDone={isAiTurnDone}
        aiHistoryIndex={aiHistoryIndex}
        handleAiStepBack={handleAiStepBack}
        aiHistoryLen={aiHistoryLen}
        handleAiStepNext={handleAiStepNext}
        handleEndAiTurn={handleEndAiTurn}
        handleEndTurn={handleEndTurn}
        endTurnStyle={endTurnStyle}
      />

      <GameModals
        confirmLeave={confirmLeave}
        setConfirmLeave={setConfirmLeave}
        onLeaveConfirm={() => router.back()}
        pendingLakeMove={pendingLakeMove}
        setPendingLakeMove={setPendingLakeMove}
        lakeTransferAmount={lakeTransferAmount}
        setLakeTransferAmount={setLakeTransferAmount}
        sliderTrackWidth={sliderTrackWidth}
        setSliderTrackWidth={setSliderTrackWidth}
        sliderTrackPageX={sliderTrackPageX}
        commitPendingLakeMove={commitPendingLakeMove}
        showEconModal={showEconModal}
        setShowEconModal={setShowEconModal}
        econBreakdown={econBreakdown as EconBreakdown | null}
        selectedTerritoryBalance={selectedTerritoryBalance}
        showDominancePopup={showDominancePopup}
        setShowDominancePopup={setShowDominancePopup}
        setGameResult={setGameResult}
        gameResult={gameResult}
        onReturnToMenu={() => {
          setGameResult(null);
          setIsDeveloperModeActive(false);
          setIsAiPaused(false);
          resumeAiRef.current = null;
          router.back();
        }}
      />

      {showSplash && (
        <Animated.View style={[styles.splashOverlay, splashAnimStyle]}>
          <Image
            source={MOUNTAIN_IMG}
            style={styles.splashPreloadImg}
            resizeMode="cover"
          />
          <Image
            source={WATER_IMG}
            style={styles.splashPreloadImg}
            resizeMode="cover"
          />
          <Text style={styles.splashTitle}>Tower Deployment</Text>
          <View style={styles.splashSeparator} />
          <Text style={styles.splashSubtitle}>Game starts next turn</Text>
        </Animated.View>
      )}
    </View>
  );
}

