/** Interview: the clock, the interviewer's follow-ups, finish and the scorecard. */
import { Clock, MessageSquare } from 'lucide-react';
import { formatSloValue } from '../evaluate';
import {
  formatClock,
  INTERVIEW_PROMPTS,
  remainingMs,
  SELF_REVIEW,
  type InterviewState,
  type Scorecard,
} from '../interview';
import { formatDuration } from '../progress';
import type { ModeAction, ModeContext } from '../types';
import { Checks } from './Checks';
import { button, primary, sectionTitle } from './styles';

export function InterviewPanel({
  state,
  ctx,
  act,
}: {
  state: InterviewState;
  ctx: ModeContext;
  act: (a: ModeAction) => void;
}) {
  const left = remainingMs(state);
  const asked = INTERVIEW_PROMPTS.filter((p) => state.asked.includes(p.id));
  return (
    <div className="space-y-3" data-testid="interview-panel">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden />
        <span
          className={`font-mono text-2xl tabular-nums ${left < 5 * 60_000 && !state.finished ? 'text-red-600' : ''}`}
          data-testid="interview-clock"
          aria-label={`Time left ${formatClock(left)}`}
        >
          {formatClock(left)}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">left</span>
        {!state.finished && state.startedAtMs !== undefined && (
          <button
            type="button"
            className={`${primary} ml-auto`}
            onClick={() => act({ type: 'finish' })}
          >
            Finish interview
          </button>
        )}
      </div>
      {!state.finished && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Hints and the reference stay hidden until you finish. The interviewer asks follow-ups as
          the clock runs.
        </p>
      )}

      <section aria-label="Interviewer" className="space-y-1">
        <h3 className={sectionTitle}>Interviewer</h3>
        {asked.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            First question at {INTERVIEW_PROMPTS[0]?.atMin} min.
          </p>
        ) : (
          <ol className="space-y-1.5" data-testid="interview-prompts">
            {asked.map((p, k) => (
              <li
                key={p.id}
                className={`flex gap-1.5 rounded px-2 py-1 text-xs ${k === asked.length - 1 && !state.finished ? 'bg-amber-50 dark:bg-amber-950' : 'bg-slate-50 dark:bg-slate-900'}`}
              >
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="text-slate-500 dark:text-slate-400">{p.atMin}:00 · </span>
                  {p.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Self-review" className="space-y-1">
        <h3 className={sectionTitle}>Self-review</h3>
        {SELF_REVIEW.map((i) => (
          <label key={i.id} className="flex items-start gap-1.5 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={state.selfReview.includes(i.id)}
              onChange={() => act({ type: 'toggleSelfReview', id: i.id })}
            />
            {i.text}
          </label>
        ))}
      </section>

      {state.scorecard && <ScorecardView card={state.scorecard} ctx={ctx} act={act} />}
    </div>
  );
}

function ScorecardView({
  card,
  ctx,
  act,
}: {
  card: Scorecard;
  ctx: ModeContext;
  act: (a: ModeAction) => void;
}) {
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return (
    <section
      aria-label="Scorecard"
      className="space-y-2 rounded border border-slate-200 p-2 dark:border-slate-800"
      data-testid="scorecard"
    >
      <h3 className="flex items-baseline gap-2 text-sm font-semibold">
        Scorecard
        <span className="text-2xl tabular-nums" data-testid="score-total">
          {card.total}
        </span>
        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/ 100</span>
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {card.endedBy === 'timer' ? 'Time is up' : 'Finished'} after{' '}
        {formatDuration(card.elapsedMs)}.
      </p>
      <h4 className={sectionTitle}>Rubric ({pct(card.rubricShare)}, weight 70 %)</h4>
      {card.rubric.length ? (
        <Checks
          label="Rubric"
          items={card.rubric.map((l) => ({
            label: `${l.label} ×${l.weight}`,
            ok: l.passed,
            detail: l.detail,
          }))}
        />
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No problem rubric on this board.
        </p>
      )}
      <h4 className={sectionTitle}>Cost (weight 15 %)</h4>
      <p className="text-xs" data-testid="score-cost">
        {card.costPerMonth === undefined
          ? 'No simulation result at the end.'
          : card.referenceCostPerMonth === undefined
            ? `${formatSloValue('costPerMonth', card.costPerMonth)} — comparing with the reference…`
            : `${formatSloValue('costPerMonth', card.costPerMonth)} vs reference ${formatSloValue('costPerMonth', card.referenceCostPerMonth)} → ${pct(card.costShare ?? 0)}`}
      </p>
      <h4 className={sectionTitle}>Self-review (weight 15 %)</h4>
      <p className="text-xs">{pct(card.selfReviewShare)} ticked</p>
      {ctx.problem && (
        <details className="text-xs">
          <summary className="cursor-pointer">Hints you could have used</summary>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            {ctx.problem.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
        </details>
      )}
      <button type="button" className={button} onClick={() => act({ type: 'restart' })}>
        Start a new interview
      </button>
    </section>
  );
}
