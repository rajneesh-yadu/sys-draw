# app

Composition root: app shell layout, routing, theme, keyboard shortcuts.

- **Depends on:** any module (composition root)
- **Rules:** Wires modules together; contains no domain logic.
- **Built in:** session S01 (canvas wired in S04, workspace UI + saving S06, simulation + metrics S08, provider switcher S12, UX polish S21, workspace space S24)

## Public API (index.ts)

- `AppShell({ autosave?, simulate?, uiStore? })` — project sidebar, palette, board tabs + canvas, inspector, metrics drawer; save status + Ctrl/Cmd+S when `autosave` is given; `simulate` (default true) keeps the open board simulated; `uiStore` (tests) = S21 UI prefs.

## Layout

- main.tsx — browser entry: `openWorkspace` (IndexedDB, migrations) before first render, flush on hide
- workspace/ — ProjectSidebar, BoardTabs, SnapshotsPanel, SaveStatus, Menu/InlineEdit, notices, file download/upload, ProviderSwitcher (S12: top-bar picker; reviews `planProviderSwitch` then dispatches `setProvider`)
- trace/ — `startTraceRunner` (engine `runTrace` ↔ canvas trace store while the panel is open: at once on request changes, 300 ms after board edits, stale runs dropped; `toTraceView`) + `useTraceRunner`; AppShell creates the trace store and mounts `<TracePanel />` beside the canvas (S15)
- security/ — `startSecurityRunner` (S16: security `reviewSecurity` + `securityOverlay` → canvas security store on every graph/scenario change; registers the fix handler) + `useSecurityRunner`; `planToCommands` maps a `FixPlan` to board commands (new ids, moved nodes placed beside their old group), `applySecurityFix` dispatches it as one `batch`; AppShell mounts `<SecurityPanel />`
- review/ — `startReviewRunner` (S19: engine `reviewDesign` over the open board + its latest result — a result of another board is ignored — → canvas review store on graph/scenario/result change; fix handler = `designFix` → `planToCommands` → one `batch`) + `useReviewRunner`; `planToCommands` also maps the S19 steps `setNodeConfig`/`setNodeScaling`/`setEdgeConfig` → `updateConfig`/`updateNode`/`updateEdge`; AppShell mounts `<FindingsPanel />`
- estimator/ — S20: `EstimatorTopBarButton` (estimator `EstimatorButton` fed the open board's scenario; push = `pushEstimateToBoard` → one `updateScenario` undo step + a notice); mounted in the top bar
- simulation/ — `startSimulationRunner` (engine ↔ store: debounced 300 ms on graph/scenario/provider change, immediate on board switch or Run, stale runs dropped) + `useSimulationRunner`
- index.css — Tailwind entry + global styles
- layout/ — AppShell (top bar, palette, canvas, inspector, metrics drawer); S21: `ErrorBoundary` around every region (reset on board switch), Projects/Palette collapse into a left rail (Ctrl/⌘+B); S24: Inspector collapses into a right rail (focus moves to the restore button and back), minimap visibility and trace width passed to canvas
- ui/ — S21: `createUiStore` (localStorage `sysdraw.ui`, schemaVersion 1: theme, collapsed panels, metrics size; S24 adds `inspectorCollapsed`, `minimapVisible`, `traceWidthPx`, `traceExpanded` with Zod defaults so older prefs still load; palette/sheet open state), theme (`dark` class on <html>, set pre-paint in index.html)
- commands/ — S21: `buildCommands` (data: actions + one "Add <component>" per registry entry + "Go to <board>") → `CommandPalette` (Ctrl/⌘+K, `rankCommands`); `shortcutSheet()` + `ShortcutSheet` ("?"); S24 panel commands for Inspector, minimap, trace width; `appShortcutFor`
- perf/ — S21: 300-node fixture (`perfFixtureCommand`, `loadPerfFixture`; `?fixture=perf-300`)

## Extension points

- Panels are filled by mounting module components into the shell regions.
