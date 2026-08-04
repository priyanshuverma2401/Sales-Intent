import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'salesmotion.theme';

/**
 * Reads the theme the same way the inline script in index.html does, so the
 * class already on <html> at first paint and the value React starts with can
 * never disagree.
 */
export function resolveInitialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (_) {
    // Private browsing can throw on localStorage access; fall through
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch (_) {
    // Not being able to remember the choice is not worth breaking the toggle
  }
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: resolveInitialTheme(),
  setTheme: (theme) => {
    apply(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));
