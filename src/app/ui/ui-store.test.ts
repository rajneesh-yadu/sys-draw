import { describe, expect, it } from 'vitest';
import {
  createUiStore,
  DEFAULT_UI_PREFS,
  parseUiPrefs,
  UI_PREFS_KEY,
  type PrefsStorage,
} from './ui-store';
import { applyTheme, resolveTheme } from './theme';

function memoryStorage(initial: Record<string, string> = {}): PrefsStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('ui prefs (S21)', () => {
  it('falls back to defaults for missing, broken, newer or invalid data', () => {
    expect(parseUiPrefs(null)).toEqual(DEFAULT_UI_PREFS);
    expect(parseUiPrefs('{not json')).toEqual(DEFAULT_UI_PREFS);
    expect(parseUiPrefs(JSON.stringify({ ...DEFAULT_UI_PREFS, schemaVersion: 2 }))).toEqual(
      DEFAULT_UI_PREFS,
    );
    expect(parseUiPrefs(JSON.stringify({ ...DEFAULT_UI_PREFS, theme: 'sepia' }))).toEqual(
      DEFAULT_UI_PREFS,
    );
    expect(parseUiPrefs(JSON.stringify({ ...DEFAULT_UI_PREFS, metricsHeightPx: 5 }))).toEqual(
      DEFAULT_UI_PREFS,
    );
  });

  it('loads saved prefs and writes every change back', () => {
    const storage = memoryStorage({
      [UI_PREFS_KEY]: JSON.stringify({
        ...DEFAULT_UI_PREFS,
        theme: 'dark',
        paletteCollapsed: true,
      }),
    });
    const ui = createUiStore({ storage });
    expect(ui.getState().prefs.theme).toBe('dark');
    expect(ui.getState().prefs.paletteCollapsed).toBe(true);

    ui.getState().setMetricsHeight(400.4);
    ui.getState().setMetricsMaximized(true);
    const saved = JSON.parse(storage.data[UI_PREFS_KEY] ?? '{}') as Record<string, unknown>;
    expect(saved).toMatchObject({ metricsHeightPx: 400, metricsMaximized: true, theme: 'dark' });
    // A fresh store (reload) sees the same prefs.
    expect(createUiStore({ storage }).getState().prefs).toEqual(ui.getState().prefs);
  });

  it('clamps the metrics height', () => {
    const ui = createUiStore({ storage: null });
    ui.getState().setMetricsHeight(10);
    expect(ui.getState().prefs.metricsHeightPx).toBe(120);
    ui.getState().setMetricsHeight(99_999);
    expect(ui.getState().prefs.metricsHeightPx).toBe(2000);
    ui.getState().setMetricsHeight(Number.NaN);
    expect(ui.getState().prefs.metricsHeightPx).toBe(240);
  });

  it('cycles the theme light → dark → system → light', () => {
    const ui = createUiStore({ storage: null, initial: { theme: 'light' } });
    const seen = [ui.getState().prefs.theme];
    for (let i = 0; i < 3; i++) {
      ui.getState().cycleTheme();
      seen.push(ui.getState().prefs.theme);
    }
    expect(seen).toEqual(['light', 'dark', 'system', 'light']);
  });

  it('toggles both left panels: collapse if either is open, else expand', () => {
    const ui = createUiStore({ storage: null });
    ui.getState().toggleLeftPanels();
    expect(ui.getState().prefs).toMatchObject({ projectsCollapsed: true, paletteCollapsed: true });
    ui.getState().toggleLeftPanels();
    expect(ui.getState().prefs).toMatchObject({
      projectsCollapsed: false,
      paletteCollapsed: false,
    });
    ui.getState().setPaletteCollapsed(true);
    ui.getState().toggleLeftPanels();
    expect(ui.getState().prefs).toMatchObject({ projectsCollapsed: true, paletteCollapsed: true });
  });

  it('the command palette and the shortcut sheet are never open together', () => {
    const ui = createUiStore({ storage: null });
    ui.getState().setShortcutsOpen(true);
    ui.getState().setCommandPaletteOpen(true);
    expect(ui.getState()).toMatchObject({ commandPaletteOpen: true, shortcutsOpen: false });
    ui.getState().setShortcutsOpen(true);
    expect(ui.getState()).toMatchObject({ commandPaletteOpen: false, shortcutsOpen: true });
  });

  it('survives a storage that throws', () => {
    const storage: PrefsStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const ui = createUiStore({ storage });
    expect(ui.getState().prefs).toEqual(DEFAULT_UI_PREFS);
    expect(() => ui.getState().setTheme('dark')).not.toThrow();
  });
});

describe('theme (S21)', () => {
  it('resolves "system" from the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('applies the theme as a class + color-scheme on the root', () => {
    const el = document.createElement('div');
    applyTheme(el, 'dark');
    expect(el.classList.contains('dark')).toBe(true);
    expect(el.style.colorScheme).toBe('dark');
    applyTheme(el, 'light');
    expect(el.classList.contains('dark')).toBe(false);
    expect(el.dataset.theme).toBe('light');
  });
});
