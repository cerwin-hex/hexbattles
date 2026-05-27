import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  Difficulty,
  EntityType,
  HexTile,
  TerritoryOwner,
} from "@/types";

const STORAGE_KEY = "hex_battles_saved_game_v1";

export interface SavedGameState {
  mutableTileMap: Map<string, HexTile>;
  entities: Map<string, EntityType>;
  territoryBalances: Map<string, number>;
  spentUnits: Set<string>;
  combatSpentUnits: Set<string>;
  partialMoves: Map<string, number>;
  liveOwnerMap: Map<string, TerritoryOwner>;
  cities: Set<string>;
  graveyard: Set<string>;
  ruins: Set<string>;
  freeTowerUsedTiles: Map<TerritoryOwner, Set<string>>;
  turn: number;
}

export interface SavedGameConfig {
  numTiles: number;
  numOpponents: number;
  difficulty: Difficulty;
}

export interface SavedGame {
  tiles: HexTile[];
  config: SavedGameConfig;
  state: SavedGameState;
}

interface Serialized {
  v: 1;
  tiles: HexTile[];
  config: SavedGameConfig;
  state: {
    mutableTileMap: [string, HexTile][];
    entities: [string, EntityType][];
    territoryBalances: [string, number][];
    spentUnits: string[];
    combatSpentUnits: string[];
    partialMoves: [string, number][];
    liveOwnerMap: [string, TerritoryOwner][];
    cities: string[];
    graveyard: string[];
    ruins: string[];
    freeTowerUsedTiles: [TerritoryOwner, string[]][];
    turn: number;
  };
}

export function serializeSavedGame(g: SavedGame): string {
  const serialized: Serialized = {
    v: 1,
    tiles: g.tiles,
    config: g.config,
    state: {
      mutableTileMap: [...g.state.mutableTileMap.entries()],
      entities: [...g.state.entities.entries()],
      territoryBalances: [...g.state.territoryBalances.entries()],
      spentUnits: [...g.state.spentUnits],
      combatSpentUnits: [...g.state.combatSpentUnits],
      partialMoves: [...g.state.partialMoves.entries()],
      liveOwnerMap: [...g.state.liveOwnerMap.entries()],
      cities: [...g.state.cities],
      graveyard: [...g.state.graveyard],
      ruins: [...g.state.ruins],
      freeTowerUsedTiles: [...g.state.freeTowerUsedTiles.entries()].map(
        ([k, v]) => [k, [...v]],
      ),
      turn: g.state.turn,
    },
  };
  return JSON.stringify(serialized);
}

export function deserializeSavedGame(json: string): SavedGame | null {
  try {
    const parsed = JSON.parse(json) as Serialized;
    if (!parsed || parsed.v !== 1) return null;
    return {
      tiles: parsed.tiles,
      config: parsed.config,
      state: {
        mutableTileMap: new Map(parsed.state.mutableTileMap),
        entities: new Map(parsed.state.entities),
        territoryBalances: new Map(parsed.state.territoryBalances),
        spentUnits: new Set(parsed.state.spentUnits),
        combatSpentUnits: new Set(parsed.state.combatSpentUnits),
        partialMoves: new Map(parsed.state.partialMoves),
        liveOwnerMap: new Map(parsed.state.liveOwnerMap),
        cities: new Set(parsed.state.cities),
        graveyard: new Set(parsed.state.graveyard),
        ruins: new Set(parsed.state.ruins),
        freeTowerUsedTiles: new Map(
          parsed.state.freeTowerUsedTiles.map(([k, v]) => [k, new Set(v)]),
        ),
        turn: parsed.state.turn,
      },
    };
  } catch {
    return null;
  }
}

let cache: SavedGame | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeSavedGame(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSavedGameSync(): SavedGame | null {
  return cache;
}

export function hasSavedGameSync(): boolean {
  return cache !== null;
}

export function isHydrated(): boolean {
  return hydrated;
}

export async function hydrateSavedGame(): Promise<SavedGame | null> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    cache = json ? deserializeSavedGame(json) : null;
  } catch {
    cache = null;
  }
  hydrated = true;
  notify();
  return cache;
}

export function setSavedGame(g: SavedGame): void {
  cache = g;
  notify();
  AsyncStorage.setItem(STORAGE_KEY, serializeSavedGame(g)).catch(() => {});
}

export function clearSavedGame(): void {
  cache = null;
  notify();
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

// Test-only: reset module state. Not called in production code.
export function __resetForTests(): void {
  cache = null;
  hydrated = false;
  listeners.clear();
}
