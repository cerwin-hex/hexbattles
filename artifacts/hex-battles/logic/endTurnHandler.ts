import type { Dispatch, SetStateAction } from "react";
import type {
  EntityType,
  HexTile,
  TerritoryOwner,
  Difficulty,
  MoveHistorySnapshot,
  GameResult,
} from "@/types";
import { HEX_EDGES, tileKey } from "@/utils/hexMath";
import {
  ENTITY_META,
  TERRAIN_INCOME,
  CITY_BONUS,
  getContiguousTerritory,
  getTerritoryId,
} from "@/utils/hexGrid";
import { applySingleHexPenalty, calcTerritoryUpkeep } from "@/logic/gameLogic";

export interface EndTurnParams {
  isAiTurn: boolean;
  gameResult: GameResult;
  territoryBalances: Map<string, number>;
  entities: Map<string, EntityType>;
  turn: number;
  activeTileMap: Map<string, HexTile>;
  cities: Set<string>;
  aiOwners: TerritoryOwner[];
  aiDifficulty: Difficulty;
  graveyard: Set<string>;
  ruins: Set<string>;
  mutableTileMap: Map<string, HexTile>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  aiTurnRef: { current: boolean };
  setMoveHistory: Dispatch<SetStateAction<MoveHistorySnapshot[]>>;
  setTerritoryBalances: (m: Map<string, number>) => void;
  setEntities: (m: Map<string, EntityType>) => void;
  setGraveyard: (s: Set<string>) => void;
  setRuins: (s: Set<string>) => void;
  setTurn: Dispatch<SetStateAction<number>>;
  setSelectedTileKey: (k: string | null) => void;
  setArmedEntityId: (id: EntityType | null) => void;
  setSelectedEntityKey: (k: string | null) => void;
  setSpentUnits: (s: Set<string>) => void;
  setCombatSpentUnits: (s: Set<string>) => void;
  setPartialMoves: (m: Map<string, number>) => void;
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
    setIsAiTurn,
    checkWinLoss,
    runAiTurn,
    closeRibbon,
  } = params;

  if (isAiTurn || gameResult !== null) return;
  setMoveHistory([]);

  const prevTileMapSnapshot = new Map(mutableTileMap);
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
        nextEntities,
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
        // Bankruptcy: reserves + income could not cover upkeep, so the balance
        // is fully drained paying as much of the bill as possible (lands at 0),
        // then units are liquidated, and if upkeep still exceeds income,
        // buildings are demolished.
        nextBalances.set(territoryId, 0);
        nextEntities = new Map(nextEntities);
        let unitUpkeepSaved = 0;
        for (const t of territory) {
          const e = nextEntities.get(t.key);
          if (e && ENTITY_META[e].isUnit) {
            unitUpkeepSaved += ENTITY_META[e].upkeep;
            if (mutableTileMap.get(t.key)?.terrain === "lake") {
              nextEntities.set(t.key, "bridge");
            } else {
              nextEntities.delete(t.key);
            }
            nextGraveyard.add(t.key);
          }
        }
        if (delta + unitUpkeepSaved < 0) {
          for (const t of territory) {
            const e = nextEntities.get(t.key);
            if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
              nextEntities.delete(t.key);
              nextRuins.add(t.key);
              if (e === "bridge") {
                const lt = mutableTileMap.get(t.key);
                if (lt) mutableTileMap.set(t.key, { ...lt, owner: "neutral" });
              }
            }
          }
        }
      } else {
        nextBalances.set(territoryId, newBalance);
      }
    }
  }

  // AI income/upkeep must match the player's SPEND cadence, not merely the same
  // crediting moment. The player's income is credited here at the end of turn N
  // but isn't spendable until the player's next turn (round N+1) — a one-round
  // delay. The AI, however, plays its turn immediately after this handler (see
  // runAiTurn below), so income credited here would be spent in the SAME round,
  // putting the AI a full economy cycle ahead (it could e.g. upgrade its free
  // round-1 tower already in round 2, which the player cannot). To give the AI
  // the same one-round delay we credit its income one handler later: from turn 3
  // onward (turn > 2). Net effect: at the start of round R both sides hold
  // 10 + (R-2) income credits.
  if (turn > 2) {
    for (const aiOwner of aiOwners) {
      const aiVisited = new Set<string>();
      for (const tile of Array.from(activeTileMap.values())) {
        if (tile.owner !== aiOwner || aiVisited.has(tile.key)) continue;
        const territory = getContiguousTerritory(
          activeTileMap,
          tile.key,
          aiOwner,
          nextEntities,
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
        const landTileCount = territory.filter(t => t.terrain !== "lake").length;
        const incomeModifier = aiDifficulty === "super_hard" ? landTileCount : 0;
        const upkeep = calcTerritoryUpkeep(territory, nextEntities);
        const current = nextBalances.get(territoryId) ?? 0;
        const delta = income + incomeModifier - upkeep;
        const newBalance = current + delta;
        if (newBalance < 0) {
          // Bankruptcy: reserves + income could not cover upkeep, so the
          // balance is drained to 0 and units (and possibly buildings) are
          // liquidated.
          nextBalances.set(territoryId, 0);
          nextEntities = new Map(nextEntities);
          let unitUpkeepSaved = 0;
          for (const t of territory) {
            const e = nextEntities.get(t.key);
            if (e && ENTITY_META[e].isUnit) {
              unitUpkeepSaved += ENTITY_META[e].upkeep;
              if (mutableTileMap.get(t.key)?.terrain === "lake") {
                nextEntities.set(t.key, "bridge");
              } else {
                nextEntities.delete(t.key);
              }
              nextGraveyard.add(t.key);
            }
          }
          if (delta + unitUpkeepSaved < 0) {
            for (const t of territory) {
              const e = nextEntities.get(t.key);
              if (e && !ENTITY_META[e].isUnit && e !== "rebel" && e !== "city") {
                nextEntities.delete(t.key);
                nextRuins.add(t.key);
                if (e === "bridge") {
                  const lt = mutableTileMap.get(t.key);
                  if (lt) mutableTileMap.set(t.key, { ...lt, owner: "neutral" });
                }
              }
            }
          }
        } else {
          nextBalances.set(territoryId, newBalance);
        }
      }
    }
  }

  // After bankruptcy, any bridges or buildings demolished mid-territory can
  // leave single-hex remnants (especially isolated bridges that previously
  // had a positive balance). Clean those up now so isolated bridges don't
  // linger on the board with inherited reserves.
  if (turn !== 1) {
    applySingleHexPenalty(
      prevTileMapSnapshot,
      mutableTileMap,
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
      const gravTile = activeTileMap.get(gravKey);
      if (gravTile?.terrain === "lake") continue;
      if (!nextEntities.has(gravKey) && Math.random() < 0.75) {
        nextEntities.set(gravKey, "rebel");
      }
    }
    for (const ruinKey of ruins) {
      const ruinTile = activeTileMap.get(ruinKey);
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
    for (const tile of activeTileMap.values()) {
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

  setTerritoryBalances(nextBalances);
  setEntities(nextEntities);
  setGraveyard(nextGraveyard);
  setRuins(nextRuins);
  setTurn((t) => t + 1);
  setSelectedTileKey(null);
  setArmedEntityId(null);
  setSelectedEntityKey(null);
  setSpentUnits(new Set());
  setCombatSpentUnits(new Set());
  setPartialMoves(new Map());
  closeRibbon();

  if (!checkWinLoss(mutableTileMap)) {
    setIsAiTurn(true);
    aiTurnRef.current = true;
    runAiTurn(
      mutableTileMap,
      nextEntities,
      nextBalances,
      turn,
      nextGraveyard,
      nextRuins,
      cities,
    );
  }
}
