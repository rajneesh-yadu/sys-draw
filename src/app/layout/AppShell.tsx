import { useState, type ReactNode } from 'react';

/**
 * The five-region app shell. Every region is an empty, labelled placeholder for now;
 * later sessions mount real module components into them (palette/canvas: S04,
 * inspector: S05, project tabs: S06, metrics drawer: S08).
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(true);

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Component palette"
          data-testid="region-palette"
          className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          <PanelHeader title="Palette" />
          <Placeholder>Components from the registry appear here.</Placeholder>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main
            aria-label="Design canvas"
            data-testid="region-canvas"
            className="relative min-h-0 flex-1 bg-[radial-gradient(circle,_rgb(148_163_184_/_0.35)_1px,_transparent_1px)] [background-size:20px_20px]"
          >
            <div className="absolute inset-0 grid place-items-center">
              <p className="rounded-md bg-white/80 px-3 py-1.5 text-sm text-slate-500 shadow-sm dark:bg-slate-900/80 dark:text-slate-400">
                Canvas — drag components here
              </p>
            </div>
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
                <Placeholder>Latency, throughput, utilisation and cost appear here.</Placeholder>
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
          <Placeholder>Select a node or edge to configure it.</Placeholder>
        </aside>
      </div>
    </div>
  );
}

function TopBar() {
  return (
    <header
      data-testid="region-topbar"
      className="flex h-12 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900"
    >
      <h1 className="text-base font-semibold tracking-tight">SysDraw</h1>
      <span className="text-sm text-slate-400">Untitled board</span>
      <div className="ml-auto text-xs text-slate-400">Sandbox</div>
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
