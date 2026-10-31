/** "Saved" / "Saving…" / "Save failed" indicator, driven by the autosave status store. */
import { useStore } from 'zustand';
import type { Autosave } from '@/persistence';

const TEXT = {
  saved: 'Saved',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
};

export function SaveStatus({ autosave }: { autosave: Autosave }) {
  const s = useStore(autosave.status);
  return (
    <button
      type="button"
      data-testid="save-status"
      data-state={s.state}
      title={s.error ?? (s.lastSavedAt ? `Last saved ${s.lastSavedAt}` : 'Saved in this browser')}
      onClick={() => void autosave.flush()}
      className={`rounded px-2 py-0.5 text-xs ${
        s.state === 'error'
          ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
          : 'text-slate-400'
      }`}
    >
      {TEXT[s.state]}
    </button>
  );
}
