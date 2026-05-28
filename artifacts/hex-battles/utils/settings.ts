import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "hex_battles_settings_v1";

export const COLOR_KEYS = ["blue", "red", "green", "orange", "purple", "teal"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export interface GameSettings {
  playerColor: ColorKey;
  mountainPct: number;
  lakePct: number;
  desertPct: number;
  forestPct: number;
  cityCount: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  playerColor: "blue",
  mountainPct: 8,
  lakePct: 10,
  desertPct: 10,
  forestPct: 10,
  cityCount: 2,
};

export const MIN_TERRAIN_PCT = 0;
export const MAX_TERRAIN_PCT = 25;
export const MIN_CITY_COUNT = 0;
export const MAX_CITY_COUNT = 5;

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
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
    cityCount: clampInt(safe.cityCount ?? DEFAULT_SETTINGS.cityCount, MIN_CITY_COUNT, MAX_CITY_COUNT),
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
      if (raw) {
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
