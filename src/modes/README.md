# modes

Sandbox / Guided / Interview / Debug / Chaos / Learn controllers, their panels and local progress.

- **Depends on:** `store`, `registry`, `engine` · **Built in:** S18
- **Rules:** A mode is a `ModeController` (pure hooks `onEnter`, `onGraphChange`, `onSimResult`, `onTick?`, `onAction?`, `isComplete`, `score?`, `subject?`, `needsReferenceCost?`) over its own session state. Controllers never touch stores; the runner does.

## Public API (index.ts)

- Contract: `defineMode`, `ModeController`, `ModeContext` (board graph/scenario, problem, result, registry, `nowMs`), `ModeAction`, `ModeSubject`; registry `modes` (`list`/`get`/`require`), `createModeRegistry`, `modeLabel`.
- Runtime: `createModeStore` (session of the open board + `act`), `startModeRunner({ workspaceStore, boardStore, simulationStore, modeStore, progressStore, registry, modes, run?, now?, tickMs? })`; React `ModesProvider`, `useModeRunner`, `useModeStore(Api)`, `useProgressStore(Api)`, `useModeContext`.
- Board actions (store API only): `setBoardMode`, `setBoardProblem`, `attachProblem` (scenario fitted to the design via `fitScenario`, one undo step), `loadDebugCase`, `loadLessonBoard`.
- Judging: `sloValue`, `checkSlo`, `checkProblemSlos`, `judgeRubric`, `rubricShare`, `costShare`, `runRules`, `scenarioPeakRps`.
- Guided: `GUIDED_STEPS` (7 cards), `guidedSteps(state, ctx)`, `apiEndpoints`, `entities`, `guidedScore`.
- Interview: `INTERVIEW_DURATION_MS` (45 min), `INTERVIEW_PROMPTS` (follow-ups as data), `SELF_REVIEW`, `buildScorecard`, `totalScore` (70 % rubric, 15 % cost vs reference, 15 % self-review), `formatClock`.
- Debug: `debugCases`, `findDebugCase`, `matchVariant`, `loadVariantCommand`, `debugStatus` (symptoms; healthy = `fixedWhenRulesPass` rules pass + every rubric SLO holds), `debugHints`, `variantChanges`, `debugScore`.
- Chaos: `CHAOS_PRESETS` (kill AZ, region outage, spike ×3, 5 % loss), `injectCommand`, `chaosTargets`, `chaosVerdict`. Learn: `listLessons`, `gradeQuiz` (2/3 to pass), `lessonBoardCommand`.
- Progress: `createProgressStore(storage?)` (localStorage key `sysdraw.progress`, `schemaVersion` 1, `PROGRESS_MIGRATIONS`), `parseProgress`, `progressSummary`, `formatDuration`, `MIN_ATTEMPT_MS`.
- UI: `ModeSwitcher` (top bar, `data-testid="board-mode"`), `ModePanel` (beside the canvas; none in Sandbox), `ProgressButton` / `ProgressPage`, `LessonPlayer`, `MiniBoard`.

## Extension points

- New mode = `controllers/<id>.ts` default-exporting `defineMode({...})` (auto-discovered) + its id in core `MODE_IDS` + a case in `ui/ModePanel.tsx` for its panel.
- New broken design = a `debugVariants` entry on a problem; new lesson = `registry/lessons/<id>.ts`; new interviewer follow-up / chaos preset = one array item.
