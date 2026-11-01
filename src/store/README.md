# store

Board state (Zustand + Immer), the command bus (every edit is an undoable command) and selection.

- **Depends on:** `core`, `registry` · **Built in:** S04 (workspace/projects/snapshots: S06, simulation results: S08, playback: S11)
- **Rules:** The only place board state is mutated. UI dispatches commands; never edits `doc` directly.

## Public API (index.ts)

- `createBoardStore({ registry, newId?, historyLimit?, initial? })` → vanilla Zustand store of `BoardState`:
  `doc` (`{ providerId, graph, layout: { groupFrames }, scenario }`), `selection`, `past`/`future`, `clipboard`, `lastError`;
  `dispatch(cmd)` → `{ok} | {ok:false, reason}`, `undo`, `redo`, `setSelection`, `copy`, `cut`, `paste`, `deleteSelection`, `clearError`, `load(doc)`.
- `BoardCommand` (plain data): `updateNode` (label, scaling incl. `autoscale: null`), `updateEdge` (protocolStack, sync, config with `null` = clear), `updateGroup` (label, kind, regionId, security; `null` clears), `updateScenario` (shallow patch) — all S05 — plus `addNode`, `moveNodes` (+ `groupId` to re-parent, `null` to leave a group), `moveGroup` (dx/dy, carries contents), `connect`, `delete` (groups delete their contents), `updateConfig` (validated by the component's `configSchema`), `group` / `ungroup`, `setGroupFrame`, `insert` (paste), `batch` (one undo step), `setProvider` (S12: sets `providerId`, moves Region groups and region chaos events to the same metro via registry `mapRegion`).
- Protocol stacks (S05): `protocolStackOptions(registry, protocol)`, `edgeSharedProtocols`, `edgeProtocolStackOptions(registry, graph, edge)`, `checkProtocolStack(...)` → reason | null.
- `checkConnection(registry, graph, req)` (ports + shared protocol, readable reason), `defaultProtocolStack`, `rankProtocols`, `defaultScenario()`, `emptyBoardDoc()`, `extractSubgraph`, `cloneSubgraph`, `descendantsOf`, `commandLabel`, `groupKindLabel`, `applyCommand`, `CommandError`.
- Workspace (S06): `createWorkspaceStore({ boardStore, newId?, now?, initial? })` → `data` (`WorkspaceData`: settings, projects in sidebar order, `boards` by id, `layouts` by id), `activeBoardId`, `lastError`; actions `replace`, `openBoard`, `openProject`, create/rename/duplicate/delete/move for projects and boards, `saveSnapshot`/`restoreSnapshot`/`deleteSnapshot`, `importBoards`/`importProjects` → `{ok, …} | {ok:false, reason}`. It loads the open board into the board store and mirrors every board edit back; undo history is kept per board. Pure ops + `graphDiff`, `uniqueName`, `normalizeWorkspace`, `emptyWorkspaceData` in workspace.ts. Command `replaceGraph` (snapshot restore). `delete`/`replaceGraph` drop scenario refs to removed items.
- React: `boardStore` + `workspaceStore` (app instances), `createAppStores()` (fresh pair on the app registry), `useBoardStore`, `useBoardStoreApi`, `useWorkspaceStore`, `useWorkspaceStoreApi`, `<BoardStoreProvider>`, `<WorkspaceStoreProvider>`.
- Simulation (S08): `createSimulationStore()` → `status` (idle/running/done/error), `result` (`SimResult | null`, kept while a newer run is in flight), `boardId`, `durationMs`, `error`, `runId`, `runRequests`, `focus`; actions `start() → runId`, `finish(runId, boardId, result, ms?)` / `fail(runId, msg)` (ignored if superseded), `clear()`, `requestRun()`, `requestFocus(nodeId)`. App instance `simulationStore`, `useSimulationStore`, `useSimulationStoreApi`, `<SimulationStoreProvider>`. Shared view helpers: `utilizationLevel` (`UTILIZATION_THRESHOLDS` 0.6/0.85), `UTILIZATION_LEVEL_LABEL`, `formatRps`, `formatMs`, `formatPercent`, `formatUsd`. The store never imports the engine — the app's runner fills it. Playback (S11): `playback` (`{ tick: number | null, playing }`), `setTick(i | null)` (clamped, pauses), `play()` (restarts at the end), `pause()`, `advance()` (next tick while playing; stops at the last); a new result keeps the tick (clamped) or resets it when there is no timeline; `clear()` resets. Pure `playbackPoint(result, playback)` → the `TimePoint` to show, or undefined (steady state).
- Re-exports core graph types for UI modules that may not import core: `Graph`, `NodeInstance`, `EdgeInstance`, `Group`, `GroupKind`, `GROUP_KINDS`, `Position`, `ProviderId`; and (S05, for inspector forms) `NodeScalingSchema`, `AutoscaleSchema`, `EdgeConfigSchema`, `GroupSchema`, `FirewallRuleSchema`, `ScenarioSchema` + their types; (S08) `SimResult`, `NodeMetrics`, `EdgeMetrics`, `FlowMetrics`, `Finding`, `FindingSeverity`; (S11) `ChaosEventSchema`, `CHAOS_EVENT_KINDS`, `ChaosEvent`, `ChaosEventKind`, `TimePoint`, `TimelineMarker`, `NodeTick`, `EdgeTick`.

## Notes

- Undo/redo = Immer patches + inverse patches per command; history capped at 200. Selection is not in history.
- All positions and group frames are absolute canvas coordinates.
- `layout.groupFrames` is view state core has no field for; persistence saves it next to the board (`WorkspaceData.layouts`).
- `doc.scenario` is the board's Scenario (core `Board.scenario`); `load()` defaults it with `defaultScenario()`.

## Extension points

- New edit = new `BoardCommand` variant + a case in `applyCommand` (+ `commandLabel`); inverse is automatic.
