/**
 * S21: per-browser UI preferences (theme, collapsed side panels, metrics drawer size) plus the
 * transient open state of the command palette and the shortcut sheet.
 * S24: collapsed Inspector, minimap visibility and request-trace width. These fields are optional
 * in stored JSON (`.default`), so prefs saved before S24 still load with every choice kept; the
 * version stays 1 because the change is additive.
 *
 * Preferences live in localStorage under `sysdraw.ui` as versioned JSON (`schemaVersion` 1,
 * Zod-validated). They are a view setting, not part of the workspace file, so they are never
 * exported. Unreadable or newer data falls back to the defaults.
 */
import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  clampDrawerHeight,
  DRAWER_DEFAULT_HEIGHT,
  DRAWER_MAX_HEIGHT,
  DRAWER_MIN_HEIGHT,
} from '@/metrics-ui';
import { clampTraceWidth, TRACE_DEFAULT_WIDTH, TRACE_MAX_WIDTH, TRACE_MIN_WIDTH } from '@/canvas';

export const UI_PREFS_KEY = 'sysdraw.ui';
export const UI_PREFS_VERSION = 1;

export const THEME_PREFS = ['system', 'light', 'dark'] as const;
export type ThemePref = (typeof THEME_PREFS)[number];

/** Metrics drawer body height bounds (px) come from metrics-ui; the CSS also caps it to the window. */
const METRICS_MIN_HEIGHT = DRAWER_MIN_HEIGHT;
const METRICS_MAX_HEIGHT = DRAWER_MAX_HEIGHT;

export const UiPrefsSchema = z.object({
  schemaVersion: z.literal(UI_PREFS_VERSION),
  theme: z.enum(THEME_PREFS),
  projectsCollapsed: z.boolean(),
  paletteCollapsed: z.boolean(),
  metricsHeightPx: z.number().int().min(METRICS_MIN_HEIGHT).max(METRICS_MAX_HEIGHT),
  metricsMaximized: z.boolean(),
  inspectorCollapsed: z.boolean().default(false),
  minimapVisible: z.boolean().default(true),
  traceWidthPx: z
    .number()
    .int()
    .min(TRACE_MIN_WIDTH)
    .max(TRACE_MAX_WIDTH)
    .default(TRACE_DEFAULT_WIDTH),
  traceExpanded: z.boolean().default(false),
});
export type UiPrefs = z.infer<typeof UiPrefsSchema>;

export const DEFAULT_UI_PREFS: UiPrefs = {
  schemaVersion: UI_PREFS_VERSION,
  theme: 'system',
  projectsCollapsed: false,
  paletteCollapsed: false,
  metricsHeightPx: DRAWER_DEFAULT_HEIGHT,
  metricsMaximized: false,
  inspectorCollapsed: false,
  minimapVisible: true,
  traceWidthPx: TRACE_DEFAULT_WIDTH,
  traceExpanded: false,
};

/** The subset of `Storage` we use (so tests can pass a fake, and SSR/no-storage still works). */
export type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Parse stored prefs; anything unreadable gives the defaults (unknown fields are dropped). */
export function parseUiPrefs(raw: string | null): UiPrefs {
  if (raw === null) return DEFAULT_UI_PREFS;
  try {
    const parsed = UiPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_UI_PREFS;
  } catch {
    return DEFAULT_UI_PREFS;
  }
}

export function loadUiPrefs(storage: PrefsStorage | undefined): UiPrefs {
  try {
    return parseUiPrefs(storage?.getItem(UI_PREFS_KEY) ?? null);
  } catch {
    return DEFAULT_UI_PREFS;
  }
}

export function saveUiPrefs(storage: PrefsStorage | undefined, prefs: UiPrefs): void {
  try {
    storage?.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked (private mode): preferences just don't persist.
  }
}

export interface UiState {
  prefs: UiPrefs;
  commandPaletteOpen: boolean;
  shortcutsOpen: boolean;
  setTheme(theme: ThemePref): void;
  /** light → dark → system → light. */
  cycleTheme(): void;
  setProjectsCollapsed(collapsed: boolean): void;
  setPaletteCollapsed(collapsed: boolean): void;
  /** Collapse both left panels if either is open, else expand both. */
  toggleLeftPanels(): void;
  setMetricsHeight(px: number): void;
  setMetricsMaximized(maximized: boolean): void;
  setInspectorCollapsed(collapsed: boolean): void;
  setMinimapVisible(visible: boolean): void;
  setTraceWidth(px: number): void;
  setTraceExpanded(expanded: boolean): void;
  setCommandPaletteOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
}

export type UiStore = StoreApi<UiState>;

const NEXT_THEME: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };

function defaultStorage(): PrefsStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function createUiStore(
  opts: { storage?: PrefsStorage | null; initial?: Partial<UiPrefs> } = {},
): UiStore {
  const storage = opts.storage === null ? undefined : (opts.storage ?? defaultStorage());
  const prefs: UiPrefs = { ...loadUiPrefs(storage), ...opts.initial };
  const store = createStore<UiState>()((set, get) => {
    const patch = (p: Partial<UiPrefs>) => set({ prefs: { ...get().prefs, ...p } });
    return {
      prefs,
      commandPaletteOpen: false,
      shortcutsOpen: false,
      setTheme: (theme) => patch({ theme }),
      cycleTheme: () => patch({ theme: NEXT_THEME[get().prefs.theme] }),
      setProjectsCollapsed: (projectsCollapsed) => patch({ projectsCollapsed }),
      setPaletteCollapsed: (paletteCollapsed) => patch({ paletteCollapsed }),
      toggleLeftPanels: () => {
        const { projectsCollapsed, paletteCollapsed } = get().prefs;
        const collapse = !projectsCollapsed || !paletteCollapsed;
        patch({ projectsCollapsed: collapse, paletteCollapsed: collapse });
      },
      setMetricsHeight: (px) => patch({ metricsHeightPx: clampDrawerHeight(px) }),
      setMetricsMaximized: (metricsMaximized) => patch({ metricsMaximized }),
      setInspectorCollapsed: (inspectorCollapsed) => patch({ inspectorCollapsed }),
      setMinimapVisible: (minimapVisible) => patch({ minimapVisible }),
      setTraceWidth: (px) => patch({ traceWidthPx: clampTraceWidth(px) }),
      setTraceExpanded: (traceExpanded) => patch({ traceExpanded }),
      setCommandPaletteOpen: (commandPaletteOpen) =>
        set(
          commandPaletteOpen
            ? { commandPaletteOpen, shortcutsOpen: false }
            : { commandPaletteOpen },
        ),
      setShortcutsOpen: (shortcutsOpen) =>
        set(shortcutsOpen ? { shortcutsOpen, commandPaletteOpen: false } : { shortcutsOpen }),
    };
  });
  store.subscribe((s, prev) => {
    if (s.prefs !== prev.prefs) saveUiPrefs(storage, s.prefs);
  });
  return store;
}
