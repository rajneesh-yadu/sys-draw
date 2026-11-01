/**
 * Interview mode content and scoring (pure): a 45-minute clock, interviewer follow-ups at fixed
 * times (data, no AI), a self-review checklist and the end-of-session scorecard.
 */
import { costShare, judgeRubric, rubricShare, type RubricLine } from './evaluate';
import type { ModeContext } from './types';

export const INTERVIEW_DURATION_MS = 45 * 60_000;

export interface InterviewPrompt {
  id: string;
  /** Minutes after the start when the interviewer asks. */
  atMin: number;
  text: string;
}

/** The interviewer's follow-ups, as data. Applies to every problem. */
export const INTERVIEW_PROMPTS: readonly InterviewPrompt[] = [
  {
    id: 'scope',
    atMin: 5,
    text: 'Before you draw: which requirements are in scope, and what numbers are you designing for?',
  },
  {
    id: 'read-path',
    atMin: 15,
    text: 'Walk me through one read request end to end. Where does the time go?',
  },
  {
    id: 'growth',
    atMin: 25,
    text: 'Traffic grows 10× overnight. What breaks first, and what do you change?',
  },
  {
    id: 'failure',
    atMin: 32,
    text: 'An availability zone goes down. What happens to reads and writes?',
  },
  {
    id: 'cost',
    atMin: 38,
    text: 'Finance asks you to cut the monthly bill by 30 %. Where would you cut, and what do you give up?',
  },
  {
    id: 'wrap-up',
    atMin: 43,
    text: 'Two minutes left: summarise your design and its main trade-offs.',
  },
];

export interface SelfReviewItem {
  id: string;
  text: string;
}

export const SELF_REVIEW: readonly SelfReviewItem[] = [
  { id: 'clarified', text: 'I clarified requirements and stated assumptions before designing' },
  { id: 'estimated', text: 'I estimated load and storage and used the numbers' },
  { id: 'api-data', text: 'I defined the API and the data model' },
  { id: 'tradeoffs', text: 'I explained the trade-offs of my main choices' },
  { id: 'failures', text: 'I covered failure modes (outages, retries, overload)' },
  { id: 'answered', text: 'I answered every interviewer follow-up' },
];

/** Weights of the scorecard parts (renormalised when the cost part is unknown). */
export const SCORE_WEIGHTS = { rubric: 0.7, cost: 0.15, selfReview: 0.15 } as const;

export interface Scorecard {
  rubric: RubricLine[];
  rubricShare: number;
  /** The design's monthly cost at finish (undefined: no result). */
  costPerMonth: number | undefined;
  referenceCostPerMonth: number | undefined;
  costShare: number | undefined;
  selfReviewShare: number;
  /** 0–100. */
  total: number;
  elapsedMs: number;
  endedBy: 'user' | 'timer';
}

export interface InterviewState {
  /** Undefined until the board has a problem (the clock starts then). */
  startedAtMs?: number;
  elapsedMs: number;
  durationMs: number;
  /** Follow-ups asked so far, oldest first. */
  asked: string[];
  selfReview: string[];
  finished: boolean;
  scorecard?: Scorecard;
}

export function initialInterviewState(ctx: ModeContext): InterviewState {
  return {
    ...(ctx.problem ? { startedAtMs: ctx.nowMs } : {}),
    elapsedMs: 0,
    durationMs: INTERVIEW_DURATION_MS,
    asked: [],
    selfReview: [],
    finished: false,
  };
}

/** Follow-ups due at `elapsedMs`. */
export function promptsDue(elapsedMs: number): string[] {
  return INTERVIEW_PROMPTS.filter((p) => elapsedMs >= p.atMin * 60_000).map((p) => p.id);
}

export function remainingMs(s: InterviewState): number {
  return Math.max(0, s.durationMs - s.elapsedMs);
}

/** "44:59". */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function totalScore(parts: {
  rubricShare: number;
  costShare: number | undefined;
  selfReviewShare: number;
}): number {
  const w = SCORE_WEIGHTS;
  const weight = w.rubric + w.selfReview + (parts.costShare === undefined ? 0 : w.cost);
  const sum =
    w.rubric * parts.rubricShare +
    w.selfReview * parts.selfReviewShare +
    (parts.costShare === undefined ? 0 : w.cost * parts.costShare);
  return Math.round((100 * sum) / weight);
}

/** Judge the board as it is now. */
export function buildScorecard(
  state: InterviewState,
  ctx: ModeContext,
  endedBy: Scorecard['endedBy'],
): Scorecard {
  const rubric = ctx.problem
    ? judgeRubric(ctx.registry, ctx.problem, ctx.graph, ctx.scenario, ctx.result)
    : [];
  const share = rubricShare(rubric);
  const costPerMonth = ctx.result?.system.costPerMonth;
  const selfReviewShare = state.selfReview.length / SELF_REVIEW.length;
  const cs = costShare(costPerMonth, undefined);
  return {
    rubric,
    rubricShare: share,
    costPerMonth,
    referenceCostPerMonth: undefined,
    costShare: cs,
    selfReviewShare,
    total: totalScore({ rubricShare: share, costShare: cs, selfReviewShare }),
    elapsedMs: state.elapsedMs,
    endedBy,
  };
}

/** Re-total a frozen scorecard after the self-review or the reference cost changed. */
export function retotal(
  card: Scorecard,
  patch: { selfReviewShare?: number; referenceCostPerMonth?: number },
): Scorecard {
  const referenceCostPerMonth = patch.referenceCostPerMonth ?? card.referenceCostPerMonth;
  const selfReviewShare = patch.selfReviewShare ?? card.selfReviewShare;
  const cs = costShare(card.costPerMonth, referenceCostPerMonth);
  return {
    ...card,
    referenceCostPerMonth,
    selfReviewShare,
    costShare: cs,
    total: totalScore({ rubricShare: card.rubricShare, costShare: cs, selfReviewShare }),
  };
}
