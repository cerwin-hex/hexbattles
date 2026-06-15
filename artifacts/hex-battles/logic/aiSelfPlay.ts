import type {
  HexTile,
  EntityType,
  TerritoryOwner,
  Difficulty,
  AiState,
} from "@/types";
import {
  generateHexGrid,
  recalculateTerritoriesForCapture,
  getContiguousTerritory,
  getTerritoryId,
  ENTITY_META,
} from "@/utils/hexGrid";
import { applySingleHexPenalty, calcTerritoryIncome, calcTerritoryUpkeep } from "@/logic/gameLogic";
import { runAiTurn } from "@/logic/aiStrategy";
import type { AiWorkingState, AiTurnCallbacks } from "@/logic/aiStrategy";
import { __setExpertWeightsOverride, __setExpertSearchConfig, type EvalWeights } from "@/logic/aiExpert";

// ════════════════════════════════════════════════════════════════════════════
// Headless AI-vs-AI self-play harness.
//
// Drives the real `runAiTurn` with pure callbacks (no React, no animation) plus
// a faithful headless income/upkeep step mirroring `endTurnHandler`'s AI rule,
// so two difficulties can play full games against each other. Used to validate
// that `expert` is genuinely stronger than `super_hard`.
// ════════════════════════════════════════════════════════════════════════════

/** Deterministic PRNG so matches are reproducible from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPETITORS: TerritoryOwner[] = ["ai1", "ai2"];

function landTiles(ws: AiWorkingState, owner: TerritoryOwner): number {
  let n = 0;
  for (const t of ws.tileMap.values()) {
    if (t.owner === owner && t.terrain !== "lake" && t.terrain !== "mountain") n++;
  }
  return n;
}

export interface OwnerStats {
  land: number;
  units: number;
  forts: number;
  balance: number;
}

function ownerStats(ws: AiWorkingState, owner: TerritoryOwner): OwnerStats {
  let units = 0;
  let forts = 0;
  for (const [k, e] of ws.entities) {
    if (ws.tileMap.get(k)?.owner !== owner) continue;
    if (ENTITY_META[e].isUnit) units++;
    else if (e === "tower" || e === "castle") forts++;
  }
  let balance = 0;
  const visited = new Set<string>();
  for (const t of ws.tileMap.values()) {
    if (t.owner !== owner || visited.has(t.key)) continue;
    const terr = getContiguousTerritory(ws.tileMap, t.key, owner, ws.entities);
    for (const ct of terr) visited.add(ct.key);
    const tid = getTerritoryId(terr);
    if (tid) balance += ws.balances.get(tid) ?? 0;
  }
  return { land: landTiles(ws, owner), units, forts, balance };
}

/** Headless income/upkeep step — mirrors the AI branch of endTurnHandler. */
/** Mirrors endTurnHandler: only the two "super" tiers get the income bonus. */
function ownerGetsIncomeBonus(
  owner: TerritoryOwner,
  diffByOwner: Record<string, Difficulty>,
): boolean {
  const d = diffByOwner[owner];
  return d === "super_hard" || d === "super_expert";
}

function creditIncome(
  ws: AiWorkingState,
  diffByOwner: Record<string, Difficulty>,
  seats: TerritoryOwner[] = COMPETITORS,
): void {
  for (const owner of seats) {
    const visited = new Set<string>();
    for (const tile of Array.from(ws.tileMap.values())) {
      if (tile.owner !== owner || visited.has(tile.key)) continue;
      const territory = getContiguousTerritory(ws.tileMap, tile.key, owner, ws.entities);
      for (const t of territory) visited.add(t.key);
      const tid = getTerritoryId(territory);
      if (!tid) continue;
      if (!ws.balances.has(tid)) ws.balances.set(tid, 0);
      const income = calcTerritoryIncome(territory, ws.entities, ws.cities, ws.tileMap);
      const landTileCount = territory.filter((t) => t.terrain !== "lake").length;
      const incomeModifier = ownerGetsIncomeBonus(owner, diffByOwner)
        ? landTileCount
        : 0;
      const upkeep = calcTerritoryUpkeep(territory, ws.entities);
      const current = ws.balances.get(tid) ?? 0;
      const delta = income + incomeModifier - upkeep;
      const newBalance = current + delta;
      if (newBalance < 0) {
        ws.balances.set(tid, 0);
        let unitUpkeepSaved = 0;
        for (const t of territory) {
          const e = ws.entities.get(t.key);
          if (e && ENTITY_META[e].isUnit) {
            unitUpkeepSaved += ENTITY_META[e].upkeep;
            if (ws.tileMap.get(t.key)?.terrain === "lake") ws.entities.set(t.key, "bridge");
            else ws.entities.delete(t.key);
            ws.graveyard.add(t.key);
          }
        }
        if (delta + unitUpkeepSaved < 0) {
          for (const t of territory) {
            const e = ws.entities.get(t.key);
            if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
              ws.entities.delete(t.key);
              ws.ruins.add(t.key);
              if (e === "bridge") {
                const lt = ws.tileMap.get(t.key);
                if (lt) ws.tileMap.set(t.key, { ...lt, owner: "neutral" });
              }
            }
          }
        }
      } else {
        ws.balances.set(tid, newBalance);
      }
    }
  }
}

function makeHeadlessCbs(): AiTurnCallbacks {
  let aiStateMap = new Map<string, AiState>();
  const noop = (): void => {};
  return {
    state: {
      setEntities: noop,
      setMutableTileMap: noop,
      setTerritoryBalances: noop,
      setGraveyard: noop,
      setRuins: noop,
      setLiveOwnerMap: noop,
      setCities: noop,
      setFreeTowerUsedTiles: noop,
      setAiStateMap: noop,
      setIsAiTurn: noop,
      // The headless harness counts rounds in its own loop, so the AI-phase
      // advance is a no-op here.
      advanceTurn: noop,
    },
    refs: {
      getAiStateMap: () => aiStateMap,
      setAiStateMap: (v) => {
        aiStateMap = v;
      },
      isTurnActive: () => true,
      isDeveloperMode: () => true,
      setAiTurn: noop,
    },
    initStepHistory: noop,
    awaitStep: async () => {},
    awaitPreAiResume: async () => {},
    awaitPostAiResume: async () => {},
    triggerUnitAnimation: (_f, _t, _e, _o, _isAi, done) => done(),
    recalculateTerritoriesForCapture,
    applySingleHexPenalty,
    checkWinLoss: noop,
  };
}

/**
 * Run exactly one AI owner-turn headlessly against the real `runAiTurn`,
 * resetting the per-turn movement/attack budgets first (mirrors the end-of-turn
 * reset inside `playMatch`). Lets tests drive the genuine AI decision loop —
 * including faithful cavalry move-chaining — without standing up a parallel
 * exec mock.
 */
export async function runOneAiTurnHeadless(
  ws: AiWorkingState,
  owner: TerritoryOwner,
  turn: number,
  difficulty: Difficulty,
): Promise<void> {
  ws.spentUnits = new Set();
  ws.partialMoves = new Map();
  ws.attacksUsed = new Map();
  ws.combatSpentUnits = new Set();
  await runAiTurn(ws, makeHeadlessCbs(), [owner], turn, difficulty);
}

export interface MatchConfig {
  seed: number;
  tiles: number;
  /** Difficulty assigned to ai1. */
  difficultyA: Difficulty;
  /** Difficulty assigned to ai2. */
  difficultyB: Difficulty;
  maxTurns: number;
  /** Override expert eval weights for this match (tuning). */
  weights?: EvalWeights;
  /** Optional per-turn diagnostic hook (after both seats have moved). */
  onTurn?: (turn: number, landA: number, landB: number) => void;
  /** Richer per-turn diagnostic hook with unit/fort/balance stats. */
  onTurnStats?: (turn: number, a: OwnerStats, b: OwnerStats) => void;
}

export interface MatchResult {
  winner: TerritoryOwner | "draw";
  turns: number;
  landA: number;
  landB: number;
  /** Lowest territory balance seen at any point (must stay >= 0: no over-spend). */
  minBalance: number;
  /** Wall-clock ms elapsed during the per-turn loop. */
  elapsedMs: number;
}

/** Play one full headless AI-vs-AI game and report the winner by land control. */
export async function playMatch(cfg: MatchConfig): Promise<MatchResult> {
  const rng = mulberry32(cfg.seed);
  const origRandom = Math.random;
  Math.random = rng;
  __setExpertWeightsOverride(cfg.weights ?? null);
  try {
    const tiles = generateHexGrid(cfg.tiles, 2);
    const tileMap = new Map<string, HexTile>(tiles.map((t) => [t.key, t]));
    // generateHexGrid labels the two seats "player"/"ai1"; remap to ai1/ai2.
    for (const t of tileMap.values()) {
      if (t.owner === "player") t.owner = "ai1";
      else if (t.owner === "ai1") t.owner = "ai2";
    }

    const entities = new Map<string, EntityType>();
    for (const t of tileMap.values()) {
      if (t.owner !== "ai1" && t.owner !== "ai2") continue;
      if (t.terrain === "mountain" || t.terrain === "lake") continue;
      if (rng() < 0.1) entities.set(t.key, "rebel");
    }
    const cities = new Set<string>(tiles.filter((t) => t.isCity).map((t) => t.key));

    const ws: AiWorkingState = {
      tileMap,
      entities,
      balances: new Map(),
      liveOwnerMap: new Map(),
      graveyard: new Set(),
      ruins: new Set(),
      cities,
      spentUnits: new Set(),
      partialMoves: new Map(),
      attacksUsed: new Map(),
      combatSpentUnits: new Set(),
      freeTowerUsed: new Map(),
    };

    const diffByOwner: Record<string, Difficulty> = {
      ai1: cfg.difficultyA,
      ai2: cfg.difficultyB,
    };
    const cbs = makeHeadlessCbs();

    let minBalance = 0;
    const t0 = Date.now();
    let turn = 1;
    for (; turn <= cfg.maxTurns; turn++) {
      // AI income is credited from turn 3 onward (matches endTurnHandler cadence).
      if (turn >= 3) creditIncome(ws, diffByOwner);

      for (const owner of COMPETITORS) {
        if (landTiles(ws, owner) === 0) continue;
        // Fresh per-turn movement budget, like end-of-turn reset in the game.
        ws.spentUnits = new Set();
        ws.partialMoves = new Map();
        ws.attacksUsed = new Map();
        ws.combatSpentUnits = new Set();
        await runAiTurn(ws, cbs, [owner], turn, diffByOwner[owner]);
        // Invariant: no territory may ever hold a negative balance (over-spend).
        for (const bal of ws.balances.values()) {
          if (bal < minBalance) minBalance = bal;
        }
      }

      const a = landTiles(ws, "ai1");
      const b = landTiles(ws, "ai2");
      cfg.onTurn?.(turn, a, b);
      if (cfg.onTurnStats) cfg.onTurnStats(turn, ownerStats(ws, "ai1"), ownerStats(ws, "ai2"));
      if (a === 0 || b === 0) {
        turn++;
        break;
      }
    }

    const landA = landTiles(ws, "ai1");
    const landB = landTiles(ws, "ai2");
    const winner: TerritoryOwner | "draw" =
      landA === landB ? "draw" : landA > landB ? "ai1" : "ai2";
    return { winner, turns: Math.min(turn, cfg.maxTurns), landA, landB, minBalance, elapsedMs: Date.now() - t0 };
  } finally {
    Math.random = origRandom;
    __setExpertWeightsOverride(null);
    __setExpertSearchConfig(null);
  }
}

export interface SeriesResult {
  winsA: number;
  winsB: number;
  draws: number;
  games: number;
}

const ALL_SEATS: TerritoryOwner[] = ["ai1", "ai2", "ai3", "ai4", "ai5"];

export interface FreeForAllConfig {
  seed: number;
  tiles: number;
  /** One difficulty per seat (length N, N seats labelled ai1..aiN). */
  difficulties: Difficulty[];
  maxTurns: number;
}

export interface FreeForAllResult {
  winner: TerritoryOwner | "draw";
  land: Record<string, number>;
  turns: number;
  /** Total pure compute (ms) summed over all AI owner-turns (no animation). */
  computeMs: number;
  /** Number of AI owner-turns executed. */
  ownerTurns: number;
}

/**
 * Play one N-player free-for-all (every seat is an AI). Reports the winner by
 * land control plus pure compute timing — used to verify 3-4 AI behaviour and
 * that per-turn AI compute stays within budget at large board sizes.
 */
export async function playFreeForAll(cfg: FreeForAllConfig): Promise<FreeForAllResult> {
  const n = cfg.difficulties.length;
  const seats = ALL_SEATS.slice(0, n);
  const rng = mulberry32(cfg.seed);
  const origRandom = Math.random;
  Math.random = rng;
  __setExpertWeightsOverride(null);
  try {
    const tiles = generateHexGrid(cfg.tiles, n);
    const tileMap = new Map<string, HexTile>(tiles.map((t) => [t.key, t]));
    // generateHexGrid labels seats player,ai1,..,ai(n-1); shift to ai1..aiN.
    const remap: Record<string, TerritoryOwner> = { player: "ai1" };
    for (let i = 1; i < n; i++) remap[`ai${i}`] = `ai${i + 1}` as TerritoryOwner;
    for (const t of tileMap.values()) {
      if (remap[t.owner]) t.owner = remap[t.owner];
    }

    const entities = new Map<string, EntityType>();
    for (const t of tileMap.values()) {
      if (!seats.includes(t.owner as TerritoryOwner)) continue;
      if (t.terrain === "mountain" || t.terrain === "lake") continue;
      if (rng() < 0.1) entities.set(t.key, "rebel");
    }
    const cities = new Set<string>(tiles.filter((t) => t.isCity).map((t) => t.key));

    const ws: AiWorkingState = {
      tileMap,
      entities,
      balances: new Map(),
      liveOwnerMap: new Map(),
      graveyard: new Set(),
      ruins: new Set(),
      cities,
      spentUnits: new Set(),
      partialMoves: new Map(),
      attacksUsed: new Map(),
      combatSpentUnits: new Set(),
      freeTowerUsed: new Map(),
    };
    const diffByOwner: Record<string, Difficulty> = {};
    seats.forEach((s, i) => (diffByOwner[s] = cfg.difficulties[i]));
    const cbs = makeHeadlessCbs();

    let computeMs = 0;
    let ownerTurns = 0;
    let turn = 1;
    for (; turn <= cfg.maxTurns; turn++) {
      if (turn >= 3) creditIncome(ws, diffByOwner, seats);
      for (const owner of seats) {
        if (landTiles(ws, owner) === 0) continue;
        ws.spentUnits = new Set();
        ws.partialMoves = new Map();
        ws.attacksUsed = new Map();
        ws.combatSpentUnits = new Set();
        const t0 = performance.now();
        await runAiTurn(ws, cbs, [owner], turn, diffByOwner[owner]);
        computeMs += performance.now() - t0;
        ownerTurns++;
      }
      const alive = seats.filter((s) => landTiles(ws, s) > 0);
      if (alive.length <= 1) {
        turn++;
        break;
      }
    }

    const land: Record<string, number> = {};
    let best: TerritoryOwner | null = null;
    let bestN = -1;
    let tie = false;
    for (const s of seats) {
      land[s] = landTiles(ws, s);
      if (land[s] > bestN) {
        bestN = land[s];
        best = s;
        tie = false;
      } else if (land[s] === bestN) {
        tie = true;
      }
    }
    return {
      winner: tie || !best ? "draw" : best,
      land,
      turns: Math.min(turn, cfg.maxTurns),
      computeMs,
      ownerTurns,
    };
  } finally {
    Math.random = origRandom;
    __setExpertWeightsOverride(null);
    __setExpertSearchConfig(null);
  }
}

/**
 * Play N games alternating which seat each difficulty occupies (to cancel any
 * first-mover / map-seat bias), returning aggregate wins for difficulty A.
 */
export async function playSeries(
  n: number,
  difficultyA: Difficulty,
  difficultyB: Difficulty,
  opts: {
    tiles?: number;
    maxTurns?: number;
    baseSeed?: number;
    weights?: EvalWeights;
  } = {},
): Promise<SeriesResult> {
  const tiles = opts.tiles ?? 50;
  const maxTurns = opts.maxTurns ?? 30;
  const baseSeed = opts.baseSeed ?? 1000;
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  for (let i = 0; i < n; i++) {
    // Even games: A=ai1, B=ai2. Odd games: swap seats with the same map seed.
    const swap = i % 2 === 1;
    const r = await playMatch({
      seed: baseSeed + Math.floor(i / 2),
      tiles,
      difficultyA: swap ? difficultyB : difficultyA,
      difficultyB: swap ? difficultyA : difficultyB,
      maxTurns,
      weights: opts.weights,
    });
    const aSeat: TerritoryOwner = swap ? "ai2" : "ai1";
    if (r.winner === "draw") draws++;
    else if (r.winner === aSeat) winsA++;
    else winsB++;
  }
  return { winsA, winsB, draws, games: n };
}
