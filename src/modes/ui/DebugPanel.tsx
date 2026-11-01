/** Debug: pick a broken design, read its symptoms, take hints (they cost points), get confirmed. */
import { AlertTriangle, CheckCircle2, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { useBoardStoreApi, useWorkspaceStoreApi } from '@/store';
import { loadDebugCase } from '../board-actions';
import type { DebugState } from '../controllers/debug';
import {
  DEBUG_HINT_COST,
  debugCases,
  debugHints,
  debugScore,
  debugStatus,
  findDebugCase,
} from '../debug';
import type { ModeAction, ModeContext } from '../types';
import { banner, button, field, primary, sectionTitle } from './styles';

export function DebugPanel({
  state,
  ctx,
  act,
  onError,
}: {
  state: DebugState;
  ctx: ModeContext;
  act: (a: ModeAction) => void;
  onError: (msg: string) => void;
}) {
  const c = findDebugCase(ctx.registry, state.problemId, state.variantId);
  return (
    <div className="space-y-3" data-testid="debug-panel">
      {c ? <DebugCaseView state={state} ctx={ctx} act={act} /> : null}
      <CasePicker ctx={ctx} act={act} onError={onError} current={c?.variant.id} />
    </div>
  );
}

function DebugCaseView({
  state,
  ctx,
  act,
}: {
  state: DebugState;
  ctx: ModeContext;
  act: (a: ModeAction) => void;
}) {
  const c = findDebugCase(ctx.registry, state.problemId, state.variantId)!;
  const st = debugStatus(c, ctx);
  const hints = debugHints(c, ctx.registry);
  const fixed = state.fixedAtMs !== undefined;
  return (
    <section className="space-y-2" aria-label="Broken design">
      <h3 className="text-sm font-semibold">
        {c.problem.title}: {c.variant.title}
      </h3>
      {fixed ? (
        <p className={banner} role="status" data-testid="debug-fixed">
          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Fixed — the faults are gone and every SLO holds. Score {debugScore(state.hintsUsed)}.
        </p>
      ) : (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Users are complaining. Find what is wrong from the symptoms and fix the design on the
          canvas; this panel confirms when it is healthy.
        </p>
      )}
      <h4 className={sectionTitle}>Symptoms</h4>
      {state.stale && !fixed ? (
        <p className="text-xs text-slate-500 dark:text-slate-400" role="status">
          Simulating…
        </p>
      ) : st.symptoms.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">No symptoms.</p>
      ) : (
        <ul className="space-y-1" data-testid="debug-symptoms">
          {st.symptoms.map((s) => (
            <li key={s.text} className="flex gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              {s.text}
            </li>
          ))}
        </ul>
      )}
      {!fixed && (
        <section className="space-y-1" aria-label="Hints">
          <h4 className={sectionTitle}>Hints</h4>
          <ol className="list-decimal space-y-1 pl-4 text-xs" data-testid="debug-hints">
            {hints.slice(0, state.hintsUsed).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
          {state.hintsUsed < hints.length && (
            <button type="button" className={button} onClick={() => act({ type: 'hint' })}>
              <Lightbulb className="h-3.5 w-3.5" aria-hidden /> Show a hint (−{DEBUG_HINT_COST}{' '}
              points)
            </button>
          )}
        </section>
      )}
    </section>
  );
}

function CasePicker({
  ctx,
  act,
  onError,
  current,
}: {
  ctx: ModeContext;
  act: (a: ModeAction) => void;
  onError: (msg: string) => void;
  current: string | undefined;
}) {
  const ws = useWorkspaceStoreApi();
  const board = useBoardStoreApi();
  const cases = debugCases(ctx.registry);
  const key = (i: number) => `${cases[i]!.problem.id}/${cases[i]!.variant.id}`;
  const [sel, setSel] = useState(0);
  return (
    <section
      className="space-y-1.5 border-t border-slate-200 pt-2 dark:border-slate-800"
      aria-label="Debug cases"
    >
      <h4 className={sectionTitle}>{current ? 'Try another' : 'Load a broken design'}</h4>
      {!current && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          It replaces this board’s design and scenario (one undo step).
        </p>
      )}
      <select
        className={field}
        value={sel}
        onChange={(e) => setSel(Number(e.target.value))}
        aria-label="Broken design"
      >
        {cases.map((c, i) => (
          <option key={key(i)} value={i}>
            L{c.problem.level} · {c.problem.title}: {c.variant.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={primary}
        onClick={() => {
          const c = cases[sel];
          if (!c) return;
          const res = loadDebugCase(ws, board, c);
          if (!res.ok) return onError(res.reason);
          act({ type: 'loaded', problemId: c.problem.id, variantId: c.variant.id });
        }}
      >
        Load broken design
      </button>
    </section>
  );
}
