/**
 * S19: design review beside the canvas — every finding (registry rules + the simulation's own),
 * worst first, filterable by category; the title jumps to the component on the canvas, and safe
 * findings carry a one-click fix (one undo step).
 */
import { ClipboardCheck, Crosshair, X } from 'lucide-react';
import { useBoardStoreApi, useSimulationStoreApi } from '@/store';
import { SEVERITY_ORDER, SEVERITY_STYLE, severityCounts } from '../security/security-store';
import { useReviewStore, useReviewStoreApi } from './context';
import {
  categoryCounts,
  jumpTarget,
  REVIEW_CATEGORIES,
  REVIEW_CATEGORY_LABEL,
  type ReviewViewFinding,
} from './review-store';

const chip =
  'rounded-full px-2 py-0.5 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none';

export function FindingsPanel() {
  const api = useReviewStoreApi();
  const open = useReviewStore((s) => s.open);
  const view = useReviewStore((s) => s.view);
  const filter = useReviewStore((s) => s.filter);
  const lastFix = useReviewStore((s) => s.lastFix);
  if (!open) return null;
  const all = view?.findings ?? [];
  const findings = filter === 'all' ? all : all.filter((f) => f.category === filter);
  const counts = severityCounts(all);
  const perCategory = categoryCounts(all);
  return (
    <aside
      aria-label="Design review"
      className="flex h-full w-96 shrink-0 flex-col border-l border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-950"
    >
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <ClipboardCheck aria-hidden className="h-4 w-4 text-sky-600" />
        <h2 className="font-semibold">Design review</h2>
        <span className="text-xs text-slate-500" data-testid="review-counts">
          {SEVERITY_ORDER.filter((s) => counts[s] > 0)
            .map((s) => `${counts[s]} ${s}`)
            .join(' · ') || 'no findings'}
        </span>
        <button
          type="button"
          className="ml-auto rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close design review"
          onClick={() => api.getState().setOpen(false)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div
        role="group"
        aria-label="Filter by category"
        className="flex flex-wrap gap-1 border-b border-slate-200 px-3 py-2 dark:border-slate-800"
      >
        {(['all', ...REVIEW_CATEGORIES] as const).map((c) => {
          const n = c === 'all' ? all.length : perCategory[c];
          const active = filter === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              className={`${chip} ${active ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'}`}
              onClick={() => api.getState().setFilter(c)}
            >
              {c === 'all' ? 'All' : REVIEW_CATEGORY_LABEL[c]} {n}
            </button>
          );
        })}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {lastFix && (
          <p
            role="status"
            className={`rounded px-2 py-1 text-xs ${lastFix.ok ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200'}`}
          >
            {lastFix.message}
          </p>
        )}
        {view && !view.hasResult && (
          <p className="text-xs text-slate-500" data-testid="review-no-result">
            Waiting for a simulation: rules that read latency and utilisation run once it finishes.
          </p>
        )}
        {findings.length === 0 ? (
          <p className="text-xs text-slate-500">
            {all.length === 0
              ? 'No findings: every rule that applies to this board passes.'
              : 'No findings in this category.'}
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Findings">
            {findings.map((f) => (
              <FindingItem key={f.key} f={f} />
            ))}
          </ul>
        )}
        {view && (
          <details className="text-[11px] text-slate-500">
            <summary className="cursor-pointer" data-testid="review-coverage">
              {view.checked} rules checked · {view.skipped.length} not applicable
            </summary>
            <ul className="mt-1 space-y-0.5">
              {view.skipped.map((s) => (
                <li key={s.ruleId}>
                  <span className="font-medium">{s.title}</span>: {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </aside>
  );
}

function FindingItem({ f }: { f: ReviewViewFinding }) {
  const board = useBoardStoreApi();
  const sim = useSimulationStoreApi();
  const api = useReviewStoreApi();
  const jump = () => {
    const { select, focusNodeId } = jumpTarget(f.targetIds, board.getState().doc.graph.edges);
    board.getState().setSelection(select);
    if (focusNodeId) sim.getState().requestFocus(focusNodeId);
  };
  const canJump = jumpTarget(f.targetIds, []).select.length > 0;
  return (
    <li
      data-testid="review-finding"
      data-severity={f.severity}
      data-rule={f.ruleId}
      data-category={f.category}
      className="rounded-md border border-slate-200 p-2 dark:border-slate-800"
    >
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLE[f.severity]}`}
        >
          {f.severity}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{f.title}</p>
          <p className="text-[11px] text-slate-500">
            {REVIEW_CATEGORY_LABEL[f.category]} · {f.ruleTitle}
          </p>
        </div>
        {canJump && (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label={`Show on canvas: ${f.title}`}
            title="Show on canvas"
            onClick={jump}
          >
            <Crosshair className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{f.message}</p>
      {f.fix && (
        <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
          <span className="font-semibold">Fix: </span>
          {f.fix}
        </p>
      )}
      {f.fixLabel && (
        <button
          type="button"
          className="mt-2 rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          onClick={() => api.getState().fix(f.key)}
        >
          Apply fix: {f.fixLabel}
        </button>
      )}
    </li>
  );
}
