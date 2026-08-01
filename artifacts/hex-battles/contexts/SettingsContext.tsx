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
  normalizeSettings,
  saveSettings,
  type ColorKey,
  type GameSettings,
} from "@/utils/settings";

interface SettingsContextValue {
  settings: GameSettings;
  /**
   * Merge a patch into the current settings and persist the result. Takes a
   * patch rather than a whole object so a control that fires before hydration
   * lands cannot write the pre-hydration defaults back over stored settings.
   */
  updateSettings: (patch: Partial<GameSettings>) => void;
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

  const updateSettings = useCallback((patch: Partial<GameSettings>) => {
    // Merge onto the module cache rather than React state: it is the value
    // hydration writes, so a rapid-fire control cannot lose an earlier patch
    // to a stale closure.
    const next = normalizeSettings({ ...getSettingsSync(), ...patch });
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
