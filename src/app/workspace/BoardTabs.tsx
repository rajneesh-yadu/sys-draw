/** Tabs for the boards of the open project: open, add, rename, duplicate, reorder, delete, export. */
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { boardFile } from '@/persistence';
import { projectOfBoard, useWorkspaceStore, useWorkspaceStoreApi } from '@/store';
import { downloadSaveFile } from './files';
import { IconButton, InlineEdit, Menu } from './Menu';
import { useNotice } from './notice-context';
import { SnapshotsButton } from './SnapshotsPanel';

const DRAG_TYPE = 'application/x-sysdraw-board';

export function BoardTabs() {
  const api = useWorkspaceStoreApi();
  const activeBoardId = useWorkspaceStore((s) => s.activeBoardId);
  const project = useWorkspaceStore((s) => projectOfBoard(s.data, s.activeBoardId));
  const boards = useWorkspaceStore((s) => s.data.boards);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const { show } = useNotice();

  if (!project) return null;
  const ids = project.boardIds;
  const report = (r: { ok: true } | { ok: false; reason: string }) => {
    if (!r.ok) show({ kind: 'error', text: r.reason });
  };

  const focusTab = (i: number) =>
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus();

  return (
    <div
      data-testid="board-tabs"
      className="flex h-9 shrink-0 items-end gap-1 border-b border-slate-200 bg-slate-100 px-2 dark:border-slate-800 dark:bg-slate-900"
    >
      <div
        ref={list}
        role="tablist"
        aria-label={`Boards in ${project.name}`}
        className="flex min-w-0 items-end gap-0.5 overflow-x-auto"
      >
        {ids.map((id, i) => {
          const b = boards[id];
          if (!b) return null;
          const selected = id === activeBoardId;
          return (
            <div
              key={id}
              data-board-id={id}
              draggable={renaming !== id}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                setDropIndex(i);
              }}
              onDragLeave={() => setDropIndex(null)}
              onDrop={(e) => {
                const from = e.dataTransfer.getData(DRAG_TYPE);
                setDropIndex(null);
                if (from) report(api.getState().moveBoard(from, i));
              }}
              className={`group flex max-w-52 items-center gap-1 rounded-t-md border border-b-0 px-2 py-1 text-sm ${
                selected
                  ? 'border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'
                  : 'border-transparent text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'
              } ${dropIndex === i ? 'ring-2 ring-sky-400' : ''}`}
            >
              {renaming === id ? (
                <InlineEdit
                  value={b.name}
                  label="Board name"
                  onCommit={(v) => {
                    report(api.getState().renameBoard(id, v));
                    setRenaming(null);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="board-canvas-region"
                  tabIndex={selected ? 0 : -1}
                  className="min-w-0 truncate focus-visible:underline focus-visible:outline-none"
                  onClick={() => report(api.getState().openBoard(id))}
                  onDoubleClick={() => setRenaming(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      const next =
                        (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
                      const target = ids[next];
                      if (target === undefined) return;
                      if (e.altKey && e.shiftKey) report(api.getState().moveBoard(id, next));
                      else report(api.getState().openBoard(target));
                      requestAnimationFrame(() => focusTab(next));
                    } else if (e.key === 'F2') {
                      e.preventDefault();
                      setRenaming(id);
                    }
                  }}
                  title={`${b.name} (double-click or F2 to rename)`}
                >
                  {b.name}
                </button>
              )}
              <Menu
                label={`Board ${b.name} actions`}
                items={[
                  { label: 'Rename', onSelect: () => setRenaming(id) },
                  {
                    label: 'Duplicate',
                    onSelect: () => report(api.getState().duplicateBoard(id)),
                  },
                  {
                    label: 'Move left',
                    disabled: i === 0,
                    onSelect: () => report(api.getState().moveBoard(id, i - 1)),
                  },
                  {
                    label: 'Move right',
                    disabled: i === ids.length - 1,
                    onSelect: () => report(api.getState().moveBoard(id, i + 1)),
                  },
                  {
                    label: 'Export JSON',
                    onSelect: () => downloadSaveFile(boardFile(api.getState().data, id)),
                  },
                  {
                    label: 'Delete',
                    danger: true,
                    disabled: ids.length === 1,
                    confirm: `Delete "${b.name}"`,
                    onSelect: () => report(api.getState().deleteBoard(id)),
                  },
                ]}
              />
            </div>
          );
        })}
      </div>
      <div className="mb-1">
        <IconButton
          label="New board"
          onClick={() => {
            const r = api.getState().createBoard(project.id);
            report(r);
          }}
        >
          <Plus size={14} aria-hidden />
        </IconButton>
      </div>
      <div className="mb-1 ml-auto">
        <SnapshotsButton />
      </div>
    </div>
  );
}
