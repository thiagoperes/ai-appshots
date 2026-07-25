import type { CanvasTheme } from './types';

export const MONO_STACK =
  'ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", ' +
  '"Roboto Mono", Menlo, Consolas, monospace';

export const SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", ' +
  '"Helvetica Neue", "Segoe UI", Arial, sans-serif';

/**
 * A neutral canvas that reads as deliberate rather than default. Override any
 * subset of it from `theme` in the config; the rest falls back to these values.
 */
export const DEFAULT_THEME: CanvasTheme = {
  dark: {
    base: '#000000',
    sweep: 'linear-gradient(176deg, #14162e 0%, #08091a 44%, #000000 100%)',
    halo: '#3b5bdb',
    grid: 'rgba(255, 255, 255, 0.07)',
    title: '#ffffff',
    kicker: '#a5b4fc',
    rule: 'rgba(255, 255, 255, 0.22)',
  },
  light: {
    base: '#eef1f7',
    sweep: 'linear-gradient(176deg, #ffffff 0%, #eef1f7 58%, #dbe3f2 100%)',
    halo: '#3b5bdb',
    grid: 'rgba(15, 23, 42, 0.07)',
    title: '#0b1020',
    kicker: '#3b5bdb',
    rule: 'rgba(15, 23, 42, 0.22)',
  },
  monoFont: MONO_STACK,
  sansFont: SANS_STACK,
  showIndex: true,
};

export function resolveTheme(overrides?: Partial<CanvasTheme>): CanvasTheme {
  return {
    ...DEFAULT_THEME,
    ...overrides,
    dark: { ...DEFAULT_THEME.dark, ...overrides?.dark },
    light: { ...DEFAULT_THEME.light, ...overrides?.light },
  };
}
