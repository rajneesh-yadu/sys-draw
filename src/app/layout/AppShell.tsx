import {
  FolderTree,
  Keyboard,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Shapes,
  Sun,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import {
  BoardCanvas,
  CanvasProvider,
  createReviewStore,
  createSecurityStore,
  createTraceStore,
  Palette,
  FindingsPanel,
  SecurityPanel,
  TracePanel,
} from '@/canvas';
import { Inspector } from '@/inspector';
import { MetricsDrawer } from '@/metrics-ui';
import { registry } from '@/registry';
import {
  createModeStore,
  createProgressStore,
  ModePanel,
  ModesProvider,
  ModeSwitcher,
  ProgressButton,
  useModeRunner,
} from '@/modes';
import type { Autosave } from '@/persistence';
import { ProblemBriefButton, ProblemsButton } from '@/problems';
import {
  projectOfBoard,
  useBoardStoreApi,
  useSimulationStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
  type SimulationStore,
} from '@/store';
import { useSimulationRunner } from '../simulation/useSimulationRunner';
import { useTraceRunner } from '../trace/useTraceRunner';
import { useReviewRunner } from '../review/useReviewRunner';
import { useSecurityRunner } from '../security/useSecurityRunner';
import { EstimatorTopBarButton } from '../estimator/EstimatorTopBarButton';
import {
  BoardTabs,
  NoticeProvider,
  ProjectSidebar,
  ProviderSwitcher,
  SaveStatus,
} from '../workspace';
import { useNotice } from '../workspace/notice-context';
import { buildCommands } from '../commands/commands';
import { CommandPalette } from '../commands/CommandPalette';
import { ShortcutSheet } from '../commands/ShortcutSheet';
import { APP_SHORTCUT_KEYS, appShortcutFor, isTextField } from '../commands/shortcuts';
import { UiStoreContext, useUiStore, useUiStoreApi } from '../ui/context';
import { THEME_LABEL, useThemeEffect } from '../ui/theme';
import { createUiStore, type UiStore } from '../ui/ui-store';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * The app shell: project sidebar, palette, board tabs over the canvas, inspector, metrics drawer.
 * Palette and canvas: S04. Inspector: S05. Projects, tabs, snapshots and saving: S06.
 * Metrics drawer, canvas overlays and auto-simulation: S08.
 * `autosave` comes from persistence (main.tsx); without it nothing is saved (tests).
 * `simulate` (default true) keeps the open board simulated (300 ms after each change, or on Run).
 * S17: "Problems" (browser + start) and, on a problem board, "Brief" in the top bar.
 * S18: mode switcher + "Progress" in the top bar; the mode's panel beside the canvas; the mode
 * runner drives the controllers (progress is kept in localStorage by the modes module).
 * S20: "Estimate" in the top bar (back-of-envelope calculator; pushes into the scenario).
 * S21: theme (top bar), collapsible Projects / Palette (left rail, Ctrl/⌘+B), resizable and
 * maximisable metrics drawer, command palette (Ctrl/⌘+K), shortcut sheet (?), and an error
 * boundary around every region. `uiStore` (optional) is for tests; preferences persist per browser.
 * S24: collapsible Inspector (right rail), hideable minimap, resizable request trace — all three
 * persisted with the other view preferences.
 */
export function AppShell({
  autosave,
  simulate = true,
  uiStore,
}: { autosave?: Autosave; simulate?: boolean; uiStore?: UiStore } = {}) {
  const [ui] = useState(() => uiStore ?? createUiStore());
  useThemeEffect(ui);
  useSimulationRunner(simulate);
  // S15: request trace — the canvas shows it, this runner fills it from the engine.
  const [traceStore] = useState(createTraceStore);
  useTraceRunner(traceStore);
  // S16: security overlay + threat review — the canvas shows it, this runner fills it.
  const [securityStore] = useState(createSecurityStore);
  useSecurityRunner(securityStore);
  // S19: design review (registry rules + simulation findings) — the canvas shows it.
  const [reviewStore] = useState(createReviewStore);
  useReviewRunner(reviewStore);
  // S18: modes — the session of the open board and local progress.
  const [modeStore] = useState(createModeStore);
  const [progressStore] = useState(() => createProgressStore());
  useModeRunner(modeStore, progressStore);

  useAppShortcuts(ui, autosave);
  const activeBoardId = useWorkspaceStore((s) => s.activeBoardId);
  const prefs = useStore(ui, (s) => s.prefs);
  const metricsSize = useMemo(
    () => ({ heightPx: prefs.metricsHeightPx, maximized: prefs.metricsMaximized }),
    [prefs.metricsHeightPx, prefs.metricsMaximized],
  );
  const traceSize = useMemo(
    () => ({ widthPx: prefs.traceWidthPx, expanded: prefs.traceExpanded }),
    [prefs.traceWidthPx, prefs.traceExpanded],
  );
  const { hideRef: inspectorHideRef, showRef: inspectorShowRef } = useCollapseFocus(
    prefs.inspectorCollapsed,
  );

  return (
    <UiStoreContext.Provider value={ui}>
      <NoticeProvider>
        <ModesProvider modeStore={modeStore} progressStore={progressStore}>
          <CanvasProvider
            traceStore={traceStore}
            securityStore={securityStore}
            reviewStore={reviewStore}
          >
            <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
              <ErrorBoundary name="Top bar" compact>
                <TopBar autosave={autosave} />
              </ErrorBoundary>

              <div className="flex min-h-0 flex-1">
                {(prefs.projectsCollapsed || prefs.paletteCollapsed) && <LeftRail />}
                <aside
                  id="region-projects"
                  aria-label="Projects"
                  data-testid="region-projects"
                  data-collapsed={prefs.projectsCollapsed ? 'true' : undefined}
                  hidden={prefs.projectsCollapsed}
                  className="w-52 shrink-0 border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
                >
                  <ErrorBoundary name="Projects" compact>
                    <ProjectSidebar onCollapse={() => ui.getState().setProjectsCollapsed(true)} />
                  </ErrorBoundary>
                </aside>

                <aside
                  id="region-palette"
                  aria-label="Component palette"
                  data-testid="region-palette"
                  data-collapsed={prefs.paletteCollapsed ? 'true' : undefined}
                  hidden={prefs.paletteCollapsed}
                  className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                >
                  <PanelHeader title="Palette">
                    <button
                      type="button"
                      className={headerBtn}
                      onClick={() => ui.getState().setPaletteCollapsed(true)}
                      aria-label="Hide Palette"
                      title={`Hide Palette (${APP_SHORTCUT_KEYS.toggleLeftPanels} hides both side panels)`}
                    >
                      <PanelLeftClose size={14} aria-hidden />
                    </button>
                  </PanelHeader>
                  <ErrorBoundary name="Palette" compact>
                    <Palette />
                  </ErrorBoundary>
                </aside>

                <div className="flex min-w-0 flex-1 flex-col">
                  <nav aria-label="Boards">
                    <ErrorBoundary name="Board tabs" compact>
                      <BoardTabs />
                    </ErrorBoundary>
                  </nav>
                  <div className="flex min-h-0 flex-1">
                    <main
                      id="board-canvas-region"
                      aria-label="Design canvas"
                      data-testid="region-canvas"
                      className="relative min-h-0 min-w-0 flex-1"
                    >
                      <ErrorBoundary name="Canvas" resetKey={activeBoardId}>
                        <BoardCanvas
                          minimap={prefs.minimapVisible}
                          onMinimapChange={(visible) => ui.getState().setMinimapVisible(visible)}
                        />
                      </ErrorBoundary>
                    </main>
                    <ErrorBoundary name="Side panel" resetKey={activeBoardId} compact>
                      <TracePanel
                        size={traceSize}
                        onSizeChange={(next) => {
                          const st = ui.getState();
                          st.setTraceWidth(next.widthPx);
                          st.setTraceExpanded(next.expanded);
                        }}
                      />
                      <SecurityPanel />
                      <FindingsPanel />
                      <ModePanelWithNotices />
                    </ErrorBoundary>
                  </div>

                  <section
                    aria-label="Metrics"
                    data-testid="region-metrics"
                    className="shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  >
                    <ErrorBoundary name="Metrics" resetKey={activeBoardId}>
                      <MetricsDrawer
                        size={metricsSize}
                        onSizeChange={(next) => {
                          const st = ui.getState();
                          st.setMetricsHeight(next.heightPx);
                          st.setMetricsMaximized(next.maximized);
                        }}
                      />
                    </ErrorBoundary>
                  </section>
                </div>

                <aside
                  id="region-inspector"
                  aria-label="Inspector"
                  data-testid="region-inspector"
                  data-collapsed={prefs.inspectorCollapsed ? 'true' : undefined}
                  hidden={prefs.inspectorCollapsed}
                  className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                >
                  <PanelHeader title="Inspector">
                    <button
                      ref={inspectorHideRef}
                      type="button"
                      className={headerBtn}
                      onClick={() => ui.getState().setInspectorCollapsed(true)}
                      aria-label="Hide Inspector"
                      aria-expanded
                      aria-controls="region-inspector"
                      title="Hide Inspector (gives the canvas more room; bring it back from the right edge)"
                      data-testid="inspector-hide"
                    >
                      <PanelRightClose size={14} aria-hidden />
                    </button>
                  </PanelHeader>
                  <ErrorBoundary name="Inspector" resetKey={activeBoardId}>
                    <Inspector />
                  </ErrorBoundary>
                </aside>
                {prefs.inspectorCollapsed && <RightRail showRef={inspectorShowRef} />}
              </div>
            </div>
            <Overlays
              autosave={autosave}
              trace={traceStore}
              security={securityStore}
              review={reviewStore}
            />
          </CanvasProvider>
        </ModesProvider>
      </NoticeProvider>
    </UiStoreContext.Provider>
  );
}

/** App-level keys (Ctrl/⌘+K, ?, Ctrl/⌘+B, Ctrl/⌘+S); the canvas handles its own. */
function useAppShortcuts(ui: UiStore, autosave: Autosave | undefined) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = appShortcutFor(e, isTextField(e.target));
      if (!hit) return;
      const st = ui.getState();
      // While a dialog is open only its own keys apply (Ctrl/⌘+K still toggles the palette).
      if ((st.commandPaletteOpen || st.shortcutsOpen) && hit !== 'commandPalette') return;
      switch (hit) {
        case 'commandPalette':
          e.preventDefault();
          st.setCommandPaletteOpen(!st.commandPaletteOpen);
          break;
        case 'shortcuts':
          e.preventDefault();
          st.setShortcutsOpen(true);
          break;
        case 'toggleLeftPanels':
          e.preventDefault();
          st.toggleLeftPanels();
          break;
        case 'save':
          if (!autosave) return;
          e.preventDefault();
          void autosave.flush();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui, autosave]);
}

/** The command palette and the shortcut sheet (modal; rendered above the shell). */
function Overlays(props: {
  autosave: Autosave | undefined;
  trace: ReturnType<typeof createTraceStore>;
  security: ReturnType<typeof createSecurityStore>;
  review: ReturnType<typeof createReviewStore>;
}) {
  const ui = useUiStoreApi();
  const paletteOpen = useUiStore((s) => s.commandPaletteOpen);
  const shortcutsOpen = useUiStore((s) => s.shortcutsOpen);
  return (
    <>
      {paletteOpen && <CommandPaletteHost {...props} />}
      {shortcutsOpen && <ShortcutSheet onClose={() => ui.getState().setShortcutsOpen(false)} />}
    </>
  );
}

function CommandPaletteHost(props: {
  autosave: Autosave | undefined;
  trace: ReturnType<typeof createTraceStore>;
  security: ReturnType<typeof createSecurityStore>;
  review: ReturnType<typeof createReviewStore>;
}) {
  const ui = useUiStoreApi();
  const board = useBoardStoreApi();
  const workspace = useWorkspaceStoreApi();
  const simulation: SimulationStore = useSimulationStoreApi();
  const { show } = useNotice();
  // Built once per opening: titles reflect the state at that moment (e.g. "Collapse …").
  const [commands] = useState(() =>
    buildCommands({
      board,
      workspace,
      simulation,
      ui,
      registry,
      trace: props.trace,
      security: props.security,
      review: props.review,
      ...(props.autosave ? { autosave: props.autosave } : {}),
      notify: (text, kind = 'info') => show({ kind, text }),
    }),
  );
  return (
    <CommandPalette
      commands={commands}
      onClose={() => ui.getState().setCommandPaletteOpen(false)}
    />
  );
}

const railBtn =
  'flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-800';

const headerBtn =
  'rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100';

/**
 * S21: the rail the side panels collapse into (shown only while one is collapsed, so collapsing
 * gives the canvas room instead of costing it): one button per collapsed panel to bring it back,
 * plus "expand both".
 */
function LeftRail() {
  const ui = useUiStoreApi();
  const projectsCollapsed = useUiStore((s) => s.prefs.projectsCollapsed);
  const paletteCollapsed = useUiStore((s) => s.prefs.paletteCollapsed);
  return (
    <nav
      aria-label="Collapsed panels"
      data-testid="left-rail"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-slate-100 py-2 dark:border-slate-800 dark:bg-slate-950"
    >
      {projectsCollapsed && (
        <RailButton
          label="Show Projects"
          controls="region-projects"
          onClick={() => ui.getState().setProjectsCollapsed(false)}
        >
          <FolderTree size={16} aria-hidden />
        </RailButton>
      )}
      {paletteCollapsed && (
        <RailButton
          label="Show Palette"
          controls="region-palette"
          onClick={() => ui.getState().setPaletteCollapsed(false)}
        >
          <Shapes size={16} aria-hidden />
        </RailButton>
      )}
      {projectsCollapsed && paletteCollapsed && (
        <button
          type="button"
          className={railBtn}
          onClick={() => ui.getState().toggleLeftPanels()}
          aria-label="Show both side panels"
          title={`Show both side panels (${APP_SHORTCUT_KEYS.toggleLeftPanels})`}
        >
          <PanelLeftOpen size={16} aria-hidden />
        </button>
      )}
    </nav>
  );
}

/**
 * S24: keeps keyboard focus when a panel collapses or expands — the button that was clicked goes
 * away, so focus moves to the one that undoes it (only if focus was actually lost).
 */
function useCollapseFocus(collapsed: boolean) {
  const hideRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Lost = on <body>, detached, or still on something inside a now-hidden region (the button
    // that was just clicked, in browsers that don't blur hidden elements).
    const active = document.activeElement;
    const lost =
      !active || active === document.body || !active.isConnected || !!active.closest('[hidden]');
    if (lost) (collapsed ? showRef : hideRef).current?.focus();
  }, [collapsed]);
  return { hideRef, showRef };
}

/**
 * S24: the rail the Inspector collapses into (right edge, shown only while it is collapsed): one
 * button that brings it back, labelled so it is easy to spot.
 */
function RightRail({ showRef }: { showRef: RefObject<HTMLButtonElement | null> }) {
  const ui = useUiStoreApi();
  return (
    <nav
      aria-label="Collapsed right panel"
      data-testid="right-rail"
      className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-slate-200 bg-slate-100 py-2 dark:border-slate-800 dark:bg-slate-950"
    >
      <button
        ref={showRef}
        type="button"
        className={railBtn}
        onClick={() => ui.getState().setInspectorCollapsed(false)}
        aria-label="Show Inspector"
        aria-expanded={false}
        aria-controls="region-inspector"
        title="Show Inspector"
        data-testid="inspector-show"
      >
        <PanelRightOpen size={16} aria-hidden />
      </button>
      <span
        aria-hidden
        className="mt-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase [writing-mode:vertical-rl] dark:text-slate-400"
      >
        Inspector
      </span>
    </nav>
  );
}

function RailButton(props: {
  label: string;
  controls: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={railBtn}
      onClick={props.onClick}
      aria-label={props.label}
      aria-expanded={false}
      aria-controls={props.controls}
      title={props.label}
    >
      {props.children}
    </button>
  );
}

function isMac(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  );
}

/** S21: top-bar entry points for the command palette and the shortcut sheet. */
function CommandButtons() {
  const ui = useUiStoreApi();
  return (
    <>
      <button
        type="button"
        data-testid="open-command-palette"
        onClick={() => ui.getState().setCommandPaletteOpen(true)}
        title={`Search commands and components (${APP_SHORTCUT_KEYS.commandPalette})`}
        className="flex items-center gap-2 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Search size={14} aria-hidden />
        <span>Search</span>
        <kbd className="rounded border border-slate-300 px-1 font-mono text-[10px] dark:border-slate-600">
          {isMac() ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => ui.getState().setShortcutsOpen(true)}
        aria-label="Keyboard shortcuts"
        title={`Keyboard shortcuts (${APP_SHORTCUT_KEYS.shortcuts})`}
        className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Keyboard size={16} aria-hidden />
      </button>
    </>
  );
}

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

function ThemeToggle() {
  const ui = useUiStoreApi();
  const theme = useUiStore((s) => s.prefs.theme);
  const Icon = THEME_ICON[theme];
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme-pref={theme}
      onClick={() => ui.getState().cycleTheme()}
      aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`}
      title={`Theme: ${THEME_LABEL[theme]} (click for ${THEME_LABEL[next]})`}
      className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}

function TopBar({ autosave }: { autosave?: Autosave | undefined }) {
  const projectName = useWorkspaceStore((s) => projectOfBoard(s.data, s.activeBoardId)?.name);
  const boardName = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.name);
  const { show } = useNotice();
  return (
    <header
      data-testid="region-topbar"
      className="flex h-12 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h1 className="text-base font-semibold tracking-tight">SysDraw</h1>
      <span
        className="truncate text-sm text-slate-600 dark:text-slate-400"
        data-testid="board-title"
      >
        {projectName} / <span className="text-slate-600 dark:text-slate-300">{boardName}</span>
      </span>
      <div className="flex items-center gap-2">
        <ProblemsButton onNotice={show} />
        <ProblemBriefButton onNotice={show} />
        <ProgressButton />
        <EstimatorTopBarButton />
      </div>
      <div className="ml-auto flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
        <ProviderSwitcher />
        {autosave && <SaveStatus autosave={autosave} />}
        <ModeSwitcher />
        <CommandButtons />
        <ThemeToggle />
      </div>
    </header>
  );
}

function ModePanelWithNotices() {
  const { show } = useNotice();
  return <ModePanel onNotice={show} />;
}

function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
      <h2 className="py-0.5 text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400">
        {title}
      </h2>
      {children}
    </div>
  );
}
