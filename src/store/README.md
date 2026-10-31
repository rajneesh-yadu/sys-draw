# store

Board state (Zustand + Immer), the command bus (every edit is an undoable command) and selection.

- **Depends on:** `core`, `registry` · **Built in:** S04 (workspace/projects: S06)
- **Rules:** The only place board state is mutated. UI dispatches commands; never edits `doc` directly.

## Public API (index.ts)

- `createBoardStore({ registry, newId?, historyLimit?, initial? })` → vanilla Zustand store of `BoardState`:
  `doc` (`{ providerId, graph, layout: { groupFrames } }`), `selection`, `past`/`future`, `clipboard`, `lastError`;
  `dispatch(cmd)` → `{ok} | {ok:false, reason}`, `undo`, `redo`, `setSelection`, `copy`, `cut`, `paste`, `deleteSelection`, `clearError`, `load(doc)`.
- `BoardCommand` (plain data): `addNode`, `moveNodes` (+ `groupId` to re-parent, `null` to leave a group), `moveGroup` (dx/dy, carries contents), `connect`, `delete` (groups delete their contents), `updateConfig` (validated by the component's `configSchema`), `group` / `ungroup`, `setGroupFrame`, `insert` (paste), `batch` (one undo step).
- `checkConnection(registry, graph, req)` — port-direction + shared-protocol check with a readable reason; `defaultProtocolStack`, `rankProtocols`.
- `extractSubgraph`, `cloneSubgraph`, `descendantsOf`, `commandLabel`, `groupKindLabel`, `applyCommand`, `CommandError`.
- React: `boardStore` (app instance), `useBoardStore(selector)`, `useBoardStoreApi()`, `<BoardStoreProvider store>`.
- Re-exports core graph types for UI modules that may not import core: `Graph`, `NodeInstance`, `EdgeInstance`, `Group`, `GroupKind`, `GROUP_KINDS`, `Position`, `ProviderId`.

## Notes

- Undo/redo = Immer patches + inverse patches per command; history capped at 200. Selection is not in history.
- All positions and group frames are absolute canvas coordinates.
- `layout.groupFrames` is view state core has no field for yet, so it is not saved (see PROGRESS.md S04).

## Extension points

- New edit = new `BoardCommand` variant + a case in `applyCommand` (+ `commandLabel`); inverse is automatic.
