# store

Workspace / project / board state (Zustand + Immer), the command bus (every edit is an undoable command), and selection.

- **Depends on:** `core`, `registry`
- **Rules:** The only place UI state is mutated. Sends frozen board snapshots to the engine.
- **Built in:** session S04

## Public API (index.ts)

- _Empty — scaffold only._

## Extension points

- New edit = new command type with an inverse.
