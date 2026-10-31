import { useEffect, useState, type ReactNode } from 'react';
import { BoardCanvas, CanvasProvider, Palette } from '@/canvas';
import { Inspector } from '@/inspector';
import type { Autosave } from '@/persistence';
import { projectOfBoard, useWorkspaceStore } from '@/store';
import { BoardTabs, NoticeProvider, ProjectSidebar, SaveStatus } from '../workspace';

/**
 * The app shell: project sidebar, palette, board tabs over the canvas, inspector, metrics drawer.
 * Palette and canvas: S04. Inspector: S05. Projects, tabs, snapshots and saving: S06.
 * `autosave` comes from persistence (main.tsx); without it nothing is saved (tests).
 */
export function AppShell({ autosave }: { autosave?: Autosave } = {}) {
  const [drawerOpen, setDrawerOpen] = useState(true);

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
      <CanvasProvider>
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
              <main
                id="board-canvas-region"
                aria-label="Design canvas"
                data-testid="region-canvas"
                className="relative min-h-0 flex-1"
              >
                <BoardCanvas />
              </main>

              <section
                aria-label="Metrics"
                data-testid="region-metrics"
                className="shrink-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between px-3 py-1.5">
                  <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Metrics
                  </h2>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen((o) => !o)}
                    aria-expanded={drawerOpen}
                    aria-controls="metrics-drawer-body"
                    className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {drawerOpen ? 'Hide' : 'Show'}
                  </button>
                </div>
                {drawerOpen && (
                  <div id="metrics-drawer-body" className="h-40 overflow-y-auto">
                    <Placeholder>
                      Latency, throughput, utilisation and cost appear here.
                    </Placeholder>
                  </div>
                )}
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
    </NoticeProvider>
  );
}

function TopBar({ autosave }: { autosave?: Autosave | undefined }) {
  const projectName = useWorkspaceStore((s) => projectOfBoard(s.data, s.activeBoardId)?.name);
  const boardName = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.name);
  const mode = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.mode ?? 'sandbox');
  return (
    <header
      data-testid="region-topbar"
      className="flex h-12 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h1 className="text-base font-semibold tracking-tight">SysDraw</h1>
      <span className="truncate text-sm text-slate-400" data-testid="board-title">
        {projectName} / <span className="text-slate-600 dark:text-slate-300">{boardName}</span>
      </span>
      <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
        {autosave && <SaveStatus autosave={autosave} />}
        <span className="capitalize">{mode}</span>
      </div>
    </header>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <h2 className="border-b border-slate-200 px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:border-slate-800">
      {title}
    </h2>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="p-3 text-sm text-slate-400">{children}</p>;
}
