import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { buildOwnerColorMaps, type OwnerColorMaps } from "@/constants/colors";
import {
  getSettingsSync,
  hydrateSettings,
  isSettingsHydrated,
  saveSettings,
  type ColorKey,
  type GameSettings,
} from "@/utils/settings";

interface SettingsContextValue {
  settings: GameSettings;
  updateSettings: (next: GameSettings) => void;
  colorMaps: OwnerColorMaps;
  playerColor: ColorKey;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

interface ProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: ProviderProps) {
  const [settings, setSettings] = useState<GameSettings>(() => getSettingsSync());

  useEffect(() => {
    if (isSettingsHydrated()) return;
    let cancelled = false;
    hydrateSettings().then(() => {
      if (!cancelled) setSettings(getSettingsSync());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((next: GameSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const colorMaps = useMemo(
    () => buildOwnerColorMaps(settings.playerColor),
    [settings.playerColor],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, updateSettings, colorMaps, playerColor: settings.playerColor }),
    [settings, updateSettings, colorMaps],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used inside SettingsProvider");
  }
  return ctx;
}

export function useOwnerColors(): OwnerColorMaps {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    return buildOwnerColorMaps("blue");
  }
  return ctx.colorMaps;
}
