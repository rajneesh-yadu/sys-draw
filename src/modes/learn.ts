/** Learn mode logic (pure): lesson list, quiz grading, loading a lesson's mini-board. */
import type { Registry } from '@/registry';
import type { BoardCommand } from '@/store';
import type { Lesson } from './types';

/** Share of quiz answers that must be right to pass. */
export const QUIZ_PASS_RATIO = 2 / 3;

export function listLessons(registry: Registry): Lesson[] {
  return registry
    .list({ kind: 'lesson' })
    .slice()
    .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
}

export interface QuizGrade {
  correct: number;
  total: number;
  passed: boolean;
  /** Per question: answered right? (null = unanswered) */
  perQuestion: (boolean | null)[];
}

export function gradeQuiz(lesson: Lesson, answers: readonly (number | null)[]): QuizGrade {
  const perQuestion = lesson.quiz.map((q, i) => {
    const a = answers[i];
    return a === null || a === undefined ? null : a === q.answerIndex;
  });
  const correct = perQuestion.filter((x) => x === true).length;
  const total = lesson.quiz.length;
  return {
    correct,
    total,
    passed: total > 0 && correct / total >= QUIZ_PASS_RATIO - 1e-9,
    perQuestion,
  };
}

/** One undo step: replace the board with the lesson's mini-board. */
export function lessonBoardCommand(lesson: Lesson): BoardCommand | undefined {
  if (!lesson.board) return undefined;
  return {
    type: 'replaceGraph',
    graph: structuredClone(lesson.board),
    label: `Lesson board: ${lesson.title}`,
  };
}
