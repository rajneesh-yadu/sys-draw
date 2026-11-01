/**
 * S17 — the open board's problem: requirements, scale and rubric, hints one at a time and the
 * reference solution (both hidden in Interview mode). Plus the top-bar launchers.
 */
import { BookOpen, ClipboardList, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { useBoardStoreApi } from '@/store';
import { Dialog } from './Dialog';
import { hintsAllowed, loadReferenceSolution, modeOptions, type Problem } from './library';
import { ProblemBrowser, type ProblemNotice } from './ProblemBrowser';
import { LevelBadge, ProblemDetails, TagList } from './ProblemDetails';
import { useActiveProblem } from './useActiveProblem';

const buttonClass =
  'inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

export function ProblemBrief({
  problem,
  mode,
  onClose,
  onNotice,
}: {
  problem: Problem;
  mode: ReturnType<typeof useActiveProblem>['mode'];
  onClose: () => void;
  onNotice?: (n: ProblemNotice) => void;
}) {
  const boardStore = useBoardStoreApi();
  const [shownHints, setShownHints] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const allowed = hintsAllowed(mode);
  const modeLabel = modeOptions(problem).find((m) => m.id === mode)?.label ?? mode;

  const loadReference = () => {
    const res = loadReferenceSolution(boardStore, problem);
    setConfirming(false);
    if (!res.ok) {
      onNotice?.({ kind: 'error', text: res.reason });
      return;
    }
    onNotice?.({
      kind: 'info',
      text: `Loaded the reference solution for "${problem.title}". Undo with Ctrl+Z.`,
    });
    onClose();
  };

  return (
    <Dialog
      title={
        <span className="flex items-center gap-2">
          {problem.title} <LevelBadge level={problem.level} />
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
            {modeLabel} mode
          </span>
        </span>
      }
      onClose={onClose}
      testId="problem-brief"
    >
      <div className="space-y-4 p-4">
        <TagList problem={problem} />
        <ProblemDetails problem={problem} />

        <section className="space-y-2" aria-label="Hints">
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
            Hints ({problem.hints.length})
          </h3>
          {!allowed ? (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="hints-hidden">
              Hints and the reference solution are hidden in Interview mode.
            </p>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-5 text-sm" data-testid="hints">
                {problem.hints.slice(0, shownHints).map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
              {shownHints < problem.hints.length && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setShownHints((n) => n + 1)}
                >
                  <Lightbulb size={14} aria-hidden />
                  {shownHints === 0 ? 'Show first hint' : `Show hint ${shownHints + 1}`}
                </button>
              )}
            </>
          )}
        </section>

        {allowed && (
          <section className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 uppercase">
              Reference solution
            </h3>
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2 text-xs" role="alert">
                <span>
                  This replaces everything on the board with the reference design and its scenario.
                </span>
                <button
                  type="button"
                  className="rounded bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700"
                  onClick={loadReference}
                >
                  Replace board
                </button>
                <button type="button" className={buttonClass} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  if (boardStore.getState().doc.graph.nodes.length === 0) loadReference();
                  else setConfirming(true);
                }}
              >
                <ClipboardList size={14} aria-hidden /> Load reference solution
              </button>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}

/** Top-bar button that opens the problem browser. */
export function ProblemsButton({ onNotice }: { onNotice?: (n: ProblemNotice) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={() => setOpen(true)}
        data-testid="open-problems"
      >
        <BookOpen size={14} aria-hidden /> Problems
      </button>
      {open && (
        <ProblemBrowser onClose={() => setOpen(false)} {...(onNotice ? { onNotice } : {})} />
      )}
    </>
  );
}

/** Top-bar button for the open board's problem brief; renders nothing on free boards. */
export function ProblemBriefButton({ onNotice }: { onNotice?: (n: ProblemNotice) => void }) {
  const { problem, mode, boardId } = useActiveProblem();
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (!problem) return null;
  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={() => setOpenFor(boardId)}
        data-testid="open-problem-brief"
        title={`Brief: ${problem.title}`}
      >
        <ClipboardList size={14} aria-hidden /> Brief
      </button>
      {openFor === boardId && (
        <ProblemBrief
          problem={problem}
          mode={mode}
          onClose={() => setOpenFor(null)}
          {...(onNotice ? { onNotice } : {})}
        />
      )}
    </>
  );
}
