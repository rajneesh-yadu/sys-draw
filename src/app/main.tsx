import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createDexieAdapter, openWorkspace, type Autosave } from '@/persistence';
import { workspaceStore } from '@/store';
import { AppShell } from './index';

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

  createRoot(el).render(
    <StrictMode>
      <AppShell {...(autosave ? { autosave } : {})} />
    </StrictMode>,
  );
}

void start(root);
