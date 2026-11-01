/**
 * S17 — problem browser: filter the library by level, topic tag and company style, read a
 * problem's brief, and start it on a new board in the chosen mode.
 */
import { BookOpen, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { registry as appRegistry, type Registry } from '@/registry';
import { useWorkspaceStoreApi } from '@/store';
import { Dialog } from './Dialog';
import {
  filterProblems,
  LEVEL_LABELS,
  listProblems,
  modeOptions,
  problemFacets,
  START_LABELS,
  startProblem,
  type ModeId,
  type Problem,
  type ProblemFilter,
  type StartFrom,
} from './library';
import { LevelBadge, ProblemDetails, TagList } from './ProblemDetails';

export interface ProblemNotice {
  kind: 'info' | 'error';
  text: string;
}

const selectClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900';

export function ProblemBrowser({
  onClose,
  onNotice,
  registry = appRegistry,
}: {
  onClose: () => void;
  onNotice?: (n: ProblemNotice) => void;
  registry?: Registry;
}) {
  const workspace = useWorkspaceStoreApi();
  const problems = useMemo(() => listProblems(registry), [registry]);
  const facets = useMemo(() => problemFacets(problems), [problems]);
  const [filter, setFilter] = useState<ProblemFilter>({});
  const shown = useMemo(() => filterProblems(problems, filter), [problems, filter]);
  const [selectedId, setSelectedId] = useState<string | undefined>(problems[0]?.id);
  const selected = shown.find((p) => p.id === selectedId) ?? shown[0];

  const patch = (p: Partial<ProblemFilter>) => setFilter((f) => ({ ...f, ...p }));

  return (
    <Dialog title="Practice problems" onClose={onClose} testId="problem-browser" wide>
      <div className="flex min-h-[28rem]">
        <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800">
          <div
            className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800"
            role="search"
          >
            <input
              type="search"
              aria-label="Search problems"
              placeholder="Search problems"
              value={filter.query ?? ''}
              onChange={(e) => patch({ query: e.target.value })}
              className={selectClass}
            />
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] text-slate-500 dark:text-slate-400">
                Level
                <select
                  className={selectClass}
                  value={filter.level ?? ''}
                  onChange={(e) =>
                    patch({ level: e.target.value ? Number(e.target.value) : undefined })
                  }
                >
                  <option value="">Any</option>
                  {facets.levels.map((l) => (
                    <option key={l} value={l}>
                      {l} · {LEVEL_LABELS[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-slate-500 dark:text-slate-400">
                Tag
                <select
                  className={selectClass}
                  value={filter.tag ?? ''}
                  onChange={(e) => patch({ tag: e.target.value || undefined })}
                >
                  <option value="">Any</option>
                  {facets.tags.map((t) => (
                    <option key={t.tag} value={t.tag}>
                      {t.tag} ({t.count})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-slate-500 dark:text-slate-400">
                Company style
                <select
                  className={selectClass}
                  value={filter.company ?? ''}
                  onChange={(e) => patch({ company: e.target.value || undefined })}
                >
                  <option value="">Any</option>
                  {facets.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({c.count})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p
              className="text-[11px] text-slate-500 dark:text-slate-400"
              aria-live="polite"
              data-testid="problem-count"
            >
              {shown.length} of {problems.length} problems
            </p>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Problems">
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  aria-current={p.id === selected?.id ? 'true' : undefined}
                  data-testid={`problem-item-${p.id}`}
                  className={`w-full space-y-1 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 ${p.id === selected?.id ? 'bg-indigo-50 dark:bg-indigo-950' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.title}</span>
                    <span className="ml-auto">
                      <LevelBadge level={p.level} />
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                    {p.docs.summary}
                  </p>
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="p-3 text-xs text-slate-500 dark:text-slate-400">
                No problem matches these filters.
              </li>
            )}
          </ul>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {selected ? (
            <ProblemPane
              key={selected.id}
              problem={selected}
              onStart={(opts) => {
                const res = startProblem(workspace, selected, opts);
                if (!res.ok) {
                  onNotice?.({ kind: 'error', text: res.reason });
                  return;
                }
                const mode = modeOptions(selected).find((m) => m.id === opts.mode)?.label;
                onNotice?.({
                  kind: 'info',
                  text: `Started "${selected.title}" in ${mode} mode on a new board.`,
                });
                onClose();
              }}
            />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Choose a problem.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ProblemPane({
  problem,
  onStart,
}: {
  problem: Problem;
  onStart: (opts: { mode: ModeId; start: StartFrom }) => void;
}) {
  const modes = modeOptions(problem);
  const [mode, setMode] = useState<ModeId>('guided');
  const option = modes.find((m) => m.id === mode);
  const [start, setStart] = useState<StartFrom>(option?.starts[0] ?? 'blank');
  const starts = option?.starts ?? ['blank'];
  const effectiveStart = starts.includes(start) ? start : (starts[0] ?? 'blank');

  return (
    <div className="space-y-4" data-testid="problem-pane">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <BookOpen size={16} aria-hidden className="text-slate-500 dark:text-slate-400" />
          <h3 className="text-base font-semibold">{problem.title}</h3>
          <LevelBadge level={problem.level} />
        </div>
        <TagList problem={problem} />
      </div>
      <ProblemDetails problem={problem} />
      <form
        className="space-y-3 rounded border border-slate-200 p-3 dark:border-slate-800"
        aria-label="Start problem"
        onSubmit={(e) => {
          e.preventDefault();
          onStart({ mode, start: effectiveStart });
        }}
      >
        <fieldset className="space-y-1">
          <legend className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
            Mode
          </legend>
          {modes.map((m) => (
            <label
              key={m.id}
              className={`flex items-start gap-2 text-xs ${m.disabledReason ? 'text-slate-500 dark:text-slate-400' : ''}`}
            >
              <input
                type="radio"
                name="problem-mode"
                value={m.id}
                checked={mode === m.id}
                disabled={m.disabledReason !== undefined}
                onChange={() => {
                  setMode(m.id);
                  setStart(m.starts[0] ?? 'blank');
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{m.label}</span> — {m.description}
                {m.disabledReason && <span className="block italic">{m.disabledReason}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        <label className="block text-xs">
          <span className="font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
            Start from
          </span>
          <select
            className={selectClass}
            value={effectiveStart}
            onChange={(e) => setStart(e.target.value as StartFrom)}
            disabled={starts.length < 2}
          >
            {starts.map((s) => (
              <option key={s} value={s}>
                {START_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          The new board gets this problem’s traffic scenario
          {effectiveStart === 'blank' ? ' (flows follow your design from the clients)' : ''}. It is
          added to the current project.
        </p>
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          <Play size={14} aria-hidden /> Start problem
        </button>
      </form>
    </div>
  );
}
