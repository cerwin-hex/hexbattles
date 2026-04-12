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
};

export const TERRITORY_FILLS: Record<string, string> = {
  neutral: '#2A2820',
  player: '#2E6EE8',
  ai1: '#E03838',
  ai2: '#38B838',
  ai3: '#E08828',
  ai4: '#C838C8',
  ai5: '#38C8C8',
};

export const CITY_NEUTRAL_FILL = '#C0B8B0';

export const TERRITORY_BORDERS: Record<string, string> = {
  player: '#6AAAF4',
  ai1: '#F06060',
  ai2: '#60CC60',
  ai3: '#F0AA44',
  ai4: '#E060E0',
  ai5: '#60E0E0',
};

export const PLAYER_LABELS: Record<string, string> = {
  player: 'You',
  ai1: 'Red',
  ai2: 'Green',
  ai3: 'Orange',
  ai4: 'Purple',
  ai5: 'Teal',
};

export const CITY_BORDER_COLOR = '#8B7A5A';
export const CITY_BUFFER_BORDER = '#B8B8B8';
