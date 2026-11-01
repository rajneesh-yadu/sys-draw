/**
 * S21: dark / light / system theme. The resolved theme is the `dark` class on <html> (Tailwind's
 * `dark:` variant is bound to it in index.css) plus `color-scheme` for native controls. Modules
 * never read the preference: anything that needs to know (React Flow's colour mode) looks at the
 * class, so the class is the only contract.
 */
import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { ThemePref, UiStore } from './ui-store';

export type ResolvedTheme = 'light' | 'dark';

export const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  root.dataset.theme = theme;
}

export const THEME_LABEL: Record<ThemePref, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_QUERY).matches
    : false;
}

/** Keep <html> in sync with the preference and, for "system", with the OS setting. */
export function useThemeEffect(ui: UiStore): ResolvedTheme {
  const pref = useStore(ui, (s) => s.prefs.theme);
  const resolved = resolveTheme(pref, systemPrefersDark());
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => applyTheme(root, resolveTheme(pref, systemPrefersDark()));
    apply();
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DARK_QUERY);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
  return resolved;
}
