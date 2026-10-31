# store

Board state (Zustand + Immer), the command bus (every edit is an undoable command) and selection.

- **Depends on:** `core`, `registry` · **Built in:** S04 (workspace/projects/snapshots: S06)
- **Rules:** The only place board state is mutated. UI dispatches commands; never edits `doc` directly.

## Public API (index.ts)

- `createBoardStore({ registry, newId?, historyLimit?, initial? })` → vanilla Zustand store of `BoardState`:
  `doc` (`{ providerId, graph, layout: { groupFrames }, scenario }`), `selection`, `past`/`future`, `clipboard`, `lastError`;
  `dispatch(cmd)` → `{ok} | {ok:false, reason}`, `undo`, `redo`, `setSelection`, `copy`, `cut`, `paste`, `deleteSelection`, `clearError`, `load(doc)`.
- `BoardCommand` (plain data): `updateNode` (label, scaling incl. `autoscale: null`), `updateEdge` (protocolStack, sync, config with `null` = clear), `updateGroup` (label, kind, regionId, security; `null` clears), `updateScenario` (shallow patch) — all S05 — plus `addNode`, `moveNodes` (+ `groupId` to re-parent, `null` to leave a group), `moveGroup` (dx/dy, carries contents), `connect`, `delete` (groups delete their contents), `updateConfig` (validated by the component's `configSchema`), `group` / `ungroup`, `setGroupFrame`, `insert` (paste), `batch` (one undo step).
- `checkConnection(registry, graph, req)` — port-direction + shared-protocol check with a readable reason; `defaultProtocolStack`, `rankProtocols`.
- Protocol stacks (S05): `protocolStackOptions(registry, protocol)`, `edgeSharedProtocols`, `edgeProtocolStackOptions(registry, graph, edge)`, `checkProtocolStack(...)` → reason | null.
- `defaultScenario()`, `emptyBoardDoc()`, `extractSubgraph`, `cloneSubgraph`, `descendantsOf`, `commandLabel`, `groupKindLabel`, `applyCommand`, `CommandError`.
- Workspace (S06): `createWorkspaceStore({ boardStore, newId?, now?, initial? })` → `data` (`WorkspaceData`: settings, projects in sidebar order, `boards` by id, `layouts` by id), `activeBoardId`, `lastError`; actions `replace`, `openBoard`, `openProject`, create/rename/duplicate/delete/move for projects and boards, `saveSnapshot`/`restoreSnapshot`/`deleteSnapshot`, `importBoards`/`importProjects` → `{ok, …} | {ok:false, reason}`. It loads the open board into the board store and mirrors every board edit back; undo history is kept per board. Pure ops + `graphDiff`, `uniqueName`, `normalizeWorkspace`, `emptyWorkspaceData` in workspace.ts. Command `replaceGraph` (snapshot restore). `delete`/`replaceGraph` drop scenario refs to removed items.
- React: `boardStore` + `workspaceStore` (app instances), `createAppStores()` (fresh pair on the app registry), `useBoardStore`, `useBoardStoreApi`, `useWorkspaceStore`, `useWorkspaceStoreApi`, `<BoardStoreProvider>`, `<WorkspaceStoreProvider>`.
- Re-exports core graph types for UI modules that may not import core: `Graph`, `NodeInstance`, `EdgeInstance`, `Group`, `GroupKind`, `GROUP_KINDS`, `Position`, `ProviderId`; and (S05, for inspector forms) `NodeScalingSchema`, `AutoscaleSchema`, `EdgeConfigSchema`, `GroupSchema`, `FirewallRuleSchema`, `ScenarioSchema` + their types.

## Notes

- Undo/redo = Immer patches + inverse patches per command; history capped at 200. Selection is not in history.
- All positions and group frames are absolute canvas coordinates.
- `layout.groupFrames` is view state core has no field for; persistence saves it next to the board (`WorkspaceData.layouts`).
- `doc.scenario` is the board's Scenario (core `Board.scenario`); `load()` defaults it with `defaultScenario()`.

## Extension points

- New edit = new `BoardCommand` variant + a case in `applyCommand` (+ `commandLabel`); inverse is automatic.
