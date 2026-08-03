import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEFAULT_GAME_ELEMENTS,
  normalizeGameElements,
  type GameElements,
} from "@/constants/gameElements";
import type { Difficulty } from "@/types";

const STORAGE_KEY = "hex_battles_settings_v1";

export const COLOR_KEYS = ["blue", "red", "green", "orange", "purple", "teal"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export interface GameSettings {
  playerColor: ColorKey;
  mountainPct: number;
  lakePct: number;
  desertPct: number;
  forestPct: number;
  /**
   * Neutral cities as a density — cities per 100 tiles — so the real number
   * follows the map size instead of sitting at the same count on a 40-tile and
   * a 200-tile map. The menu shows it as a count; see cityCountForMap.
   */
  cityPct: number;
  /** Which parts of the game new games start with. Remembered between launches. */
  elements: GameElements;
  /** Map size chosen in the main menu. Remembered between launches. */
  tileCount: number;
  /** Number of AI opponents chosen in the main menu. */
  opponentCount: number;
  /** AI difficulty chosen in the main menu. */
  difficulty: Difficulty;
}

export const DEFAULT_SETTINGS: GameSettings = {
  playerColor: "blue",
  mountainPct: 8,
  lakePct: 10,
  desertPct: 10,
  forestPct: 10,
  cityPct: 2,
  elements: DEFAULT_GAME_ELEMENTS,
  tileCount: 100,
  opponentCount: 3,
  difficulty: "medium",
};

export const MIN_TERRAIN_PCT = 0;
export const MAX_TERRAIN_PCT = 25;
export const MIN_TILE_COUNT = 40;
export const MAX_TILE_COUNT = 200;
export const MIN_OPPONENT_COUNT = 1;
export const MAX_OPPONENT_COUNT = 4;

/**
 * The densest the city slider goes: 4 cities per 100 tiles. Measured against
 * the minimum spacing map generation keeps between cities — asking for more
 * than this on a big map just returns fewer cities than the slider promised.
 */
export const MAX_CITY_PCT = 4;
/**
 * What a *stored* density may be. Slightly above the slider's own ceiling
 * because the slider works in whole cities: one city on a 40-tile map is a
 * density of 2.5, two is 5.
 */
const MAX_STORED_CITY_PCT = 6;

/** Most cities the slider offers on a map of this size. Always at least one. */
export function maxCitiesForMap(tileCount: number): number {
  return Math.max(1, Math.round((tileCount * MAX_CITY_PCT) / 100));
}

/**
 * Cities a stored density yields on a map of this size. Any density above zero
 * is worth at least one city, so a small map never silently drops to none.
 */
export function cityCountForMap(pct: number, tileCount: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  const raw = Math.round((tileCount * pct) / 100);
  return Math.min(maxCitiesForMap(tileCount), Math.max(1, raw));
}

/** Inverse of cityCountForMap: the density that gives `count` cities here. */
export function cityPctForCount(count: number, tileCount: number): number {
  if (count <= 0) return 0;
  return (count * 100) / Math.max(1, tileCount);
}

const DIFFICULTIES: readonly Difficulty[] = [
  "easy",
  "medium",
  "hard",
  "expert",
  "super_expert",
];

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * Blobs written before cities became a density stored a plain count. The
 * default map was 100 tiles back then, so a stored count reads directly as
 * cities per 100 tiles: 2 cities → 2%.
 */
function storedCityPct(safe: Record<string, unknown>): number {
  const pct = safe.cityPct;
  if (typeof pct === "number") return pct;
  const legacy = safe.cityCount;
  if (typeof legacy === "number") return legacy;
  return DEFAULT_SETTINGS.cityPct;
}

export function normalizeSettings(s: Partial<GameSettings> | null | undefined): GameSettings {
  const safe = s ?? {};
  return {
    playerColor: (COLOR_KEYS as readonly string[]).includes(safe.playerColor as string)
      ? (safe.playerColor as ColorKey)
      : DEFAULT_SETTINGS.playerColor,
    mountainPct: clampInt(safe.mountainPct ?? DEFAULT_SETTINGS.mountainPct, MIN_TERRAIN_PCT, MAX_TERRAIN_PCT),
    lakePct: clampInt(safe.lakePct ?? DEFAULT_SETTINGS.lakePct, MIN_TERRAIN_PCT, MAX_TERRAIN_PCT),
    desertPct: clampInt(safe.desertPct ?? DEFAULT_SETTINGS.desertPct, MIN_TERRAIN_PCT, MAX_TERRAIN_PCT),
    forestPct: clampInt(safe.forestPct ?? DEFAULT_SETTINGS.forestPct, MIN_TERRAIN_PCT, MAX_TERRAIN_PCT),
    cityPct: clampNum(
      storedCityPct(safe as unknown as Record<string, unknown>),
      0,
      MAX_STORED_CITY_PCT,
    ),
    elements: normalizeGameElements((safe as { elements?: unknown }).elements),
    tileCount: clampInt(safe.tileCount ?? DEFAULT_SETTINGS.tileCount, MIN_TILE_COUNT, MAX_TILE_COUNT),
    opponentCount: clampInt(
      safe.opponentCount ?? DEFAULT_SETTINGS.opponentCount,
      MIN_OPPONENT_COUNT,
      MAX_OPPONENT_COUNT,
    ),
    difficulty: DIFFICULTIES.includes(safe.difficulty as Difficulty)
      ? (safe.difficulty as Difficulty)
      : DEFAULT_SETTINGS.difficulty,
  };
}

let cached: GameSettings = { ...DEFAULT_SETTINGS };
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

export function isSettingsHydrated(): boolean {
  return hydrated;
}

export function getSettingsSync(): GameSettings {
  return cached;
}

export async function hydrateSettings(): Promise<void> {
  if (hydrated) return;
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      // `!hydrated` re-checked after the await: saveSettings sets it, so a
      // menu control tapped while the read was in flight must not have its
      // change overwritten by the older stored blob.
      if (raw && !hydrated) {
        const parsed = JSON.parse(raw);
        cached = normalizeSettings(parsed);
      }
    } catch {
      // Ignore — fall back to defaults
    } finally {
      hydrated = true;
      hydrationPromise = null;
    }
  })();
  return hydrationPromise;
}

export async function saveSettings(next: GameSettings): Promise<void> {
  cached = normalizeSettings(next);
  hydrated = true;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Best-effort
  }
}
