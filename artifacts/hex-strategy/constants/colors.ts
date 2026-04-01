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
  mountain: '#96928C',
  city: '#795B9A',
};

export const TERRITORY_FILLS: Record<string, string> = {
  neutral: '#131008',
  player: '#162460',
  ai1: '#5C1010',
  ai2: '#1A4A14',
  ai3: '#5C3A0A',
};

export const TERRITORY_BORDERS: Record<string, string> = {
  player: '#4488CC',
  ai1: '#CC3333',
  ai2: '#44AA44',
  ai3: '#CC8833',
};

export const PLAYER_LABELS: Record<string, string> = {
  player: 'You',
  ai1: 'Red',
  ai2: 'Green',
  ai3: 'Orange',
};

export const CITY_BORDER_COLOR = '#8B7A5A';
export const CITY_BUFFER_BORDER = '#B8B8B8';
