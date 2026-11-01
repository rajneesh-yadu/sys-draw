/** Interview: 45-minute clock, hints hidden, follow-ups at fixed times, scorecard at the end. */
import { defineMode } from '../define';
import {
  buildScorecard,
  initialInterviewState,
  promptsDue,
  retotal,
  SELF_REVIEW,
  type InterviewState,
  type Scorecard,
} from '../interview';
import type { ModeContext } from '../types';

function finish(state: InterviewState, ctx: ModeContext, by: Scorecard['endedBy']): InterviewState {
  if (state.finished) return state;
  return { ...state, finished: true, scorecard: buildScorecard(state, ctx, by) };
}

function tick(state: InterviewState, ctx: ModeContext): InterviewState {
  if (state.finished) return state;
  if (state.startedAtMs === undefined) {
    return ctx.problem ? { ...state, startedAtMs: ctx.nowMs, elapsedMs: 0 } : state;
  }
  const elapsedMs = Math.min(state.durationMs, Math.max(0, ctx.nowMs - state.startedAtMs));
  const due = promptsDue(elapsedMs);
  const next: InterviewState = {
    ...state,
    elapsedMs,
    asked: due.length === state.asked.length ? state.asked : due,
  };
  return elapsedMs >= state.durationMs ? finish(next, ctx, 'timer') : next;
}

export default defineMode<InterviewState>({
  id: 'interview',
  label: 'Interview',
  description: '45 minutes against the clock, as in a real interview. Scored at the end.',
  help: 'None until finished; interviewer follow-ups at fixed times',
  success: 'Rubric score: SLOs met, rules passed, cost, plus a self-review checklist',
  order: 2,
  hintsAllowed: false,
  wantsProblem: true,
  onEnter: initialInterviewState,
  onGraphChange: (s) => s,
  onSimResult: (s) => s,
  onTick: tick,
  onAction(state, action, ctx) {
    switch (action.type) {
      case 'finish':
        return finish(tick(state, ctx), ctx, 'user');
      case 'toggleSelfReview': {
        const id = String(action.id);
        if (!SELF_REVIEW.some((i) => i.id === id)) return state;
        const selfReview = state.selfReview.includes(id)
          ? state.selfReview.filter((x) => x !== id)
          : [...state.selfReview, id];
        const share = selfReview.length / SELF_REVIEW.length;
        return {
          ...state,
          selfReview,
          ...(state.scorecard
            ? { scorecard: retotal(state.scorecard, { selfReviewShare: share }) }
            : {}),
        };
      }
      case 'referenceCost': {
        const v = Number(action.costPerMonth);
        if (!state.scorecard || !Number.isFinite(v)) return state;
        return { ...state, scorecard: retotal(state.scorecard, { referenceCostPerMonth: v }) };
      }
      case 'restart':
        return initialInterviewState(ctx);
      default:
        return state;
    }
  },
  needsReferenceCost: (s) =>
    s.scorecard !== undefined && s.scorecard.referenceCostPerMonth === undefined,
  isComplete: (state) => state.finished,
  score: (state) => state.scorecard?.total,
});
