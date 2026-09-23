// Design tokens carried over from the web version (legacy-web/src/index.css).
export const colors = {
  ivory: '#FBF9F5',
  ivoryWarm: '#F6F3EC',
  stone: '#EFECE6',
  stoneCard: '#F4F1EA',
  charcoal: '#1A1918',
  charcoalMuted: '#2E2D2A',
  warmGray: '#78746D',
  mutedGray: '#8C877E',
  border: '#E8E4DC',
  borderStrong: '#E6E1D7',
  white: '#FFFFFF',
  amber: '#FCD34D',
  gold: '#FFD76A',
  emerald: '#34D399',
  danger: '#B4413C',
  // Mirror (dark glass) theme
  night: '#070707',
  nightSurface: '#121110',
  glass: 'rgba(0,0,0,0.46)',
  glassStrong: 'rgba(0,0,0,0.6)',
  glassBorder: 'rgba(255,255,255,0.15)',
} as const;

export const fonts = {
  serif: 'CormorantGaramond_500Medium',
  serifItalic: 'CormorantGaramond_500Medium_Italic',
  sans: 'PlusJakartaSans_400Regular',
  sansMedium: 'PlusJakartaSans_500Medium',
  sansSemi: 'PlusJakartaSans_600SemiBold',
  sansBold: 'PlusJakartaSans_700Bold',
} as const;

export const radius = { sm: 10, md: 16, lg: 24, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/** Ease-out-expo, the curve the web version used for image transitions. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
