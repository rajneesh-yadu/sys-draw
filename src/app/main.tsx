import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createDexieAdapter, openWorkspace, type Autosave } from '@/persistence';
import { boardStore, workspaceStore } from '@/store';
import { AppShell } from './index';
import { ErrorBoundary } from './layout/ErrorBoundary';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

async function start(el: HTMLElement) {
  // Load (and migrate) the saved workspace before the first render, then autosave.
  let autosave: Autosave | undefined;
  try {
    const session = await openWorkspace(workspaceStore, createDexieAdapter());
    autosave = session.autosave;
    if (session.warnings.length > 0) {
      console.warn('[sysdraw] Loaded with warnings (originals backed up):', session.warnings);
    }
    // Best effort: write pending changes when the tab is hidden or closed.
    const flushNow = () => void session.autosave.flush();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
    window.addEventListener('pagehide', flushNow);
  } catch (e) {
    // IndexedDB unavailable (e.g. some private modes): run without saving rather than not at all.
    console.error('[sysdraw] Saving is unavailable in this browser:', e);
  }

  // S21: `?fixture=perf-300` opens the 300-node performance board (dev aid; e2e perf test).
  const fixture = new URLSearchParams(window.location.search).get('fixture');
  if (fixture === 'perf-300') {
    const { loadPerfFixture } = await import('./perf/fixture');
    const r = loadPerfFixture(workspaceStore, boardStore);
    if (!r.ok) console.error('[sysdraw] Could not load the perf fixture:', r.reason);
  }

  createRoot(el).render(
    <StrictMode>
      <ErrorBoundary name="SysDraw">
        <AppShell {...(autosave ? { autosave } : {})} />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void start(root);
