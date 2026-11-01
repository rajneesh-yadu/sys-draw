/** Top-bar mode switcher: every registered mode, on any board. */
import { useWorkspaceStore, useWorkspaceStoreApi } from '@/store';
import { setBoardMode } from '../board-actions';
import { modes } from '../registry';
import type { ModeId } from '../types';

export function ModeSwitcher() {
  const ws = useWorkspaceStoreApi();
  const mode = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.mode ?? 'sandbox');
  const list = modes.list();
  const current = list.find((m) => m.id === mode);
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      Mode
      <select
        data-testid="board-mode"
        value={mode}
        title={current?.description}
        onChange={(e) => setBoardMode(ws, e.target.value as ModeId)}
        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      >
        {list.map((m) => (
          <option key={m.id} value={m.id} title={m.description}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
