/** Learn: short lessons with a mini-board to try the concept; success = the quiz is passed. */
import { defineMode } from '../define';
import { gradeQuiz } from '../learn';
import type { Lesson, ModeContext } from '../types';

export interface LearnState {
  lessonId?: string;
  step: number;
  answers: (number | null)[];
  submitted: boolean;
  passedAtMs?: number;
  score?: number;
}

const lessonOf = (s: LearnState, ctx: ModeContext): Lesson | undefined =>
  s.lessonId ? ctx.registry.get(s.lessonId, 'lesson') : undefined;

export default defineMode<LearnState>({
  id: 'learn',
  label: 'Learn',
  description:
    'Short concept lessons (consistent hashing, CAP, TLS, Kafka, caching) with a mini-board.',
  help: 'Step-by-step explanation',
  success: 'Lesson quiz passed',
  order: 5,
  hintsAllowed: true,
  wantsProblem: false,
  onEnter: () => ({ step: 0, answers: [], submitted: false }),
  onGraphChange: (s) => s,
  onSimResult: (s) => s,
  onAction(state, action, ctx) {
    switch (action.type) {
      case 'open': {
        const lesson = ctx.registry.get(String(action.lessonId), 'lesson');
        if (!lesson) return state;
        return {
          lessonId: lesson.id,
          step: 0,
          answers: lesson.quiz.map(() => null),
          submitted: false,
        };
      }
      case 'close':
        return { step: 0, answers: [], submitted: false };
      case 'goto': {
        const lesson = lessonOf(state, ctx);
        if (!lesson) return state;
        // Steps 0…n-1 are the lesson, n is the quiz.
        const step = Math.max(0, Math.min(lesson.steps.length, Number(action.step)));
        return { ...state, step };
      }
      case 'answer': {
        if (state.submitted && state.passedAtMs !== undefined) return state;
        const answers = [...state.answers];
        answers[Number(action.question)] = Number(action.option);
        return { ...state, answers, submitted: false };
      }
      case 'submit': {
        const lesson = lessonOf(state, ctx);
        if (!lesson) return state;
        const g = gradeQuiz(lesson, state.answers);
        const score = Math.round((100 * g.correct) / Math.max(1, g.total));
        return {
          ...state,
          submitted: true,
          score: Math.max(state.score ?? 0, score),
          ...(g.passed && state.passedAtMs === undefined ? { passedAtMs: ctx.nowMs } : {}),
        };
      }
      case 'retry': {
        const lesson = lessonOf(state, ctx);
        return lesson
          ? { ...state, answers: lesson.quiz.map(() => null), submitted: false }
          : state;
      }
      default:
        return state;
    }
  },
  isComplete: (s) => s.passedAtMs !== undefined,
  score: (s) => s.score,
  subject(s, ctx) {
    const l = lessonOf(s, ctx);
    return l ? { kind: 'lesson', id: l.id, title: l.title } : undefined;
  },
});
