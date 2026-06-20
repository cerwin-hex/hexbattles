import type { Dispatch, SetStateAction } from "react";
import type {
  EntityType,
  HexTile,
  TerritoryOwner,
  MoveHistorySnapshot,
  GameResult,
} from "@/types";
import { HEX_EDGES, tileKey } from "@/utils/hexMath";
import { applySingleHexPenalty } from "@/logic/gameLogic";

export interface EndTurnParams {
  isAiTurn: boolean;
  gameResult: GameResult;
  territoryBalances: Map<string, number>;
  entities: Map<string, EntityType>;
  turn: number;
  activeTileMap: Map<string, HexTile>;
  cities: Set<string>;
  graveyard: Set<string>;
  ruins: Set<string>;
  mutableTileMap: Map<string, HexTile>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  aiTurnRef: { current: boolean };
  setMoveHistory: Dispatch<SetStateAction<MoveHistorySnapshot[]>>;
  setMutableTileMap: (m: Map<string, HexTile>) => void;
  setTerritoryBalances: (m: Map<string, number>) => void;
  setEntities: (m: Map<string, EntityType>) => void;
  setGraveyard: (s: Set<string>) => void;
  setRuins: (s: Set<string>) => void;
  setSelectedTileKey: (k: string | null) => void;
  setArmedEntityId: (id: EntityType | null) => void;
  setSelectedEntityKey: (k: string | null) => void;
  setSpentUnits: (s: Set<string>) => void;
  setCombatSpentUnits: (s: Set<string>) => void;
  setPartialMoves: (m: Map<string, number>) => void;
  setAttacksUsed: (m: Map<string, number>) => void;
  setIsAiTurn: (b: boolean) => void;
  checkWinLoss: (map: Map<string, HexTile>) => boolean;
  runAiTurn: (
    currentTileMap: Map<string, HexTile>,
    currentEntities: Map<string, EntityType>,
    currentBalances: Map<string, number>,
    currentTurn?: number,
    initialGraveyard?: Set<string>,
    initialRuins?: Set<string>,
    initialCities?: Set<string>,
  ) => void;
  closeRibbon: () => void;
}

export function handleEndTurnLogic(params: EndTurnParams): void {
  const {
    isAiTurn,
    gameResult,
    territoryBalances,
    entities,
    turn,
    activeTileMap,
    cities,
    graveyard,
    ruins,
    liveOwnerMap,
    aiTurnRef,
    setMoveHistory,
    setMutableTileMap,
    setTerritoryBalances,
    setEntities,
    setGraveyard,
    setRuins,
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
  } = params;

  if (isAiTurn || gameResult !== null) return;
  setMoveHistory([]);

  // `activeTileMap` is the live React-state map (it equals `mutableTileMap`
  // during play). Never mutate it in place: doing so corrupts downstream
  // incremental caches that diff against the prior map (see the border-edge
  // cache, which would miss a bankruptcy owner→neutral flip). Instead work on a
  // private clone, apply every ownership change to it, and commit it once via
  // `setMutableTileMap`. `prevTileMapSnapshot` stays frozen as the pre-turn
  // state for `applySingleHexPenalty`.
  const prevTileMapSnapshot = new Map(activeTileMap);
  const nextTileMap = new Map(activeTileMap);
  const nextBalances = new Map(territoryBalances);
  let nextEntities = new Map(entities);
  const nextGraveyard = new Set<string>();
  const nextRuins = new Set<string>();

  // The PLAYER's income/upkeep/bankruptcy is no longer applied here. It now runs
  // exactly once per round at the player's turn boundary — the end of the AI
  // phase (see `runAiTurn` in aiStrategy.ts), i.e. the start of the player's next
  // turn. Applying it here as well double-charged upkeep and wrongly bankrupted
  // negative-net territories whose reserves covered exactly one application.

  // AI income/upkeep is no longer applied here either. Each AI owner's economy
  // now runs at the start of its own turn, inside `runAiTurn` (aiStrategy.ts),
  // credited from round 3 onward — the same one-round delay that keeps both
  // sides at 10 + (R-2) income credits at the start of round R. Centralising the
  // economy there (via `applyOwnerEconomy`) makes `runAiTurn` the single
  // authority for both the React flow and the headless self-play harness.

  // End-of-turn single-hex remnant sweep (defensive backstop). The main sources
  // of mid-turn isolation each sweep in their own handler now — player moves in
  // tileTapHandler, AI captures and the per-owner economy (demolished bridges) in
  // runAiTurn — so this pass rarely finds anything, but it's a cheap safety net
  // so no isolated single-hex territory can linger with inherited reserves.
  if (turn !== 1) {
    applySingleHexPenalty(
      prevTileMapSnapshot,
      nextTileMap,
      nextBalances,
      nextEntities,
      nextGraveyard,
      nextRuins,
    );
  }

  // Rebel spawning and spreading is suspended in round 1
  if (turn !== 1) {
    // Clone nextEntities once before the spawn loops so we can mutate in-place.
    // Earlier this clone happened inside the loop per spawn, which made the
    // whole pass quadratic once graveyard/ruins accumulated late in the game.
    nextEntities = new Map(nextEntities);
    for (const gravKey of graveyard) {
      const gravTile = nextTileMap.get(gravKey);
      if (gravTile?.terrain === "lake") continue;
      if (!nextEntities.has(gravKey) && Math.random() < 0.75) {
        nextEntities.set(gravKey, "rebel");
      }
    }
    for (const ruinKey of ruins) {
      const ruinTile = nextTileMap.get(ruinKey);
      if (ruinTile?.terrain === "lake") continue;
      if (!nextEntities.has(ruinKey) && Math.random() < 0.75) {
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
    for (const tile of nextTileMap.values()) {
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

  setMutableTileMap(nextTileMap);
  setTerritoryBalances(nextBalances);
  setEntities(nextEntities);
  setGraveyard(nextGraveyard);
  setRuins(nextRuins);
  // The round counter is NOT advanced here. It advances when the AI phase
  // completes (aiStrategy.runAiTurn → cbs.state.advanceTurn), so the counter
  // equals the round number: everyone acts in round R while it reads R. The
  // income gates above ran with `turn` === R (the player's round), unchanged.
  setSelectedTileKey(null);
  setArmedEntityId(null);
  setSelectedEntityKey(null);
  setSpentUnits(new Set());
  setCombatSpentUnits(new Set());
  setPartialMoves(new Map());
  setAttacksUsed(new Map());
  closeRibbon();

  if (!checkWinLoss(nextTileMap)) {
    setIsAiTurn(true);
    aiTurnRef.current = true;
    runAiTurn(
      nextTileMap,
      nextEntities,
      nextBalances,
      turn,
      nextGraveyard,
      nextRuins,
      cities,
    );
  }
}
