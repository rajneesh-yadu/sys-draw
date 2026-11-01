import { useEffect, useState } from 'react';
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
import { projectOfBoard, useWorkspaceStore } from '@/store';
import { useSimulationRunner } from '../simulation/useSimulationRunner';
import { useTraceRunner } from '../trace/useTraceRunner';
import { useReviewRunner } from '../review/useReviewRunner';
import { useSecurityRunner } from '../security/useSecurityRunner';
import {
  BoardTabs,
  NoticeProvider,
  ProjectSidebar,
  ProviderSwitcher,
  SaveStatus,
} from '../workspace';
import { useNotice } from '../workspace/notice-context';

/**
 * The app shell: project sidebar, palette, board tabs over the canvas, inspector, metrics drawer.
 * Palette and canvas: S04. Inspector: S05. Projects, tabs, snapshots and saving: S06.
 * Metrics drawer, canvas overlays and auto-simulation: S08.
 * `autosave` comes from persistence (main.tsx); without it nothing is saved (tests).
 * `simulate` (default true) keeps the open board simulated (300 ms after each change, or on Run).
 * S17: "Problems" (browser + start) and, on a problem board, "Brief" in the top bar.
 * S18: mode switcher + "Progress" in the top bar; the mode's panel beside the canvas; the mode
 * runner drives the controllers (progress is kept in localStorage by the modes module).
 */
export function AppShell({
  autosave,
  simulate = true,
}: { autosave?: Autosave; simulate?: boolean } = {}) {
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

  // Ctrl/Cmd+S saves now instead of opening the browser's "Save page" dialog.
  useEffect(() => {
    if (!autosave) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void autosave.flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autosave]);

  return (
    <NoticeProvider>
      <ModesProvider modeStore={modeStore} progressStore={progressStore}>
        <CanvasProvider
          traceStore={traceStore}
          securityStore={securityStore}
          reviewStore={reviewStore}
        >
          <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <TopBar autosave={autosave} />

            <div className="flex min-h-0 flex-1">
              <aside
                aria-label="Projects"
                data-testid="region-projects"
                className="w-52 shrink-0 border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
              >
                <ProjectSidebar />
              </aside>

              <aside
                aria-label="Component palette"
                data-testid="region-palette"
                className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <PanelHeader title="Palette" />
                <Palette />
              </aside>

              <div className="flex min-w-0 flex-1 flex-col">
                <BoardTabs />
                <div className="flex min-h-0 flex-1">
                  <main
                    id="board-canvas-region"
                    aria-label="Design canvas"
                    data-testid="region-canvas"
                    className="relative min-h-0 min-w-0 flex-1"
                  >
                    <BoardCanvas />
                  </main>
                  <TracePanel />
                  <SecurityPanel />
                  <FindingsPanel />
                  <ModePanelWithNotices />
                </div>

                <section
                  aria-label="Metrics"
                  data-testid="region-metrics"
                  className="shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                >
                  <MetricsDrawer />
                </section>
              </div>

              <aside
                aria-label="Inspector"
                data-testid="region-inspector"
                className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <PanelHeader title="Inspector" />
                <Inspector />
              </aside>
            </div>
          </div>
        </CanvasProvider>
      </ModesProvider>
    </NoticeProvider>
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
      <span className="truncate text-sm text-slate-400" data-testid="board-title">
        {projectName} / <span className="text-slate-600 dark:text-slate-300">{boardName}</span>
      </span>
      <div className="flex items-center gap-2">
        <ProblemsButton onNotice={show} />
        <ProblemBriefButton onNotice={show} />
        <ProgressButton />
      </div>
      <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
        <ProviderSwitcher />
        {autosave && <SaveStatus autosave={autosave} />}
        <ModeSwitcher />
      </div>
    </header>
  );
}

function ModePanelWithNotices() {
  const { show } = useNotice();
  return <ModePanel onNotice={show} />;
}

function PanelHeader({ title }: { title: string }) {
  return (
    <h2 className="border-b border-slate-200 px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:border-slate-800">
      {title}
    </h2>
  );
}
