/** Guided: step cards from requirements to bottlenecks; each card's checks must pass. */
import { defineMode } from '../define';
import {
  GUIDED_STEPS,
  guidedScore,
  guidedSteps,
  initialGuidedState,
  type GuidedState,
  type GuidedStepId,
} from '../guided';
import type { ModeContext } from '../types';

function latch(state: GuidedState, ctx: ModeContext): GuidedState {
  if (state.completedAtMs !== undefined) return state;
  return guidedSteps(state, ctx).every((s) => s.passed)
    ? { ...state, completedAtMs: ctx.nowMs }
    : state;
}

export default defineMode<GuidedState>({
  id: 'guided',
  label: 'Guided',
  description:
    'Step by step: requirements → estimates → API → data model → design → scale → bottlenecks.',
  help: 'Next-step card, hints on request, “why” explanations',
  success: 'Each step’s checks pass',
  order: 1,
  hintsAllowed: true,
  wantsProblem: true,
  onEnter: (ctx) => latch(initialGuidedState(), ctx),
  onGraphChange: latch,
  onSimResult: latch,
  onAction(state, action, ctx) {
    let next = state;
    switch (action.type) {
      case 'goto': {
        const step = Math.max(0, Math.min(GUIDED_STEPS.length - 1, Number(action.step)));
        next = { ...state, step };
        break;
      }
      case 'toggleRequirement': {
        const text = String(action.text);
        next = {
          ...state,
          checked: state.checked.includes(text)
            ? state.checked.filter((t) => t !== text)
            : [...state.checked, text],
        };
        break;
      }
      case 'setNote':
        next = {
          ...state,
          notes: { ...state.notes, [action.step as GuidedStepId]: String(action.text ?? '') },
        };
        break;
      case 'setEstimate': {
        const field = action.field === 'storageBytes' ? 'storageBytes' : 'peakRps';
        const v = Number(action.value);
        const estimates = { ...state.estimates };
        if (Number.isFinite(v) && v > 0) estimates[field] = v;
        else delete estimates[field];
        next = { ...state, estimates };
        break;
      }
      case 'hint':
        next = {
          ...state,
          hintsShown: Math.min(ctx.problem?.hints.length ?? 0, state.hintsShown + 1),
        };
        break;
    }
    return latch(next, ctx);
  },
  isComplete: (state) => state.completedAtMs !== undefined,
  score: (state) => (state.completedAtMs !== undefined ? guidedScore(state) : undefined),
});
