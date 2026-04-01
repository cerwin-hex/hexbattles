const colors = {
  light: {
    text: '#E2E8F0',
    tint: '#F59E0B',
    background: '#050A14',
    foreground: '#E2E8F0',
    card: '#0F1A2E',
    cardForeground: '#E2E8F0',
    primary: '#F59E0B',
    primaryForeground: '#050A14',
    secondary: '#1E2D4A',
    secondaryForeground: '#CBD5E1',
    muted: '#1A2535',
    mutedForeground: '#64748B',
    accent: '#1E3A5F',
    accentForeground: '#93C5FD',
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',
    border: '#1E3A5F',
    input: '#1E3A5F',
  },
  dark: {
    text: '#E2E8F0',
    tint: '#F59E0B',
    background: '#050A14',
    foreground: '#E2E8F0',
    card: '#0F1A2E',
    cardForeground: '#E2E8F0',
    primary: '#F59E0B',
    primaryForeground: '#050A14',
    secondary: '#1E2D4A',
    secondaryForeground: '#CBD5E1',
    muted: '#1A2535',
    mutedForeground: '#64748B',
    accent: '#1E3A5F',
    accentForeground: '#93C5FD',
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',
    border: '#1E3A5F',
    input: '#1E3A5F',
  },
  radius: 12,
};

export default colors;

export const TERRAIN_FILLS: Record<string, string> = {
  grass: '#143D1E',
  desert: '#4A3518',
  mountain: '#4A5568',
  city: '#220E46',
};

export const TERRITORY_FILLS: Record<string, string> = {
  neutral: '#111827',
  player: '#1A3A7C',
  ai1: '#7C1A1A',
  ai2: '#1A5C2A',
  ai3: '#7C4A1A',
};

export const TERRITORY_BORDERS: Record<string, string> = {
  player: '#3B82F6',
  ai1: '#EF4444',
  ai2: '#22C55E',
  ai3: '#F97316',
};

export const PLAYER_LABELS: Record<string, string> = {
  player: 'You',
  ai1: 'Red',
  ai2: 'Green',
  ai3: 'Orange',
};
