# problems

Problem library UI and the reference-solution loader.

- **Depends on:** `registry`, `store` · **Built in:** S17
- **Rules:** Problem content lives in registry/problems; this module only presents it.

## Public API (index.ts)

- Library (`library.ts`, pure): `listProblems(registry)` (easiest first), `findProblem`, `filterProblems` / `matchesFilter` (`{ level?, tag?, company?, query? }`), `problemFacets` (levels, topic tags and companies with counts), `companyStyles` / `topicTags` (`company:<id>` tags vs topics), `companyLabel`, `LEVEL_LABELS`, `formatCount`, `formatBytes`, `formatReadWrite`, `presetPeakRps`, `rubricLines`.
- Starting: `modeOptions(problem)` (guided, interview, sandbox, debug, chaos; each with allowed starts and a `disabledReason`), `START_LABELS`, `hintsAllowed(mode)` (false in interview), `blankScenario` (preset with flow paths cleared), `problemBoard(problem, { mode, start, variant?, providerId?, name?, boardId? }, projectId)` → `{ board, layout }`, `startProblem(workspaceStore, problem, opts, projectId?)` (adds via `importBoards` and opens it), `referenceCommand` / `loadReferenceSolution(boardStore, problem)` (one undo step: `replaceGraph` + scenario preset).
- UI: `ProblemsButton` (top-bar button + `ProblemBrowser` dialog), `ProblemBriefButton` (only on a problem board: requirements, scale, rubric, hints one at a time, "Load reference solution"; hints/reference hidden in Interview), `ProblemBrowser`, `ProblemBrief`, `ProblemDetails`, `useActiveProblem`. Notices go to an `onNotice({ kind, text })` callback.

## Extension points

- New problem = a folder `registry/problems/<id>/index.ts` (use `registry/problems/kit.ts`); it appears in the browser with no other edits. Tag company styles as `company:<id>`; add a label in `COMPANY_NAMES` for a pretty name (optional).
