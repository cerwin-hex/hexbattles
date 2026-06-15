import type { ColorKey } from "@/utils/settings";

const colors = {
  light: {
    text: '#D4BF96',
    tint: '#C8A24A',
    background: '#0D0A06',
    foreground: '#D4BF96',
    card: '#1A1208',
    cardForeground: '#D4BF96',
    primary: '#C8A24A',
    primaryForeground: '#0D0A06',
    secondary: '#2A1E0C',
    secondaryForeground: '#A08C68',
    muted: '#1E1610',
    mutedForeground: '#786A54',
    accent: '#4A3C1E',
    accentForeground: '#D4BF96',
    destructive: '#8B1A1A',
    destructiveForeground: '#F0D070',
    border: '#4A3C1E',
    input: '#4A3C1E',
  },
  dark: {
    text: '#D4BF96',
    tint: '#C8A24A',
    background: '#0D0A06',
    foreground: '#D4BF96',
    card: '#1A1208',
    cardForeground: '#D4BF96',
    primary: '#C8A24A',
    primaryForeground: '#0D0A06',
    secondary: '#2A1E0C',
    secondaryForeground: '#A08C68',
    muted: '#1E1610',
    mutedForeground: '#786A54',
    accent: '#4A3C1E',
    accentForeground: '#D4BF96',
    destructive: '#8B1A1A',
    destructiveForeground: '#F0D070',
    border: '#4A3C1E',
    input: '#4A3C1E',
  },
  radius: 8,
};

export default colors;

export const TERRAIN_FILLS: Record<string, string> = {
  grass: '#66985C',
  desert: '#C7A760',
  mountain: '#4A4642',
  lake: '#5BAFD6',
  forest: '#2D6A2D',
  field: '#B8A038',
  sawmill: '#7A5230',
};

export const CITY_NEUTRAL_FILL = '#C0B8B0';
export const CITY_BORDER_COLOR = '#8B7A5A';
export const CITY_BUFFER_BORDER = '#B8B8B8';

interface ColorEntry {
  fill: string;
  border: string;
  label: string;
}

export const COLOR_PALETTE: Record<ColorKey, ColorEntry> = {
  blue: { fill: '#2E6EE8', border: '#6AAAF4', label: 'Blue' },
  red: { fill: '#E03838', border: '#F06060', label: 'Red' },
  green: { fill: '#38B838', border: '#60CC60', label: 'Green' },
  orange: { fill: '#E08828', border: '#F0AA44', label: 'Orange' },
  purple: { fill: '#C838C8', border: '#E060E0', label: 'Purple' },
  teal: { fill: '#38C8C8', border: '#60E0E0', label: 'Teal' },
};

const AI_OWNER_ORDER = ['ai1', 'ai2', 'ai3', 'ai4', 'ai5'] as const;
const COLOR_ORDER: ColorKey[] = ['blue', 'red', 'green', 'orange', 'purple', 'teal'];

export interface OwnerColorMaps {
  fills: Record<string, string>;
  borders: Record<string, string>;
  labels: Record<string, string>;
}

export function buildOwnerColorMaps(playerColor: ColorKey): OwnerColorMaps {
  const remaining = COLOR_ORDER.filter((c) => c !== playerColor);
  const fills: Record<string, string> = { neutral: '#2A2820' };
  const borders: Record<string, string> = {};
  const labels: Record<string, string> = { player: 'You' };

  const playerEntry = COLOR_PALETTE[playerColor];
  fills.player = playerEntry.fill;
  borders.player = playerEntry.border;

  AI_OWNER_ORDER.forEach((aiKey, i) => {
    const colorKey = remaining[i];
    if (!colorKey) return;
    const entry = COLOR_PALETTE[colorKey];
    fills[aiKey] = entry.fill;
    borders[aiKey] = entry.border;
    labels[aiKey] = entry.label;
  });

  return { fills, borders, labels };
}

// Backwards-compatible defaults (player = blue) — kept for any consumer that
// hasn't been migrated to the context-driven maps yet.
const DEFAULT_MAPS = buildOwnerColorMaps('blue');
export const TERRITORY_FILLS: Record<string, string> = DEFAULT_MAPS.fills;
export const TERRITORY_BORDERS: Record<string, string> = DEFAULT_MAPS.borders;
export const PLAYER_LABELS: Record<string, string> = DEFAULT_MAPS.labels;
