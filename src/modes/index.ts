/**
 * modes — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md. Implemented in S18.
 */
export {
  type AnyModeController,
  type Lesson,
  type ModeAction,
  type ModeContext,
  type ModeController,
  type ModeId,
  type ModeSubject,
  type Problem,
} from './types';
export { defineMode, ModeDefinitionError } from './define';
export {
  createModeRegistry,
  modes,
  modeLabel,
  ModeRegistryError,
  type ModeRegistry,
} from './registry';
export {
  createModeStore,
  type ModeSession,
  type ModeStore,
  type ModeStoreState,
} from './mode-store';
export { startModeRunner, type ModeRunner, type ModeRunnerDeps } from './runner';
export {
  attachProblem,
  fitScenario,
  loadDebugCase,
  loadLessonBoard,
  setBoardMode,
  setBoardProblem,
  type ActionResult,
} from './board-actions';
export {
  checkProblemSlos,
  checkSlo,
  costShare,
  formatSloValue,
  holds,
  judgeRubric,
  rubricShare,
  runRules,
  scenarioPeakRps,
  sloLabel,
  sloValue,
  type RubricLine,
  type SloCheck,
} from './evaluate';
export {
  GUIDED_STEPS,
  GUIDED_STEP_IDS,
  apiEndpoints,
  entities,
  guidedScore,
  guidedSteps,
  type GuidedState,
  type GuidedStepId,
  type GuidedStepResult,
} from './guided';
export {
  INTERVIEW_DURATION_MS,
  INTERVIEW_PROMPTS,
  SELF_REVIEW,
  buildScorecard,
  formatClock,
  remainingMs,
  totalScore,
  type InterviewState,
  type Scorecard,
} from './interview';
export {
  debugCases,
  debugHints,
  debugScore,
  debugStatus,
  findDebugCase,
  loadVariantCommand,
  matchVariant,
  variantChanges,
  type DebugCase,
  type DebugStatus,
} from './debug';
export {
  CHAOS_PRESETS,
  chaosTargets,
  chaosVerdict,
  injectCommand,
  type ChaosVerdict,
} from './chaos';
export { QUIZ_PASS_RATIO, gradeQuiz, lessonBoardCommand, listLessons } from './learn';
export {
  MIN_ATTEMPT_MS,
  PROGRESS_SCHEMA_VERSION,
  PROGRESS_STORAGE_KEY,
  browserProgressStorage,
  createProgressStore,
  formatDuration,
  memoryProgressStorage,
  parseProgress,
  progressSummary,
  type Attempt,
  type ProgressStorage,
  type ProgressStore,
  type SubjectProgress,
} from './progress';

// UI (React)
export { ModesProvider } from './ui/ModesProvider';
export {
  useModeContext,
  useModeRunner,
  useModeStore,
  useModeStoreApi,
  useProgressStore,
  useProgressStoreApi,
} from './ui/context';
export { ModeSwitcher } from './ui/ModeSwitcher';
export { ModePanel, type ModeNotice } from './ui/ModePanel';
export { ProgressButton, ProgressPage } from './ui/ProgressPage';
export { MiniBoard } from './ui/MiniBoard';
export { LessonPlayer } from './ui/LearnPanel';
