/** Project list: open, create, rename, duplicate, reorder (drag or menu), delete, export, import. */
import { FolderPlus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { importSaveFile, projectFile } from '@/persistence';
import { useWorkspaceStore, useWorkspaceStoreApi } from '@/store';
import { downloadSaveFile, readFileText } from './files';
import { IconButton, InlineEdit, Menu } from './Menu';
import { useNotice } from './notice-context';
import { NoticeLine } from './notices';

const DRAG_TYPE = 'application/x-sysdraw-project';

export function ProjectSidebar() {
  const api = useWorkspaceStoreApi();
  const projects = useWorkspaceStore((s) => s.data.projects);
  const boards = useWorkspaceStore((s) => s.data.boards);
  const activeBoardId = useWorkspaceStore((s) => s.activeBoardId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { show } = useNotice();

  const report = (r: { ok: true } | { ok: false; reason: string }) => {
    if (!r.ok) show({ kind: 'error', text: r.reason });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    let text: string;
    try {
      text = await readFileText(file);
    } catch (e) {
      show({ kind: 'error', text: `Could not read ${file.name}: ${(e as Error).message}` });
      return;
    }
    const res = importSaveFile(api, text);
    if (!res.ok) {
      show({ kind: 'error', text: `Import failed:\n${res.errors.slice(0, 5).join('\n')}` });
      return;
    }
    const what =
      res.kind === 'board'
        ? 'board'
        : `${res.projectIds.length} project${res.projectIds.length === 1 ? '' : 's'}`;
    const extra = [...res.applied, ...res.warnings];
    show({
      kind: 'info',
      text: `Imported ${what} (${res.boardIds.length} board${res.boardIds.length === 1 ? '' : 's'}).${
        extra.length ? `\n${extra.join('\n')}` : ''
      }`,
    });
  };

  return (
    <nav aria-label="Projects" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
        <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Projects</h2>
        <div className="flex">
          <IconButton label="Import JSON" onClick={() => fileInput.current?.click()}>
            <Upload size={14} aria-hidden />
          </IconButton>
          <IconButton
            label="New project"
            onClick={() => {
              const r = api.getState().createProject();
              if (r.ok) setRenaming(r.projectId);
              else report(r);
            }}
          >
            <FolderPlus size={14} aria-hidden />
          </IconButton>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="import-input"
          onChange={(e) => {
            void onImport(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="project-list">
        {projects.map((p, i) => {
          const active = p.boardIds.includes(activeBoardId);
          return (
            <li
              key={p.id}
              data-project-id={p.id}
              draggable={renaming !== p.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, p.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                setDropIndex(i);
              }}
              onDragLeave={() => setDropIndex(null)}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(DRAG_TYPE);
                setDropIndex(null);
                if (id) report(api.getState().moveProject(id, i));
              }}
              className={`group mx-1 flex items-center gap-1 rounded px-2 py-1 text-sm ${
                active
                  ? 'bg-sky-100 font-medium text-sky-900 dark:bg-sky-900/40 dark:text-sky-100'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              } ${dropIndex === i ? 'ring-2 ring-sky-400' : ''}`}
            >
              {renaming === p.id ? (
                <InlineEdit
                  value={p.name}
                  label="Project name"
                  onCommit={(v) => {
                    report(api.getState().renameProject(p.id, v));
                    setRenaming(null);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  className="min-w-0 flex-1 truncate text-left focus-visible:underline focus-visible:outline-none"
                  onClick={() => report(api.getState().openProject(p.id))}
                  onDoubleClick={() => setRenaming(p.id)}
                  title={`${p.name} — ${p.boardIds.length} board${p.boardIds.length === 1 ? '' : 's'}`}
                >
                  {p.name}
                </button>
              )}
              <span className="text-xs text-slate-400">{p.boardIds.length}</span>
              <Menu
                label={`Project ${p.name} actions`}
                items={[
                  { label: 'Rename', onSelect: () => setRenaming(p.id) },
                  {
                    label: 'Duplicate',
                    onSelect: () => report(api.getState().duplicateProject(p.id)),
                  },
                  {
                    label: 'Move up',
                    disabled: i === 0,
                    onSelect: () => report(api.getState().moveProject(p.id, i - 1)),
                  },
                  {
                    label: 'Move down',
                    disabled: i === projects.length - 1,
                    onSelect: () => report(api.getState().moveProject(p.id, i + 1)),
                  },
                  {
                    label: 'Export JSON',
                    onSelect: () => downloadSaveFile(projectFile(api.getState().data, p.id)),
                  },
                  {
                    label: 'Delete',
                    danger: true,
                    disabled: projects.length === 1,
                    confirm: `Delete "${p.name}" and its ${p.boardIds.length} board${
                      p.boardIds.length === 1 ? '' : 's'
                    }`,
                    onSelect: () => report(api.getState().deleteProject(p.id)),
                  },
                ]}
              />
            </li>
          );
        })}
      </ul>
      <p className="px-3 pb-1 text-[11px] text-slate-400">
        {Object.keys(boards).length} boards in {projects.length} projects
      </p>
      <NoticeLine />
    </nav>
  );
}
