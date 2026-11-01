/** Debug: a broken design with symptoms in the metrics; fixed when its rules and SLOs pass. */
import { defineMode } from '../define';
import { debugHints, debugScore, debugStatus, findDebugCase, matchVariant } from '../debug';
import type { ModeContext } from '../types';

export interface DebugState {
  problemId?: string;
  variantId?: string;
  /** The result in context predates the latest graph change. */
  stale: boolean;
  /** A fresh result showed the design broken (so "fixed" means the user fixed it). */
  sawBroken: boolean;
  hintsUsed: number;
  fixedAtMs?: number;
}

function evaluate(state: DebugState, ctx: ModeContext): DebugState {
  if (state.stale || state.fixedAtMs !== undefined) return state;
  const c = findDebugCase(ctx.registry, state.problemId, state.variantId);
  if (!c || !ctx.result) return state;
  const healthy = debugStatus(c, ctx).healthy;
  if (!healthy) return state.sawBroken ? state : { ...state, sawBroken: true };
  return state.sawBroken ? { ...state, fixedAtMs: ctx.nowMs } : state;
}

export default defineMode<DebugState>({
  id: 'debug',
  label: 'Debug',
  description: 'A broken design with hidden faults: read the symptoms, find the cause, fix it.',
  help: 'Symptoms only; hints cost points',
  success: 'Faults fixed and SLOs restored',
  order: 3,
  hintsAllowed: false,
  wantsProblem: true,
  onEnter(ctx) {
    const v = matchVariant(ctx.problem, ctx.graph);
    return {
      ...(v && ctx.problem ? { problemId: ctx.problem.id, variantId: v.id } : {}),
      // The board may still show the previous graph's result until the next run.
      stale: true,
      sawBroken: false,
      hintsUsed: 0,
    };
  },
  onGraphChange: (s) => (s.fixedAtMs === undefined ? { ...s, stale: true } : s),
  onSimResult: (s, ctx) => evaluate({ ...s, stale: false }, ctx),
  onAction(state, action, ctx) {
    switch (action.type) {
      case 'loaded':
        return {
          problemId: String(action.problemId),
          variantId: String(action.variantId),
          stale: true,
          sawBroken: false,
          hintsUsed: 0,
        };
      case 'hint': {
        const c = findDebugCase(ctx.registry, state.problemId, state.variantId);
        const max = c ? debugHints(c, ctx.registry).length : 0;
        return { ...state, hintsUsed: Math.min(max, state.hintsUsed + 1) };
      }
      default:
        return state;
    }
  },
  isComplete: (s) => s.fixedAtMs !== undefined,
  score: (s) => (s.fixedAtMs !== undefined ? debugScore(s.hintsUsed) : undefined),
  subject(s, ctx) {
    const c = findDebugCase(ctx.registry, s.problemId, s.variantId);
    return c ? { kind: 'problem', id: c.problem.id, title: c.problem.title } : undefined;
  },
});
