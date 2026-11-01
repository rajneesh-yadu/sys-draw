/** Chaos: inject failures into the time-series run; success = availability and p99 within targets. */
import { chaosScore, chaosVerdict } from '../chaos';
import { defineMode } from '../define';
import type { ModeContext } from '../types';

export interface ChaosState {
  passedAtMs?: number;
  /** Best score of an experiment so far. */
  best?: number;
}

function judge(state: ChaosState, ctx: ModeContext): ChaosState {
  const v = chaosVerdict(ctx);
  if (v.events === 0 || !ctx.result?.timeline?.length) return state;
  const score = chaosScore(v);
  const best = Math.max(state.best ?? 0, score);
  return {
    ...state,
    best,
    ...(v.passed && state.passedAtMs === undefined ? { passedAtMs: ctx.nowMs } : {}),
  };
}

export default defineMode<ChaosState>({
  id: 'chaos',
  label: 'Chaos',
  description: 'Run a timeline and inject failures: kill an AZ, spike traffic, drop packets.',
  help: 'Timeline of events and recovery',
  success: 'Availability and p99 stay within targets',
  order: 4,
  hintsAllowed: true,
  wantsProblem: false,
  onEnter: () => ({}),
  onGraphChange: (s) => s,
  onSimResult: judge,
  isComplete: (s) => s.passedAtMs !== undefined,
  score: (s) => s.best,
});
