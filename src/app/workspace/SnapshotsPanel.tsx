/** Named snapshots of the open board: save, restore (undoable), delete, and how much changed since. */
import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { graphDiff, useBoardStore, useWorkspaceStore, useWorkspaceStoreApi } from '@/store';
import { useNotice } from './notice-context';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function SnapshotsButton() {
  const count = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.snapshots.length ?? 0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <History size={14} aria-hidden />
        Snapshots{count > 0 ? ` (${count})` : ''}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Snapshots"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="absolute top-full right-0 z-50 mt-1 w-80 rounded-md border border-slate-200 bg-white p-2 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <SnapshotsPanel />
        </div>
      )}
    </div>
  );
}

export function SnapshotsPanel() {
  const api = useWorkspaceStoreApi();
  const snapshots = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.snapshots);
  const graph = useBoardStore((s) => s.doc.graph);
  const [label, setLabel] = useState('');
  const { show } = useNotice();
  const diffs = useMemo(
    () => new Map((snapshots ?? []).map((s) => [s.id, graphDiff(s.graph, graph)])),
    [snapshots, graph],
  );

  const save = () => {
    const r = api.getState().saveSnapshot(label);
    if (r.ok) setLabel('');
    else show({ kind: 'error', text: r.reason });
  };

  return (
    <div className="space-y-2">
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          aria-label="Snapshot name"
          placeholder={`Snapshot ${(snapshots?.length ?? 0) + 1}`}
          value={label}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-sm dark:border-slate-600 dark:bg-slate-900"
        />
        <button
          type="submit"
          className="rounded bg-sky-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-sky-700"
        >
          Save snapshot
        </button>
      </form>
      {!snapshots || snapshots.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No snapshots yet. A snapshot keeps this board&apos;s design so you can come back to it.
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto" data-testid="snapshot-list">
          {[...snapshots].reverse().map((s) => {
            const d = diffs.get(s.id);
            const summary =
              !d || d.total === 0
                ? 'Same as now'
                : `${d.total} change${d.total === 1 ? '' : 's'} since (+${d.added} −${d.removed} ~${d.changed})`;
            return (
              <li
                key={s.id}
                className="rounded border border-slate-200 px-2 py-1 dark:border-slate-700"
                data-snapshot-id={s.id}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                  <time className="text-[11px] text-slate-500 dark:text-slate-400" dateTime={s.at}>
                    {formatWhen(s.at)}
                  </time>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className="flex-1 text-slate-500 dark:text-slate-400"
                    data-testid="snapshot-diff"
                  >
                    {summary}
                  </span>
                  <button
                    type="button"
                    disabled={!d || d.total === 0}
                    onClick={() => {
                      const r = api.getState().restoreSnapshot(s.id);
                      show(
                        r.ok
                          ? { kind: 'info', text: `Restored "${s.label}" (Ctrl+Z to undo)` }
                          : { kind: 'error', text: r.reason },
                      );
                    }}
                    className="rounded px-1.5 text-sky-700 hover:bg-sky-50 disabled:opacity-40 dark:text-sky-300 dark:hover:bg-slate-700"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete snapshot ${s.label}`}
                    onClick={() => {
                      const r = api.getState().deleteSnapshot(s.id);
                      if (!r.ok) show({ kind: 'error', text: r.reason });
                    }}
                    className="rounded px-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
