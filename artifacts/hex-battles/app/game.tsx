import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
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
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Defs,
  G,
  LinearGradient,
  Rect,
  Stop,
} from "react-native-svg";

const MOUNTAIN_IMG = require("../assets/images/mountain.webp");
const WATER_IMG = require("../assets/images/water.webp");


import type {
  EntityType,
  HexTile,
  TerritoryOwner,
  BorderEdge,
  AiStepSnapshot,
  Difficulty,
  AiState,
  GameResult,
} from "@/types";
import {
  getBoardBounds,
  hexToPixel,
  tileKey,
  HEX_EDGES,
} from "@/utils/hexMath";
import {
  ENTITY_META,
  generateHexGrid,
  getContiguousTerritory,
  getTerritoryId,
  recalculateTerritories,
  recalculateTerritoriesForCapture,
} from "@/utils/hexGrid";
import {
  BTN_H,
  BOTTOM_BAR_H,
  RIBBON_H,
  ENTITY_PANEL_H,
} from "@/constants/gameConstants";
import {
  applySingleHexPenalty,
  initTerritoryBalances,
} from "@/logic/gameLogic";
import {
  runAiTurn as runAiTurnOrchestration,
  type AiWorkingState,
} from "@/logic/aiStrategy";
import styles from "@/app/gameStyles";
import PurchaseRibbon from "@/components/PurchaseRibbon";
import EntityPanel from "@/components/EntityPanel";
import GameModals from "@/components/GameModals";
import type { EconBreakdown } from "@/components/GameModals";
import BottomActionMenu from "@/components/BottomActionMenu";
import { DevModeOverlay, DevEconomicSvgOverlays } from "@/components/DevModeOverlay";

import {
  HexTileTerrainLayer,
  HexTileTerritoryLayer,
} from "@/components/HexTileLayer";
import { EntityLayer } from "@/components/EntityLayer";
import { BorderEdgeLayer } from "@/components/BorderEdgeLayer";
import { MovementHighlightTapTargets } from "@/components/MovementHighlightTapTargets";
import { MovementHighlightLayer } from "@/components/MovementHighlightLayer";
import { FortificationDotLayer } from "@/components/FortificationDotLayer";
import { CityOverlayLayer } from "@/components/CityOverlayLayer";
import { BridgeOverlayLayer } from "@/components/BridgeOverlayLayer";
import { GraveyardLayer } from "@/components/GraveyardLayer";
import { AffordableTerritoryLayer } from "@/components/AffordableTerritoryLayer";
import { LakeImageLayer } from "@/components/LakeImageLayer";
import { MountainImageLayer } from "@/components/MountainImageLayer";
import { IdleUnitLayer } from "@/components/IdleUnitLayer";
import { ErrorTileFlash } from "@/components/ErrorTileFlash";
import {
  computeBorderEdges,
  computeOuterTerritoryEdges,
  type BorderEdgesCache,
  type OuterEdgesCache,
} from "@/utils/borderEdges";
import { useSelectionState } from "@/hooks/useSelectionState";
import { makeAiTurnCallbacks } from "@/hooks/useAiTurnCallbacks";
import { usePanZoomGesture } from "@/hooks/usePanZoomGesture";
import { useMoveHistory } from "@/hooks/useMoveHistory";
import { useEconBreakdown } from "@/hooks/useEconBreakdown";
import { useDevEconomicOverlays } from "@/hooks/useDevEconomicOverlays";
import { useEndTurnPulse } from "@/hooks/useEndTurnPulse";
import { handleTileTapLogic } from "@/logic/tileTapHandler";
import { handleEndTurnLogic } from "@/logic/endTurnHandler";
import { checkWinLossLogic } from "@/logic/winLossChecker";
import { useOwnerColors } from "@/contexts/SettingsContext";
import {
  clearSavedGame,
  getSavedGameSync,
  setSavedGame,
} from "@/utils/savedGame";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SPLASH_SEEN_KEY = "hex_battles_splash_seen";

export default function GameScreen() {

  const params = useLocalSearchParams<{
    tileCount: string;
    opponentCount: string;
    difficulty: string;
    resume: string;
    mountainPct: string;
    lakePct: string;
    desertPct: string;
    forestPct: string;
    cityCount: string;
  }>();

  const clampPctParam = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(25, Math.round(n)));
  };
  const clampCityParam = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(5, Math.round(n)));
  };

  // Capture the resume snapshot once at mount. After this, the in-memory
  // saved game can be overwritten freely without disturbing initialization.
  const resumeSnapshotRef = useRef<ReturnType<typeof getSavedGameSync>>(
    params.resume === "1" ? getSavedGameSync() : null,
  );
  const resumeSnapshot = resumeSnapshotRef.current;

  const numTiles = resumeSnapshot
    ? resumeSnapshot.config.numTiles
    : Math.min(200, Math.max(40, Number(params.tileCount) || 100));
  const numOpponents = resumeSnapshot
    ? resumeSnapshot.config.numOpponents
    : Math.min(4, Math.max(1, Number(params.opponentCount) || 3));
  const aiDifficulty: Difficulty = resumeSnapshot
    ? resumeSnapshot.config.difficulty
    : ((params.difficulty as Difficulty) || "medium");
  const mapGenOptions = useMemo(
    () =>
      resumeSnapshot
        ? undefined
        : {
            mountainPct: clampPctParam(params.mountainPct, 8),
            lakePct: clampPctParam(params.lakePct, 10),
            desertPct: clampPctParam(params.desertPct, 10),
            forestPct: clampPctParam(params.forestPct, 10),
            cityCount: clampCityParam(params.cityCount, 2),
          },
    // params from useLocalSearchParams are stable per nav and resumeSnapshot is captured once
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
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

  const [showSplash, setShowSplash] = useState(false);
  const splashOpacity = useSharedValue(1);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SPLASH_SEEN_KEY).then((val) => {
      if (cancelled) return;
      if (val !== null) return;
      setShowSplash(true);
      AsyncStorage.setItem(SPLASH_SEEN_KEY, "1").catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showSplash) return;
    const timer = setTimeout(() => {
      splashOpacity.value = withTiming(0, { duration: 600 }, (finished) => {
        if (finished) {
          runOnJS(setShowSplash)(false);
        }
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [showSplash]);

  const splashAnimStyle = useAnimatedStyle(() => ({
    opacity: splashOpacity.value,
  }));

  const tiles = useMemo(
    () =>
      resumeSnapshot
        ? resumeSnapshot.tiles
        : generateHexGrid(numTiles, numOpponents + 1, mapGenOptions),
    [numTiles, numOpponents, gameKey, resumeSnapshot, mapGenOptions],
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
  const ownerColorMaps = useOwnerColors();

  const borderEdges = useMemo<BorderEdge[]>(
    () => computeBorderEdges(borderEdgesCache, tileData, tileMap, tileDataMap, mutableTileMap, INNER_SIZE, BORDER_W, ownerColorMaps.borders),
    [tileData, tileMap, tileDataMap, mutableTileMap, INNER_SIZE, ownerColorMaps.borders],
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
    ribbonAnim.value = withTiming(0, { duration: 130 });
    ribbonScrollRef.current?.scrollTo({ x: 0, animated: false });
  }

  function closeRibbon() {
    ribbonAnim.value = withTiming(RIBBON_H, { duration: 100 });
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
  // Combat actions already used this turn, keyed by unit tile. Only charge units
  // (maxAttacks > 1) accumulate entries here; absence means zero attacks used.
  const [attacksUsed, setAttacksUsed] = useState<Map<string, number>>(
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
  const graveyardRef = useRef<Set<string>>(new Set());
  const ruinsRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (tiles.length === 0) return;

    if (resumeSnapshot) {
      const s = resumeSnapshot.state;
      setMutableTileMap(s.mutableTileMap);
      setEntities(s.entities);
      setTerritoryBalances(s.territoryBalances);
      setSpentUnits(s.spentUnits);
      setCombatSpentUnits(s.combatSpentUnits);
      setPartialMoves(s.partialMoves);
      setAttacksUsed(s.attacksUsed ?? new Map());
      setLiveOwnerMap(s.liveOwnerMap);
      setGraveyard(s.graveyard);
      setRuins(s.ruins);
      setCities(s.cities);
      setFreeTowerUsedTiles(s.freeTowerUsedTiles);
      setTurn(s.turn);
      setSelectedTileKey(null);
      setArmedEntityId(null);
      setSelectedEntityKey(null);
      setIsAiTurn(false);
      return;
    }

    setTerritoryBalances(initTerritoryBalances(tiles, tileMap));
    setSelectedTileKey(null);
    setArmedEntityId(null);
    setSelectedEntityKey(null);
    setSpentUnits(new Set());
    setCombatSpentUnits(new Set());
    setPartialMoves(new Map());
    setAttacksUsed(new Map());
    setMutableTileMap(new Map(tileMap));
    setLiveOwnerMap(new Map());
    setGraveyard(new Set());
    setRuins(new Set());
    setFreeTowerUsedTiles(new Map());

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
  }, [tiles, tileMap, resumeSnapshot]);

  const activeTileMap = mutableTileMap.size > 0 ? mutableTileMap : tileMap;

  const aiOwners = useMemo<TerritoryOwner[]>(() => {
    const all: TerritoryOwner[] = ["ai1", "ai2", "ai3", "ai4", "ai5"];
    return all.slice(0, numOpponents);
  }, [numOpponents]);

  const checkWinLoss = useCallback(
    (currentTileMap: Map<string, HexTile>) => {
      const outcome = checkWinLossLogic(currentTileMap, aiOwners, dominanceShownRef);
      if (!outcome) return false;
      if (outcome.result) {
        setGameResult(outcome.result);
        return true;
      }
      if (outcome.showDominance) {
        setShowDominancePopup(true);
      }
      return false;
    },
    [aiOwners],
  );

  const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

  const awaitStep = useCallback(async (afterSnap: AiStepSnapshot) => {
    aiStepHistoryRef.current.push(afterSnap);
    const newLen = aiStepHistoryRef.current.length;
    const newIdx = newLen - 1;
    setAiHistoryIndex(newIdx);
    setAiHistoryLen(newLen);
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
        attacksUsed: new Map<string, number>(),
        combatSpentUnits: new Set<string>(),
        freeTowerUsed: new Map(freeTowerUsedTilesRef.current),
      };

      const cbs = makeAiTurnCallbacks({
        setEntities,
        setMutableTileMap,
        setTerritoryBalances,
        setGraveyard,
        setRuins,
        setLiveOwnerMap,
        setCities,
        setFreeTowerUsedTiles,
        setAiStateMap,
        setIsAiTurn,
        setIsAiPaused,
        setIsAiTurnDone,
        setAiHistoryIndex,
        setAiHistoryLen,
        aiStateMapRef,
        aiTurnRef,
        isDeveloperModeRef,
        resumeAiRef,
        resumeAfterAiRef,
        aiStepHistoryRef,
        awaitStep,
        triggerUnitAnimation,
        recalculateTerritoriesForCapture,
        applySingleHexPenalty,
        checkWinLoss,
      });

      await runAiTurnOrchestration(ws, cbs, aiOwners, currentTurn ?? 0, aiDifficultyRef.current);
    },
    [aiOwners, checkWinLoss, awaitStep, triggerUnitAnimation],
  );

  // Once a game ends we must NEVER auto-save again, even if some handler
  // transiently flips gameResult back to null (see onReturnToMenu).
  const gameEndedRef = useRef(false);
  useEffect(() => {
    if (gameResult !== null) {
      gameEndedRef.current = true;
      clearSavedGame();
    }
  }, [gameResult]);

  useEffect(() => {
    if (gameEndedRef.current) return;
    if (gameResult !== null) return;
    if (isAiTurn) return;
    if (mutableTileMap.size === 0) return;

    setSavedGame({
      tiles,
      config: { numTiles, numOpponents, difficulty: aiDifficulty },
      state: {
        mutableTileMap,
        entities,
        territoryBalances,
        spentUnits,
        combatSpentUnits,
        partialMoves,
        attacksUsed,
        liveOwnerMap,
        cities,
        graveyard,
        ruins,
        freeTowerUsedTiles,
        turn,
      },
    });
  }, [
    tiles,
    numTiles,
    numOpponents,
    aiDifficulty,
    mutableTileMap,
    entities,
    territoryBalances,
    spentUnits,
    combatSpentUnits,
    partialMoves,
    attacksUsed,
    liveOwnerMap,
    cities,
    graveyard,
    ruins,
    freeTowerUsedTiles,
    turn,
    isAiTurn,
    gameResult,
  ]);

  const {
    selectedTerritory,
    selectedTerritoryId,
    selectedTerritoryBalance,
    selectedTileKeys,
    selectedTerritoryDefenseCounts,
    validMoveTiles,
    validBridgePlacementTiles,
    hasBridgePlacementAvailable,
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

  const { endTurnStyle } = useEndTurnPulse({
    entities,
    activeTileMap,
    spentUnits,
    combatSpentUnits,
    territoryBalances,
    minUnitCost,
    isAiTurn,
    freeTowerUsedTiles,
    turn,
    armedEntityId,
    ribbonOpen,
  });

  const canBuild = selectedTerritory.length > 0;

  const econBreakdown = useEconBreakdown({ selectedTerritory, entities, cities });

  const hasAffordableTerritories = affordableTerritoryTileKeys.size > 0;
  useEffect(() => {
    if (
      hasAffordableTerritories &&
      !selectedTileKey &&
      !selectedEntityKey &&
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
  }, [hasAffordableTerritories, selectedTileKey, selectedEntityKey, armedEntityId, isAiTurn, gameResult]);

  const devEconomicOverlays = useDevEconomicOverlays({
    isDeveloperModeActive,
    aiOwners,
    activeTileMap,
    territoryBalances,
    entities,
    cities,
    tileDataMap,
    aiStateMap,
  });

  const { moveHistory, setMoveHistory, pushHistory, handleUndo } = useMoveHistory({
    entities,
    cities,
    mutableTileMap,
    territoryBalances,
    spentUnits,
    combatSpentUnits,
    liveOwnerMap,
    partialMoves,
    attacksUsed,
    freeTowerUsedTiles,
    selectedTileKey,
    isAiTurn,
    gameResult,
    ribbonOpen,
    closeRibbon,
    setEntities,
    setCities,
    setMutableTileMap,
    setTerritoryBalances,
    setSpentUnits,
    setCombatSpentUnits,
    setLiveOwnerMap,
    setPartialMoves,
    setAttacksUsed,
    setFreeTowerUsedTiles,
    setSelectedTileKey,
    setSelectedEntityKey,
    setArmedEntityId,
  });

  const handleDeselect = useCallback(() => {
    setSelectedTileKey(null);
    setArmedEntityId(null);
    setSelectedEntityKey(null);
    if (ribbonOpen) closeRibbon();
  }, [ribbonOpen]);

  const handleDemolishBridge = useCallback(() => {
    const bridgeKey = selectedEntityKey ?? selectedTileKey;
    if (!bridgeKey) return;
    const tile = activeTileMap.get(bridgeKey);
    if (!tile || tile.terrain !== "lake" || tile.owner !== "player") return;
    const entity = entities.get(bridgeKey);
    if (entity !== "bridge") return;
    pushHistory();

    const newEntities = new Map(entities);
    newEntities.delete(bridgeKey);
    const newTileMap = new Map(activeTileMap);
    newTileMap.set(bridgeKey, { ...tile, owner: "neutral" });

    // Find old player territory (with bridge still present) to get its balance.
    const oldCluster = getContiguousTerritory(activeTileMap, bridgeKey, "player", entities);
    const oldId = getTerritoryId(oldCluster);
    const oldBalance = oldId ? (territoryBalances.get(oldId) ?? 0) : 0;

    // BFS from each neighbour of the bridge tile to find new player clusters.
    const [bq, br] = bridgeKey.split(",").map(Number);
    const visitedKeys = new Set<string>();
    const newClusters: HexTile[][] = [];
    for (const { dir: [dq, dr] } of HEX_EDGES) {
      const nk = tileKey(bq + dq, br + dr);
      if (visitedKeys.has(nk)) continue;
      const cluster = getContiguousTerritory(newTileMap, nk, "player", newEntities);
      if (cluster.length === 0) continue;
      for (const ct of cluster) visitedKeys.add(ct.key);
      newClusters.push(cluster);
    }

    // Redistribute the old balance: largest cluster inherits everything.
    // If two clusters are exactly equal in size, split evenly.
    const newBalances = new Map(territoryBalances);
    if (oldId) newBalances.delete(oldId);

    if (newClusters.length === 1) {
      const newId = getTerritoryId(newClusters[0]);
      if (newId) newBalances.set(newId, oldBalance);
    } else if (newClusters.length > 1) {
      const maxSize = Math.max(...newClusters.map((c) => c.length));
      const exactlyTwoEqual =
        newClusters.length === 2 && newClusters.every((c) => c.length === maxSize);
      const firstId = getTerritoryId(newClusters[0]) ?? "";
      for (const cluster of newClusters) {
        const newId = getTerritoryId(cluster);
        if (!newId) continue;
        if (exactlyTwoEqual) {
          const half = Math.floor(oldBalance / 2);
          newBalances.set(newId, half + (newId === firstId ? oldBalance % 2 : 0));
        } else if (cluster.length === maxSize) {
          newBalances.set(newId, oldBalance);
        } else {
          newBalances.set(newId, 0);
        }
      }
    }

    const newLiveOwnerMap = new Map(liveOwnerMap);
    newLiveOwnerMap.delete(bridgeKey);
    setMutableTileMap(newTileMap);
    setEntities(newEntities);
    setTerritoryBalances(newBalances);
    setLiveOwnerMap(newLiveOwnerMap);
    setSelectedEntityKey(null);

    // Keep the largest remaining territory selected instead of deselecting.
    const largestCluster =
      newClusters.length > 0
        ? newClusters.reduce((best, c) => (c.length > best.length ? c : best))
        : [];
    const anchorTile =
      largestCluster.find((t) => t.terrain !== "lake") ?? largestCluster[0];
    setSelectedTileKey(anchorTile?.key ?? null);
  }, [
    selectedEntityKey,
    selectedTileKey,
    activeTileMap,
    entities,
    territoryBalances,
    liveOwnerMap,
    pushHistory,
  ]);

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
        combatSpentUnits,
        spentUnits,
        partialMoves,
        attacksUsed,
        validBridgePlacementTiles,
        validPlacementAttackTiles,
        ribbonOpen,
        cities,
        setMutableTileMap,
        setLiveOwnerMap,
        setEntities,
        setSpentUnits,
        setCombatSpentUnits,
        setPartialMoves,
        setAttacksUsed,
        setTerritoryBalances,
        setSelectedEntityKey,
        setSelectedTileKey,
        setGraveyard,
        setRuins,
        setArmedEntityId,
        setFreeTowerUsedTiles,
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
      validBridgePlacementTiles,
      validPlacementAttackTiles,
      spentUnits,
      combatSpentUnits,
      partialMoves,
      attacksUsed,
      liveOwnerMap,
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
      aiTurnRef,
      setMoveHistory,
      setTerritoryBalances,
      setEntities,
      setGraveyard,
      setRuins,
      setTurn,
      setSelectedTileKey,
      setArmedEntityId,
      setSelectedEntityKey,
      setSpentUnits,
      setCombatSpentUnits,
      setPartialMoves,
      setAttacksUsed,
      setIsAiTurn,
      checkWinLoss,
      runAiTurn,
      closeRibbon,
    });
  }, [
    activeTileMap,
    entities,
    territoryBalances,
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

  const { gesture, boardStyle } = usePanZoomGesture({
    boardW,
    boardH,
    bounds,
    HEX_SIZE,
    SW,
    availH,
    topInset,
    initX,
    initY,
    fitScale,
    activeTileMap,
    handleTileTap,
    handleDeselect,
  });

  const territoryPulseStyle = useAnimatedStyle(() => ({
    opacity: territoryPulseVal.value,
  }));

  const ribbonStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ribbonAnim.value }],
  }));

  const hasSelection = selectedTerritory.length > 0;
  const showGold = hasSelection;
  const goldDisplayValue = selectedTerritoryBalance;

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
              {/*
               * Two permanently-mounted hex layers controlled by SVG G opacity.
               * Neither layer ever re-renders when hasSelection changes — only the
               * G wrapper's opacity prop is updated, which is a cheap native
               * operation and makes the terrain/territory switch instant.
               */}
              <G opacity={hasSelection ? 0 : 1}>
                <HexTileTerritoryLayer
                  tileData={tileData}
                  activeTileMap={activeTileMap}
                  cities={cities}
                  HEX_SIZE={HEX_SIZE}
                />
              </G>
              <G opacity={hasSelection ? 1 : 0}>
                <HexTileTerrainLayer
                  tileData={tileData}
                  HEX_SIZE={HEX_SIZE}
                />
              </G>

              <LakeImageLayer tileData={tileData} HEX_SIZE={HEX_SIZE} />

              <MountainImageLayer tileData={tileData} HEX_SIZE={HEX_SIZE} />

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
                validBridgePlacementTiles={validBridgePlacementTiles}
                validPlacementAttackTiles={validPlacementAttackTiles}
                armedEntityId={armedEntityId}
                tileDataMap={tileDataMap}
                HEX_SIZE={HEX_SIZE}
              />

            </Svg>

            {/* Cities and bridges render as RN building tokens (like
                towers/castles) so they match in border weight and icon size;
                kept below the unit layers so a unit standing on one shows. */}
            <CityOverlayLayer
              cities={cities}
              activeTileMap={activeTileMap}
              tileDataMap={tileDataMap}
              HEX_SIZE={HEX_SIZE}
            />

            <BridgeOverlayLayer
              activeTileMap={activeTileMap}
              tileDataMap={tileDataMap}
              selectedEntityKey={selectedEntityKey}
              HEX_SIZE={HEX_SIZE}
            />

            <AffordableTerritoryLayer
              affordableTerritoryTileKeys={affordableTerritoryTileKeys}
              tileDataMap={tileDataMap}
              activeTileMap={activeTileMap}
              boardW={boardW}
              boardH={boardH}
              HEX_SIZE={HEX_SIZE}
              territoryPulseStyle={territoryPulseStyle}
            />

            <ErrorTileFlash
              errorTileKey={errorTileKey}
              tileDataMap={tileDataMap}
              boardW={boardW}
              boardH={boardH}
              HEX_SIZE={HEX_SIZE}
            />

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

            <IdleUnitLayer
              entities={entities}
              activeTileMap={activeTileMap}
              tileDataMap={tileDataMap}
              spentUnits={spentUnits}
              selectedEntityKey={selectedEntityKey}
              animatingUnit={animatingUnit}
              animUnitProgress={animUnitProgress}
              HEX_SIZE={HEX_SIZE}
              isAiTurn={isAiTurn}
            />

            <FortificationDotLayer
              fortificationDots={fortificationDots}
              tileDataMap={tileDataMap}
              boardW={boardW}
              boardH={boardH}
              HEX_SIZE={HEX_SIZE}
            />

            <MovementHighlightLayer
              validMoveTiles={validMoveTiles}
              validBridgePlacementTiles={validBridgePlacementTiles}
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
        hasBridgePlacementAvailable={hasBridgePlacementAvailable}
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

      {__DEV__ && (
        <DevModeOverlay
          isDeveloperModeActive={isDeveloperModeActive}
          setIsDeveloperModeActive={setIsDeveloperModeActive}
          topInset={topInset}
          aiDifficulty={aiDifficulty}
        />
      )}

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
          onRemoveOverride={
            entities.get(selectedEntityKey) === "bridge"
              ? handleDemolishBridge
              : undefined
          }
        />
      )}

      <BottomActionMenu
        botInset={botInset}
        isAiTurn={isAiTurn}
        gameResult={gameResult}
        moveHistory={moveHistory}
        handleUndo={handleUndo}
        showGold={showGold}
        hasSelection={hasSelection}
        setShowEconModal={setShowEconModal}
        goldDisplayValue={goldDisplayValue}
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

