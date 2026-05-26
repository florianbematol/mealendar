import { MD3LightTheme, type MD3Theme } from 'react-native-paper';

/**
 * Palette Mealendar (light only).
 * Inspiration : couleurs "appetit / cuisine" en versions douces.
 *  - primary   : vert sauge profond (legumes frais, simplicite)
 *  - secondary : terracotta doux (chaleur, gourmand)
 *  - tertiary  : ambre miel (mise en avant, badges)
 *  - surface   : creme tres legere (lecture confort, moins agressif que blanc pur)
 */
export const brand = {
  primary: '#3F7D58', // vert sauge
  primaryContainer: '#D6E9DC',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#0F3320',

  secondary: '#C75B3B', // terracotta
  secondaryContainer: '#FBE2D6',
  onSecondary: '#FFFFFF',
  onSecondaryContainer: '#3F1709',

  tertiary: '#B97C2E', // ambre miel
  tertiaryContainer: '#F8E5C2',
  onTertiary: '#FFFFFF',
  onTertiaryContainer: '#3A2406',

  background: '#FBF8F3', // creme
  onBackground: '#1B1B17',

  surface: '#FFFFFF',
  surfaceVariant: '#F1EDE5',
  onSurface: '#1B1B17',
  onSurfaceVariant: '#4F4D47',
  surfaceDisabled: '#EDEAE3',
  onSurfaceDisabled: '#9A9890',

  outline: '#D7D2C7',
  outlineVariant: '#E6E1D6',

  error: '#B3261E',
  errorContainer: '#F9DEDC',
  onError: '#FFFFFF',
  onErrorContainer: '#410E0B',

  shadow: '#000000',
  scrim: '#000000',
  inverseSurface: '#2F2E2A',
  inverseOnSurface: '#F2EFE8',
  inversePrimary: '#9CCFA9',

  elevation: {
    level0: 'transparent',
    level1: '#FAF6EE',
    level2: '#F6F2E9',
    level3: '#F1ECE1',
    level4: '#EFEADE',
    level5: '#EBE5D7',
  },

  backdrop: 'rgba(20, 18, 14, 0.4)',
};

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: 4,
  colors: {
    ...MD3LightTheme.colors,
    ...brand,
  },
};

// Conserve l'export `darkTheme` pour ne rien casser ailleurs : on alias light.
// L'app force le mode light pour le moment.
export const darkTheme = lightTheme;
