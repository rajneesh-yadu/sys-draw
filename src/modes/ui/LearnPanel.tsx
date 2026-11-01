/** Learn: lesson list → lesson player (steps + mini-board) → quiz. */
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBoardStoreApi } from '@/store';
import { loadLessonBoard } from '../board-actions';
import type { LearnState } from '../controllers/learn';
import { gradeQuiz, listLessons, QUIZ_PASS_RATIO } from '../learn';
import type { Lesson, ModeAction, ModeContext } from '../types';
import { MiniBoard } from './MiniBoard';
import { badText, banner, button, okText, primary, sectionTitle } from './styles';

export function LearnPanel({
  state,
  ctx,
  act,
  onError,
}: {
  state: LearnState;
  ctx: ModeContext;
  act: (a: ModeAction) => void;
  onError: (msg: string) => void;
}) {
  const lesson = state.lessonId ? ctx.registry.get(state.lessonId, 'lesson') : undefined;
  if (!lesson) {
    return (
      <div className="space-y-2" data-testid="learn-panel">
        <h3 className={sectionTitle}>Lessons</h3>
        <ul className="space-y-1.5" aria-label="Lessons">
          {listLessons(ctx.registry).map((l) => (
            <li key={l.id}>
              <button
                type="button"
                data-testid={`lesson-${l.id}`}
                onClick={() => act({ type: 'open', lessonId: l.id })}
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <BookOpen className="h-3.5 w-3.5" aria-hidden /> {l.title}
                  <span className="ml-auto text-[10px] text-slate-500 dark:text-slate-400">
                    L{l.level}
                  </span>
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {l.docs.summary}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <LessonPlayer lesson={lesson} state={state} act={act} onError={onError} />;
}

export function LessonPlayer({
  lesson,
  state,
  act,
  onError,
}: {
  lesson: Lesson;
  state: LearnState;
  act: (a: ModeAction) => void;
  onError: (msg: string) => void;
}) {
  const board = useBoardStoreApi();
  const n = lesson.steps.length;
  const step = Math.min(state.step, n);
  const inQuiz = step === n;
  const current = lesson.steps[step];
  return (
    <div className="space-y-3" data-testid="lesson-player">
      <div className="flex items-center gap-2">
        <button type="button" className={button} onClick={() => act({ type: 'close' })}>
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Lessons
        </button>
        <h3 className="text-sm font-semibold">{lesson.title}</h3>
      </div>
      {state.passedAtMs !== undefined && (
        <p className={banner} role="status" data-testid="lesson-passed">
          Quiz passed — score {state.score}.
        </p>
      )}
      {lesson.board && (
        <div className="space-y-1">
          <MiniBoard graph={lesson.board} focusIds={inQuiz ? [] : (current?.focusIds ?? [])} />
          <button
            type="button"
            className={button}
            onClick={() => {
              const res = loadLessonBoard(board, lesson);
              if (!res.ok) onError(res.reason);
            }}
          >
            Try it on the board (replaces the design; undo with Ctrl+Z)
          </button>
        </div>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
        {inQuiz ? 'Quiz' : `Step ${step + 1} of ${n}`}
      </p>
      {!inQuiz && current ? (
        <section aria-label={current.title} className="space-y-1">
          <h4 className="text-sm font-medium">{current.title}</h4>
          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            {current.body}
          </p>
        </section>
      ) : (
        <Quiz lesson={lesson} state={state} act={act} />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={button}
          disabled={step === 0}
          onClick={() => act({ type: 'goto', step: step - 1 })}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Back
        </button>
        {!inQuiz && (
          <button
            type="button"
            className={primary}
            onClick={() => act({ type: 'goto', step: step + 1 })}
          >
            {step === n - 1 ? 'Take the quiz' : 'Next'}{' '}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function Quiz({
  lesson,
  state,
  act,
}: {
  lesson: Lesson;
  state: LearnState;
  act: (a: ModeAction) => void;
}) {
  const grade = gradeQuiz(lesson, state.answers);
  const need = Math.ceil(QUIZ_PASS_RATIO * lesson.quiz.length - 1e-9);
  return (
    <section className="space-y-3" aria-label="Quiz" data-testid="lesson-quiz">
      {lesson.quiz.map((q, qi) => {
        const verdict = state.submitted ? grade.perQuestion[qi] : null;
        return (
          <fieldset key={q.question} className="space-y-1">
            <legend className="text-xs font-medium">
              {qi + 1}. {q.question}
            </legend>
            {q.options.map((o, oi) => (
              <label key={o} className="flex items-start gap-1.5 text-xs">
                <input
                  type="radio"
                  name={`q-${lesson.id}-${qi}`}
                  className="mt-0.5"
                  checked={state.answers[qi] === oi}
                  onChange={() => act({ type: 'answer', question: qi, option: oi })}
                />
                {o}
              </label>
            ))}
            {verdict !== null && (
              <p className={`text-xs ${verdict ? okText : badText}`}>
                {verdict ? 'Right. ' : 'Not quite. '}
                {q.explanation}
              </p>
            )}
          </fieldset>
        );
      })}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={primary}
          disabled={state.answers.some((a) => a === null || a === undefined)}
          onClick={() => act({ type: 'submit' })}
        >
          Check answers
        </button>
        {state.submitted && (
          <span className="text-xs" data-testid="quiz-result">
            {grade.correct} / {grade.total} right —{' '}
            {grade.passed ? 'passed' : `need ${need} to pass`}
          </span>
        )}
        {state.submitted && !grade.passed && (
          <button type="button" className={button} onClick={() => act({ type: 'retry' })}>
            Try again
          </button>
        )}
      </div>
    </section>
  );
}
