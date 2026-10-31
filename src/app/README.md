# app

Composition root: app shell layout, routing, theme, keyboard shortcuts.

- **Depends on:** any module (composition root)
- **Rules:** Wires modules together; contains no domain logic.
- **Built in:** session S01 (canvas wired in S04, workspace UI + saving S06, simulation + metrics S08)

## Public API (index.ts)

- `AppShell({ autosave?, simulate? })` — project sidebar, palette, board tabs + canvas, inspector, metrics drawer; save status + Ctrl/Cmd+S when `autosave` is given; `simulate` (default true) keeps the open board simulated.

## Layout

- main.tsx — browser entry: `openWorkspace` (IndexedDB, migrations) before first render, flush on hide
- workspace/ — ProjectSidebar, BoardTabs, SnapshotsPanel, SaveStatus, Menu/InlineEdit, notices, file download/upload
- simulation/ — `startSimulationRunner` (engine ↔ store: debounced 300 ms on graph/scenario/provider change, immediate on board switch or Run, stale runs dropped) + `useSimulationRunner`
- index.css — Tailwind entry + global styles
- layout/ — AppShell (top bar, palette, canvas, inspector, metrics drawer)

## Extension points

- Panels are filled by mounting module components into the shell regions.
