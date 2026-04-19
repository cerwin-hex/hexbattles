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
  CITY_NEUTRAL_FILL,
  TERRAIN_FILLS,
  TERRITORY_BORDERS,
  TERRITORY_FILLS,
} from "@/constants/colors";
import {
  CITY_BONUS,
  ENTITY_META,
  EntityType,
  HEX_EDGES,
  HexTile,
  TERRAIN_INCOME,
  TerritoryOwner,
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

const BTN_H = 52;
const BOTTOM_BAR_H = BTN_H + 20;
const RIBBON_H = 130;
const ENTITY_PANEL_H = 72;
const EXTRA_PAN = 150;

const ORDERED_EDGES: ReadonlyArray<{
  dir: [number, number];
  verts: [number, number];
}> = [
  { dir: [1, 0], verts: [0, 1] },
  { dir: [0, 1], verts: [1, 2] },
  { dir: [-1, 1], verts: [2, 3] },
  { dir: [-1, 0], verts: [3, 4] },
  { dir: [0, -1], verts: [4, 5] },
  { dir: [1, -1], verts: [5, 0] },
];

const PURCHASABLES = (Object.keys(ENTITY_META) as EntityType[])
  .filter((id) => id !== "rebel")
  .map((id) => ({
    id,
    ...ENTITY_META[id],
  }));
const UNIT_PURCHASABLES = PURCHASABLES.filter((p) => p.isUnit);
const BUILDING_PURCHASABLES = PURCHASABLES.filter((p) => !p.isUnit);

function calcTerritoryUpkeep(
  territory: HexTile[],
  ents: Map<string, EntityType>,
): number {
  let towers = 0, castles = 0, unitUpkeep = 0;
  for (const t of territory) {
    const e = ents.get(t.key);
    if (!e) continue;
    if (e === "tower") towers++;
    else if (e === "castle") castles++;
    else unitUpkeep += ENTITY_META[e].upkeep;
  }
  return unitUpkeep + calcDefenseUpkeep("tower", towers) + calcDefenseUpkeep("castle", castles);
}

// Wipe out newly-isolated single-hex territories: zero balance, kill units→graveyard, remove buildings.
// Only fires for tiles that were NOT already lone-hex before the current move (prevTileMap).
function applySingleHexPenalty(
  prevTileMap: Map<string, HexTile>,
  tileMap: Map<string, HexTile>,
  balances: Map<string, number>,
  entities: Map<string, EntityType>,
  graveyard: Set<string>,
  ruins: Set<string>,
  exemptKey?: string,
): void {
  const allOwners = new Set<TerritoryOwner>([
    "player",
    "ai1",
    "ai2",
    "ai3",
    "ai4",
    "ai5",
  ]);
  const visited = new Set<string>();
  for (const tile of tileMap.values()) {
    if (!allOwners.has(tile.owner as TerritoryOwner) || visited.has(tile.key))
      continue;
    if (tile.terrain === "mountain" || tile.terrain === "lake") continue;
    const territory = getContiguousTerritory(
      tileMap,
      tile.key,
      tile.owner as TerritoryOwner,
    );
    for (const t of territory) visited.add(t.key);
    if (territory.length !== 1) continue;
    const singleKey = territory[0].key;
    // Never penalise a tile that was just freshly captured/landed on — it is
    // expansion (e.g. naval landing), not an enemy-induced isolation.
    if (exemptKey && singleKey === exemptKey) continue;
    // Skip if this tile was already isolated before this move — it is not newly cut off
    const prevOwner = prevTileMap.get(singleKey)?.owner;
    if (prevOwner === tile.owner) {
      const prevTerritory = getContiguousTerritory(
        prevTileMap,
        singleKey,
        tile.owner as TerritoryOwner,
      );
      if (prevTerritory.length === 1) continue;
    }
    const id = getTerritoryId(territory);
    if (id) balances.set(id, 0);
    const entity = entities.get(singleKey);
    if (entity) {
      entities.delete(singleKey);
      if (ENTITY_META[entity].isUnit) {
        graveyard.add(singleKey);
      } else if (entity !== "rebel" && entity !== "city") {
        ruins.add(singleKey);
      }
    }
  }
}

const STRENGTH_TO_UNIT: Record<number, EntityType> = {
  1: "simple_unit",
  2: "advanced_unit",
  3: "expert_unit",
};

function mergedUnitType(strA: number, strB: number): EntityType {
  const total = Math.min(strA + strB, 3);
  return STRENGTH_TO_UNIT[total] ?? "expert_unit";
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
  const owners: TerritoryOwner[] = [
    "player",
    "ai1",
    "ai2",
    "ai3",
    "ai4",
    "ai5",
  ];
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
  type Difficulty = "super_easy" | "easy" | "medium" | "hard" | "super_hard";
  type AiState = "attacking" | "defending";

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
      // Cities are now tracked purely via tile.isCity (permanent flag on HexTile).
      // No "city" entity is stored in the entities map — cities can never be
      // removed, and units can occupy city tiles without erasing the city.
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
    ) => {
      let workingTileMap = new Map(currentTileMap);
      let workingEntities = new Map(currentEntities);
      let workingBalances = new Map(currentBalances);
      let workingLiveOwnerMap = new Map<string, TerritoryOwner>();
      let workingGraveyard = new Set(initialGraveyard ?? graveyardRef.current);
      let workingRuins = new Set(initialRuins ?? ruinsRef.current);
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

          // ─── Decision Tree Helpers (closures over working* state) ─────────

          // Count contiguous clusters of an owner in a (possibly simulated) tile map
          const dtCountClusters = (owner: TerritoryOwner, simMap: Map<string, HexTile>): number => {
            const tiles = Array.from(simMap.values()).filter(
              (t) => t.owner === owner && t.terrain !== "mountain" && t.terrain !== "lake",
            );
            const vis = new Set<string>();
            let cnt = 0;
            for (const tile of tiles) {
              if (vis.has(tile.key)) continue;
              cnt++;
              const q = [tile.key];
              vis.add(tile.key);
              while (q.length > 0) {
                const curr = q.shift()!;
                const [cq, cr] = curr.split(",").map(Number);
                for (const { dir: [dq, dr] } of HEX_EDGES) {
                  const nk = tileKey(cq + dq, cr + dr);
                  if (vis.has(nk)) continue;
                  const nt = simMap.get(nk);
                  if (nt && nt.owner === owner && nt.terrain !== "mountain" && nt.terrain !== "lake") {
                    vis.add(nk);
                    q.push(nk);
                  }
                }
              }
            }
            return cnt;
          };

          // Split score: extra clusters created for enemyOwner by capturing captureKey
          const dtSplitScore = (captureKey: string, enemyOwner: TerritoryOwner): number => {
            const capTile = workingTileMap.get(captureKey);
            if (!capTile || capTile.owner !== enemyOwner) return 0;
            const [cq, cr] = captureKey.split(",").map(Number);
            const adjOwnerCount = HEX_EDGES.filter(({ dir: [dq, dr] }) => {
              const nk = tileKey(cq + dq, cr + dr);
              const nt = workingTileMap.get(nk);
              return nt && nt.owner === enemyOwner;
            }).length;
            if (adjOwnerCount < 2) return 0;
            const before = dtCountClusters(enemyOwner, workingTileMap);
            const simMap = new Map(workingTileMap);
            simMap.set(captureKey, { ...capTile, owner: aiOwner });
            return dtCountClusters(enemyOwner, simMap) - before;
          };

          // Would capturing captureKey cause the enemy territory to go bankrupt next round?
          const dtCaptureNegatesIncome = (captureKey: string, enemyOwner: TerritoryOwner): boolean => {
            const capTile = workingTileMap.get(captureKey);
            if (!capTile || capTile.owner !== enemyOwner) return false;
            const origTerr = getContiguousTerritory(workingTileMap, captureKey, enemyOwner);
            const origId = getTerritoryId(origTerr);
            const enemyBal = origId ? (workingBalances.get(origId) ?? 0) : 0;
            const simMap = new Map(workingTileMap);
            simMap.set(captureKey, { ...capTile, owner: aiOwner });
            const simEntities = new Map(workingEntities);
            simEntities.delete(captureKey);
            const anyRemaining = Array.from(simMap.values()).find((t) => t.owner === enemyOwner);
            if (!anyRemaining) return true;
            const remTerr = getContiguousTerritory(simMap, anyRemaining.key, enemyOwner);
            const remIncome = remTerr.reduce((s, t) => {
              if (simEntities.get(t.key) === "rebel") return s;
              return s + (TERRAIN_INCOME[t.terrain] ?? 0) + (t.isCity || simEntities.get(t.key) === "city" ? CITY_BONUS : 0);
            }, 0);
            const remUpkeep = calcTerritoryUpkeep(remTerr, simEntities);
            return enemyBal + (remIncome - remUpkeep) < 0;
          };

          // Does capturing captureKey leave any enemy component with exactly 1 tile (instant kill)?
          const dtCaptureCreatesOneHex = (captureKey: string, enemyOwner: TerritoryOwner): boolean => {
            const capTile = workingTileMap.get(captureKey);
            if (!capTile || capTile.owner !== enemyOwner) return false;
            const simMap = new Map(workingTileMap);
            simMap.set(captureKey, { ...capTile, owner: aiOwner });
            const vis = new Set<string>();
            for (const t of Array.from(simMap.values())) {
              if (t.owner !== enemyOwner || vis.has(t.key)) continue;
              const comp = getContiguousTerritory(simMap, t.key, enemyOwner);
              for (const ct of comp) vis.add(ct.key);
              if (comp.length === 1) return true;
            }
            return false;
          };

          // BFS first step: walk from fromKey toward targetKey; only return steps in validMoves
          const dtBfsStep = (fromKey: string, targetKey: string, validMoves: Set<string>): string | null => {
            if (fromKey === targetKey) return null;
            if (validMoves.has(targetKey)) return targetKey;
            const prev = new Map<string, string>();
            const vis = new Set<string>([fromKey]);
            const q: string[] = [fromKey];
            while (q.length > 0) {
              const curr = q.shift()!;
              const [cq, cr] = curr.split(",").map(Number);
              for (const { dir: [dq, dr] } of HEX_EDGES) {
                const nk = tileKey(cq + dq, cr + dr);
                if (vis.has(nk)) continue;
                const nt = workingTileMap.get(nk);
                if (!nt || nt.terrain === "mountain") continue;
                vis.add(nk);
                prev.set(nk, curr);
                if (nk === targetKey) {
                  let step = nk;
                  while (prev.get(step) !== fromKey) {
                    const p = prev.get(step);
                    if (!p) break;
                    step = p;
                  }
                  return validMoves.has(step) ? step : null;
                }
                q.push(nk);
              }
            }
            return null;
          };

          // Is there at least one non-lake, conquerable land tile reachable from a lake tile?
          // unitStrength must be > ZoC on any enemy/neutral land tile for it to count as a valid target.
          const dtLakeHasLandTarget = (lakeKey: string, unitStrength: number): boolean => {
            const vis = new Set<string>([lakeKey]);
            const q = [lakeKey];
            while (q.length > 0) {
              const curr = q.shift()!;
              const [cq, cr] = curr.split(",").map(Number);
              for (const { dir: [dq, dr] } of HEX_EDGES) {
                const nk = tileKey(cq + dq, cr + dr);
                if (vis.has(nk)) continue;
                vis.add(nk);
                const nt = workingTileMap.get(nk);
                if (!nt || nt.terrain === "mountain") continue;
                if (nt.terrain !== "lake") {
                  if (nt.owner === aiOwner) {
                    // Friendly land tile — always a safe landing spot
                    if (!workingEntities.has(nk)) return true;
                  } else {
                    // Enemy/neutral tile — only valid if we can actually conquer it
                    const zoc = getMaxEnemyZoC(nk, aiOwner, workingEntities, workingTileMap);
                    if (unitStrength > zoc) return true;
                  }
                } else {
                  q.push(nk);
                }
              }
            }
            return false;
          };

          // Only move onto a lake if there's a split opportunity reachable on the far side
          const dtLakeHasSplitOpportunity = (lakeKey: string, unitStrength: number): boolean => {
            const vis = new Set<string>([lakeKey]);
            const q = [lakeKey];
            while (q.length > 0) {
              const curr = q.shift()!;
              const [cq, cr] = curr.split(",").map(Number);
              for (const { dir: [dq, dr] } of HEX_EDGES) {
                const nk = tileKey(cq + dq, cr + dr);
                if (vis.has(nk)) continue;
                vis.add(nk);
                const nt = workingTileMap.get(nk);
                if (!nt || nt.terrain === "mountain") continue;
                if (nt.terrain !== "lake") {
                  if (nt.owner === aiOwner || nt.owner === "neutral") continue;
                  const zoc = getMaxEnemyZoC(nk, aiOwner, workingEntities, workingTileMap);
                  if (unitStrength > zoc) {
                    const eOwner2 = nt.owner as TerritoryOwner;
                    if (dtSplitScore(nk, eOwner2) > 0 || dtCaptureNegatesIncome(nk, eOwner2) || dtCaptureCreatesOneHex(nk, eOwner2)) {
                      return true;
                    }
                  }
                } else {
                  q.push(nk);
                }
              }
            }
            return false;
          };

          // Min distance from a tile to any owned defense building (tower/castle) in this AI
          const dtDefenseMinDist = (tk: string): number => {
            const [tq, tr] = tk.split(",").map(Number);
            let minD = Infinity;
            for (const [bk, be] of workingEntities) {
              if (be !== "tower" && be !== "castle") continue;
              const bt = workingTileMap.get(bk);
              if (!bt || bt.owner !== aiOwner) continue;
              const [bq2, br2] = bk.split(",").map(Number);
              const d = hexDistance(tq, tr, bq2, br2);
              if (d < minD) minD = d;
            }
            return minD;
          };

          // Filter placement candidates by spacing from existing defenses.
          // Prefer ≥3 tiles away; fallback to ≥2; never adjacent (≤1).
          const dtSpacedPlacements = (candidates: HexTile[]): HexTile[] => {
            const best = candidates.filter((t) => dtDefenseMinDist(t.key) >= 3);
            if (best.length > 0) return best;
            return candidates.filter((t) => dtDefenseMinDist(t.key) >= 2);
          };

          // Find a merge move (from → to) that creates a unit of requiredStr able to reach any targetKey.
          const dtFindMergeMove = (
            requiredStr: number,
            targetKeys: Set<string>,
            units: [string, EntityType][],
          ): { from: string; to: string } | null => {
            if (units.length < 2 || targetKeys.size === 0) return null;
            for (let i = 0; i < units.length; i++) {
              for (let j = 0; j < units.length; j++) {
                if (i === j) continue;
                const [uk1, ue1] = units[i];
                const [uk2, ue2] = units[j];
                const str1 = ENTITY_META[ue1].strength;
                const str2 = ENTITY_META[ue2].strength;
                const mergedStr = str1 + str2;
                if (mergedStr > 3 || mergedStr < requiredStr) continue;
                const range1 = workingPartialMoves.get(uk1) ?? 3;
                const vm1 = getValidMoves(uk1, aiOwner, workingEntities, workingTileMap, workingSpentUnits, range1);
                if (!vm1.has(uk2)) continue;
                // Simulate the merged unit's remaining range
                const stepsUsed = getMoveCost(uk1, uk2, workingTileMap);
                const remainingAfterMerge = Math.max(0, range1 - stepsUsed);
                const destRemaining = workingPartialMoves.get(uk2) ?? 3;
                const mergedRemaining = Math.min(remainingAfterMerge, destRemaining);
                const tempEntities = new Map(workingEntities);
                tempEntities.delete(uk1);
                tempEntities.set(uk2, mergedUnitType(str1, str2));
                const vmMerged = getValidMoves(uk2, aiOwner, tempEntities, workingTileMap, new Set(), mergedRemaining);
                for (const tk of targetKeys) {
                  if (vmMerged.has(tk)) return { from: uk1, to: uk2 };
                }
              }
            }
            return null;
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

            if (destExisting === "city") {
              // City capture: city is permanent — stays on the tile.
              // The capturing unit is consumed (deleted); city entity remains.
              workingEntities.delete(fromKey);
              // Spend & recalculate
              workingSpentUnits = new Set(workingSpentUnits);
              workingSpentUnits.add(toKey);
              workingPartialMoves = new Map(workingPartialMoves);
              workingPartialMoves.delete(fromKey);
              workingPartialMoves.delete(toKey);
              workingBalances = recalculateTerritoriesForCapture(
                toKey, aiOwner, previousOwner, prevTileMapSnapshot, workingTileMap, workingBalances,
              );
              workingLiveOwnerMap = new Map(workingLiveOwnerMap);
              workingLiveOwnerMap.set(toKey, aiOwner);
              workingGraveyard = new Set(workingGraveyard);
              workingGraveyard.delete(toKey);
              applySingleHexPenalty(
                prevTileMapSnapshot, workingTileMap, workingBalances, workingEntities,
                workingGraveyard, workingRuins,
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
            } else if (isAllyMerge) {
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
              workingEntities.set(target, unitType);
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
              workingEntities.delete(target);
              workingEntities.set(target, unitType);
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
            workingEntities = new Map(workingEntities);
            workingEntities.set(targetKey, buildingType);
            workingBalances = new Map(workingBalances);
            const buyTerr = getContiguousTerritory(workingTileMap, startTile.key, aiOwner);
            const buyTid = getTerritoryId(buyTerr);
            if (buyTid) workingBalances.set(buyTid, (workingBalances.get(buyTid) ?? 0) - cost);
            setEntities(new Map(workingEntities));
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

          // ─── Decision Tree Loop ──────────────────────────────────────────

          let dtIter = 0;
          while (dtIter++ < 100) {
            if (!aiTurnRef.current) return;

            // Recompute fresh territory state on each iteration (actions change the map)
            const currTerr = getContiguousTerritory(workingTileMap, startTile.key, aiOwner);
            if (currTerr.length === 0) break;
            const currTerrKeys = new Set(currTerr.map((t) => t.key));
            const currTid = getTerritoryId(currTerr);
            if (!currTid) break;
            const currBal = workingBalances.get(currTid) ?? 0;

            const currIncome = currTerr.reduce((s, t) => {
              if (workingEntities.get(t.key) === "rebel") return s;
              return s + (TERRAIN_INCOME[t.terrain] ?? 0) + (t.isCity || workingEntities.get(t.key) === "city" ? CITY_BONUS : 0);
            }, 0);
            const currUpkeep = calcTerritoryUpkeep(currTerr, workingEntities);

            // canAfford: can we spend `cost` without pushing income below running costs?
            const canAfford = (cost: number, extraUpkeep: number = 0): boolean =>
              currBal >= cost && currIncome - (currUpkeep + extraUpkeep) >= 0;

            // Compute max AI strength and border tiles
            const currMaxStr = currTerr.reduce((best, t) => {
              const e = workingEntities.get(t.key);
              return e && ENTITY_META[e].isUnit ? Math.max(best, ENTITY_META[e].strength) : best;
            }, 0);

            const currBorderTiles = currTerr.filter((t) => {
              const [tq, tr] = t.key.split(",").map(Number);
              return HEX_EDGES.some(({ dir: [dq, dr] }) => {
                const nk = tileKey(tq + dq, tr + dr);
                const nb = workingTileMap.get(nk);
                return !!nb && nb.owner !== aiOwner;
              });
            });

            // Precompute all tile keys belonging to territories ADJACENT to this AI territory
            const adjacentEnemyTileKeys = new Set<string>();
            {
              const visitedAdj = new Set<string>();
              for (const bt of currBorderTiles) {
                const [bq, br] = bt.key.split(",").map(Number);
                for (const { dir: [dq, dr] } of HEX_EDGES) {
                  const nk = tileKey(bq + dq, br + dr);
                  const nt = workingTileMap.get(nk);
                  if (!nt || nt.owner === aiOwner || nt.owner === "neutral" || visitedAdj.has(nk)) continue;
                  visitedAdj.add(nk);
                  const adjTerr = getContiguousTerritory(workingTileMap, nk, nt.owner as TerritoryOwner);
                  for (const t of adjTerr) adjacentEnemyTileKeys.add(t.key);
                }
              }
            }

            // Find the strongest threatening enemy unit on an ADJACENT territory within 3 tiles of any border tile
            let strongerEnemy: { key: string; entity: EntityType; strength: number; owner: TerritoryOwner } | null = null;
            for (const bt of currBorderTiles) {
              const [bq, br] = bt.key.split(",").map(Number);
              for (const [ek, ee] of workingEntities) {
                if (!ENTITY_META[ee].isUnit) continue;
                const et = workingTileMap.get(ek);
                if (!et || et.owner === aiOwner || et.owner === "neutral") continue;
                if (!adjacentEnemyTileKeys.has(ek)) continue; // must be on an adjacent territory
                const [eq, er] = ek.split(",").map(Number);
                if (hexDistance(bq, br, eq, er) <= 3 && ENTITY_META[ee].strength > currMaxStr) {
                  if (!strongerEnemy || ENTITY_META[ee].strength > strongerEnemy.strength) {
                    strongerEnemy = { key: ek, entity: ee, strength: ENTITY_META[ee].strength, owner: et.owner as TerritoryOwner };
                  }
                }
              }
            }

            const currAiState: AiState = strongerEnemy ? "defending" : "attacking";
            aiStateMapRef.current = new Map(aiStateMapRef.current);
            aiStateMapRef.current.set(currTid, currAiState);
            setAiStateMap(new Map(aiStateMapRef.current));

            // Unspent units inside THIS territory only
            const availUnits = Array.from(workingEntities.entries()).filter(([k, e]) => {
              const t = workingTileMap.get(k);
              return t?.owner === aiOwner && ENTITY_META[e].isUnit && !workingSpentUnits.has(k) && currTerrKeys.has(k);
            });

            // Difficulty skip: Easy/Medium occasionally skip one full decision-tree iteration
            const skipChance = difficulty === "easy" ? 0.4 : difficulty === "medium" ? 0.2 : 0;
            if (skipChance > 0 && Math.random() < skipChance) continue;

            let actionTaken = false;

            // ══ PRIORITY 0: Retreat lake units that no longer have a split opportunity ══
            // Lake tiles are excluded from currTerrKeys by getContiguousTerritory, so we
            // must scan ALL AI-owned entities on lake tiles directly (not just availUnits).
            if (!actionTaken) {
              for (const [uk, ue] of workingEntities) {
                if (actionTaken) break;
                if (!ENTITY_META[ue].isUnit) continue;
                if (workingSpentUnits.has(uk)) continue;
                const ut = workingTileMap.get(uk);
                if (!ut || ut.owner !== aiOwner || ut.terrain !== "lake") continue;
                if (dtLakeHasSplitOpportunity(uk, ENTITY_META[ue].strength)) continue;
                // Specialized BFS: traverse lake tiles AND land tiles to find nearest own land.
                // getValidMoves has a continue after lake tiles (no chaining), so we do a raw BFS.
                const retreatVis = new Set<string>([uk]);
                const retreatQ: string[] = [uk];
                const retreatPrev = new Map<string, string>();
                let retreatTarget: string | null = null;
                bfsLakeRetreat: while (retreatQ.length > 0) {
                  const curr = retreatQ.shift()!;
                  const ct = workingTileMap.get(curr);
                  if (!ct) continue;
                  const [cq2, cr2] = curr.split(",").map(Number);
                  for (const { dir: [dq, dr] } of HEX_EDGES) {
                    const nk = tileKey(cq2 + dq, cr2 + dr);
                    if (retreatVis.has(nk)) continue;
                    const nt = workingTileMap.get(nk);
                    if (!nt || nt.terrain === "mountain") continue;
                    if (workingEntities.has(nk)) continue;
                    retreatVis.add(nk);
                    retreatPrev.set(nk, curr);
                    if (nt.owner === aiOwner && nt.terrain !== "lake") {
                      retreatTarget = nk;
                      break bfsLakeRetreat;
                    }
                    retreatQ.push(nk);
                  }
                }
                if (retreatTarget) {
                  // Walk back from retreatTarget to find the first step from uk
                  let firstStep = retreatTarget;
                  while (retreatPrev.get(firstStep) !== uk) {
                    const p = retreatPrev.get(firstStep);
                    if (!p) break;
                    firstStep = p;
                  }
                  actionTaken = await dtExecMove(uk, firstStep);
                } else {
                  // No retreat path — mark spent to avoid infinite loop
                  workingSpentUnits = new Set(workingSpentUnits);
                  workingSpentUnits.add(uk);
                }
              }
            }

            // ══ PRIORITY 1 (DEFENDING): Attack to split stronger enemy's territory ══
            if (!actionTaken && currAiState === "defending" && strongerEnemy) {
              const eOwner = strongerEnemy.owner;
              type SplitCand = { fk: string; tk: string; score: number; neg: boolean; oneHex: boolean };
              const cands: SplitCand[] = [];
              for (const [uk, ue] of availUnits) {
                const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                for (const mk of vm) {
                  const mt = workingTileMap.get(mk);
                  if (!mt || mt.owner !== eOwner) continue;
                  const zoc = getMaxEnemyZoC(mk, aiOwner, workingEntities, workingTileMap);
                  if (ENTITY_META[ue].strength <= zoc) continue;
                  if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength)) continue;
                  const score = dtSplitScore(mk, eOwner);
                  const neg = dtCaptureNegatesIncome(mk, eOwner);
                  const oneHex = dtCaptureCreatesOneHex(mk, eOwner);
                  cands.push({ fk: uk, tk: mk, score, neg, oneHex });
                }
              }
              if (cands.length > 0) {
                cands.sort((a, b) => {
                  if (a.oneHex !== b.oneHex) return a.oneHex ? -1 : 1;
                  if (a.neg !== b.neg) return a.neg ? -1 : 1;
                  return b.score - a.score;
                });
                if (cands[0].score > 0 || cands[0].neg || cands[0].oneHex) {
                  actionTaken = await dtExecMove(cands[0].fk, cands[0].tk);
                }
              }
              // Merge step: prepare a stronger unit for next iteration to achieve the split
              if (!actionTaken) {
                const splitTargets = new Set(
                  Array.from(workingTileMap.values())
                    .filter((t) => {
                      if (t.owner !== eOwner || t.terrain === "mountain") return false;
                      return dtSplitScore(t.key, eOwner) > 0 || dtCaptureNegatesIncome(t.key, eOwner) || dtCaptureCreatesOneHex(t.key, eOwner);
                    })
                    .map((t) => t.key),
                );
                const merge = dtFindMergeMove(strongerEnemy.strength, splitTargets, availUnits);
                if (merge) actionTaken = await dtExecMove(merge.from, merge.to);
              }
              // Fallback: attack the tile that minimises the area with most units in enemy territory
              if (!actionTaken) {
                let bestAttack: { fk: string; tk: string; sz: number } | null = null;
                for (const [uk, ue] of availUnits) {
                  const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                  for (const mk of vm) {
                    const mt = workingTileMap.get(mk);
                    if (!mt || mt.owner !== eOwner) continue;
                    const zoc = getMaxEnemyZoC(mk, aiOwner, workingEntities, workingTileMap);
                    if (ENTITY_META[ue].strength <= zoc) continue;
                    if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength)) continue;
                    const simMap = new Map(workingTileMap);
                    simMap.set(mk, { ...mt, owner: aiOwner });
                    let totalSz = 0;
                    const vis2 = new Set<string>();
                    for (const t of Array.from(simMap.values())) {
                      if (t.owner !== eOwner || vis2.has(t.key)) continue;
                      const comp = getContiguousTerritory(simMap, t.key, eOwner);
                      const hasE = comp.some((ct) => {
                        const ce = workingEntities.get(ct.key);
                        return ce && ENTITY_META[ce].strength > 0;
                      });
                      if (hasE) totalSz += comp.length;
                      for (const ct of comp) vis2.add(ct.key);
                    }
                    if (!bestAttack || totalSz < bestAttack.sz) bestAttack = { fk: uk, tk: mk, sz: totalSz };
                  }
                }
                if (bestAttack) actionTaken = await dtExecMove(bestAttack.fk, bestAttack.tk);
              }
            }

            // ══ PRIORITY 2 (DEFENDING): Defend against the stronger enemy unit ══
            if (!actionTaken && currAiState === "defending" && strongerEnemy) {
              const eStr = strongerEnemy.strength;
              const [seqE, serE] = strongerEnemy.key.split(",").map(Number);

              // Step 1: Upgrade existing building to match enemy strength
              for (const t of currTerr) {
                if (actionTaken) break;
                const e = workingEntities.get(t.key);
                if (!e || ENTITY_META[e].isUnit) continue;
                const up = UNIT_UPGRADE[e];
                if (!up || ENTITY_META[up].strength < eStr) continue;
                const upgCost = ENTITY_META[up].cost - ENTITY_META[e].cost;
                const dUpk = ENTITY_META[up].upkeep - ENTITY_META[e].upkeep;
                if (canAfford(upgCost, dUpk)) actionTaken = await dtExecUpgrade(t.key, up, upgCost);
              }

              // Step 2: Upgrade an existing unit within 5 tiles, then move toward enemy
              if (!actionTaken) {
                for (const [uk, ue] of availUnits) {
                  if (actionTaken) break;
                  const [uq, ur] = uk.split(",").map(Number);
                  if (hexDistance(uq, ur, seqE, serE) > 5) continue;
                  const up = UNIT_UPGRADE[ue];
                  if (!up || ENTITY_META[up].strength < eStr) continue;
                  const upgCost = ENTITY_META[up].cost - ENTITY_META[ue].cost;
                  const dUpk = ENTITY_META[up].upkeep - ENTITY_META[ue].upkeep;
                  if (canAfford(upgCost, dUpk)) actionTaken = await dtExecUpgrade(uk, up, upgCost);
                }
              }

              // Step 3: Buy a unit of equal strength on a border tile close to the threat
              if (!actionTaken) {
                for (const uType of (["simple_unit", "advanced_unit", "expert_unit"] as EntityType[])) {
                  if (actionTaken) break;
                  if (ENTITY_META[uType].strength < eStr) continue;
                  const uCost = ENTITY_META[uType].cost;
                  const uUpk = ENTITY_META[uType].upkeep;
                  if (!canAfford(uCost, uUpk)) continue;
                  const borderPlacements = currBorderTiles
                    .filter((t) => {
                      if (t.terrain === "mountain" || t.terrain === "lake") return false;
                      if (workingEntities.has(t.key)) return false;
                      const [tq, tr] = t.key.split(",").map(Number);
                      return hexDistance(tq, tr, seqE, serE) <= 5;
                    })
                    .sort((a, b) => {
                      const [aq2, ar2] = a.key.split(",").map(Number);
                      const [bq2, br2] = b.key.split(",").map(Number);
                      return hexDistance(aq2, ar2, seqE, serE) - hexDistance(bq2, br2, seqE, serE);
                    });
                  if (borderPlacements.length > 0) {
                    actionTaken = await dtExecBuy(uType, borderPlacements[0].key, uCost, false);
                  }
                }
              }

              // Step 4: Build new building matching enemy strength within 5 tiles of enemy unit
              if (!actionTaken) {
                for (const bType of (["castle", "tower"] as EntityType[])) {
                  if (actionTaken) break;
                  if (ENTITY_META[bType].strength < eStr) continue;
                  const bCost = ENTITY_META[bType].cost;
                  const bUpk = ENTITY_META[bType].upkeep;
                  if (!canAfford(bCost, bUpk)) continue;
                  if (bType === "castle" && !currTerr.some((t) => {
                    const e = workingEntities.get(t.key);
                    return e === "advanced_unit" || e === "expert_unit";
                  })) continue;
                  const rawPlacements = currTerr.filter((t) => {
                    if (t.terrain === "mountain" || t.terrain === "lake") return false;
                    if (workingEntities.has(t.key)) return false;
                    const [tq, tr] = t.key.split(",").map(Number);
                    return hexDistance(tq, tr, seqE, serE) <= 5;
                  }).sort((a, b) => {
                    const [aq2, ar2] = a.key.split(",").map(Number);
                    const [bq2, br2] = b.key.split(",").map(Number);
                    return hexDistance(aq2, ar2, seqE, serE) - hexDistance(bq2, br2, seqE, serE);
                  });
                  const placements = dtSpacedPlacements(rawPlacements);
                  if (placements.length > 0) actionTaken = await dtExecBuild(bType, placements[0].key, bCost);
                }
              }

              // Step 5: Build building with strength-1 one step from enemy border
              if (!actionTaken) {
                for (const bType of (["tower", "castle"] as EntityType[])) {
                  if (actionTaken) break;
                  if (ENTITY_META[bType].strength < eStr - 1) continue;
                  const bCost = ENTITY_META[bType].cost;
                  const bUpk = ENTITY_META[bType].upkeep;
                  if (!canAfford(bCost, bUpk)) continue;
                  if (bType === "castle" && !currTerr.some((t) => {
                    const e = workingEntities.get(t.key);
                    return e === "advanced_unit" || e === "expert_unit";
                  })) continue;
                  const rawPlacements = currTerr.filter((t) => {
                    if (t.terrain === "mountain" || t.terrain === "lake") return false;
                    if (workingEntities.has(t.key)) return false;
                    const [tq, tr] = t.key.split(",").map(Number);
                    return HEX_EDGES.some(({ dir: [dq, dr] }) => {
                      const nk = tileKey(tq + dq, tr + dr);
                      const nb = workingTileMap.get(nk);
                      return nb && nb.owner !== aiOwner && nb.owner !== "neutral";
                    });
                  });
                  const placements = dtSpacedPlacements(rawPlacements);
                  if (placements.length > 0) actionTaken = await dtExecBuild(bType, placements[0].key, bCost);
                }
              }
            }

            // ══ PRIORITY A: Attack to split any enemy territory into 2 parts ══
            if (!actionTaken) {
              type SplitCandA = { fk: string; tk: string; score: number; neg: boolean; oneHex: boolean };
              const candsA: SplitCandA[] = [];
              for (const [uk, ue] of availUnits) {
                const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                for (const mk of vm) {
                  const mt = workingTileMap.get(mk);
                  if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
                  const zoc = getMaxEnemyZoC(mk, aiOwner, workingEntities, workingTileMap);
                  if (ENTITY_META[ue].strength <= zoc) continue;
                  if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength)) continue;
                  const eOwnerA = mt.owner as TerritoryOwner;
                  const score = dtSplitScore(mk, eOwnerA);
                  const neg = dtCaptureNegatesIncome(mk, eOwnerA);
                  const oneHex = dtCaptureCreatesOneHex(mk, eOwnerA);
                  if (score > 0 || neg || oneHex) {
                    candsA.push({ fk: uk, tk: mk, score, neg, oneHex });
                  }
                }
              }
              if (candsA.length > 0) {
                candsA.sort((a, b) => {
                  if (a.oneHex !== b.oneHex) return a.oneHex ? -1 : 1;
                  if (a.neg !== b.neg) return a.neg ? -1 : 1;
                  return b.score - a.score;
                });
                actionTaken = await dtExecMove(candsA[0].fk, candsA[0].tk);
              }
              // Merge step: prepare a stronger unit that could execute this split next iteration
              if (!actionTaken) {
                const allSplitTargets = new Set(
                  Array.from(workingTileMap.values())
                    .filter((t) => {
                      if (t.owner === aiOwner || t.owner === "neutral" || t.terrain === "mountain") return false;
                      const eOwnerT = t.owner as TerritoryOwner;
                      return dtSplitScore(t.key, eOwnerT) > 0 || dtCaptureNegatesIncome(t.key, eOwnerT) || dtCaptureCreatesOneHex(t.key, eOwnerT);
                    })
                    .map((t) => t.key),
                );
                const mergeA = dtFindMergeMove(1, allSplitTargets, availUnits);
                if (mergeA) actionTaken = await dtExecMove(mergeA.from, mergeA.to);
              }
            }

            // ══ PRIORITY B: Connect own territories via 1–2 tile bridge ══
            if (!actionTaken) {
              type BridgeInfo = { tile: string; sz: number };
              const bridges: BridgeInfo[] = [];
              for (const t of currTerr) {
                const [tq, tr] = t.key.split(",").map(Number);
                for (const { dir: [dq, dr] } of HEX_EDGES) {
                  const mk = tileKey(tq + dq, tr + dr);
                  if (currTerrKeys.has(mk)) continue;
                  const mt = workingTileMap.get(mk);
                  if (!mt || mt.terrain === "mountain" || mt.terrain === "lake") continue;
                  if (mt.owner === aiOwner) continue;
                  const [mq, mr] = mk.split(",").map(Number);
                  // Direct 1-tile bridge to another AI territory
                  const directBridge = HEX_EDGES.some(({ dir: [dq2, dr2] }) => {
                    const nk2 = tileKey(mq + dq2, mr + dr2);
                    const nt2 = workingTileMap.get(nk2);
                    return nt2 && nt2.owner === aiOwner && !currTerrKeys.has(nk2);
                  });
                  if (directBridge && !bridges.find((b) => b.tile === mk)) {
                    const otherKey = HEX_EDGES.map(({ dir: [dq2, dr2] }) => {
                      const nk2 = tileKey(mq + dq2, mr + dr2);
                      const nt2 = workingTileMap.get(nk2);
                      return (nt2 && nt2.owner === aiOwner && !currTerrKeys.has(nk2)) ? nk2 : null;
                    }).find((k) => k !== null);
                    const sz = otherKey ? getContiguousTerritory(workingTileMap, otherKey, aiOwner).length : 0;
                    bridges.push({ tile: mk, sz });
                    continue;
                  }
                  // 2-tile bridge
                  for (const { dir: [dq2, dr2] } of HEX_EDGES) {
                    const mk2 = tileKey(mq + dq2, mr + dr2);
                    if (currTerrKeys.has(mk2) || mk2 === mk) continue;
                    const mt2 = workingTileMap.get(mk2);
                    if (!mt2 || mt2.terrain === "mountain" || mt2.terrain === "lake" || mt2.owner === aiOwner) continue;
                    const [mq2, mr2] = mk2.split(",").map(Number);
                    const chainBridges = HEX_EDGES.some(({ dir: [dq3, dr3] }) => {
                      const nk3 = tileKey(mq2 + dq3, mr2 + dr3);
                      const nt3 = workingTileMap.get(nk3);
                      return nt3 && nt3.owner === aiOwner && !currTerrKeys.has(nk3) && nk3 !== mk;
                    });
                    if (chainBridges && !bridges.find((b) => b.tile === mk)) {
                      bridges.push({ tile: mk, sz: 0 });
                    }
                  }
                }
              }
              if (bridges.length > 0) {
                bridges.sort((a, b) => b.sz - a.sz);
                for (const bridge of bridges) {
                  if (actionTaken) break;
                  const bridgeTile = workingTileMap.get(bridge.tile);
                  if (!bridgeTile) continue;
                  const zoc = getMaxEnemyZoC(bridge.tile, aiOwner, workingEntities, workingTileMap);
                  for (const [uk, ue] of availUnits) {
                    if (actionTaken) break;
                    if (ENTITY_META[ue].strength <= zoc) continue;
                    const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                    if (!vm.has(bridge.tile)) continue;
                    actionTaken = await dtExecMove(uk, bridge.tile);
                  }
                  // Merge step: set up a stronger unit to capture the bridge next iteration
                  if (!actionTaken) {
                    const mergeB = dtFindMergeMove(zoc + 1, new Set([bridge.tile]), availUnits);
                    if (mergeB) actionTaken = await dtExecMove(mergeB.from, mergeB.to);
                  }
                  // Try buying a unit adjacent to the bridge tile
                  if (!actionTaken) {
                    for (const uType of (["simple_unit", "advanced_unit", "expert_unit"] as EntityType[])) {
                      if (actionTaken) break;
                      const str = ENTITY_META[uType].strength;
                      const cost = ENTITY_META[uType].cost;
                      const upk = ENTITY_META[uType].upkeep;
                      if (str <= zoc || !canAfford(cost, upk)) continue;
                      const adjacentToSpawn = currTerr.some((t) => {
                        const [tq, tr] = t.key.split(",").map(Number);
                        return HEX_EDGES.some(({ dir: [dq, dr] }) => tileKey(tq + dq, tr + dr) === bridge.tile);
                      });
                      if (adjacentToSpawn) actionTaken = await dtExecBuy(uType, bridge.tile, cost, true);
                    }
                  }
                }
              }
            }

            // ══ PRIORITY C: Build defense for undefended border tiles ══
            if (!actionTaken) {
              const undefBorder = currBorderTiles.filter((t) => {
                const e = workingEntities.get(t.key);
                if (e && e !== "rebel") return false;
                const [tq, tr] = t.key.split(",").map(Number);
                return HEX_EDGES.some(({ dir: [dq, dr] }) => {
                  const nk = tileKey(tq + dq, tr + dr);
                  const nt = workingTileMap.get(nk);
                  if (!nt || nt.owner === aiOwner || nt.owner === "neutral") return false;
                  return getContiguousTerritory(workingTileMap, nk, nt.owner as TerritoryOwner).length >= 2;
                });
              });
              if (undefBorder.length > 0) {
                const innerCands = currTerr.filter((t) => {
                  if (t.terrain === "mountain" || t.terrain === "lake") return false;
                  if (workingEntities.has(t.key)) return false;
                  if (currBorderTiles.some((bt) => bt.key === t.key)) return false;
                  const [tq, tr] = t.key.split(",").map(Number);
                  return undefBorder.some((bt) => {
                    const [bq, br] = bt.key.split(",").map(Number);
                    return hexDistance(tq, tr, bq, br) === 1;
                  });
                });
                const borderCands = undefBorder.filter((t) => {
                  if (t.terrain === "mountain" || t.terrain === "lake") return false;
                  return !workingEntities.has(t.key);
                });
                const rawPlacementsC = innerCands.length > 0 ? innerCands : borderCands;
                const placementsC = dtSpacedPlacements(rawPlacementsC);
                for (const bType of (["tower", "castle"] as EntityType[])) {
                  if (actionTaken || placementsC.length === 0) break;
                  const bCost = ENTITY_META[bType].cost;
                  const bUpk = ENTITY_META[bType].upkeep;
                  if (!canAfford(bCost, bUpk)) continue;
                  if (bType === "castle" && !currTerr.some((t) => {
                    const e = workingEntities.get(t.key);
                    return e === "advanced_unit" || e === "expert_unit";
                  })) continue;
                  actionTaken = await dtExecBuild(bType, placementsC[0].key, bCost);
                }
              }
            }

            // ══ PRIORITY D: Build a city ══
            if (!actionTaken) {
              const cityCost = ENTITY_META.city.cost;
              const alreadyHasCity = currTerr.some((t) => t.isCity || workingEntities.get(t.key) === "city");
              if (canAfford(cityCost, 0) && currTerr.length >= 6 && !alreadyHasCity) {
                const bldgZoC = new Set<string>();
                for (const [bk, be] of workingEntities) {
                  if (be !== "tower" && be !== "castle") continue;
                  const bt = workingTileMap.get(bk);
                  if (!bt || bt.owner !== aiOwner) continue;
                  bldgZoC.add(bk);
                  const [bq2, br2] = bk.split(",").map(Number);
                  for (const { dir: [dq, dr] } of HEX_EDGES) bldgZoC.add(tileKey(bq2 + dq, br2 + dr));
                }
                // Find the largest enemy territory for "far from enemy" calculation
                let largestEnemyKey: string | null = null;
                let largestEnemySz = 0;
                const visLarge = new Set<string>();
                for (const t of Array.from(workingTileMap.values())) {
                  if (t.owner === aiOwner || t.owner === "neutral" || visLarge.has(t.key)) continue;
                  const comp = getContiguousTerritory(workingTileMap, t.key, t.owner as TerritoryOwner);
                  for (const ct of comp) visLarge.add(ct.key);
                  if (comp.length > largestEnemySz) { largestEnemySz = comp.length; largestEnemyKey = t.key; }
                }
                const [lEq, lEr] = largestEnemyKey ? largestEnemyKey.split(",").map(Number) : [0, 0];
                const cityCands = currTerr.filter((t) => {
                  if (t.terrain === "mountain" || t.terrain === "lake" || t.isCity || workingEntities.get(t.key) === "city") return false;
                  if (workingEntities.has(t.key)) return false;
                  return bldgZoC.has(t.key);
                }).sort((a, b) => {
                  if (!largestEnemyKey) return 0;
                  const [aq2, ar2] = a.key.split(",").map(Number);
                  const [bq2, br2] = b.key.split(",").map(Number);
                  return hexDistance(bq2, br2, lEq, lEr) - hexDistance(aq2, ar2, lEq, lEr);
                });
                if (cityCands.length > 0) actionTaken = await dtExecBuild("city", cityCands[0].key, cityCost);
              }
            }

            // ══ PRIORITY E: Border expansion ══
            if (!actionTaken) {
              // E1: Conquer neighbor tile with enemy unit or building
              // Sort: 1-hex kill > negates income > high split score > strongest entity > attacker strength
              const entityAttacks: { fk: string; tk: string; eStr: number; aStr: number; oneHex: boolean; neg: boolean; score: number }[] = [];
              for (const [uk, ue] of availUnits) {
                const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                for (const mk of vm) {
                  const mt = workingTileMap.get(mk);
                  if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
                  const me = workingEntities.get(mk);
                  if (!me || me === "rebel") continue;
                  const zoc = getMaxEnemyZoC(mk, aiOwner, workingEntities, workingTileMap);
                  if (ENTITY_META[ue].strength <= zoc) continue;
                  if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength)) continue;
                  const eOwnerE1 = mt.owner as TerritoryOwner;
                  entityAttacks.push({
                    fk: uk, tk: mk,
                    eStr: ENTITY_META[me].strength,
                    aStr: ENTITY_META[ue].strength,
                    oneHex: dtCaptureCreatesOneHex(mk, eOwnerE1),
                    neg: dtCaptureNegatesIncome(mk, eOwnerE1),
                    score: dtSplitScore(mk, eOwnerE1),
                  });
                }
              }
              if (entityAttacks.length > 0) {
                entityAttacks.sort((a, b) => {
                  if (a.oneHex !== b.oneHex) return a.oneHex ? -1 : 1;
                  if (a.neg !== b.neg) return a.neg ? -1 : 1;
                  if (b.score !== a.score) return b.score - a.score;
                  if (b.eStr !== a.eStr) return b.eStr - a.eStr;
                  return b.aStr - a.aStr;
                });
                actionTaken = await dtExecMove(entityAttacks[0].fk, entityAttacks[0].tk);
              }
              // E1 merge: set up a stronger unit to beat an enemy entity next iteration
              if (!actionTaken) {
                const e1Targets = new Set(
                  Array.from(workingEntities.entries())
                    .filter(([ek, ee]) => {
                      if (ee === "rebel") return false;
                      const et = workingTileMap.get(ek);
                      return et && et.owner !== aiOwner && et.owner !== "neutral";
                    })
                    .map(([ek]) => ek),
                );
                const mergeE1 = dtFindMergeMove(1, e1Targets, availUnits);
                if (mergeE1) actionTaken = await dtExecMove(mergeE1.from, mergeE1.to);
              }
              // E1 buy: buy a unit adjacent to an enemy-entity tile
              if (!actionTaken) {
                for (const uType of (["expert_unit", "advanced_unit", "simple_unit"] as EntityType[])) {
                  if (actionTaken) break;
                  const str = ENTITY_META[uType].strength;
                  const cost = ENTITY_META[uType].cost;
                  const upk = ENTITY_META[uType].upkeep;
                  if (!canAfford(cost, upk)) continue;
                  for (const t of currTerr) {
                    if (actionTaken) break;
                    const [tq, tr] = t.key.split(",").map(Number);
                    for (const { dir: [dq, dr] } of HEX_EDGES) {
                      const nk = tileKey(tq + dq, tr + dr);
                      const nt = workingTileMap.get(nk);
                      if (!nt || nt.owner === aiOwner || nt.owner === "neutral") continue;
                      const ne = workingEntities.get(nk);
                      if (!ne || ne === "rebel") continue;
                      if (nt.terrain === "lake" && !dtLakeHasSplitOpportunity(nk, str)) continue;
                      const zoc = getMaxEnemyZoC(nk, aiOwner, workingEntities, workingTileMap);
                      if (str > zoc) {
                        actionTaken = await dtExecBuy(uType, nk, cost, true);
                        break;
                      }
                    }
                  }
                }
              }

              // E2: Conquer empty enemy tile (largest enemy territory first)
              if (!actionTaken) {
                const emptyEnemyMoves: { fk: string; tk: string; sz: number }[] = [];
                for (const [uk, ue] of availUnits) {
                  const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                  for (const mk of vm) {
                    const mt = workingTileMap.get(mk);
                    if (!mt || mt.owner === aiOwner || mt.owner === "neutral") continue;
                    const me = workingEntities.get(mk);
                    if (me && me !== "rebel") continue;
                    const zoc = getMaxEnemyZoC(mk, aiOwner, workingEntities, workingTileMap);
                    if (ENTITY_META[ue].strength <= zoc) continue;
                    if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength)) continue;
                    const sz = getContiguousTerritory(workingTileMap, mk, mt.owner as TerritoryOwner).length;
                    emptyEnemyMoves.push({ fk: uk, tk: mk, sz });
                  }
                }
                if (emptyEnemyMoves.length > 0) {
                  emptyEnemyMoves.sort((a, b) => b.sz - a.sz);
                  actionTaken = await dtExecMove(emptyEnemyMoves[0].fk, emptyEnemyMoves[0].tk);
                }
                // E2 merge: set up a unit to attack an empty enemy tile next iteration
                if (!actionTaken) {
                  const e2Targets = new Set(
                    Array.from(workingTileMap.values())
                      .filter((t) => {
                        if (t.owner === aiOwner || t.owner === "neutral" || t.terrain === "mountain") return false;
                        const me = workingEntities.get(t.key);
                        return !me || me === "rebel";
                      })
                      .map((t) => t.key),
                  );
                  const mergeE2 = dtFindMergeMove(1, e2Targets, availUnits);
                  if (mergeE2) actionTaken = await dtExecMove(mergeE2.from, mergeE2.to);
                }
                // E2 buy
                if (!actionTaken) {
                  for (const uType of (["simple_unit", "advanced_unit", "expert_unit"] as EntityType[])) {
                    if (actionTaken) break;
                    const str = ENTITY_META[uType].strength;
                    const cost = ENTITY_META[uType].cost;
                    const upk = ENTITY_META[uType].upkeep;
                    if (!canAfford(cost, upk)) continue;
                    let best: { tile: string; sz: number } | null = null;
                    for (const t of currTerr) {
                      const [tq, tr] = t.key.split(",").map(Number);
                      for (const { dir: [dq, dr] } of HEX_EDGES) {
                        const nk = tileKey(tq + dq, tr + dr);
                        const nt = workingTileMap.get(nk);
                        if (!nt || nt.owner === aiOwner || nt.owner === "neutral") continue;
                        const ne = workingEntities.get(nk);
                        if (ne && ne !== "rebel") continue;
                        if (nt.terrain === "lake" && !dtLakeHasSplitOpportunity(nk, str)) continue;
                        const zoc = getMaxEnemyZoC(nk, aiOwner, workingEntities, workingTileMap);
                        if (str > zoc) {
                          const sz = getContiguousTerritory(workingTileMap, nk, nt.owner as TerritoryOwner).length;
                          if (!best || sz > best.sz) best = { tile: nk, sz };
                        }
                      }
                    }
                    if (best) actionTaken = await dtExecBuy(uType, best.tile, cost, true);
                  }
                }
              }

              // E3: Conquer neutral tile (city first, then grass/forest, then desert)
              if (!actionTaken) {
                const neutralPrio = (t: HexTile): number => (t.isCity || workingEntities.get(t.key) === "city") ? 3 : (t.terrain === "grass" || t.terrain === "forest") ? 2 : 1;
                const neutralMoves: { fk: string; tk: string; prio: number }[] = [];
                for (const [uk, ue] of availUnits) {
                  const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                  for (const mk of vm) {
                    const mt = workingTileMap.get(mk);
                    if (!mt || mt.owner !== "neutral") continue;
                    const zoc = getMaxEnemyZoC(mk, aiOwner, workingEntities, workingTileMap);
                    if (ENTITY_META[ue].strength <= zoc) continue;
                    if (mt.terrain === "lake" && !dtLakeHasSplitOpportunity(mk, ENTITY_META[ue].strength)) continue;
                    neutralMoves.push({ fk: uk, tk: mk, prio: neutralPrio(mt) });
                  }
                }
                if (neutralMoves.length > 0) {
                  neutralMoves.sort((a, b) => b.prio - a.prio);
                  actionTaken = await dtExecMove(neutralMoves[0].fk, neutralMoves[0].tk);
                }
                // E3 merge: position a unit near a neutral tile for next iteration
                if (!actionTaken) {
                  const e3Targets = new Set(
                    Array.from(workingTileMap.values())
                      .filter((t) => t.owner === "neutral" && t.terrain !== "mountain" && t.terrain !== "lake")
                      .map((t) => t.key),
                  );
                  const mergeE3 = dtFindMergeMove(1, e3Targets, availUnits);
                  if (mergeE3) actionTaken = await dtExecMove(mergeE3.from, mergeE3.to);
                }
                // E3 buy
                if (!actionTaken) {
                  for (const uType of (["simple_unit", "advanced_unit", "expert_unit"] as EntityType[])) {
                    if (actionTaken) break;
                    const str = ENTITY_META[uType].strength;
                    const cost = ENTITY_META[uType].cost;
                    const upk = ENTITY_META[uType].upkeep;
                    if (!canAfford(cost, upk)) continue;
                    let bestN: { tile: string; prio: number } | null = null;
                    for (const t of currTerr) {
                      const [tq, tr] = t.key.split(",").map(Number);
                      for (const { dir: [dq, dr] } of HEX_EDGES) {
                        const nk = tileKey(tq + dq, tr + dr);
                        const nt = workingTileMap.get(nk);
                        if (!nt || nt.owner !== "neutral") continue;
                        if (nt.terrain === "lake" && !dtLakeHasSplitOpportunity(nk, str)) continue;
                        const zoc = getMaxEnemyZoC(nk, aiOwner, workingEntities, workingTileMap);
                        if (str > zoc) {
                          const p = neutralPrio(nt);
                          if (!bestN || p > bestN.prio) bestN = { tile: nk, prio: p };
                        }
                      }
                    }
                    if (bestN) actionTaken = await dtExecBuy(uType, bestN.tile, cost, true);
                  }
                }
              }
            }

            // ══ PRIORITY F: Move unit closer to enemy ══
            if (!actionTaken) {
              const allEnemyTiles = Array.from(workingTileMap.values()).filter(
                (t) => t.owner !== aiOwner && t.owner !== "neutral" && t.terrain !== "mountain" && t.terrain !== "lake",
              );
              for (const [uk, ue] of availUnits) {
                if (actionTaken) break;
                const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                if (vm.size === 0) continue;
                const movesArr = Array.from(vm);
                const [uq, ur] = uk.split(",").map(Number);
                // Skip if already adjacent to an enemy tile (handled by priority E)
                const alreadyBorder = HEX_EDGES.some(({ dir: [dq, dr] }) => {
                  const nk = tileKey(uq + dq, ur + dr);
                  const nt = workingTileMap.get(nk);
                  return nt && nt.owner !== aiOwner && nt.owner !== "neutral";
                });
                if (alreadyBorder) continue;
                if (allEnemyTiles.length === 0) continue;
                // Greedy: pick the reachable tile that minimises distance to any enemy tile.
                // This uses the unit's full movement range (up to 3 tiles) in one action.
                let bestMk = movesArr[0];
                let bestD = Infinity;
                for (const mk of movesArr) {
                  const [mq, mr] = mk.split(",").map(Number);
                  let minD = Infinity;
                  for (const et of allEnemyTiles) {
                    const d = hexDistance(mq, mr, et.q, et.r);
                    if (d < minD) minD = d;
                  }
                  if (minD < bestD) { bestD = minD; bestMk = mk; }
                }
                if (bestD < Infinity) actionTaken = await dtExecMove(uk, bestMk);
              }
            }

            // ══ PRIORITY G: Clear rebel tiles (last resort — lower priority than expansion/movement) ══
            if (!actionTaken) {
              const rebelTiles = currTerr.filter((t) => workingEntities.get(t.key) === "rebel");
              // G1: Move weakest interior unit onto rebel tile.
              // Skip border units (adjacent to enemy territory): those should guard or be used for expansion.
              const unitsAsc = [...availUnits]
                .filter(([uk]) => {
                  const [uqG, urG] = uk.split(",").map(Number);
                  return !HEX_EDGES.some(({ dir: [dq, dr] }) => {
                    const nk = tileKey(uqG + dq, urG + dr);
                    const nt = workingTileMap.get(nk);
                    return nt && nt.owner !== aiOwner && nt.owner !== "neutral";
                  });
                })
                .sort(([, a2], [, b2]) => ENTITY_META[a2].strength - ENTITY_META[b2].strength);
              for (const rt of rebelTiles) {
                if (actionTaken) break;
                for (const [uk] of unitsAsc) {
                  const vm = getValidMoves(uk, aiOwner, workingEntities, workingTileMap, workingSpentUnits, workingPartialMoves.get(uk) ?? 3);
                  if (!vm.has(rt.key)) continue;
                  actionTaken = await dtExecMove(uk, rt.key);
                  break;
                }
              }
              // G2: Buy a simple_unit on the rebel tile
              if (!actionTaken) {
                for (const rt of rebelTiles) {
                  if (actionTaken) break;
                  const cost = ENTITY_META.simple_unit.cost;
                  const upk = ENTITY_META.simple_unit.upkeep;
                  const rtIncome = (TERRAIN_INCOME[rt.terrain] ?? 0) + (rt.isCity || workingEntities.get(rt.key) === "city" ? CITY_BONUS : 0);
                  if (currBal >= cost && currIncome + rtIncome - (currUpkeep + upk) >= 0) {
                    actionTaken = await dtExecBuy("simple_unit", rt.key, cost, false);
                  }
                }
              }
            }

            // ══ PRIORITY H: Remove unnecessary defensive buildings ══
            if (!actionTaken) {
              for (const [bk, be] of workingEntities) {
                if (actionTaken) break;
                if (be !== "tower" && be !== "castle") continue;
                const bt = workingTileMap.get(bk);
                if (!bt || bt.owner !== aiOwner || !currTerrKeys.has(bk)) continue;
                const [bq2, br2] = bk.split(",").map(Number);
                // Only remove if NO enemy tile exists within 6 tiles of the building
                const hasNearbyEnemy = Array.from(workingTileMap.values()).some((nt) => {
                  if (nt.owner === aiOwner || nt.owner === "neutral") return false;
                  const [ntq, ntr] = nt.key.split(",").map(Number);
                  return hexDistance(bq2, br2, ntq, ntr) <= 6;
                });
                if (!hasNearbyEnemy) actionTaken = await dtExecRemove(bk);
              }
            }

            if (!actionTaken) break;
          } // end decision tree loop
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
              (t.isCity || workingEntities.get(t.key) === "city" ? CITY_BONUS : 0)
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
    () => selectedTerritory.some((t) => t.isCity || entities.get(t.key) === "city"),
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
      if (t.terrain === "grass") grassCount++;
      else if (t.terrain === "forest") forestCount++;
      else if (t.terrain === "desert") desertCount++;
      else if (t.terrain === "mountain") mountainCount++;
      else if (t.terrain === "lake") lakeCount++;
      const entityId = entities.get(t.key);
      const hasRebel = entityId === "rebel";
      const isCity = t.isCity || entityId === "city";
      if (isCity) cityCount++;
      if (!hasRebel) {
        if (t.terrain === "grass") activeGrassCount++;
        if (isCity) activeCityCount++;
      }
      if (entityId && entityId !== "city" && entityId !== "rebel") {
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
  }, [selectedTerritory, entities]);

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
            (t.isCity || entities.get(t.key) === "city" ? CITY_BONUS : 0)
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
        } else if (existingUnit === "city") {
          // City capture: city is permanent — it stays on the tile.
          // The capturing unit is consumed (it "enters" the city).
          newEntities.delete(selectedEntityKey);
        } else {
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
          !!existingOnTile &&
          !canMerge &&
          !canOverwriteRebel &&
          !canOverwriteBuilding;
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
          newEntities.delete(key);
          newEntities.set(key, armedEntityId);
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
            (t.isCity || nextEntities.get(t.key) === "city" ? CITY_BONUS : 0)
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
              (t.isCity || nextEntities.get(t.key) === "city" ? CITY_BONUS : 0)
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
                const isCityZone = tile.cityBuffer || tile.isCity;
                const fill =
                  tile.terrain === "lake"
                    ? "#5BAFD6"
                    : hasSelection
                      ? (TERRAIN_FILLS[tile.terrain] ?? TERRAIN_FILLS.grass)
                      : tile.terrain === "mountain"
                        ? TERRAIN_FILLS.mountain
                        : isCityZone && liveTile.owner === "neutral"
                          ? CITY_NEUTRAL_FILL
                          : (TERRITORY_FILLS[liveTile.owner] ??
                            TERRITORY_FILLS.neutral);
                return (
                  <Polygon
                    key={tile.key}
                    points={hexCornersString(cx, cy, HEX_SIZE)}
                    fill={fill}
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
                .filter(({ tile }) => tile.isCity || entities.get(tile.key) === "city")
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

                {isDeveloperModeActive &&
                  devEconomicOverlays.map(({ cx, cy, label, aiLabel }, i) => {
                    const fontSize = Math.max(7, Math.min(11, HEX_SIZE * 0.32));
                    const maxLen = aiLabel
                      ? Math.max(label.length, aiLabel.length)
                      : label.length;
                    const totalHeight = aiLabel
                      ? fontSize * 2.8
                      : fontSize * 1.4;
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
        style={[
          styles.ribbon,
          {
            bottom:
              BOTTOM_BAR_H +
              botInset +
              (selectedEntityKey ? ENTITY_PANEL_H : 0),
          },
          ribbonStyle,
        ]}
      >
        <ScrollView
          ref={ribbonScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.ribbonContent}
        >
          {(ribbonMode === "units"
            ? UNIT_PURCHASABLES
            : BUILDING_PURCHASABLES
          ).map((item) => {
            const isArmed = armedEntityId === item.id;
            const isTower = item.id === "tower";
            const isCastle = item.id === "castle";
            const round1Locked = turn === 1 && !isTower;
            const cityAlreadyBuilt = item.id === "city" && territoryHasCity;
            const cityTooSmall =
              item.id === "city" && selectedTerritory.length < 6;
            const cityLocked = cityAlreadyBuilt || cityTooSmall;
            const playerUsedTilesSet =
              freeTowerUsedTiles.get("player") ?? new Set<string>();
            const playerTowerFree =
              isTower &&
              turn === 1 &&
              selectedTerritory.length >= 2 &&
              !selectedTerritory.some((t) => playerUsedTilesSet.has(t.key));
            const effectiveCost = playerTowerFree ? 0 : item.cost;
            const affordable = effectiveCost <= selectedTerritoryBalance;
            const enabled = affordable && !cityLocked && !round1Locked;
            const costLabel = round1Locked
              ? "Round 2+"
              : cityAlreadyBuilt
                ? "BUILT"
                : cityTooSmall
                  ? "<6 tiles"
                  : playerTowerFree
                    ? "FREE"
                    : `${item.cost}g`;
            const nextUpkeepLabel = (() => {
              if (isTower) {
                const cost = nextDefenseUpkeep("tower", selectedTerritoryDefenseCounts.tower);
                return `${cost}/turn`;
              }
              if (isCastle) {
                const cost = nextDefenseUpkeep("castle", selectedTerritoryDefenseCounts.castle);
                return `${cost}/turn`;
              }
              return null;
            })();
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
                <Text
                  style={[
                    styles.ribbonName,
                    !enabled && styles.ribbonDim,
                    isArmed && styles.ribbonNameArmed,
                  ]}
                >
                  {item.name}
                </Text>
                <Text
                  style={[
                    styles.ribbonCost,
                    !enabled && styles.ribbonDim,
                    isArmed && styles.ribbonNameArmed,
                    playerTowerFree && styles.ribbonCostFree,
                    cityAlreadyBuilt && styles.ribbonCostBuilt,
                  ]}
                >
                  {costLabel}
                </Text>
                {nextUpkeepLabel && (
                  <Text
                    style={[
                      styles.ribbonCost,
                      !enabled && styles.ribbonDim,
                      { fontSize: 10, marginTop: 1 },
                    ]}
                  >
                    {nextUpkeepLabel}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>

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

      <TouchableOpacity
        style={[
          styles.devBtn,
          isDeveloperModeActive ? styles.devBtnActive : styles.devBtnInactive,
          { top: topInset + 4, right: 4, position: "absolute", zIndex: 20 },
        ]}
        onPress={() => setIsDeveloperModeActive((v) => !v)}
      >
        <Text
          style={[
            styles.devBtnText,
            isDeveloperModeActive
              ? styles.devBtnTextActive
              : styles.devBtnTextInactive,
          ]}
        >
          DEV
        </Text>
      </TouchableOpacity>

      {selectedEntityKey &&
        (() => {
          const entityId = entities.get(selectedEntityKey);
          const isUnit = entityId ? ENTITY_META[entityId].isUnit : false;
          const upgradeTarget = entityId ? UNIT_UPGRADE[entityId] : undefined;
          const canUpgrade = !!upgradeTarget;
          const upgradeCost =
            entityId && upgradeTarget
              ? ENTITY_META[upgradeTarget].cost - ENTITY_META[entityId].cost
              : 0;
          const isSpent = spentUnits.has(selectedEntityKey);
          const entityTile = activeTileMap.get(selectedEntityKey);
          const entityTerritoryId = entityTile
            ? getTerritoryId(
                getContiguousTerritory(
                  activeTileMap,
                  selectedEntityKey,
                  "player",
                ),
              )
            : null;
          const entityTerritoryBalance = entityTerritoryId
            ? (territoryBalances.get(entityTerritoryId) ?? 0)
            : 0;
          const removeCost = 0;
          const upgradeEnabled =
            canUpgrade &&
            entityTerritoryBalance >= upgradeCost &&
            (!isUnit || !isSpent);
          const removeEnabled = isUnit
            ? !isSpent
            : !!entityTerritoryId && entityTerritoryBalance >= removeCost;
          return (
            <View
              style={[styles.entityPanel, { bottom: BOTTOM_BAR_H + botInset }]}
            >
              <TouchableOpacity
                style={[
                  styles.buildBtn,
                  { borderColor: "#AA3A2A", backgroundColor: "#3A1A10" },
                  !removeEnabled && styles.buildBtnDisabled,
                ]}
                activeOpacity={removeEnabled ? 0.75 : 1}
                onPress={() => {
                  if (isAiTurn || gameResult !== null) return;
                  if (!removeEnabled || !entityTerritoryId) return;
                  pushHistory();
                  setEntities((prev) => {
                    const next = new Map(prev);
                    next.delete(selectedEntityKey);
                    return next;
                  });
                  if (removeCost > 0) {
                    setTerritoryBalances((prev) => {
                      const next = new Map(prev);
                      next.set(
                        entityTerritoryId,
                        entityTerritoryBalance - removeCost,
                      );
                      return next;
                    });
                  }
                  setSelectedEntityKey(null);
                }}
              >
                <Text
                  style={[
                    styles.buildBtnText,
                    { color: removeEnabled ? "#F07060" : "#7A3020" },
                  ]}
                >
                  ✕ Remove{removeCost > 0 ? ` (${removeCost}g)` : ""}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.buildBtn,
                  !upgradeEnabled && styles.buildBtnDisabled,
                ]}
                activeOpacity={upgradeEnabled ? 0.75 : 1}
                onPress={() => {
                  if (isAiTurn || gameResult !== null) return;
                  if (
                    !upgradeEnabled ||
                    !entityId ||
                    !upgradeTarget ||
                    !entityTerritoryId
                  )
                    return;
                  pushHistory();
                  setEntities((prev) => {
                    const next = new Map(prev);
                    next.set(selectedEntityKey, upgradeTarget);
                    return next;
                  });
                  setTerritoryBalances((prev) => {
                    const next = new Map(prev);
                    next.set(
                      entityTerritoryId,
                      entityTerritoryBalance - upgradeCost,
                    );
                    return next;
                  });
                }}
              >
                <Text
                  style={[
                    styles.buildBtnText,
                    !upgradeEnabled && styles.buildBtnTextDisabled,
                  ]}
                >
                  ⬆ Upgrade {canUpgrade ? `(${upgradeCost}g)` : "(Max)"}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })()}

      <View style={[styles.bottomBar, { paddingBottom: botInset }]}>
        <View style={styles.bottomBarInner}>
          {(() => {
            const undoDisabled =
              isAiTurn || gameResult !== null || moveHistory.length === 0;
            return (
              <TouchableOpacity
                style={[styles.undoBtn, undoDisabled && styles.undoBtnDisabled]}
                onPress={handleUndo}
                activeOpacity={undoDisabled ? 1 : 0.75}
                disabled={undoDisabled}
              >
                <Text
                  style={[
                    styles.undoBtnLabel,
                    undoDisabled && styles.undoBtnLabelDisabled,
                  ]}
                >
                  Undo
                </Text>
                <Text
                  style={[
                    styles.undoBtnIcon,
                    undoDisabled && styles.undoBtnIconDisabled,
                  ]}
                >
                  ↺
                </Text>
              </TouchableOpacity>
            );
          })()}

          {showCredits && (
            <TouchableOpacity
              style={styles.creditsDisplay}
              onPress={() => {
                if (hasSelection) setShowEconModal(true);
              }}
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
                <Text
                  style={[
                    styles.creditsNet,
                    econBreakdown.net >= 0
                      ? styles.creditsNetPos
                      : styles.creditsNetNeg,
                  ]}
                >
                  {econBreakdown.net >= 0
                    ? `+${econBreakdown.net}`
                    : `${econBreakdown.net}`}
                  /turn
                </Text>
              ) : (
                <Text style={[styles.creditsNet, { color: "transparent" }]}>
                  +0/turn
                </Text>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.spacer} />

          {canBuild &&
            (["buildings", "units"] as const).map((mode) => {
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
                  <Text
                    style={{
                      fontSize: 13,
                      color: isActive
                        ? "#0D0A06"
                        : canBuild
                          ? "#C8A24A"
                          : "#3A2E14",
                    }}
                  >
                    {mode === "units" ? "⚒" : "🏛"}
                  </Text>
                  <Text
                    style={[
                      styles.buildBtnText,
                      isActive && styles.buildBtnTextActive,
                      !canBuild && styles.buildBtnTextDisabled,
                    ]}
                  >
                    {mode === "units" ? "Train" : "Build"}
                  </Text>
                </TouchableOpacity>
              );
            })}

          {isDeveloperModeActive && (isAiPaused || isAiTurnDone) && aiHistoryIndex > 0 && (
            <TouchableOpacity
              style={styles.prevActionBtn}
              onPress={handleAiStepBack}
            >
              <Text style={{ fontSize: 13, color: "#00FF88" }}>←</Text>
              <Text style={styles.nextActionBtnText}>Prev</Text>
            </TouchableOpacity>
          )}

          {isDeveloperModeActive && (isAiPaused || isAiTurnDone) && (() => {
            const atEnd = isAiTurnDone && aiHistoryIndex >= aiHistoryLen - 1;
            return (
              <TouchableOpacity
                style={[styles.nextActionBtn, atEnd && { opacity: 0.35 }]}
                onPress={atEnd ? undefined : handleAiStepNext}
                disabled={atEnd}
              >
                <Text style={styles.nextActionBtnText}>
                  {aiHistoryIndex < aiHistoryLen - 1 ? "Next ▶" : "Next"}
                </Text>
                <Text style={{ fontSize: 13, color: "#00FF88" }}>→</Text>
              </TouchableOpacity>
            );
          })()}

          {isAiTurnDone ? (
            <TouchableOpacity
              style={styles.endTurnBtn}
              onPress={handleEndAiTurn}
            >
              <Text style={styles.endTurnText}>End AI Turn</Text>
              <Text style={styles.endTurnArrow}>→</Text>
            </TouchableOpacity>
          ) : isAiTurn ? (
            <View style={[styles.endTurnBtn, styles.aiTurnBtn]}>
              <Text style={styles.aiTurnText}>AI Turn...</Text>
            </View>
          ) : (
            <Animated.View style={endTurnStyle}>
              <TouchableOpacity
                style={styles.endTurnBtn}
                onPress={handleEndTurn}
                disabled={gameResult !== null}
              >
                <Text style={styles.endTurnText}>End Turn</Text>
                <Text style={styles.endTurnArrow}>→</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>
      </View>

      <Modal
        visible={confirmLeave}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmLeave(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Leave Game?</Text>
            <Text style={styles.modalBody}>
              Return to the main menu? Your progress will be lost.
            </Text>
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={styles.modalStayBtn}
                onPress={() => setConfirmLeave(false)}
              >
                <Text style={styles.modalStayText}>Stay</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalLeaveBtn}
                onPress={() => {
                  setConfirmLeave(false);
                  router.back();
                }}
              >
                <Text style={styles.modalLeaveText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {pendingLakeMove && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => setPendingLakeMove(null)}
        >
          <View style={styles.lakeModalOverlay}>
            <View style={styles.lakeModalBox}>
              <Text style={styles.lakeModalTitle}>⚓ Naval Supply</Text>
              <Text style={styles.lakeModalSubtitle}>
                How many credits to provision this unit?{"\n"}
                (min {pendingLakeMove.minAmount}, max{" "}
                {pendingLakeMove.maxAmount})
              </Text>

              <Text style={styles.lakeModalAmount}>{lakeTransferAmount}</Text>

              <View style={styles.lakeSliderRow}>
                <TouchableOpacity
                  style={styles.lakeStepBtn}
                  onPress={() =>
                    setLakeTransferAmount((prev) =>
                      Math.max(pendingLakeMove.minAmount, prev - 1),
                    )
                  }
                >
                  <Text style={styles.lakeStepText}>−</Text>
                </TouchableOpacity>

                <View
                  style={styles.lakeTrackHitZone}
                  onLayout={(e) => {
                    setSliderTrackWidth(e.nativeEvent.layout.width);
                  }}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onMoveShouldSetResponderCapture={() => true}
                  onResponderGrant={(e) => {
                    sliderTrackPageX.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
                    const x = Math.max(0, Math.min(sliderTrackWidth, e.nativeEvent.pageX - sliderTrackPageX.current));
                    const range = pendingLakeMove.maxAmount - pendingLakeMove.minAmount;
                    if (range <= 0) return;
                    setLakeTransferAmount(
                      pendingLakeMove.minAmount + Math.round((x / sliderTrackWidth) * range),
                    );
                  }}
                  onResponderMove={(e) => {
                    const x = Math.max(0, Math.min(sliderTrackWidth, e.nativeEvent.pageX - sliderTrackPageX.current));
                    const range = pendingLakeMove.maxAmount - pendingLakeMove.minAmount;
                    if (range <= 0) return;
                    setLakeTransferAmount(
                      pendingLakeMove.minAmount + Math.round((x / sliderTrackWidth) * range),
                    );
                  }}
                >
                  <View style={styles.lakeTrack} pointerEvents="none">
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
                          left:
                            pendingLakeMove.maxAmount <= pendingLakeMove.minAmount
                              ? sliderTrackWidth - 12
                              : Math.round(
                                  ((lakeTransferAmount - pendingLakeMove.minAmount) /
                                    (pendingLakeMove.maxAmount - pendingLakeMove.minAmount)) *
                                    (sliderTrackWidth - 24),
                                ),
                        },
                      ]}
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.lakeStepBtn}
                  onPress={() =>
                    setLakeTransferAmount((prev) =>
                      Math.min(pendingLakeMove.maxAmount, prev + 1),
                    )
                  }
                >
                  <Text style={styles.lakeStepText}>+</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.lakeModalButtons}>
                <TouchableOpacity
                  style={styles.lakeCancelBtn}
                  onPress={() => setPendingLakeMove(null)}
                >
                  <Text style={styles.lakeCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.lakeConfirmBtn}
                  onPress={() => commitPendingLakeMove(lakeTransferAmount)}
                >
                  <Text style={styles.lakeConfirmText}>Dispatch ⚓</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <Modal
        visible={showEconModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEconModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowEconModal(false)}
        >
          <View style={styles.econCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.econTitle}>Economy Breakdown</Text>
            <View style={styles.econSection}>
              <Text style={styles.econSectionLabel}>INCOME / TURN</Text>
              {econBreakdown && econBreakdown.grassCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>
                    🌿 Grass ×{econBreakdown.grassCount}{" "}
                    <Text style={styles.econPer}>(+2 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.grassIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.forestCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>
                    🌲 Forest ×{econBreakdown.forestCount}{" "}
                    <Text style={styles.econPer}>(+2 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.forestIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.desertCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>
                    🏜️ Desert ×{econBreakdown.desertCount}{" "}
                    <Text style={styles.econPer}>(+1 each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.desertIncome}
                  </Text>
                </View>
              )}
              {econBreakdown && econBreakdown.cityCount > 0 && (
                <View style={styles.econRow}>
                  <Text style={styles.econRowLabel}>
                    {ENTITY_META.city.icon} Cities ×{econBreakdown.cityCount}{" "}
                    <Text style={styles.econPer}>(+{CITY_BONUS} each)</Text>
                  </Text>
                  <Text style={styles.econRowValue}>
                    +{econBreakdown.cityIncome}
                  </Text>
                </View>
              )}
            </View>
            {econBreakdown &&
              (econBreakdown.upkeepGroups.length > 0 ||
                econBreakdown.rebelTotalLoss > 0) && (
                <View style={styles.econSection}>
                  <Text style={styles.econSectionLabel}>UPKEEP / TURN</Text>
                  {econBreakdown.upkeepGroups.map((g, i) => (
                    <View key={i} style={styles.econRow}>
                      <Text style={styles.econRowLabel}>
                        {g.icon} {g.name} ×{g.count}{" "}
                        {g.upkeepPerUnit !== null && (
                          <Text style={styles.econPer}>
                            (−{g.upkeepPerUnit} each)
                          </Text>
                        )}
                      </Text>
                      <Text style={[styles.econRowValue, { color: "#E07060" }]}>
                        −{g.total}
                      </Text>
                    </View>
                  ))}
                  {econBreakdown.rebelTotalLoss > 0 && (
                    <View style={styles.econRow}>
                      <Text style={styles.econRowLabel}>
                        ✊ Rebels ×{econBreakdown.rebelCount}
                      </Text>
                      <Text style={[styles.econRowValue, { color: "#E07060" }]}>
                        −{econBreakdown.rebelTotalLoss}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            <View style={styles.econDivider} />
            <View style={styles.econRow}>
              <Text style={styles.econNetLabel}>Net per turn</Text>
              <Text
                style={[
                  styles.econNetValue,
                  {
                    color:
                      econBreakdown && econBreakdown.net >= 0
                        ? "#7EC87E"
                        : "#E07060",
                  },
                ]}
              >
                {econBreakdown && econBreakdown.net >= 0 ? "+" : ""}
                {econBreakdown?.net ?? 0}
              </Text>
            </View>
            <View style={styles.econRow}>
              <Text style={styles.econNetLabel}>Current balance</Text>
              <Text style={styles.econNetValue}>
                ⚜️ {selectedTerritoryBalance}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.econCloseBtn}
              onPress={() => setShowEconModal(false)}
            >
              <Text style={styles.econCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 70% Dominance popup */}
      <Modal visible={showDominancePopup} transparent animationType="fade">
        <View style={styles.gameResultOverlay}>
          <View style={styles.gameResultCard}>
            <Text style={styles.gameResultEmoji}>⚔️</Text>
            <Text
              style={[styles.gameResultTitle, styles.gameResultVictoryTitle]}
            >
              Dominance!
            </Text>
            <Text style={styles.gameResultBody}>
              You control 70% of the realm. Claim victory now, or continue
              your conquest and take it all?
            </Text>
            <TouchableOpacity
              style={[styles.gameResultBtn, styles.dominanceContinueBtn]}
              onPress={() => setShowDominancePopup(false)}
            >
              <Text
                style={[
                  styles.gameResultBtnText,
                  styles.dominanceContinueBtnText,
                ]}
              >
                Keep Playing
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.gameResultBtn, styles.gameResultMenuBtn]}
              onPress={() => {
                setShowDominancePopup(false);
                setGameResult("victory");
              }}
            >
              <Text
                style={[
                  styles.gameResultBtnText,
                  styles.gameResultMenuBtnText,
                ]}
              >
                Claim Victory
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={gameResult !== null} transparent animationType="fade">
        <View style={styles.gameResultOverlay}>
          <View style={styles.gameResultCard}>
            <Text style={styles.gameResultEmoji}>
              {gameResult === "victory" ? "🏆" : "💀"}
            </Text>
            <Text
              style={[
                styles.gameResultTitle,
                gameResult === "victory"
                  ? styles.gameResultVictoryTitle
                  : styles.gameResultDefeatTitle,
              ]}
            >
              {gameResult === "victory" ? "Victory!" : "Game Over"}
            </Text>
            <Text style={styles.gameResultBody}>
              {gameResult === "victory"
                ? "All opponents have been eliminated. The realm is yours!"
                : "Your territory has been conquered. The campaign is lost."}
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
              <Text
                style={[styles.gameResultBtnText, styles.gameResultMenuBtnText]}
              >
                Return to Main Menu
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#081828",
    overflow: "hidden",
  },
  board: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  boardElevated: {
    ...Platform.select({
      web: {
        filter: "drop-shadow(0px 12px 32px rgba(0,10,30,0.85))",
      } as any,
      default: {
        elevation: 24,
        shadowColor: "#000A1E",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.85,
        shadowRadius: 24,
      },
    }),
  },
  entityPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    height: ENTITY_PANEL_H,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: "rgba(18, 12, 4, 0.97)",
    borderTopWidth: 1,
    borderTopColor: "#6A4A1C",
    zIndex: 18,
  },
  ribbon: {
    position: "absolute",
    left: 0,
    right: 0,
    height: RIBBON_H,
    overflow: "hidden",
    backgroundColor: "rgba(58, 44, 18, 0.98)",
    borderTopWidth: 1,
    borderTopColor: "#8A6A2C",
  },
  ribbonContent: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  ribbonItem: {
    width: 82,
    height: RIBBON_H - 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#7A6030",
    backgroundColor: "#3A2C12",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  ribbonItemDisabled: {
    borderColor: "#4A3A1A",
    backgroundColor: "#2A200A",
  },
  ribbonItemArmed: {
    borderColor: "#FFD700",
    backgroundColor: "#2A2008",
  },
  ribbonIcon: {
    fontSize: 22,
  },
  ribbonName: {
    fontSize: 10,
    fontFamily: "Cinzel_400Regular",
    color: "#C8A24A",
  },
  ribbonNameArmed: {
    color: "#FFD700",
  },
  ribbonCost: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: "#A08C68",
  },
  ribbonCostFree: {
    color: "#44DD88",
    fontFamily: "Cinzel_700Bold",
  },
  ribbonCostBuilt: {
    color: "#E04040",
    fontFamily: "Cinzel_700Bold",
  },
  ribbonDim: {
    color: "#786848",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(54, 40, 14, 0.98)",
    borderTopWidth: 1,
    borderTopColor: "#8A6A2C",
  },
  bottomBarInner: {
    height: BOTTOM_BAR_H,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    gap: 6,
  },
  menuBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#7A6030",
    backgroundColor: "#3A2A10",
  },
  menuBtnText: {
    fontSize: 11,
    fontFamily: "Cinzel_400Regular",
    color: "#A08860",
  },
  buildBtn: {
    height: BTN_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#9A7830",
    backgroundColor: "#3A2A10",
  },
  buildBtnActive: {
    backgroundColor: "#C8A24A",
    borderColor: "#C8A24A",
  },
  buildBtnDisabled: {
    borderColor: "#4A3A1A",
    backgroundColor: "#2A1E08",
  },
  buildBtnText: {
    fontSize: 11,
    fontFamily: "Cinzel_400Regular",
    color: "#C8A24A",
  },
  buildBtnTextActive: {
    color: "#0D0A06",
  },
  buildBtnTextDisabled: {
    color: "#5A4A22",
  },
  creditsDisplay: {
    height: BTN_H,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingHorizontal: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#7A6030",
    backgroundColor: "#3A2A10",
  },
  creditsTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  creditsIcon: {
    fontSize: 12,
  },
  creditsAmount: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#C8A24A",
  },
  creditsNet: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  creditsNetPos: {
    color: "#70C870",
  },
  creditsNetNeg: {
    color: "#E07060",
  },
  lakeModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
  },
  lakeModalBox: {
    backgroundColor: "#1E1A10",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#4A7FA5",
    padding: 24,
    width: 320,
    alignItems: "center",
  },
  lakeModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#7EC8E3",
    marginBottom: 6,
  },
  lakeModalSubtitle: {
    fontSize: 12,
    color: "#8C9BAB",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 18,
  },
  lakeModalAmount: {
    fontSize: 44,
    fontWeight: "800",
    color: "#C8D8E8",
    marginBottom: 12,
  },
  lakeSliderRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginBottom: 20,
    gap: 8,
  },
  lakeStepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2A3A4A",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#4A7FA5",
  },
  lakeStepText: {
    fontSize: 20,
    color: "#7EC8E3",
    lineHeight: 24,
  },
  lakeTrackHitZone: {
    flex: 1,
    height: 44,
    justifyContent: "center",
  },
  lakeTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2A3A4A",
    position: "relative",
    overflow: "visible",
  },
  lakeTrackFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#4A7FA5",
    borderRadius: 4,
  },
  lakeThumb: {
    position: "absolute",
    top: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#7EC8E3",
    marginLeft: -12,
    borderWidth: 2,
    borderColor: "#1E1A10",
  },
  lakeModalButtons: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  lakeCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#2A2218",
    borderWidth: 1,
    borderColor: "#5A4A2A",
    alignItems: "center",
  },
  lakeCancelText: {
    color: "#8A7A5A",
    fontWeight: "600",
    fontSize: 15,
  },
  lakeConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#1A3A5A",
    borderWidth: 1,
    borderColor: "#4A7FA5",
    alignItems: "center",
  },
  lakeConfirmText: {
    color: "#7EC8E3",
    fontWeight: "700",
    fontSize: 15,
  },
  spacer: {
    flex: 1,
  },
  undoBtn: {
    height: BTN_H,
    width: BTN_H,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: 1,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#9A7830",
    backgroundColor: "#3A2A10",
  },
  undoBtnDisabled: {
    borderColor: "#6A5A28",
    backgroundColor: "#2E2208",
  },
  undoBtnLabel: {
    fontSize: 9,
    fontFamily: "Cinzel_400Regular",
    color: "#C8A24A",
    letterSpacing: 0.5,
  },
  undoBtnLabelDisabled: {
    color: "#6A5828",
  },
  undoBtnIcon: {
    fontSize: 17,
    color: "#C8A24A",
  },
  undoBtnIconDisabled: {
    color: "#6A5828",
  },
  endTurnBtn: {
    height: BTN_H,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingHorizontal: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#B08030",
    backgroundColor: "#6A4014",
  },
  endTurnText: {
    fontSize: 11,
    fontFamily: "Cinzel_700Bold",
    color: "#F0D080",
    letterSpacing: 0.5,
  },
  endTurnArrow: {
    fontSize: 13,
    color: "#F0D080",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    width: 300,
    backgroundColor: "#3A2A10",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#9A7830",
    padding: 28,
    gap: 12,
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Cinzel_700Bold",
    color: "#F0D080",
    letterSpacing: 0.5,
  },
  modalBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#C8A870",
    textAlign: "center",
    lineHeight: 20,
  },
  modalRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  modalStayBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#7A6030",
    backgroundColor: "#2A1E08",
    alignItems: "center",
  },
  modalStayText: {
    fontSize: 13,
    fontFamily: "Cinzel_400Regular",
    color: "#C8A24A",
  },
  modalLeaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#AA3A2A",
    backgroundColor: "#4A1A10",
    alignItems: "center",
  },
  modalLeaveText: {
    fontSize: 13,
    fontFamily: "Cinzel_700Bold",
    color: "#F07060",
  },
  econCard: {
    width: 320,
    backgroundColor: "#3A2A10",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#9A7830",
    padding: 24,
    gap: 8,
  },
  econTitle: {
    fontSize: 16,
    fontFamily: "Cinzel_700Bold",
    color: "#F0D080",
    letterSpacing: 0.5,
    marginBottom: 4,
    textAlign: "center",
  },
  econSection: {
    gap: 4,
  },
  econSectionLabel: {
    fontSize: 10,
    fontFamily: "Cinzel_400Regular",
    color: "#786A54",
    letterSpacing: 1,
    marginBottom: 2,
  },
  econRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  econRowLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#C8A870",
    flex: 1,
  },
  econPer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
  },
  econRowValue: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#7EC87E",
  },
  econEmpty: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#786A54",
    fontStyle: "italic",
  },
  econDivider: {
    height: 1,
    backgroundColor: "#6A5020",
    marginVertical: 4,
  },
  econNetLabel: {
    fontSize: 14,
    fontFamily: "Cinzel_400Regular",
    color: "#D0B880",
  },
  econNetValue: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#C8A24A",
  },
  econCloseBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#7A6030",
    backgroundColor: "#2A1E08",
    alignItems: "center",
  },
  econCloseBtnText: {
    fontSize: 13,
    fontFamily: "Cinzel_400Regular",
    color: "#C8A24A",
  },
  aiTurnBtn: {
    backgroundColor: "#1A1A3A",
    borderColor: "#4A4A8A",
  },
  aiTurnText: {
    fontSize: 12,
    fontFamily: "Cinzel_400Regular",
    color: "#8888CC",
    letterSpacing: 0.5,
  },
  devBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#7A6030",
    backgroundColor: "#3A2A10",
  },
  devBtnInactive: {
    borderColor: "#8A2222",
    backgroundColor: "#3A0808",
  },
  devBtnActive: {
    borderColor: "#00FF88",
    backgroundColor: "#003322",
  },
  devBtnText: {
    fontSize: 11,
    fontFamily: "Cinzel_400Regular",
    letterSpacing: 0.5,
  },
  devBtnTextInactive: {
    color: "#CC4444",
  },
  devBtnTextActive: {
    color: "#00FF88",
  },
  prevActionBtn: {
    height: BTN_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#00BB66",
    backgroundColor: "#002211",
  },
  nextActionBtn: {
    height: BTN_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#00FF88",
    backgroundColor: "#003322",
  },
  nextActionBtnText: {
    fontSize: 11,
    fontFamily: "Cinzel_700Bold",
    color: "#00FF88",
    letterSpacing: 0.5,
  },
  gameResultOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.80)",
    alignItems: "center",
    justifyContent: "center",
  },
  gameResultCard: {
    width: 320,
    backgroundColor: "#1E1608",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#9A7830",
    padding: 36,
    alignItems: "center",
    gap: 16,
  },
  gameResultEmoji: {
    fontSize: 56,
  },
  gameResultTitle: {
    fontSize: 28,
    fontFamily: "Cinzel_700Bold",
    letterSpacing: 1,
  },
  gameResultVictoryTitle: {
    color: "#F0D060",
  },
  gameResultDefeatTitle: {
    color: "#E06050",
  },
  gameResultBody: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#C8A870",
    textAlign: "center",
    lineHeight: 22,
  },
  gameResultBtn: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#9A7830",
    backgroundColor: "#3A2A10",
    alignItems: "center",
  },
  gameResultBtnText: {
    fontSize: 14,
    fontFamily: "Cinzel_700Bold",
    color: "#F0D080",
    letterSpacing: 0.5,
  },
  gameResultMenuBtn: {
    backgroundColor: "#2A1E08",
    borderColor: "#6A5020",
  },
  gameResultMenuBtnText: {
    color: "#C8A24A",
    fontSize: 12,
  },
  dominanceContinueBtn: {
    backgroundColor: "#1A3A20",
    borderColor: "#4A8A50",
  },
  dominanceContinueBtnText: {
    color: "#80D090",
  },
  splashOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#0D0A06",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  splashPreloadImg: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  splashTitle: {
    fontFamily: "Cinzel_700Bold",
    fontSize: 34,
    color: "#C8A24A",
    letterSpacing: 2,
    textAlign: "center",
  },
  splashSeparator: {
    width: 180,
    height: 1.5,
    backgroundColor: "#C8A24A",
    marginVertical: 14,
    opacity: 0.7,
  },
  splashSubtitle: {
    fontFamily: "Cinzel_400Regular",
    fontSize: 17,
    color: "#D4BF96",
    letterSpacing: 1,
    textAlign: "center",
  },
});
