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
  SharedValue,
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
  CITY_BUFFER_BORDER,
  TERRITORY_BORDERS,
} from "@/constants/colors";
import type {
  EntityType,
  HexTile,
  TerritoryOwner,
  BorderEdge,
  AiStepSnapshot,
  Difficulty,
  AiState,
} from "@/types";
import {
  CITY_BONUS,
  ENTITY_META,
  HEX_EDGES,
  TERRAIN_INCOME,
  UNIT_UPGRADE,
  calcDefenseUpkeep,
  nextDefenseUpkeep,
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
} from "@/utils/hexGrid";
import {
  BTN_H,
  BOTTOM_BAR_H,
  RIBBON_H,
  ENTITY_PANEL_H,
  EXTRA_PAN,
  ORDERED_EDGES,
} from "@/constants/gameConstants";
import {
  calcTerritoryUpkeep,
  applySingleHexPenalty,
  initTerritoryBalances,
  mergedUnitType,
} from "@/logic/gameLogic";
import type { AiContext } from "@/logic/aiHelpers";
import { runAiTerritoryDecisionLoop } from "@/logic/aiStrategy";
import styles from "@/app/gameStyles";
import PurchaseRibbon from "@/components/PurchaseRibbon";
import EntityPanel from "@/components/EntityPanel";
import GameModals from "@/components/GameModals";
import type { EconBreakdown } from "@/components/GameModals";
import { HexCell } from "@/components/HexCell";
import BottomActionMenu from "@/components/BottomActionMenu";
import { DevModeOverlay, DevEconomicSvgOverlays } from "@/components/DevModeOverlay";


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
  progress: SharedValue<number>;
}) {
  const meta = ENTITY_META[entityId];
  const r = hexSize * 0.5;
  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        { translateX: (toPos.cx - fromPos.cx) * p },
        { translateY: (toPos.cy - fromPos.cy) * p },
      ],
    };
  });
  const bgColor =
    owner === "player" ? "rgba(30,50,120,0.9)" : "rgba(80,20,20,0.9)";
  const borderColor = TERRITORY_BORDERS[owner] ?? TERRITORY_BORDERS["player"];
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: fromPos.cx - r,
          top: fromPos.cy - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: bgColor,
          borderWidth: 2.2,
          borderColor,
          alignItems: "center",
          justifyContent: "center",
        },
        animStyle,
      ]}
    >
      <Text style={{ fontSize: r * 1.1, lineHeight: r * 1.6 }}>
        {meta.icon}
      </Text>
    </Animated.View>
  );
}

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
    const isNewBoard =
      !prev || prev.tileData !== tileData || prev.INNER_SIZE !== INNER_SIZE;

    const perTileEdges: Map<string, BorderEdge[]> = isNewBoard
      ? new Map()
      : new Map(prev!.perTileEdges);

    const changedKeys = new Set<string>();
    if (isNewBoard) {
      for (const { tile } of tileData) changedKeys.add(tile.key);
    } else {
      for (const [key, tile] of mutableTileMap) {
        if (prev!.mutableTileMap.get(key)?.owner !== tile.owner) {
          changedKeys.add(key);
          for (const {
            dir: [dq, dr],
          } of ORDERED_EDGES) {
            const [q, r] = key.split(",").map(Number);
            changedKeys.add(tileKey(q + dq, r + dr));
          }
        }
      }
      for (const [key] of prev!.mutableTileMap) {
        if (!mutableTileMap.has(key)) {
          changedKeys.add(key);
          for (const {
            dir: [dq, dr],
          } of ORDERED_EDGES) {
            const [q, r] = key.split(",").map(Number);
            changedKeys.add(tileKey(q + dq, r + dr));
          }
        }
      }
    }

    const computeEdgesForTile = (
      tile: HexTile,
      cx: number,
      cy: number,
    ): BorderEdge[] => {
      const edges: BorderEdge[] = [];
      const liveOwner = ownerOf(tile.key, tile);
      if (
        tile.terrain === "mountain" ||
        tile.terrain === "lake" ||
        liveOwner === "neutral"
      ) {
        if ((tile.cityBuffer || tile.isCity) && liveOwner === "neutral") {
          for (const {
            dir: [dq, dr],
            verts: [va, vb],
          } of ORDERED_EDGES) {
            const nk = tileKey(tile.q + dq, tile.r + dr);
            const neighborBase = tileMap.get(nk);
            const neighborLiveOwner = neighborBase
              ? ownerOf(nk, neighborBase)
              : null;
            const neighborIsNeutralCity =
              neighborBase !== undefined &&
              neighborLiveOwner === "neutral" &&
              (neighborBase.cityBuffer || neighborBase.isCity);
            if (neighborIsNeutralCity) continue;
            const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
            const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
            edges.push({
              x1: ptA.x,
              y1: ptA.y,
              x2: ptB.x,
              y2: ptB.y,
              color: CITY_BUFFER_BORDER,
              width: BORDER_W,
            });
          }
        }
        return edges;
      }
      const color = TERRITORY_BORDERS[liveOwner as TerritoryOwner]!;
      if (!color) return edges;
      for (const {
        dir: [dq, dr],
        verts: [va, vb],
      } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighborBase = tileMap.get(nk);
        if (!neighborBase) {
          const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
          edges.push({
            x1: ptA.x,
            y1: ptA.y,
            x2: ptB.x,
            y2: ptB.y,
            color,
            width: BORDER_W,
          });
          continue;
        }
        const neighborLiveOwner = ownerOf(nk, neighborBase);
        const needsBorder =
          neighborBase.terrain === "mountain" ||
          neighborBase.terrain === "lake" ||
          neighborLiveOwner === "neutral" ||
          neighborLiveOwner !== liveOwner;
        if (!needsBorder) continue;
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({
          x1: ptA.x,
          y1: ptA.y,
          x2: ptB.x,
          y2: ptB.y,
          color,
          width: BORDER_W,
        });
      }
      return edges;
    };

    for (const key of changedKeys) {
      const baseTile = tileMap.get(key);
      const pos = tileDataMap.get(key);
      if (!baseTile || !pos) {
        perTileEdges.delete(key);
        continue;
      }
      perTileEdges.set(key, computeEdgesForTile(baseTile, pos.cx, pos.cy));
    }

    const allEdges: BorderEdge[] = [];
    for (const { tile } of tileData) {
      const tileEdges = perTileEdges.get(tile.key);
      if (tileEdges) for (const e of tileEdges) allEdges.push(e);
    }

    borderEdgesCache.current = {
      mutableTileMap,
      tileData,
      INNER_SIZE,
      perTileEdges,
      result: allEdges,
    };
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
    const isNewBoard =
      !prev || prev.tileData !== tileData || prev.HEX_SIZE !== HEX_SIZE;

    const perTileEdges: Map<string, BorderEdge[]> = isNewBoard
      ? new Map()
      : new Map(prev!.perTileEdges);

    const changedKeys = new Set<string>();
    if (isNewBoard) {
      for (const { tile } of tileData) changedKeys.add(tile.key);
    } else {
      for (const [key, tile] of mutableTileMap) {
        if (prev!.mutableTileMap.get(key)?.owner !== tile.owner) {
          changedKeys.add(key);
          for (const {
            dir: [dq, dr],
          } of ORDERED_EDGES) {
            const [q, r] = key.split(",").map(Number);
            changedKeys.add(tileKey(q + dq, r + dr));
          }
        }
      }
      for (const [key] of prev!.mutableTileMap) {
        if (!mutableTileMap.has(key)) {
          changedKeys.add(key);
          for (const {
            dir: [dq, dr],
          } of ORDERED_EDGES) {
            const [q, r] = key.split(",").map(Number);
            changedKeys.add(tileKey(q + dq, r + dr));
          }
        }
      }
    }

    const computeOuterEdgesForTile = (
      tile: HexTile,
      cx: number,
      cy: number,
    ): BorderEdge[] => {
      const edges: BorderEdge[] = [];
      const liveOwner = ownerOf(tile.key, tile);
      const isImpassable =
        tile.terrain === "mountain" || tile.terrain === "lake";
      if (!isImpassable && liveOwner === "neutral") return edges;

      for (const {
        dir: [dq, dr],
        verts: [va, vb],
      } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        const neighborBase = tileMap.get(nk);

        if (!neighborBase) {
          const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
          edges.push({
            x1: ptA.x,
            y1: ptA.y,
            x2: ptB.x,
            y2: ptB.y,
            color: "#000000",
            width: 2,
          });
          continue;
        }

        if (isImpassable) {
          if (neighborBase.terrain === tile.terrain) continue;
          const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
          edges.push({
            x1: ptA.x,
            y1: ptA.y,
            x2: ptB.x,
            y2: ptB.y,
            color: "#000000",
            width: 2,
          });
        } else {
          const neighborLiveOwner = ownerOf(nk, neighborBase);
          const needsBorder =
            neighborBase.terrain === "mountain" ||
            neighborBase.terrain === "lake" ||
            neighborLiveOwner === "neutral" ||
            neighborLiveOwner !== liveOwner;
          if (!needsBorder) continue;
          const ptA = hexCornerPoint(cx, cy, HEX_SIZE, va);
          const ptB = hexCornerPoint(cx, cy, HEX_SIZE, vb);
          edges.push({
            x1: ptA.x,
            y1: ptA.y,
            x2: ptB.x,
            y2: ptB.y,
            color: "#000000",
            width: 2,
          });
        }
      }
      return edges;
    };

    for (const key of changedKeys) {
      const baseTile = tileMap.get(key);
      const pos = tileDataMap.get(key);
      if (!baseTile || !pos) {
        perTileEdges.delete(key);
        continue;
      }
      perTileEdges.set(key, computeOuterEdgesForTile(baseTile, pos.cx, pos.cy));
    }

    const allEdges: BorderEdge[] = [];
    for (const { tile } of tileData) {
      const tileEdges = perTileEdges.get(tile.key);
      if (tileEdges) for (const e of tileEdges) allEdges.push(e);
    }

    outerEdgesCache.current = {
      mutableTileMap,
      tileData,
      HEX_SIZE,
      perTileEdges,
      result: allEdges,
    };
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
  const [moveHistory, setMoveHistory] = useState<
    Array<{
      entities: Map<string, EntityType>;
      cities: Set<string>;
      mutableTileMap: Map<string, HexTile>;
      territoryBalances: Map<string, number>;
      spentUnits: Set<string>;
      combatSpentUnits: Set<string>;
      liveOwnerMap: Map<string, TerritoryOwner>;
      partialMoves: Map<string, number>;
      freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
      lakeUnitFunds: Map<string, number>;
      selectedTileKey: string | null;
    }>
  >([]);
  const [isAiTurn, setIsAiTurn] = useState(false);
  const [gameResult, setGameResult] = useState<"victory" | "defeat" | null>(
    null,
  );
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
      let workingTileMap = new Map(currentTileMap);
      let workingEntities = new Map(currentEntities);
      let workingBalances = new Map(currentBalances);
      let workingLiveOwnerMap = new Map<string, TerritoryOwner>();
      let workingGraveyard = new Set(initialGraveyard ?? graveyardRef.current);
      let workingRuins = new Set(initialRuins ?? ruinsRef.current);
      let workingCities = new Set(initialCities ?? citiesRef.current);
      let workingSpentUnits = new Set<string>();
      let workingPartialMoves = new Map<string, number>(); // remaining move range for partially-moved units
      let workingFreeTowerUsed = new Map(freeTowerUsedTilesRef.current);
      let workingLakeFunds = new Map(
        initialLakeFunds ?? lakeUnitFundsRef.current,
      );

      // Snapshot state BEFORE any AI action so the user can step back to the start of AI's turn
      const preAiSnap: AiStepSnapshot = {
        entities: new Map(currentEntities),
        mutableTileMap: new Map(currentTileMap),
        territoryBalances: new Map(currentBalances),
        liveOwnerMap: new Map(),
        graveyard: new Set(workingGraveyard),
        freeTowerUsedTiles: new Map(
          [...workingFreeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)]),
        ),
      };
      aiStepHistoryRef.current = [preAiSnap];
      setAiHistoryIndex(0);
      setAiHistoryLen(1);

      // Dev mode: pause at index 0 so user sees the pre-AI state before the first action runs
      if (isDeveloperModeRef.current) {
        setIsAiPaused(true);
        await new Promise<void>((resolve) => {
          resumeAiRef.current = resolve;
        });
        resumeAiRef.current = null;
        setIsAiPaused(false);
      }

      for (const aiOwner of aiOwners) {
        if (aiTurnRef.current === false) return;

        const visited = new Set<string>();
        const aiTiles = Array.from(workingTileMap.values()).filter(
          (t) => t.owner === aiOwner,
        );
        if (aiTiles.length === 0) continue;

        for (const startTile of aiTiles) {
          if (visited.has(startTile.key)) continue;
          const territory = getContiguousTerritory(
            workingTileMap,
            startTile.key,
            aiOwner,
          );
          for (const t of territory) visited.add(t.key);
          const territoryId = getTerritoryId(territory);
          if (!territoryId) continue;

          // Free tower: each territory with ≥2 tiles may build one free tower, round 1 only
          if (territory.length >= 2 && currentTurn === 1) {
            const aiUsedSet = workingFreeTowerUsed.get(aiOwner);
            const hasUsedFreeTower =
              !!aiUsedSet && territory.some((t) => aiUsedSet.has(t.key));
            if (!hasUsedFreeTower) {
              // Fix 5: Round 1 Tower Optimization — evaluate ALL valid owned tiles globally
              // and place the tower on the tile whose ZoC covers the most owned tiles.
              // No pre-filtering buckets; score is the true global argmax across the territory.
              const allValidTowerCands: string[] = territory
                .filter(
                  (t) =>
                    t.terrain !== "mountain" &&
                    t.terrain !== "lake" &&
                    !workingEntities.has(t.key) &&
                    !workingGraveyard.has(t.key),
                )
                .map((t) => t.key);
              if (allValidTowerCands.length > 0) {
                const scoreCandidate = (candKey: string): number => {
                  const [cq, cr] = candKey.split(",").map(Number);
                  let ownedCovered = 0;
                  for (const { dir: [dq, dr] } of HEX_EDGES) {
                    const nk = tileKey(cq + dq, cr + dr);
                    const nt = workingTileMap.get(nk);
                    if (nt && nt.owner === aiOwner) ownedCovered++;
                  }
                  return ownedCovered;
                };
                const towerKey = allValidTowerCands.reduce((bestKey, candKey) => {
                  return scoreCandidate(candKey) > scoreCandidate(bestKey) ? candKey : bestKey;
                }, allValidTowerCands[0]);
                workingEntities = new Map(workingEntities);
                workingEntities.set(towerKey, "tower");
                const newOwnerSet = new Set(
                  workingFreeTowerUsed.get(aiOwner) ?? [],
                );
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
                  freeTowerUsedTiles: new Map(
                    [...workingFreeTowerUsed.entries()].map(([k, v]) => [
                      k,
                      new Set(v),
                    ]),
                  ),
                });
                if (!aiTurnRef.current) return;
              }
            }
          }

          // Round 1: only the free tower is allowed — no other purchases
          if (currentTurn === 1) continue;

          // === STATE-DEPENDENT DECISION TREE AI ===
          // Runs per territory, looping until no more valid actions exist.
          // Priorities 1 & 2 are DEFENDING-only; A-H run in all states.

          const difficulty = aiDifficultyRef.current;

          // ─── Decision Tree Helpers (delegating to aiHelpers module) ────────
          // aiCtx uses getters so it always reads the current `let` variable,
          // even after reassignment (e.g. workingTileMap = new Map(...)).
          const aiCtx: AiContext = {
            get tileMap() { return workingTileMap; },
            get entities() { return workingEntities; },
            get balances() { return workingBalances; },
            get cities() { return workingCities; },
            get spentUnits() { return workingSpentUnits; },
            get partialMoves() { return workingPartialMoves; },
            get aiOwner() { return aiOwner; },
          };

          // Consolidated awaitStep call for the decision tree
          const dtAwait = async (): Promise<void> => {
            await awaitStep({
              entities: new Map(workingEntities),
              mutableTileMap: new Map(workingTileMap),
              territoryBalances: new Map(workingBalances),
              liveOwnerMap: new Map(workingLiveOwnerMap),
              graveyard: new Set(workingGraveyard),
              freeTowerUsedTiles: new Map(
                [...workingFreeTowerUsed.entries()].map(([k, v]) => [k, new Set(v)]),
              ),
            });
          };

          // Publish updated AI state label after a move
          const dtPublishState = (anchorKey: string): void => {
            const updTerr = getContiguousTerritory(workingTileMap, anchorKey, aiOwner);
            const updId = getTerritoryId(updTerr);
            if (!updId) return;
            const updMaxStr = updTerr.reduce((best, t) => {
              const e = workingEntities.get(t.key);
              return e ? Math.max(best, ENTITY_META[e].strength) : best;
            }, 0);
            const updBorder = updTerr.filter((t) => {
              const [tq, tr] = t.key.split(",").map(Number);
              return HEX_EDGES.some(({ dir: [dq, dr] }) => {
                const nk = tileKey(tq + dq, tr + dr);
                const nb = workingTileMap.get(nk);
                return !!nb && nb.owner !== aiOwner;
              });
            });
            const updThreatened = updBorder.some((bt) => {
              const [bq, br] = bt.key.split(",").map(Number);
              for (const [ek, ee] of workingEntities) {
                if (!ENTITY_META[ee].isUnit) continue;
                const et = workingTileMap.get(ek);
                if (!et || et.owner === aiOwner || et.owner === "neutral") continue;
                const [eq2, er2] = ek.split(",").map(Number);
                if (hexDistance(bq, br, eq2, er2) <= 3 && ENTITY_META[ee].strength > updMaxStr) return true;
              }
              return false;
            });
            aiStateMapRef.current = new Map(aiStateMapRef.current);
            aiStateMapRef.current.set(updId, updThreatened ? "defending" : "attacking");
            setAiStateMap(new Map(aiStateMapRef.current));
          };

          // Execute a unit move (fromKey → toKey); updates all working state and triggers animation
          const dtExecMove = async (fromKey: string, toKey: string): Promise<boolean> => {
            if (!aiTurnRef.current) return false;
            const unitEntity = workingEntities.get(fromKey);
            if (!unitEntity) return false;
            const destTile = workingTileMap.get(toKey);
            if (!destTile) return false;
            const srcTile = workingTileMap.get(fromKey);
            const movingFromLake = srcTile?.terrain === "lake";
            const movingToLake = destTile.terrain === "lake";
            const previousOwner = destTile.owner as TerritoryOwner;
            const prevTileMapSnapshot = new Map(workingTileMap);

            // Pre-check: ensure enough balance for lake transfer (2× upkeep) before mutating state
            if (movingToLake && !movingFromLake) {
              const srcTerrPre = getContiguousTerritory(prevTileMapSnapshot, fromKey, aiOwner);
              const srcIdPre = getTerritoryId(srcTerrPre);
              if (srcIdPre) {
                const unitUpkPre = ENTITY_META[unitEntity].upkeep;
                const srcBalPre = workingBalances.get(srcIdPre) ?? 0;
                if (srcBalPre < unitUpkPre * 2) return false;
              } else {
                return false;
              }
            }

            workingTileMap = new Map(workingTileMap);
            workingTileMap.set(toKey, { ...destTile, owner: aiOwner });
            workingEntities = new Map(workingEntities);

            const destExisting = workingEntities.get(toKey);
            const isAllyMerge =
              destExisting &&
              ENTITY_META[destExisting].isUnit &&
              destTile.owner === aiOwner &&
              ENTITY_META[unitEntity].strength + ENTITY_META[destExisting].strength <= 3;

            // NOTE: cities are tracked in workingCities (not entities), so
            // destExisting will never be "city" — no special branch needed.
            if (isAllyMerge) {
              const merged = mergedUnitType(
                ENTITY_META[unitEntity].strength,
                ENTITY_META[destExisting].strength,
              );
              workingEntities.delete(fromKey);
              workingEntities.set(toKey, merged);
            } else {
              workingEntities.delete(toKey);
              workingEntities.delete(fromKey);
              workingEntities.set(toKey, unitEntity);
            }

            workingSpentUnits = new Set(workingSpentUnits);
            // Merge: only mark the "from" unit spent — the merged result at toKey
            // is a fresh unit and must be free to act in the next while-loop iteration.
            if (isAllyMerge) {
              workingSpentUnits.add(fromKey);
            } else {
              workingSpentUnits.add(toKey);
            }

            // Track partial movement: merged unit inherits the MIN remaining range of both units.
            {
              const stepsUsed = getMoveCost(fromKey, toKey, prevTileMapSnapshot);
              const prevRemaining = workingPartialMoves.get(fromKey) ?? 3;
              const remainingAfterMove = movingToLake ? 0 : Math.max(0, prevRemaining - stepsUsed);
              workingPartialMoves = new Map(workingPartialMoves);
              workingPartialMoves.delete(fromKey);
              if (isAllyMerge) {
                const destRemaining = workingPartialMoves.get(toKey) ?? 3;
                const mergedRemaining = Math.min(remainingAfterMove, destRemaining);
                workingPartialMoves.delete(toKey);
                if (mergedRemaining < 3) {
                  workingPartialMoves.set(toKey, mergedRemaining);
                }
              } else {
                workingPartialMoves.delete(toKey);
                if (remainingAfterMove < 3) {
                  workingPartialMoves.set(toKey, remainingAfterMove);
                }
              }
            }

            workingLakeFunds = new Map(workingLakeFunds);
            if (movingToLake && !movingFromLake) {
              const srcTerrLake = getContiguousTerritory(prevTileMapSnapshot, fromKey, aiOwner);
              const srcIdLake = getTerritoryId(srcTerrLake);
              if (srcIdLake) {
                const lakeAmount = ENTITY_META[unitEntity].upkeep * 2;
                workingBalances = new Map(workingBalances);
                workingBalances.set(srcIdLake, (workingBalances.get(srcIdLake) ?? 0) - lakeAmount);
                workingLakeFunds.set(toKey, lakeAmount);
              }
            } else if (movingFromLake && movingToLake) {
              const fund = workingLakeFunds.get(fromKey) ?? 0;
              workingLakeFunds.delete(fromKey);
              workingLakeFunds.set(toKey, fund);
              workingTileMap.set(fromKey, { ...srcTile!, owner: "neutral" });
              workingLiveOwnerMap = new Map(workingLiveOwnerMap);
              workingLiveOwnerMap.delete(fromKey);
            } else if (movingFromLake && !movingToLake) {
              const fund = workingLakeFunds.get(fromKey) ?? 0;
              workingLakeFunds.delete(fromKey);
              workingTileMap.set(fromKey, { ...srcTile!, owner: "neutral" });
              workingLiveOwnerMap = new Map(workingLiveOwnerMap);
              workingLiveOwnerMap.delete(fromKey);
              workingBalances = recalculateTerritoriesForCapture(
                toKey, aiOwner, previousOwner, prevTileMapSnapshot, workingTileMap, workingBalances,
              );
              if (fund > 0) {
                const newTerr = getContiguousTerritory(workingTileMap, toKey, aiOwner);
                const newId = getTerritoryId(newTerr);
                if (newId) {
                  workingBalances = new Map(workingBalances);
                  workingBalances.set(newId, (workingBalances.get(newId) ?? 0) + fund);
                }
              }
            } else {
              workingBalances = recalculateTerritoriesForCapture(
                toKey, aiOwner, previousOwner, prevTileMapSnapshot, workingTileMap, workingBalances,
              );
            }

            workingLiveOwnerMap = new Map(workingLiveOwnerMap);
            workingLiveOwnerMap.set(toKey, aiOwner);
            workingGraveyard = new Set(workingGraveyard);
            workingGraveyard.delete(toKey);
            applySingleHexPenalty(
              prevTileMapSnapshot, workingTileMap, workingBalances, workingEntities,
              workingGraveyard, workingRuins,
              movingFromLake && !movingToLake ? toKey : undefined,
            );
            setRuins(new Set(workingRuins));

            if (!isDeveloperModeRef.current) {
              await new Promise<void>((resolve) => {
                triggerUnitAnimation(fromKey, toKey, unitEntity, aiOwner as TerritoryOwner, true, () => {
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

            dtPublishState(toKey);
            await dtAwait();
            return true;
          };

          // Execute a buy action: place unitType at target
          // outside=true means target is outside the territory (direct capture attack)
          const dtExecBuy = async (
            unitType: EntityType, target: string, cost: number, outside: boolean,
          ): Promise<boolean> => {
            if (!aiTurnRef.current) return false;
            workingEntities = new Map(workingEntities);
            workingBalances = new Map(workingBalances);

            if (!outside) {
              const wasRebel = workingEntities.get(target) === "rebel";
              if (unitType === "city") {
                workingCities = new Set(workingCities);
                workingCities.add(target);
              } else {
                workingEntities.set(target, unitType);
              }
              const buyTerr = getContiguousTerritory(workingTileMap, startTile.key, aiOwner);
              const buyTid = getTerritoryId(buyTerr);
              if (buyTid) workingBalances.set(buyTid, (workingBalances.get(buyTid) ?? 0) - cost);
              if (wasRebel) {
                workingSpentUnits = new Set(workingSpentUnits);
                workingSpentUnits.add(target);
              }
            } else {
              const previousOwner = (workingTileMap.get(target)?.owner ?? "neutral") as TerritoryOwner;
              const prevSnapshot = new Map(workingTileMap);
              workingTileMap = new Map(workingTileMap);
              const targetTile = workingTileMap.get(target);
              if (targetTile && (targetTile.terrain === "mountain" || targetTile.terrain === "lake")) return false;
              if (targetTile) workingTileMap.set(target, { ...targetTile, owner: aiOwner });
              if (unitType === "city") {
                workingCities = new Set(workingCities);
                workingCities.add(target);
              } else {
                workingEntities.delete(target);
                workingEntities.set(target, unitType);
              }
              workingBalances = recalculateTerritoriesForCapture(
                target, aiOwner, previousOwner, prevSnapshot, workingTileMap, workingBalances,
              );
              const mergedTerr = getContiguousTerritory(workingTileMap, target, aiOwner);
              const mergedId = getTerritoryId(mergedTerr);
              if (mergedId) workingBalances.set(mergedId, (workingBalances.get(mergedId) ?? 0) - cost);
              applySingleHexPenalty(prevSnapshot, workingTileMap, workingBalances, workingEntities, workingGraveyard, workingRuins);
              setRuins(new Set(workingRuins));
              workingLiveOwnerMap = new Map(workingLiveOwnerMap);
              workingLiveOwnerMap.set(target, aiOwner);
              workingSpentUnits = new Set(workingSpentUnits);
              workingSpentUnits.add(target);
              setMutableTileMap(new Map(workingTileMap));
              setLiveOwnerMap(new Map(workingLiveOwnerMap));
            }

            setEntities(new Map(workingEntities));
            setCities(new Set(workingCities));
            setTerritoryBalances(new Map(workingBalances));
            setAiStateMap(new Map(aiStateMapRef.current));
            await dtAwait();
            return true;
          };

          // Execute a building upgrade (change entity on tile in place)
          const dtExecUpgrade = async (targetKey: string, to: EntityType, cost: number): Promise<boolean> => {
            if (!aiTurnRef.current) return false;
            workingEntities = new Map(workingEntities);
            workingEntities.set(targetKey, to);
            workingBalances = new Map(workingBalances);
            const buyTerr = getContiguousTerritory(workingTileMap, startTile.key, aiOwner);
            const buyTid = getTerritoryId(buyTerr);
            if (buyTid) workingBalances.set(buyTid, (workingBalances.get(buyTid) ?? 0) - cost);
            setEntities(new Map(workingEntities));
            setTerritoryBalances(new Map(workingBalances));
            await dtAwait();
            return true;
          };

          // Build a building inside the territory (no ownership change)
          const dtExecBuild = async (buildingType: EntityType, targetKey: string, cost: number): Promise<boolean> => {
            if (!aiTurnRef.current) return false;
            workingBalances = new Map(workingBalances);
            if (buildingType === "city") {
              workingCities = new Set(workingCities);
              workingCities.add(targetKey);
            } else {
              workingEntities = new Map(workingEntities);
              workingEntities.set(targetKey, buildingType);
            }
            const buyTerr = getContiguousTerritory(workingTileMap, startTile.key, aiOwner);
            const buyTid = getTerritoryId(buyTerr);
            if (buyTid) workingBalances.set(buyTid, (workingBalances.get(buyTid) ?? 0) - cost);
            setEntities(new Map(workingEntities));
            setCities(new Set(workingCities));
            setTerritoryBalances(new Map(workingBalances));
            await dtAwait();
            return true;
          };

          // Remove a building (Priority H)
          const dtExecRemove = async (targetKey: string): Promise<boolean> => {
            if (!aiTurnRef.current) return false;
            workingEntities = new Map(workingEntities);
            workingEntities.delete(targetKey);
            setEntities(new Map(workingEntities));
            setTerritoryBalances(new Map(workingBalances));
            await dtAwait();
            return true;
          };

          // markSpent: direct working-state mutation (no React publish needed mid-loop)
          const markSpent = (key: string): void => {
            workingSpentUnits = new Set(workingSpentUnits);
            workingSpentUnits.add(key);
          };

          // setTerritoryState: update the AI state label for dev-mode display
          const setTerritoryState = (tid: string, state: AiState): void => {
            aiStateMapRef.current = new Map(aiStateMapRef.current);
            aiStateMapRef.current.set(tid, state);
            setAiStateMap(new Map(aiStateMapRef.current));
          };

          // ─── Decision Tree Loop ────────────────────────────────────────────────────
          await runAiTerritoryDecisionLoop(
            startTile.key,
            aiCtx,
            {
              move: dtExecMove,
              buy: dtExecBuy,
              upgrade: dtExecUpgrade,
              build: dtExecBuild,
              remove: dtExecRemove,
              markSpent,
              setTerritoryState,
            },
            () => aiTurnRef.current,
            difficulty,
          );
        }
      }

      // ── Player bankruptcy check after all AI moves ────────────────────────
      // When the AI splits or overruns a player territory, the resulting
      // isolated sub-territory may have 0 balance + negative income delta.
      // We kill those units now so the player sees graveyards immediately at
      // the start of their turn (mirrors the same logic in handleEndTurn).
      if (currentTurn !== 1) {
        const playerVisited = new Set<string>();
        let playerBankruptcyOccurred = false;
        for (const tile of Array.from(workingTileMap.values())) {
          if (tile.owner !== "player" || playerVisited.has(tile.key)) continue;
          if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
          const territory = getContiguousTerritory(
            workingTileMap,
            tile.key,
            "player",
          );
          for (const t of territory) playerVisited.add(t.key);
          const territoryId = getTerritoryId(territory);
          if (!territoryId) continue;
          const income = territory.reduce((s, t) => {
            if (workingEntities.get(t.key) === "rebel") return s;
            return (
              s +
              TERRAIN_INCOME[t.terrain] +
              (workingCities.has(t.key) ? CITY_BONUS : 0)
            );
          }, 0);
          const upkeep = calcTerritoryUpkeep(territory, workingEntities);
          const current = workingBalances.get(territoryId) ?? 0;
          const delta = income - upkeep;
          const newBalance = current + delta;
          if (newBalance < 0) {
            playerBankruptcyOccurred = true;
            workingBalances = new Map(workingBalances);
            workingBalances.set(territoryId, 0);
            workingEntities = new Map(workingEntities);
            let unitUpkeepSaved = 0;
            for (const t of territory) {
              const e = workingEntities.get(t.key);
              if (e && ENTITY_META[e].isUnit) {
                unitUpkeepSaved += ENTITY_META[e].upkeep;
                workingEntities.delete(t.key);
                workingGraveyard = new Set(workingGraveyard);
                workingGraveyard.add(t.key);
              }
            }
            if (delta + unitUpkeepSaved < 0) {
              for (const t of territory) {
                const e = workingEntities.get(t.key);
                if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
                  workingEntities.delete(t.key);
                  workingRuins = new Set(workingRuins);
                  workingRuins.add(t.key);
                }
              }
            }
          }
        }
        if (playerBankruptcyOccurred) {
          setEntities(new Map(workingEntities));
          setTerritoryBalances(new Map(workingBalances));
          setGraveyard(new Set(workingGraveyard));
          setRuins(new Set(workingRuins));
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      setLakeUnitFunds(new Map(workingLakeFunds));
      // Dev mode: pause after all AI steps so user can review before player's turn begins
      if (isDeveloperModeRef.current) {
        setIsAiTurnDone(true);
        await new Promise<void>((resolve) => {
          resumeAfterAiRef.current = resolve;
        });
        resumeAfterAiRef.current = null;
        setIsAiTurnDone(false);
      }
      setIsAiTurn(false);
      aiTurnRef.current = false;
      checkWinLoss(workingTileMap);
    },
    [aiOwners, checkWinLoss, awaitStep, triggerUnitAnimation],
  );

  const selectedTerritory = useMemo<HexTile[]>(() => {
    if (!selectedTileKey) return [];
    const tile = activeTileMap.get(selectedTileKey);
    if (!tile || tile.owner !== "player") return [];
    return getContiguousTerritory(activeTileMap, selectedTileKey, "player");
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
    () => new Set(selectedTerritory.map((t) => t.key)),
    [selectedTerritory],
  );

  const selectedTerritoryDefenseCounts = useMemo<{ tower: number; castle: number }>(() => {
    let tower = 0, castle = 0;
    for (const t of selectedTerritory) {
      const e = entities.get(t.key);
      if (e === "tower") tower++;
      else if (e === "castle") castle++;
    }
    return { tower, castle };
  }, [selectedTerritory, entities]);

  const validMoveTiles = useMemo<Set<string>>(() => {
    if (!selectedEntityKey) return new Set();
    const tile = activeTileMap.get(selectedEntityKey);
    if (!tile || tile.owner !== "player") return new Set();
    const entityId = entities.get(selectedEntityKey);
    if (!entityId || !ENTITY_META[entityId].isUnit) return new Set();
    const movingStrength = ENTITY_META[entityId].strength;
    const remaining = partialMoves.get(selectedEntityKey) ?? 3;
    const raw = getValidMoves(
      selectedEntityKey,
      "player",
      entities,
      activeTileMap,
      spentUnits,
      remaining,
    );
    // Remove ally unit tiles where merge is invalid: combined strength > 3, or dest is combat-spent
    for (const k of raw) {
      const destTile = activeTileMap.get(k);
      if (destTile?.owner !== "player") continue;
      const destEntity = entities.get(k);
      if (!destEntity || !ENTITY_META[destEntity].isUnit) continue;
      if (movingStrength + ENTITY_META[destEntity].strength > 3) raw.delete(k);
      else if (combatSpentUnits.has(k)) raw.delete(k);
    }
    return raw;
  }, [
    selectedEntityKey,
    entities,
    activeTileMap,
    spentUnits,
    partialMoves,
    combatSpentUnits,
  ]);

  const fortificationDots = useMemo<Set<string>>(() => {
    let territory: HexTile[];
    if (selectedEntityKey) {
      const selEntity = entities.get(selectedEntityKey);
      if (!selEntity || ENTITY_META[selEntity].isUnit || selEntity === "city")
        return new Set();
      territory = getContiguousTerritory(
        activeTileMap,
        selectedEntityKey,
        "player",
      );
    } else if (
      armedEntityId &&
      !ENTITY_META[armedEntityId].isUnit &&
      armedEntityId !== "city"
    ) {
      territory = selectedTerritory;
    } else {
      return new Set();
    }
    const territoryKeys = new Set(territory.map((t) => t.key));
    const dots = new Set<string>();
    for (const t of territory) {
      const e = entities.get(t.key);
      if (!e || ENTITY_META[e].isUnit || e === "city" || e === "rebel")
        continue;
      dots.add(t.key);
      const [q, r] = t.key.split(",").map(Number);
      for (const {
        dir: [dq, dr],
      } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (territoryKeys.has(nk)) dots.add(nk);
      }
    }
    return dots;
  }, [
    selectedEntityKey,
    armedEntityId,
    selectedTerritory,
    entities,
    activeTileMap,
  ]);

  const validPlacementAttackTiles = useMemo<Set<string>>(() => {
    if (!armedEntityId) return new Set();
    const meta = ENTITY_META[armedEntityId];
    if (!meta.isUnit) return new Set();
    const result = new Set<string>();
    for (const tile of selectedTerritory) {
      if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
      const [q, r] = tile.key.split(",").map(Number);
      for (const {
        dir: [dq, dr],
      } of HEX_EDGES) {
        const nk = tileKey(q + dq, r + dr);
        if (selectedTileKeys.has(nk)) continue;
        const neighbor = activeTileMap.get(nk);
        if (!neighbor) continue;
        if (neighbor.terrain === "mountain" || neighbor.terrain === "lake")
          continue;
        const existingEntity = entities.get(nk);
        if (existingEntity && existingEntity !== "rebel") {
          // buildings with higher strength can't be captured
          if (
            !ENTITY_META[existingEntity].isUnit &&
            meta.strength < ENTITY_META[existingEntity].strength
          )
            continue;
        }
        const enemyZoC = getMaxEnemyZoC(nk, "player", entities, activeTileMap);
        if (meta.strength > enemyZoC) result.add(nk);
      }
    }
    return result;
  }, [
    armedEntityId,
    selectedTerritory,
    selectedTileKeys,
    activeTileMap,
    entities,
  ]);

  const minUnitCost = useMemo(() => {
    return Math.min(
      ...Object.values(ENTITY_META)
        .filter((m) => m.isUnit)
        .map((m) => m.cost),
    );
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

  const territoryHasCity = useMemo(
    () => selectedTerritory.some((t) => cities.has(t.key)),
    [selectedTerritory, cities],
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

  const selectionBorderEdges = useMemo<BorderEdge[]>(() => {
    if (selectedTileKeys.size === 0) return [];
    const edges: BorderEdge[] = [];
    for (const key of selectedTileKeys) {
      const pos = tileDataMap.get(key);
      const tile = tileMap.get(key);
      if (!pos || !tile) continue;
      const { cx, cy } = pos;
      for (const {
        dir: [dq, dr],
        verts: [va, vb],
      } of ORDERED_EDGES) {
        const nk = tileKey(tile.q + dq, tile.r + dr);
        if (selectedTileKeys.has(nk)) continue;
        const ptA = hexCornerPoint(cx, cy, INNER_SIZE, va);
        const ptB = hexCornerPoint(cx, cy, INNER_SIZE, vb);
        edges.push({
          x1: ptA.x,
          y1: ptA.y,
          x2: ptB.x,
          y2: ptB.y,
          color: "#FFFFFF",
          width: BORDER_W,
        });
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
    )
      return cached.result;
    const keys = new Set<string>();
    const visited = new Set<string>();
    const playerFreeTowerUsed =
      freeTowerUsedTiles.get("player") ?? new Set<string>();
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
      // In round 1, only the free tower can be placed — balance spending is locked
      const canAfford = turn === 1 ? towerFree : balance >= minUnitCost;
      if (!canAfford) continue;
      for (const t of territory) keys.add(t.key);
    }
    affordableTerritoryCache.current = {
      activeTileMap,
      territoryBalances,
      freeTowerUsedTiles,
      isAiTurn,
      gameResult,
      turn,
      result: keys,
    };
    return keys;
  }, [
    activeTileMap,
    territoryBalances,
    minUnitCost,
    freeTowerUsedTiles,
    isAiTurn,
    gameResult,
    turn,
  ]);

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
      const now = Date.now();
      if (now - lastTileTapMs.current < 50) return;
      lastTileTapMs.current = now;
      if (isAiTurn || gameResult !== null) return;
      const tile = activeTileMap.get(key);

      if (selectedEntityKey && validMoveTiles.has(key)) {
        const targetTile = activeTileMap.get(key);
        const movingToLake = targetTile?.terrain === "lake";
        const fromTile = activeTileMap.get(selectedEntityKey);
        const fromLake = fromTile?.terrain === "lake";

        if (movingToLake && !fromLake) {
          const sourceTerritory = getContiguousTerritory(
            activeTileMap,
            selectedEntityKey,
            "player",
          );
          const sourceTerrId = getTerritoryId(sourceTerritory);
          if (!sourceTerrId) return;
          const sourceBalance = territoryBalances.get(sourceTerrId) ?? 0;
          const movingEntityType = entities.get(selectedEntityKey);
          const minAmount = movingEntityType
            ? ENTITY_META[movingEntityType].upkeep * 2
            : 2;
          if (sourceBalance < minAmount) {
            triggerErrorFlash(key);
            return;
          }
          setLakeTransferAmount(minAmount);
          setPendingLakeMove({
            fromKey: selectedEntityKey,
            toKey: key,
            sourceTerrId,
            maxAmount: sourceBalance,
            minAmount,
          });
          return;
        }

        const movingEntityId = entities.get(selectedEntityKey);
        const fromKeyForAnim = selectedEntityKey;

        pushHistory();
        const prevTile = activeTileMap.get(key);
        const previousOwner = prevTile?.owner ?? "neutral";
        const newTileMap = new Map(activeTileMap);
        if (targetTile) {
          newTileMap.set(key, { ...targetTile, owner: "player" });
        }
        const newEntities = new Map(entities);
        const movingUnit = newEntities.get(selectedEntityKey)!;
        const existingUnit = newEntities.get(key);
        const isMerge =
          !!existingUnit &&
          existingUnit !== "city" &&
          existingUnit !== "rebel" &&
          ENTITY_META[existingUnit].isUnit &&
          activeTileMap.get(key)?.owner === "player" &&
          ENTITY_META[movingUnit].strength +
            ENTITY_META[existingUnit].strength <=
            3 &&
          !combatSpentUnits.has(key);

        if (isMerge) {
          const merged = mergedUnitType(
            ENTITY_META[movingUnit].strength,
            ENTITY_META[existingUnit!].strength,
          );
          newEntities.delete(selectedEntityKey);
          newEntities.set(key, merged);
        } else {
          // NOTE: cities are in the cities Set (not entities), so
          // existingUnit will never be "city" — unit moves freely onto city tiles.
          newEntities.delete(key);
          newEntities.delete(selectedEntityKey);
          newEntities.set(key, movingUnit);
        }

        const stepsUsed = getMoveCost(selectedEntityKey, key, activeTileMap);
        const prevRemaining = partialMoves.get(selectedEntityKey) ?? 3;
        const remainingAfterMove = movingToLake
          ? 0
          : Math.max(0, prevRemaining - stepsUsed);

        const newSpentUnits = new Set(spentUnits);
        const newPartialMoves = new Map(partialMoves);
        newPartialMoves.delete(selectedEntityKey);
        if (isMerge) {
          const destRemaining =
            newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : 3);
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
        const isCombatMove =
          !isMerge &&
          (previousOwner !== "neutral" || existingUnit !== undefined);
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
        // Exempt the destination tile when landing from a lake — the unit is
        // intentionally establishing a new beachhead, not being cut off.
        const lakeLanding = fromLake && !movingToLake;
        applySingleHexPenalty(
          activeTileMap,
          newTileMap,
          newBalances,
          newEntities,
          newGraveyard,
          newRuins,
          lakeLanding ? key : undefined,
        );

        const newLiveOwnerMap = new Map(liveOwnerMap);
        newLiveOwnerMap.set(key, "player");

        const newLakeFunds = new Map(lakeUnitFunds);
        if (fromLake && movingToLake) {
          const fund = newLakeFunds.get(selectedEntityKey) ?? 0;
          newLakeFunds.delete(selectedEntityKey);
          newLakeFunds.set(key, fund);
          if (fromTile) {
            newTileMap.set(selectedEntityKey, {
              ...fromTile,
              owner: "neutral",
            });
            newLiveOwnerMap.delete(selectedEntityKey);
          }
        } else if (fromLake && !movingToLake) {
          const fund = newLakeFunds.get(selectedEntityKey) ?? 0;
          newLakeFunds.delete(selectedEntityKey);
          const newTerritory = getContiguousTerritory(
            newTileMap,
            key,
            "player",
          );
          const newTerrId = getTerritoryId(newTerritory);
          if (newTerrId && fund > 0) {
            newBalances.set(
              newTerrId,
              (newBalances.get(newTerrId) ?? 0) + fund,
            );
          }
          if (fromTile) {
            newTileMap.set(selectedEntityKey, {
              ...fromTile,
              owner: "neutral",
            });
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
          existingOnTile !== "rebel" &&
          existingOnTile !== "city" &&
          ENTITY_META[existingOnTile].isUnit &&
          activeTileMap.get(key)?.owner === "player";
        const canMerge =
          armedIsUnit &&
          existingIsAllyUnit &&
          ENTITY_META[armedEntityId].strength +
            ENTITY_META[existingOnTile!].strength <=
            3;
        const canOverwriteRebel = armedIsUnit && existingOnTile === "rebel";
        const existingIsBuilding =
          !!existingOnTile &&
          !ENTITY_META[existingOnTile].isUnit &&
          existingOnTile !== "rebel";
        const existingBuildingIsOwn =
          existingIsBuilding && activeTileMap.get(key)?.owner === "player";
        const canOverwriteBuilding =
          armedIsUnit &&
          existingIsBuilding &&
          !existingBuildingIsOwn &&
          ENTITY_META[armedEntityId].strength >=
            ENTITY_META[existingOnTile as EntityType].strength;
        const alreadyOccupied =
          (!!existingOnTile && !canMerge && !canOverwriteRebel && !canOverwriteBuilding) ||
          // prevent placing a second city on an existing city tile
          (armedEntityId === "city" && cities.has(key));
        if (!alreadyOccupied && selectedTerritoryId) {
          const meta = ENTITY_META[armedEntityId];
          const balance = territoryBalances.get(selectedTerritoryId) ?? 0;
          const placingTower = armedEntityId === "tower";
          const playerUsedSet =
            freeTowerUsedTiles.get("player") ?? new Set<string>();
          const towerIsFree =
            placingTower &&
            turn === 1 &&
            selectedTerritory.length >= 2 &&
            !selectedTerritory.some((t) => playerUsedSet.has(t.key));
          const blockedByGraveyard = !meta.isUnit && graveyard.has(key);
          const effectiveCost = towerIsFree ? 0 : meta.cost;
          if (balance >= effectiveCost && !blockedByGraveyard) {
            pushHistory();
            const newEntities = new Map(entities);
            const newSpentUnits = new Set(spentUnits);
            const newPartialMoves = new Map(partialMoves);
            if (canMerge) {
              const merged = mergedUnitType(
                ENTITY_META[armedEntityId].strength,
                ENTITY_META[existingOnTile!].strength,
              );
              newEntities.set(key, merged);
              const existingRemaining =
                newPartialMoves.get(key) ?? (newSpentUnits.has(key) ? 0 : 3);
              const mergedRemaining = Math.min(3, existingRemaining);
              newSpentUnits.delete(key);
              newPartialMoves.delete(key);
              if (mergedRemaining <= 0) {
                newSpentUnits.add(key);
              } else if (mergedRemaining < 3) {
                newPartialMoves.set(key, mergedRemaining);
              }
            } else if (armedEntityId === "city") {
              setCities((prev) => new Set([...prev, key]));
            } else {
              newEntities.set(key, armedEntityId);
              if (canOverwriteRebel) {
                newSpentUnits.add(key);
              }
            }
            setEntities(newEntities);
            setTerritoryBalances((prev) => {
              const next = new Map(prev);
              next.set(selectedTerritoryId, balance - effectiveCost);
              return next;
            });
            if (towerIsFree) {
              setFreeTowerUsedTiles((prev) => {
                const next = new Map(prev);
                const ownerSet = new Set(prev.get("player") ?? []);
                for (const t of selectedTerritory) ownerSet.add(t.key);
                next.set("player", ownerSet);
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
          const previousOwner = (activeTileMap.get(key)?.owner ??
            "neutral") as TerritoryOwner;
          const newTileMap = new Map(activeTileMap);
          const targetTile = newTileMap.get(key);
          if (targetTile)
            newTileMap.set(key, { ...targetTile, owner: "player" });
          const newEntities = new Map(entities);
          if (armedEntityId === "city") {
            setCities((prev) => new Set([...prev, key]));
          } else {
            newEntities.delete(key);
            newEntities.set(key, armedEntityId);
          }
          const newBalances = recalculateTerritoriesForCapture(
            key,
            "player",
            previousOwner,
            activeTileMap,
            newTileMap,
            territoryBalances,
          );
          const mergedTerritory = getContiguousTerritory(
            newTileMap,
            key,
            "player",
          );
          const mergedId = getTerritoryId(mergedTerritory);
          if (mergedId)
            newBalances.set(
              mergedId,
              (newBalances.get(mergedId) ?? 0) - meta.cost,
            );
          const newGraveyard2 = new Set(graveyard);
          const newRuins2 = new Set(ruins);
          applySingleHexPenalty(
            activeTileMap,
            newTileMap,
            newBalances,
            newEntities,
            newGraveyard2,
            newRuins2,
          );
          const newLiveOwnerMap = new Map(liveOwnerMap);
          newLiveOwnerMap.set(key, "player");
          // Placing a unit via attack counts as combat — it cannot be merged with this turn
          const newCombatSpent2 = new Set([...combatSpentUnits, key]);
          setMutableTileMap(newTileMap);
          setLiveOwnerMap(newLiveOwnerMap);
          setEntities(newEntities);
          setTerritoryBalances(newBalances);
          setGraveyard(newGraveyard2);
          setRuins(newRuins2);
          setCombatSpentUnits(newCombatSpent2);
          setSpentUnits((prev) => {
            const next = new Set(prev);
            next.add(key);
            return next;
          });
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
      const isSelectableEntity =
        entityOnTile &&
        entityOnTile !== "city" &&
        entityOnTile !== "rebel" &&
        tile?.owner === "player";
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

      if (!tile || tile.owner !== "player") {
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
    },
    [
      activeTileMap,
      selectedTileKeys,
      armedEntityId,
      entities,
      selectedTerritoryId,
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
      turn,
      freeTowerUsedTiles,
      checkWinLoss,
      pushHistory,
      triggerErrorFlash,
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
        if (tile.owner !== "player" || visited.has(tile.key)) continue;
        const territory = getContiguousTerritory(
          activeTileMap,
          tile.key,
          "player",
        );
        for (const t of territory) visited.add(t.key);
        const territoryId = getTerritoryId(territory);
        if (!territoryId) continue;
        const income = territory.reduce((s, t) => {
          if (nextEntities.get(t.key) === "rebel") return s;
          return (
            s +
            TERRAIN_INCOME[t.terrain] +
            (cities.has(t.key) ? CITY_BONUS : 0)
          );
        }, 0);
        const upkeep = calcTerritoryUpkeep(territory, nextEntities);
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
              if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
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

    // AI income and upkeep start from round 3 (same cadence as the player:
    // neither side earns income in rounds 1 or 2).
    if (turn > 2) {
      for (const aiOwner of aiOwners) {
        const aiVisited = new Set<string>();
        for (const tile of Array.from(activeTileMap.values())) {
          if (tile.owner !== aiOwner || aiVisited.has(tile.key)) continue;
          const territory = getContiguousTerritory(
            activeTileMap,
            tile.key,
            aiOwner,
          );
          for (const t of territory) aiVisited.add(t.key);
          const territoryId = getTerritoryId(territory);
          if (!territoryId) continue;
          if (!nextBalances.has(territoryId)) nextBalances.set(territoryId, 0);
          const income = territory.reduce((s, t) => {
            if (nextEntities.get(t.key) === "rebel") return s;
            return (
              s +
              TERRAIN_INCOME[t.terrain] +
              (cities.has(t.key) ? CITY_BONUS : 0)
            );
          }, 0);
          const incomeModifier =
            aiDifficulty === "super_hard" ? territory.length :
            aiDifficulty === "super_easy" ? -territory.length : 0;
          const upkeep = calcTerritoryUpkeep(territory, nextEntities);
          const current = nextBalances.get(territoryId) ?? 0;
          const delta = income + incomeModifier - upkeep;
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
                if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
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
        if (gravTile?.terrain === "lake") continue;
        if (!nextEntities.has(gravKey) && Math.random() < 0.75) {
          nextEntities = new Map(nextEntities);
          nextEntities.set(gravKey, "rebel");
        }
      }
      for (const ruinKey of Array.from(ruins)) {
        const ruinTile = activeTileMap.get(ruinKey);
        if (ruinTile?.terrain === "lake") continue;
        if (!nextEntities.has(ruinKey) && Math.random() < 0.75) {
          nextEntities = new Map(nextEntities);
          nextEntities.set(ruinKey, "rebel");
        }
      }

      const allOwners: TerritoryOwner[] = [
        "player",
        "ai1",
        "ai2",
        "ai3",
        "ai4",
        "ai5",
      ];
      const preSpawnEntities = nextEntities;
      const rebelSpawns = new Map(nextEntities);
      for (const tile of Array.from(activeTileMap.values())) {
        if (!allOwners.includes(tile.owner)) continue;
        if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
        if (preSpawnEntities.has(tile.key)) continue;
        const [tq, tr] = tile.key.split(",").map(Number);
        const neighborRebelCount = HEX_EDGES.filter(({ dir: [dq, dr] }) => {
          const nk = tileKey(tq + dq, tr + dr);
          return preSpawnEntities.get(nk) === "rebel";
        }).length;
        const chance =
          neighborRebelCount >= 2
            ? 0.1
            : neighborRebelCount === 1
              ? 0.075
              : 0.02;
        if (Math.random() < chance) {
          rebelSpawns.set(tile.key, "rebel");
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
        if (t) nextMutableTileMap.set(lakeKey, { ...t, owner: "neutral" });
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
        if (t) nextMutableTileMap.set(lakeKey, { ...t, owner: "neutral" });
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
    setTurn((t) => t + 1);
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
      runAiTurn(
        nextMutableTileMap,
        nextEntities,
        nextBalances,
        nextLakeFunds,
        turn,
        nextGraveyard,
        nextRuins,
        cities,
      );
    }
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
    graveyard,
    ruins,
    turn,
    cities,
    checkWinLoss,
    runAiTurn,
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
              <Defs>
                {tileData
                  .filter(({ tile }) => tile.terrain === "lake")
                  .map(({ tile, cx, cy }) => (
                    <ClipPath
                      key={`clip-def-${tile.key}`}
                      id={`lclip-${tile.key}`}
                    >
                      <Polygon points={hexCornersString(cx, cy, HEX_SIZE)} />
                    </ClipPath>
                  ))}
                {tileData
                  .filter(({ tile }) => tile.terrain === "mountain")
                  .map(({ tile, cx, cy }) => (
                    <ClipPath
                      key={`mclip-def-${tile.key}`}
                      id={`mclip-${tile.key}`}
                    >
                      <Polygon points={hexCornersString(cx, cy, HEX_SIZE)} />
                    </ClipPath>
                  ))}
              </Defs>
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
                return (
                  <HexCell
                    key={tile.key}
                    tileKey={tile.key}
                    terrain={tile.terrain}
                    cx={cx}
                    cy={cy}
                    hexSize={HEX_SIZE}
                    liveOwner={liveTile.owner}
                    hasSelection={hasSelection}
                    isCityZone={isCityZone}
                    cityBuffer={tile.cityBuffer ?? false}
                  />
                );
              })}

              {tileData
                .filter(({ tile }) => tile.terrain === "lake")
                .map(({ tile, cx, cy }) => {
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

              {tileData
                .filter(({ tile }) => tile.terrain === "mountain")
                .map(({ tile, cx, cy }) => {
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

              {tileData
                .filter(({ tile }) => cities.has(tile.key))
                .map(({ tile, cx, cy }) => {
                  const liveTile = activeTileMap.get(tile.key) ?? tile;
                  const cityBorderColor =
                    TERRITORY_BORDERS[liveTile.owner] ?? "#888888";
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
                        {ENTITY_META.city.icon}
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

              {hasSelection &&
                borderEdges.map((edge, i) => (
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

              {hasSelection &&
                selectionBorderEdges.map((edge, i) => (
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

              {graveyard.size > 0 &&
                Array.from(graveyard).map((key) => {
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

              {ruins.size > 0 &&
                Array.from(ruins).map((key) => {
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

              {validMoveTiles.size > 0 &&
                Array.from(validMoveTiles).map((key) => {
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

              {armedEntityId &&
                Array.from(validPlacementAttackTiles).map((key) => {
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

              {errorTileKey &&
                (() => {
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

            <Animated.View
              style={[StyleSheet.absoluteFillObject, territoryPulseStyle]}
              pointerEvents="none"
            >
              <Svg width={boardW} height={boardH}>
                {Array.from(affordableTerritoryTileKeys).map((key) => {
                  const pos = tileDataMap.get(key);
                  if (!pos) return null;
                  const tile = activeTileMap.get(key);
                  if (
                    !tile ||
                    tile.terrain === "mountain" ||
                    tile.terrain === "lake"
                  )
                    return null;
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

            <View
              style={StyleSheet.absoluteFillObject}
              pointerEvents="box-none"
            >
              <Svg width={boardW} height={boardH}>
                {Array.from(entities.entries()).map(([key, entityId]) => {
                  if (entityId === "city") return null;
                  if (animatingUnit && key === animatingUnit.fromKey)
                    return null;
                  if (
                    animatingUnit &&
                    animatingUnit.hideDestination &&
                    key === animatingUnit.toKey
                  )
                    return null;
                  const pos = tileDataMap.get(key);
                  if (!pos) return null;
                  const meta = ENTITY_META[entityId];
                  const isRebel = entityId === "rebel";
                  const isBuilding = !meta.isUnit && !isRebel;
                  const r = HEX_SIZE * 0.5;
                  const isSelected = selectedEntityKey === key;
                  const isSpent = spentUnits.has(key);
                  const liveTile = activeTileMap.get(key);
                  const isPlayerUnit =
                    liveTile?.owner === "player" && meta.isUnit;
                  const isIdleBouncing =
                    isPlayerUnit && !isSpent && !isSelected;
                  if (isIdleBouncing) return null;
                  const bgColor = isRebel
                    ? "rgba(140,20,20,0.92)"
                    : isSelected
                      ? "rgba(20,80,20,0.95)"
                      : meta.isUnit
                        ? "rgba(30,50,120,0.9)"
                        : "rgba(80,40,10,0.9)";
                  const ownerColor =
                    TERRITORY_BORDERS[liveTile?.owner ?? ""] ?? "#FFD700";
                  const strokeColor = isRebel
                    ? "#FFD700"
                    : isSelected
                      ? "#50FF50"
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

            {fortificationDots.size > 0 && (
              <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <Svg width={boardW} height={boardH}>
                  {Array.from(fortificationDots).map((key) => {
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
                {Array.from(validMoveTiles).map((key) => {
                  const pos = tileDataMap.get(key);
                  if (!pos) return null;
                  const tileOwner = activeTileMap.get(key)?.owner;
                  const hasRebel = entities.get(key) === "rebel";
                  const isAttackMove =
                    (tileOwner !== "player" && tileOwner !== undefined) ||
                    hasRebel;
                  return (
                    <Circle
                      key={`move-dot-${key}`}
                      cx={pos.cx}
                      cy={pos.cy}
                      r={HEX_SIZE * 0.18}
                      fill={
                        isAttackMove
                          ? "rgba(220,40,40,0.85)"
                          : "rgba(255,220,0,0.85)"
                      }
                    />
                  );
                })}

                {armedEntityId &&
                  Array.from(selectedTileKeys).map((key) => {
                    const pos = tileDataMap.get(key);
                    if (!pos) return null;
                    // For buildings: only show dot on empty, non-graveyard tiles not already showing a blue fortification dot
                    if (armedEntityId && !ENTITY_META[armedEntityId].isUnit) {
                      if (
                        entities.get(key) ||
                        graveyard.has(key) ||
                        fortificationDots.has(key)
                      )
                        return null;
                    }
                    // For units: skip tiles occupied by own buildings (tower/castle/city) — can't place there
                    if (armedEntityId && ENTITY_META[armedEntityId].isUnit) {
                      const existingEntity = entities.get(key);
                      if (
                        existingEntity &&
                        !ENTITY_META[existingEntity].isUnit &&
                        existingEntity !== "rebel" &&
                        activeTileMap.get(key)?.owner === "player"
                      )
                        return null;
                    }
                    const isRebelTarget =
                      ENTITY_META[armedEntityId].isUnit &&
                      entities.get(key) === "rebel";
                    return (
                      <Circle
                        key={`place-dot-${key}`}
                        cx={pos.cx}
                        cy={pos.cy}
                        r={HEX_SIZE * 0.18}
                        fill={
                          isRebelTarget
                            ? "rgba(220,40,40,0.85)"
                            : "rgba(255,220,0,0.85)"
                        }
                      />
                    );
                  })}

                {armedEntityId &&
                  Array.from(validPlacementAttackTiles).map((key) => {
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

