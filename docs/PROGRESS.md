# SysDraw — Progress

Every session appends a handoff note below (template in ROADMAP.md → Templates). Newest last.
Read this file and ARCHITECTURE.md at the start of every session.

## Follow-ups

- Decide whether to keep `docs/SPEC.MD` (it still holds the session prompts, section 10) or delete it once all prompts have been run.
- Run `pnpm exec playwright install chromium` once per machine before `pnpm e2e`.

---

## S01 — Scaffold and docs — 2026-10-31

Status: done
Changed: repo root config (package.json, tsconfig*.json, vite.config.ts, eslint.config.js, playwright.config.ts, .prettierrc.json, .prettierignore, .gitignore, .editorconfig, index.html, README.md), src/\* (all 14 module folders with index.ts + README.md, registry/engine/core subfolders), src/app/{main.tsx,index.css,index.ts,layout/AppShell.tsx}, src/test/setup.ts, tests/boundaries.test.ts, e2e/shell.spec.ts, docs/\*.md
Public APIs added/changed: `app` → `AppShell()` (five-region layout). All other modules export nothing yet (`export {}`).
Registry entries added: none
Tests: 7 added (2 AppShell render tests, 5 boundary-lint tests), all passing; 1 Playwright smoke test (`pnpm e2e`)

Notes:

- Stack versions: React 19, Vite 8, TypeScript 6.0 (pinned `~6.0` — typescript-eslint does not support TS 7 yet), Tailwind 4 (via `@tailwindcss/vite`, no config file), ESLint 10 flat config, Vitest 5, Playwright 1.64, pnpm 9 (`packageManager` field).
- TS is strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Path alias `@/*` → `src/*` (tsconfig + Vite).
- Module boundaries: `MODULE_DEPENDENCIES` in `eslint.config.js` mirrors ARCHITECTURE.md. One `boundaries/dependencies` rule enforces both the table and "only through index.ts" (`fileInternalPath` selector; the separate `entry-point` rule is deprecated in plugin v7). `boundaries/no-unknown-files` means every file under `src/` must live in a module folder. `src/test/` is a `test-support` element for Vitest setup.
- The browser entry lives at `src/app/main.tsx` (part of the `app` composition root) rather than `src/main.tsx`, so every file under `src/` belongs to a module.
- Engine gets an extra `behaviors/` folder (the spec's component template refers to `src/engine/behaviors/`).
- The two embedded diagrams in the spec (architecture layers, roadmap) were not in the markdown; ARCHITECTURE.md has a text layer diagram and ROADMAP.md a phase table reconstructed from the session list.

Known gaps / follow-ups:

- No Radix, Zustand, React Flow, Zod, Dexie, Comlink yet — each owning session adds its own dependency.
- Dark mode follows the OS (`prefers-color-scheme`); a theme toggle is S21.

Next suggested session: S02 — Core schemas and migrations

---

## S02 — Core schemas and migrations — 2026-10-31

Status: done
Changed: src/core/{index.ts, README.md, ids.ts, units.ts, validation.ts, load.ts}, src/core/schemas/{common,graph,scenario,result,registry,workspace,index}.ts, src/core/migrations/{index,types,v0-to-v1}.ts, src/core/fixtures/sample-workspace.ts, tests (`ids.test.ts`, `units.test.ts`, `schemas/schemas.test.ts`, `migrations/migrations.test.ts`), package.json + pnpm-lock.yaml (added `zod` ^4.6.7), docs/PROGRESS.md
Public APIs added/changed: `core` now exports everything listed in src/core/README.md (schemas + inferred types for every DATA-MODEL.md type, id and unit helpers, `safeParseReadable`/`parseOrThrow`, `migrate`/`loadWorkspace`, `CURRENT_SCHEMA_VERSION = 1`, fixtures).
Registry entries added: none
Tests: 40 added (47 total), all passing; `pnpm build` and `pnpm lint` green.

Notes (interpretations of types DATA-MODEL.md names but does not define — review in an architecture session if wrong):

- `UserSettings` = `{ theme, defaultProviderId, autosave, showFormulas }`; `Rule` (group security) = `FirewallRule { direction, action, protocol, fromPort?, toPort?, peer, description? }`.
- `ChaosEvent` = discriminated union on `kind`: nodeOutage, groupOutage, regionOutage, trafficSpike, packetLoss, latencyInjection, networkPartition (all with `id`, `atSec`, `durationSec?`). Attack scenarios (DDoS, …) can be added as new kinds without a migration.
- `EdgeMetrics`, `Finding` (`ruleId, severity, title, message, targetIds, fix?`), `TimePoint`, `InstanceType` (`id, vCpu, memGb, netGbps, costUsdPerHour`) defined in core.
- Open sets are validated strings, not enums: `RegionId` (kebab-case), `BehaviorId` (camelCase; `KNOWN_BEHAVIOR_IDS` lists ENGINE.md's), protocol/registry ids (`^[a-z0-9]+([.-][a-z0-9]+)*$`, which accepts both `http2` and `proto.http2` — DATA-MODEL's example and ARCHITECTURE's convention disagree; S03 should pick one).
- Edges gained optional `sourcePortId`/`targetPortId` for DATA-MODEL's "node ids (+ optional port ids)".
- Id prefixes: `proj_`, `board_`, `node_`, `edge_`, `grp_`, `snap_`, `flow_`, `evt_` (`proj_` and the last three are new; schemas enforce them).
- Saved docs get structural checks only (unique ids, references resolve, no group cycles, flows/events point at existing nodes/edges/groups). Semantic checks (flow shares sum to 1, SPOF) are left to review rules so half-finished designs still save. Saved-doc objects strip unknown keys; registry entries are strict (typos fail).
- `ComponentDefinitionSchema` checks `defaults` against `configSchema` and rejects an empty `docs.summary`.
- v0 is defined as the pre-versioned draft format (no `schemaVersion`, no/partial `settings`); v0→v1 adds both. `migrate` is pure (structuredClone), rejects newer versions, and checks each step bumps `schemaVersion`.
- Fixture defIds (`client.web`, `network.load-balancer`, `compute.app-server`, `database.postgres`) and protocol ids (`ip`, `tcp`, `tls13`, `http1`, `http2`, `postgres-wire`) are placeholders for S03 to match or rename.

Known gaps / follow-ups:

- Only `Workspace` carries `schemaVersion`; boards are separate documents with no version of their own. S06 (persistence) needs an export envelope or a board-level version — this is an architecture change to DATA-MODEL.md, so decide it there.
- The lockfile was out of sync with package.json before this session (`typescript` `^6.0.3` vs `~6.0.3`), so `pnpm install --frozen-lockfile` failed; `pnpm add zod` regenerated it.
- The connected folder blocks deletes from Claude's shell, so empty `src/core/{schemas,migrations}/.gitkeep` files remain and a failed in-place `pnpm install` left six empty `_tmp_*` files at the repo root — safe to delete.

Next suggested session: S03 — Registry and plugin API

---

## S03 — Registry and plugin API — 2026-10-31

Status: done
Changed: src/registry/{index.ts, define.ts, schemas.ts, discover.ts, catalog.ts, sources.ts, presets.ts, README.md, define.test.ts, registry.test.ts}, src/registry/components/{clients/client.ts, network/{dns,cdn,load-balancer,api-gateway}.ts, compute/{app-server,serverless-function}.ts, database/{sql,nosql}.ts, cache/cache.ts, messaging/message-queue.ts, storage/object-storage.ts}, src/registry/protocols/{tcp,tls13,http1,http2,grpc,websocket}.ts, src/registry/providers/generic.ts, src/registry/test-fixtures/{README.md, components/compute/dummy-worker.ts}, docs/PROGRESS.md
Public APIs added/changed: `registry` → `registry: Registry` (`get(id, kind?)`, `require(id, kind)`, `has`, `kindOf`, `sourceOf`, `list(filter?)`, `size`); `defineComponent|Protocol|Provider|Problem|Rule|Lesson`; `RegistryEntryError`, `RegistryLoadError`, `registryKindOf`, `REGISTRY_KINDS`; `createRegistry(entries)`, `discoverEntries(sourceGroups)`; `isAvailableOn(def, provider)`, `componentDisplayName(def, provider)`, `findUnresolvedReferences(registry)`; schemas/types `ProviderDefinition(Schema)`, `ProviderRegion`, `RuleDefinition(Schema)`, `RuleContext`, `RuleCheck`, `RULE_CATEGORIES`, `LessonDefinition(Schema)`, `RegistryProblemSchema`/`RegistryProblemDefinition`; types `EntryByKind`, `EntryInputByKind`, `AnyRegistryEntry`, `ListFilter`, `SourceGroup`, `DiscoveredEntry`. No other module's API changed.
Registry entries added: components `client.app`, `network.dns`, `network.cdn`, `network.load-balancer`, `network.api-gateway`, `compute.app-server`, `compute.serverless-function`, `database.sql`, `database.nosql`, `cache.in-memory`, `messaging.queue`, `storage.object`; protocols `tcp`, `tls13`, `http1`, `http2`, `grpc`, `websocket`; provider `generic`
Tests: 63 added (110 total), all passing; `pnpm build` and `pnpm lint` green.

Notes (decisions):

- Id convention settled: protocols use bare ids (`http2`, matching DATA-MODEL and edge stacks); everything else is dotted `<kind-or-category>.<name>`. Ids are unique across all kinds, so `registry.get(id)` needs no kind.
- Provider, rule and lesson schemas live in the registry (core had none); core's problem schema is reused with `docs` made required so every entry has `docs.summary`.
- `list` filters: `category` matches component and rule categories; `tag` matches entries with `tags`; `provider` keeps components that are available there (generic → all; cloud → has `providerNames[p]` or no `providerNames` at all) and the matching provider entry; other kinds ignore it.
- Discovery collects only objects created by a `define*` helper (WeakMap brand); a registry file must export at least one, of its folder's kind. Problems are discovered from `problems/*/index.ts` only.
- Entries are deep-frozen except Zod schemas and functions. Config knobs use `.describe()` for help text and `.meta({ advanced: true })` for advanced fields, for the S05 inspector.
- The "new file is picked up" check uses `test-fixtures/components/compute/dummy-worker.ts`, discovered with the same `discoverEntries` the app uses (the app globs don't match it). Writing a real file during a test was avoided: Vite resolves globs at transform time, and the connected folder blocks deletes.
- Generic instance types are `small|medium|large|xlarge` and `mem-medium|mem-large|mem-xlarge` (rounded m/r-class prices). Serverless instance types are memory sizes priced per hour of continuous execution.

Known gaps / follow-ups:

- Core's fixture uses defIds `client.web` and `database.postgres`; the registry ships `client.app` (one client with `platform: web|mobile`) and `database.sql` (`engine: postgres|mysql`). `network.load-balancer` and `compute.app-server` match. Update the core fixture in a core session, or the engine compile step will not resolve those two nodes.
- Port protocol lists reference ids not yet seeded: `ip` (in edge stacks), `udp`, `dns`, `http3`, `resp`, `postgres-wire`, `mysql-wire`, `cql`, `amqp`. `findUnresolvedReferences` reports them; tests only require `runsOn` to resolve. `tcp.runsOn` is `[]` until `ip` exists.
- No rules, lessons, problems or cloud providers yet (S12, S17, S19). The empty folders are discovered without error.
- `.gitkeep` files remain in the populated registry folders because the connected folder blocks deletes. They are safe to remove.
- Tests in this session ran on a Linux copy of the repo: the checked-in `node_modules` holds macOS-native rolldown bindings that don't load in the Linux sandbox.

Next suggested session: S04 — Canvas editor

---

## S04 — Canvas editor — 2026-10-31

Status: done
Changed: src/store/{index.ts, README.md, types.ts, commands.ts, connections.ts, clipboard.ts, graph-utils.ts, board-store.ts, context.ts, BoardStoreProvider.tsx, board-store.test.ts}, src/canvas/{index.ts, README.md, CanvasProvider.tsx, BoardCanvas.tsx, Palette.tsx, actions.ts, context.ts, dnd.ts, geometry.ts, layout.ts, palette-model.ts, shortcuts.ts, to-flow.ts, nodes/{ComponentNode,GroupNode,RegistryIcon}.tsx, canvas-logic.test.ts, Canvas.test.tsx}, src/app/{layout/AppShell.tsx, README.md}, src/test/setup.ts (ResizeObserver/DOMMatrixReadOnly stubs for React Flow in jsdom), e2e/canvas.spec.ts, vite.config.ts (`chunkSizeWarningLimit: 1500` for the lazy ELK chunk), package.json + pnpm-lock.yaml (added `zustand`, `immer`, `@xyflow/react`, `elkjs`, `lucide-react`), docs/PROGRESS.md
Public APIs added/changed: `store` — everything in src/store/README.md (`createBoardStore`, `BoardCommand`, `checkConnection`, `defaultProtocolStack`, `rankProtocols`, clipboard helpers, `boardStore`/`useBoardStore`/`useBoardStoreApi`/`BoardStoreProvider`, types `BoardDoc`, `BoardLayout`, `Rect`, `Subgraph`, plus re-exported core graph types). `canvas` — `CanvasProvider`, `Palette`, `BoardCanvas`, geometry/layout/shortcut helpers (src/canvas/README.md). `app` — `AppShell` now mounts the canvas. No other module's API changed.
Registry entries added: none
Tests: 43 added (153 total), all passing; `pnpm build` and `pnpm lint` green. e2e: `e2e/canvas.spec.ts` (F1) + shell spec pass.

F1 acceptance: checked in headless Chromium on the production build — 6 components dragged from the palette and 6 connections drawn in ~2 s (scripted), edges labelled HTTP/2 and postgres-wire; group-as-subnet, copy/paste, auto-layout, then 22 undos back to an empty board and 22 redos; no console errors. Dropping a node into a VPC and dragging the VPC carries the node; undo restores it.

Notes (decisions):

- Undo/redo uses Immer `produceWithPatches`: each command stores patches + inverse patches, so commands need no hand-written inverse. `batch` makes several commands one undo step (move of a mixed selection, auto-layout, multi-ungroup). A command that throws `CommandError` changes nothing (including a half-applied batch).
- The store keeps absolute positions; the canvas converts to React Flow's parent-relative positions. React Flow nodes are mirrored in local state during drags/resizes and committed with one command on drag/resize end.
- Connections: source port must be `out|both`, target `in|both`, and they must share a protocol. The default protocol is the shared one with the highest OSI layer (unregistered wire protocols count as 7), then multiplexing; the stack follows `runsOn`, preferring encrypted layers (`http2` → `['tcp','tls13','http2']`). Edges into a `queue` component are `sync: false`.
- Deleting a group deletes its contents (draw-tool convention); `ungroup` keeps them. Copy brings a group's contents; paste renumbers labels (`app-server-1` → `app-server-2`) and offsets 32 px per paste.
- Node labels come from the component name slug (`client-1`, `app-server-1`, `sql-database-1`).
- Icons: registry `icon` is a lucide name rendered with `lucide-react/dynamic` (unknown names fall back to `box`), so a new component's icon needs no UI change. This emits ~2,000 tiny lazy icon chunks in dist; only used icons are fetched.
- `canvas` may not import `core`, so `store` re-exports the graph types and `GROUP_KINDS` the UI needs.

Known gaps / follow-ups:

- **Group position/size is not saved.** Core's `Group` has no frame field, so frames live in `BoardDoc.layout.groupFrames` (undoable, in memory only). Groups still render around their contents after a reload, but empty groups and manual resizes are lost. Needs a core change + migration (e.g. `Group.frame?: {x,y,width,height}`) before or in S06 (persistence). I did not change core's public API in this session.
- No in-canvas rename, protocol switch or edge re-routing — inspector work (S05). The connection check shows a valid/invalid handle while dragging but not the reason text.
- Shortcuts are a window listener in `canvas` (ignores text fields). Move them to `app` if a global shortcut registry is built.
- The clipboard is in-app only (not the system clipboard, not shared between tabs).
- Node size is fixed (184×64); 300-node 60 fps not yet measured.
- Tests again ran on a Linux copy of the repo (the checked-in `node_modules` is macOS-native). **On the Mac run `pnpm install`** to pick up the five new dependencies.
- e2e needs `pnpm exec playwright install chromium` once per machine (unchanged).

Next suggested session: S05 — Inspector (schema-driven forms over `updateConfig`; add `updateNode`/`updateEdge` commands for label, scaling and protocol stack).

---

## S05 — Schema-driven inspector panel — 2026-10-31

Status: done
Changed: src/inspector/{index.ts, README.md, Inspector.tsx, Inspector.test.tsx, form/{model.ts, validate.ts, SchemaForm.tsx, model.test.ts}, panels/{NodePanel,EdgePanel,GroupPanel,ScenarioPanel,DocsView,common}.tsx, panels/use-dispatch.ts}, src/store/{index.ts, README.md, types.ts, board-store.ts, commands.ts, connections.ts, inspector-commands.test.ts}, src/app/layout/AppShell.tsx (mounts `<Inspector />`), docs/PROGRESS.md
Public APIs added/changed:

- `inspector` (new): `Inspector`, `SchemaForm`, `Field`, `buildFormModel`/`buildFields`/`buildField`, `defaultValueFor`, `inferUnit`, `humanize`, `issuesByPath`, `readableIssue`, `errorAt`, `setAtPath`, `getAtPath`, types `FieldModel`, `FieldKind`, `FieldMeta`, `FieldOverrides`, `SchemaFormProps`, `CommitResult`.
- `store` (**additive change to another module's API, approved by the user at the start of the session**): commands `updateNode`, `updateEdge`, `updateGroup`, `updateScenario` (+ types `NodeScalingPatch`, `EdgeConfigPatch`); `BoardDoc.scenario` (required; `emptyBoardDoc()` and `load()` fill it from the new `defaultScenario()`); `protocolStackOptions`, `edgeSharedProtocols`, `edgeProtocolStackOptions`, `checkProtocolStack`; re-exports of core's `NodeScalingSchema`, `AutoscaleSchema`, `EdgeConfigSchema`, `GroupSchema`, `FirewallRuleSchema`, `ScenarioSchema` and their types (the inspector may not import core). Nothing existing changed signature.
  Registry entries added: none
  Tests: 33 added (186 total), all passing; `pnpm build` and `pnpm lint` green.

F5 acceptance: every node config field comes from the component's Zod `configSchema` (Basic / Advanced split by `.meta({ advanced: true })`); each committed edit is one `dispatch` = one undo step (text/number commit on blur or Enter, Escape reverts; selects/switches/add/remove commit at once). Invalid values are validated against the whole schema before dispatch (so object-level refines such as autoscale `max ≥ min` and firewall `toPort ≥ fromPort` are caught), shown under the field with `role="alert"` + `aria-invalid`, and not sent; the store re-validates and its reason is shown too. Covered by `Inspector.test.tsx`.

Notes (decisions):

- Panels: Node (label; generated config; scaling = replicas, instance-type select built from the definition's `instanceTypes` with vCPU/GB/$ per hour, autoscale on/off with defaults min=replicas, max=4×, 60 %, 60 s; advanced config collapsed), Edge (stack picker lists every bottom-up stack for each protocol both ports share, following `runsOn`, encrypted first, plus handshake-RTT/encryption summary; sync switch; timeout, retries; backoff and pool size under Advanced; empty = clear), Group (label, kind, region select from the board provider's regions, security on/off with public flag and firewall-rule list), Board (nothing selected: users by region, peak multiplier, daily cycle, payload sizes, duration; seed under Advanced). Multi-selection shows a count only.
- Docs tab: component docs (summary, how it works, trade-offs, interview tips, threats/controls, ports), each protocol in the edge stack (top first, with OSI layer, RTTs, overhead), provider docs for the board. Groups have no registry docs, so their tab lists member components with their summaries.
- Labels/units come from the schema (`.describe`, `.meta({label, unit})`) or the key's unit suffix; panels annotate schemas they don't own (core scaling/edge/scenario) with `FieldOverrides` instead of editing core.
- Zod default messages are rewritten for people ("Must be ≥ 1", "Must not be empty", "Choose one of: …", record keys: `Key "x": …`); custom schema messages pass through unchanged.
- `updateGroup` validates the whole group with core's `GroupSchema`; `updateEdge` validates config with `EdgeConfigSchema.strict()` (unknown keys rejected); `updateScenario` validates the merged scenario with `ScenarioSchema`.

Known gaps / follow-ups:

- **Scenario is in the store but not saved yet** — S06 (persistence) should map `BoardDoc.scenario` ↔ core `Board.scenario`. The `defaultScenario()` values (1 000 users in `north-america`, 2× peak, 1 KB / 10 KB payloads, 60 s, seed 1) are placeholders for the scenario session to tune.
- Flows and chaos events are not editable (the board panel shows their counts); unions/discriminated unions render as "not editable here yet".
- Protocol stack picker only offers stacks for protocols the ports share; unregistered wire protocols (`postgres-wire`, `resp`) appear as single-layer stacks until S14 adds them.
- Region ids in "Users by region" are free text checked only for shape (geo table comes with engine/geo).
- The canvas edge label does not show the picked stack's name beyond what S04 already renders; no metrics (out of scope).
- Tests ran on a Linux copy of the repo (macOS-native `node_modules`); `pnpm e2e` was not run (no Chromium available in this session). No new dependencies.

Next suggested session: S06 — Workspace, tabs and persistence (persist `scenario` and group frames).

---

## S06 — Projects, board tabs, saving — 2026-10-31

Status: done
Changed: src/store/{workspace.ts, workspace-store.ts, WorkspaceStoreProvider.tsx, workspace.test.ts, workspace-store.test.ts, commands.ts, context.ts, index.ts, README.md}, src/persistence/{index.ts, README.md, adapter.ts, dexie-adapter.ts, save-file.ts, session.ts, test-utils.ts, save-file.test.ts, session.test.ts, dexie-adapter.test.ts}, src/app/{main.tsx, README.md, layout/AppShell.tsx, workspace/{index.ts, ProjectSidebar.tsx, BoardTabs.tsx, SnapshotsPanel.tsx, SaveStatus.tsx, Menu.tsx, notices.tsx, notice-context.ts, files.ts, Workspace.test.tsx}}, e2e/persistence.spec.ts (new), e2e/canvas.spec.ts (drop coordinates only), package.json + pnpm-lock.yaml (added `dexie` ^4.4.7, dev `fake-indexeddb` ^6.2.7), docs/PROGRESS.md
Public APIs added/changed:

- `store` (**additive; the store README already scheduled workspace/projects for S06**): `createWorkspaceStore`, `WorkspaceState`/`WorkspaceStore`/`WorkspaceResult`, `workspaceStore` (app instance, drives `boardStore`), `useWorkspaceStore`, `useWorkspaceStoreApi`, `WorkspaceStoreProvider`, `createAppStores()`; pure helpers `emptyWorkspaceData`, `normalizeWorkspace`, `graphDiff`, `uniqueName`, `newBoard`, `projectOfBoard`, `boardsOfProject`, `WorkspaceError`, constants, types `WorkspaceData`, `WorkspaceDeps`, `GraphDiff`, `ImportedBoards`, `ImportedProjects`; re-exports core `Board`, `Project`, `Snapshot`, `UserSettings` types; new `BoardCommand` `replaceGraph`. Behaviour change: `delete` (and `replaceGraph`) now drop scenario flow steps / chaos events that point at removed items, so a saved board always passes `BoardSchema`. Nothing existing changed signature.
- `persistence` (new): see src/persistence/README.md — `SaveFile` format, `workspaceFile`/`projectFile`/`boardFile`, `serializeSaveFile`, `saveFileName`, `parseSaveFile` (migrate + validate, strict or lenient), `importSaveFile`, `openWorkspace`, `startAutosave`, `createDexieAdapter`, `createMemoryAdapter`, `StorageAdapter`, `toWorkspaceData`, `BoardLayoutSchema`.
- `app`: `AppShell({ autosave? })`; `main.tsx` loads the workspace before the first render.
  Registry entries added: none
  Tests: 56 added (242 total), all passing; `pnpm build`, `pnpm lint`, `prettier --check src e2e` green. e2e: 4/4 pass (also 12/12 with `--repeat-each=3`).

F9 acceptance: `e2e/persistence.spec.ts` — (1) create 2 boards (drag nodes onto each, rename one, snapshot), wait for "Saved", reload: both tabs, names, node ids/labels, the snapshot and the last open tab return exactly; (2) export a project as JSON, import it in a fresh browser context: same 2 boards and nodes. Unit level: `session.test.ts` checks the reloaded `WorkspaceData` deep-equals the original (boards, scenario, snapshots, group frames, order), v0 data upgrades on load, and exported JSON re-imports on a fresh profile with identical ids and content.

Notes (decisions):

- **Save format** (one shape for IndexedDB and files): a Workspace doc (`schemaVersion`, `settings`, `projects`) plus `boards[]` and `layouts{boardId → {groupFrames}}`, with `format: 'sysdraw'` and `kind: workspace|project|board`. Boards share the file's `schemaVersion`, so core's existing migration chain runs on the whole file (S02's open question). **Future migrations that change Board must also migrate `boards[]`** — please record this in DATA-MODEL.md in the next architecture session.
- **Group frames are now saved** (S04's gap) without a core change: they travel as `layouts` next to each board (persistence-owned, validated by `BoardLayoutSchema`; an invalid layout is dropped with a warning, never the board). Snapshots hold only the graph (core `Snapshot`), so restoring a snapshot keeps frames for groups that still exist; others re-fit their contents.
- **Scenario is saved** (S05's gap): `BoardDoc.scenario` ↔ `Board.scenario`.
- Load is lenient, import is strict. On load, invalid boards are skipped and dangling refs repaired with warnings; anything migrated/repaired/unreadable is written to a `backups` table first, then the cleaned data is rewritten at the current version. Import rejects any invalid board with a readable reason and changes nothing.
- Import keeps project/board ids when free (fresh profile = identical), re-mints on collision; board files go into the open project as new tabs, project/workspace files add projects; names are made unique ("Board 1 2").
- Autosave: 600 ms debounce, writes only boards whose object changed (reference check — the store's immutable updates make this exact) plus the workspace row; deletes removed boards; honours `settings.autosave` (off → only Ctrl/Cmd+S or clicking the status saves); flushes on `visibilitychange: hidden`/`pagehide`. Status shown top-right (Saved / Unsaved changes / Saving… / Save failed). If IndexedDB is unavailable the app still runs, without saving.
- Undo history is kept per board while the app runs (switching tabs no longer loses it); it is not persisted. Restoring a snapshot is one undoable step ("Restore "name"").
- Rules: the only project can't be deleted; a project's only board can't be deleted (delete the project). Deleting the open tab opens its neighbour; opening a project reopens its last-used tab. Delete asks for a second click to confirm (in-menu, no browser dialog).
- UI: project sidebar (left) and board tabs (above the canvas) both support create, rename (double-click, F2 on a tab, or menu), duplicate, reorder (drag-and-drop, menu, Alt+Shift+←/→ on a tab), delete, Export JSON; Import JSON in the sidebar header. Snapshots popover on the tab bar: save with a name, list with "N changes since (+added −removed ~changed)" diff counts, restore, delete.
- e2e/canvas.spec.ts: the F1 drop points moved to two rows because the new sidebar narrows the canvas (the old x = 900 landed on the inspector). The F1 steps and assertions are unchanged.

Known gaps / follow-ups:

- **On the Mac run `pnpm install`** to pick up `dexie` and `fake-indexeddb`. Tests ran on a Linux copy of the repo (macOS-native `node_modules`); e2e ran in a separate Linux container against Playwright's Chromium.
- No cross-tab sync: two browser tabs open on SysDraw overwrite each other's saves (last writer wins). A BroadcastChannel/Dexie liveQuery guard is a small follow-up.
- No UI yet to browse or restore the `backups` table, nor to toggle `settings.autosave` (settings UI: S21).
- Snapshot diff counts nodes/edges/groups only (not scenario changes); snapshots don't store group frames or scenario.
- `lastResult` is saved as-is when present; no engine results exist yet.
- Prettier flags `.claude/settings.json` and `CLAUDE.MD` (not touched in this session).
- Leftovers from earlier sessions (`.gitkeep`s, `_tmp_*` files) are still there; nothing new was left behind.

Next suggested session: S07 — Engine core. Later, problems (S12+) that load reference designs onto boards should go through `workspaceStore.importBoards` / `createBoard` rather than writing to IndexedDB directly.

---

## S07 — Analytical simulation engine — 2026-10-31

Status: done
Changed: src/engine/{index.ts, README.md, simulate.ts, client.ts, worker.ts, worker-api.ts, test-fixtures.ts, simulate.test.ts, engine.test.ts, perf.test.ts}, src/engine/model/{types,compile,load,route,expr,latency,format,findings}.ts + latency.test.ts, src/engine/queueing/{mmc,node}.ts + mmc.test.ts, src/engine/behaviors/{index,types,loadBalancer,cache,queue}.ts, package.json + pnpm-lock.yaml (added `comlink` ^4.4.2), docs/PROGRESS.md
Public APIs added/changed: `engine` (new; listed in src/engine/README.md) — `runSimulation(board: SimInput, options?): Promise<SimResult>`, `disposeSimulationWorker()`, `simulate(input, registry, options?): SimResult`, `compile(graph, registry): Model`, `generateLoad(scenario, flows?): FlowLoad[]`, `inferFlow(options): Flow`, `INFERRED_FLOW_ID = 'flow_inferred'`, `route(loads, model, options): RoutePlan`, `combineCalls`, `nodeQueueing`, `mmc`/`erlangB`/`erlangC`/`expQuantileFactor`, latency helpers (`stageDist`, `fixedDist`, `sumDist`, `mixDist`, `quantile`, `percentiles`, `distMean`), `BEHAVIORS`, `defineBehavior`, `DEFAULT_ENGINE_OPTIONS`, `BOTTLENECK_UTILIZATION`, types `SimInput`, `EngineOptions`, `Model`, `CompiledNode`, `CompiledEdge`, `NodeStats`, `Expr`, `Op`, `Dist`, `Branch`, `FlowLoad`, `RoutePlan`, `RoutedFlow`, `Behavior`, `ComponentSource`. No other module's API changed.
Registry entries added: none
Tests: 44 added (286 total), all passing; `pnpm build`, `pnpm lint`, `prettier --check src/engine` green.

Done-when check (hand-computed values, all within 1%, in `simulate.test.ts` against a test registry with round-number perf models):

- Single server: λ = 50, μ = 100 ⇒ ρ = 0.5, T = 20 ms, p50/p95/p99 = T·ln 2 / ln 20 / ln 100, Lq = 0.5; M/M/2 at λ = 150: C = 4.5/7, T = 22.857 ms.
- 2 replicas behind LB (one node ×2, and two nodes): LB T = 1.190 ms, servers ρ = 0.8, T = 50 ms, Lq 6.4; flow p50/p95/p99 = 35.84 / 151.0 / 231.5 ms. One replica ⇒ ρ = 1.6 and listed as bottleneck.
- Cache in front of DB (cache-aside, read-through and explicit path give the same numbers): h = 0.9 ⇒ DB gets 10 of 100 rps, ρ = 0.2; flow p50/p95/p99 = 2.54 / 20.49 / 60.76 ms. Without the cache the DB is at ρ = 2.
- Expected values were computed independently in Python from the formulas; derivations are in the test comments.

Notes (decisions):

- **Queueing:** each replica is an M/M/c queue with c = `perf.maxConcurrencyPerInstance` and λ/replicas (so an LB splits across instances, and replicas without an LB are assumed evenly balanced). Reads and writes share the queue: μ = 1000/S̄ with S̄ weighted by the read/write rates; a read's response is Wq + S_read. Erlang C uses the stable Erlang B recursion with an early exit (c = 50 000 LBs stay cheap).
- **Saturation (ρ ≥ rhoCap = 0.99):** the queue is evaluated at ρ = 0.99; then `queue` adds fluid backlog wait (λ − cμ)·D/(2cμ) over `scenario.durationSec`; `reject` sets error = 1 − capacity/λ and passes only served traffic downstream (fixed-point iteration over the flows); `degrade` keeps latency capped with no errors. `utilization` is reported raw (can exceed 1).
- **Percentiles:** a node's response time is treated as exponential (exact for M/M/1). A path is a shifted exponential: θ = √ΣTᵢ², shift = ΣTᵢ − θ, which is exactly ENGINE.md's "sum of means + RSS of tail excess" and exact for one stage. LB splits and cache hit/miss form a mixture (≤ 32 branches, closest merged), percentiles by bisection on the mixture CDF.
- **Routing:** a flow is an expression tree (visit / seq / choice / async). Explicit `path` steps run in order and behaviors transform the rest of the path (cache hit ends it unless `cacheable: false`; after a queue it is async). **A flow with an empty `path` follows the graph**; with no flows at all one read flow `flow_inferred` (share 1, 0.1 rps per user, from every client node, users split evenly) is created. With no client nodes, traffic starts at root nodes (info finding). Sync calls from a node run sequentially (latencies add). Async edges are fire-and-forget, except into a `queue`, whose enqueue is waited for while its consumers run async.
- **Behaviors** are auto-discovered files (`import.meta.glob`) exporting `behavior = defineBehavior({...})` with hooks `routeOut` (graph walk), `routeRest` (explicit path), `cacheAsideHitRate`, `finish` (metrics). `loadBalancer`: one target, share ∝ target replicas for every algorithm. `cache`: fixed hit rate = `config.hitRate` if a number in [0, 1], else 0.8; cache-aside (caller → cache + caller → database/storage) guards only database/storage calls; read-through when the cache has out-edges; writes always go through. `queue`: consumers off the critical path; lag = (λ − Σ consumer capacity) × duration added to `queueDepth`.
- Clients are traffic sources (no queueing, 0 ms). Unknown `defId`s are 0 ms pass-throughs with a warning finding; cycles in the graph walk are cut with a finding naming the edge. Engine findings use rule ids `engine.compile` / `engine.route`.
- `runSimulation` sends only `{ graph, scenario, providerId }` to the worker; in jsdom (no `Worker`) it runs in-thread via a dynamic import. The worker chunk was checked with a throwaway Vite build using the engine as entry (registry + engine ≈ 175 kB); the app's `dist` has no worker yet because nothing imports the engine until S08.
- Determinism: no randomness anywhere; `scenario.seed` is unused until a stochastic mode exists. 300 nodes run in ~12 ms (`perf.test.ts`, budget 1 s).

Known gaps / follow-ups:

- **On the Mac run `pnpm install`** to pick up `comlink`. Tests ran on a Linux copy of the repo again (macOS-native `node_modules`). The worker path has not been exercised in a real browser yet — S08 should confirm it in the e2e run.
- Out of scope and returning 0 / ignored for now: network latency per edge (`perEdge.latencyMs`, `handshakeMs`; S10 geo + S14 protocols — `simulate` already composes a per-edge fixed latency hook that returns 0), cost (`costPerMonth`; S09), diurnal curves and region routing (S10), chaos events, retries/timeouts from `EdgeConfig`, autoscaling (S11). `regionId` is attached to compiled nodes but unused.
- Vertical scaling is not modelled: instance type is resolved (unknown ones fall back to the first, info finding) but μ ignores vCPU/`scaleCurve` (S09). `single-writer` stores scale reads and writes alike for now.
- The cache hit rate is fixed; `cache.in-memory`'s configSchema has no `hitRate` field, so in the app it is always 0.8 until the Zipf model (or a `hitRate` knob) arrives. `cdn` uses the `cache` behavior's hit rate; the `cdn`, `replicatedStore`, `shardedStore`, `rateLimiter`, `serverless` behaviors named in definitions are not implemented yet and are ignored.
- Consumers behind a queue still receive the full arrival rate (they show ρ > 1 if too slow) while the queue reports the backlog; pull-based throttling is a later refinement.
- Graph walks duplicate shared downstream subtrees per path (bounded by `maxVisits` = 20 000 with a finding); fine for 300 nodes, revisit if designs get very deep with heavy fan-in.
- `core`'s sample board still uses `client.web` / `database.postgres` (S03 gap): the engine simulates those nodes as pass-throughs with warnings.

Next suggested session: S08 — Metrics UI (call `runSimulation(boardDoc)` debounced 300 ms from the store/app; use `SimResult.explain` for the formula tooltips; `perFlow['flow_inferred']` is the flow to show when the scenario has none).

---

## S08 — Performance view (metrics UI) — 2026-11-01

Status: done
Changed: src/store/{simulation.ts, simulation.test.ts, SimulationStoreProvider.tsx, context.ts, index.ts, README.md}, src/app/{simulation/{runner.ts, runner.test.ts, useSimulationRunner.ts}, layout/{AppShell.tsx, AppShell.test.tsx}, README.md}, src/canvas/{overlay.ts, overlay.test.tsx, edges/ProtocolEdge.tsx, nodes/ComponentNode.tsx, BoardCanvas.tsx, to-flow.ts, README.md}, src/metrics-ui/{index.ts, README.md, MetricsDrawer.tsx, NodeDetail.tsx, FormulaValue.tsx, formulas.ts, metrics-ui.test.tsx}, e2e/performance.spec.ts (new), e2e/persistence.spec.ts (waits for the simulation before comparing node text), package.json + pnpm-lock.yaml (added `recharts` ^3.10.1), docs/PROGRESS.md
Public APIs added/changed:

- `store` (**additive change to another module's API, approved by the user at the start of the session**): `createSimulationStore`, `simulationStore`, `useSimulationStore`, `useSimulationStoreApi`, `SimulationStoreProvider`, types `SimulationState`/`SimulationStore`/`SimulationStatus`/`FocusRequest`; view helpers `utilizationLevel`, `UTILIZATION_THRESHOLDS`, `UTILIZATION_LEVEL_LABEL`, `UtilizationLevel`, `formatRps`, `formatMs`, `formatPercent`, `formatUsd`; re-exports of core `SimResult`, `NodeMetrics`, `EdgeMetrics`, `FlowMetrics`, `Finding`, `FindingSeverity`. Nothing existing changed signature.
- `metrics-ui` (new): `MetricsDrawer`, `NodeDetail`, `UtilizationMeter`, `LatencyChart`, `FormulaValue`, `nodeFormula`, `systemFormulas`, `flowFormula`, `flowName`, `bottleneckRows`, `INFERRED_FLOW_ID`, `INFERRED_FLOW_NAME`, types `FlowField`, `NodeField`, `SystemFormulas`.
- `canvas`: no export changes (overlays are internal; edges now use the custom `sdEdge` type).
- `app`: `AppShell({ autosave?, simulate? })` (`simulate` defaults to true).
  Registry entries added: none
  Tests: 33 added (319 total), all passing; `pnpm build`, `pnpm lint`, `prettier --check src e2e` green. e2e: 5/5 pass (new `performance.spec.ts`).

F7 acceptance (`e2e/performance.spec.ts`, production build, real Web Worker, no console errors): client → LB → app server is simulated automatically; edges show thickness and "HTTP/2 · 0 ms"; the drawer shows throughput 200 rps and p99 for the flow. Setting `north-america` users to 400 000 (80k rps against 10k rps capacity) turns the server red (`data-level="hot"`, "Overloaded" pill with ⚠) and lists it as a bottleneck; clicking it selects and zooms to the node and opens its detail (meter + p50/p95/p99 chart). Formula tooltips show `SimResult.explain` (ρ = λ/(c·μ) …) and the flow p99 formula; every numeric value in the drawer (4 KPIs + 5 flow cells + 9 node values) is a "show formula" button. Run re-simulates.

Notes (decisions):

- **Who runs the engine:** the store may not import `engine`, so `app/simulation/runner.ts` (composition root) subscribes to the board store (graph, scenario, providerId by reference), debounces 300 ms, calls `runSimulation`, and writes to the simulation store. Opening another board clears the result and runs at once; "Run" (`requestRun`) runs at once; a debounced run whose inputs are identical to the last run is skipped; results of superseded runs are dropped (`runId`). Moving nodes re-runs too (positions are part of the graph; ~ms in the worker).
- **Overlays read the simulation store inside `ComponentNode` / `ProtocolEdge`,** not React Flow node data, so a result arriving mid-drag never resets node positions. Node: 2 px border + pill in the utilisation colour (green < 60 %, amber < 85 %, red ≥ 85 % with an icon and "Overloaded" label — never colour alone), rps, p99 badge. Edge: width 1.5–8 px on a √ scale relative to the busiest edge; label "protocol · p50 latency"; clicking the label selects the edge.
- The red threshold (0.85) equals the engine's `BOTTLENECK_UTILIZATION`, so red nodes and the bottleneck list agree (the list only has `service` nodes, as the engine decides).
- The selected component (board selection) drives the detail panel. Results are kept in memory only; `Board.lastResult` is not written.
- Charts: Recharts horizontal bar chart (single hue, hover tooltip, sr-only caption) for p50/p95/p99. No time-series chart: the engine produces no `timeline` yet.

Known gaps / follow-ups:

- **On the Mac run `pnpm install`** to pick up `recharts`. Tests and e2e ran on a Linux copy of the repo (macOS-native `node_modules`); e2e used a local Playwright config pointing at the sandbox's Chromium (not committed).
- **Flow and system numbers have no `explain` in `SimResult`** (core schema), so their formulas are stated in `metrics-ui/formulas.ts` from the result's own numbers (e.g. availability = served/offered rps). The per-flow λ formula shows users and peak but not `rpsPerUser` for the inferred flow (engine default 0.1). Adding `explain` to `FlowMetrics` and `system` is a core + engine change for an architecture session.
- Edge latency and all costs are 0 until S10/S14 (network) and S09 (cost); the labels and tooltips already say so via `explain`.
- An idle node (0 rps) still shows its no-load p99 (the service time tail), e.g. "p99 92.1 ms" for an app server. Consider "idle" instead.
- `metrics-ui` hard-codes the inferred flow id `flow_inferred` (it may not import `engine`); keep it in sync with `INFERRED_FLOW_ID`.
- The overlay strip under a node can overlap an edge label that passes right below it.
- A `.s08tmp/` folder (the source tarball used to copy the repo into the sandbox) is left at the repo root because the connected folder blocks deletes; safe to delete.

Next suggested session: S09 — Scaling and cost (instance size → capacity, cost/month per node; the drawer's cost KPI and the node cost row will fill in automatically).

---

## S09 — Scaling models — 2026-11-01

Status: done
Changed: src/engine/{index.ts, README.md, simulate.ts, test-fixtures.ts, scaling.test.ts (new)}, src/engine/scaling/{vertical,pools,roles,spec,autoscale}.ts + scaling.test.ts (all new), src/engine/cost/cost.ts (new), src/engine/queueing/node.ts (rewritten on instance pools), src/engine/model/{types,compile}.ts, src/engine/behaviors/{loadBalancer,types}.ts, src/registry/components/{database/sql, database/nosql, cache/cache, storage/object-storage, compute/serverless-function, network/load-balancer}.ts, src/registry/README.md, src/inspector/panels/{ScaleActions.tsx, scale-actions.ts} (new), src/inspector/panels/NodePanel.tsx, src/inspector/scale-actions.test.tsx (new), src/inspector/README.md, e2e/scaling.spec.ts (new), docs/PROGRESS.md
Public APIs added/changed:

- `engine` (own module, additive): `verticalSpeedup`, `verticalScale`, `AMDAHL_PARALLEL_FRACTION`, `scaleSpecOf`, `buildPools`, `capacityForMix`, `poolUtilization`, `consistentHashImbalance`, `servingInstances`, `readersPerShard`, `SCALING_ROLES`, `scalingFields`, `roleValue`, `desiredReplicas`, `steadyStateReplicas`, `autoscaleTimeline`, `nodeCost`, `FALLBACK_PRICING`, `HOURS_PER_MONTH`, `SECONDS_PER_MONTH`, `LB_ALGORITHMS`, `DEFAULT_VIRTUAL_NODES`, `lbAlgorithm`, `targetWeight`; types `Pool`, `ScaleSpec`, `ScalingRole`, `VerticalScale`, `AutoscaleTick`, `AutoscaleTimelineOptions`, `NodeCost`, `Pricing`, `LbAlgorithm`. `CompiledNode` gained `scale`, `autoscale?`, `baseServiceTimeMs` (`serviceTimeMs` is now the size-adjusted value) and its `config` is now `{...def.defaults, ...node.config}`; `NodeStats` gained `replicas`, `pools`, `costPerMonth`; `Behavior` gained optional `hashVirtualNodes`. `simulate`/`runSimulation`/`nodeQueueing` signatures unchanged.
- `inspector`: no export changes (Scale actions are inside `NodePanel`).
- No other module's public API changed. `core` untouched.
  Registry entries changed (data only): config fields tagged with `.meta({ scaling: role })` in sql, nosql, cache, object storage, serverless; new fields `database.sql` `shards`, `shardKeySkew` (advanced) and `network.load-balancer` `virtualNodes` (advanced) — all `.default(...)`, so existing boards without them still validate (no migration).
  Tests: 39 added (358 total), all passing; `pnpm build`, `pnpm lint`, `prettier --check src e2e` green. e2e: 6/6 pass (new `scaling.spec.ts`).

F6 acceptance: `e2e/scaling.spec.ts` (production build, real worker): client → LB → app server at 6 000 rps shows 60 %; "+1 replica" in the inspector → 30 % and system cost $87 → $157 (node $140); "Size up" small → medium → 17 % and node cost $280; "Add read replica" is disabled for an app server with a reason. Unit level (`engine/scaling.test.ts`, hand-computed): doubling replicas halves ρ exactly and doubles cost; medium (2× vCPU, sublinear) gives ρ/1.818.
Single-writer tests: 80 writes/s keep the primary at ρ 0.8 with 0, 3, 7 read replicas and with 4 scaling replicas; 150 writes/s stay saturated (ρ 1.5) with 5 replicas; reads drop 2.4 → 0.8 with 2 replicas; only sharding (×2 ⇒ 0.75) or a bigger primary (Amdahl, 0.4875) raises write capacity. Mixed read/write pools checked against M/M/1 by hand.

Notes (decisions):

- **Data-driven roles.** The engine and the Scale actions never read field names; they look for `.meta({ scaling })` roles: `shards`, `keySkew`, `readReplicas`, `standby`, `storageGb`, `storageCopies`, `maxInstances`, `minInstances`. A new database tags its own fields and gets sharding/replicas/cost for free.
- **Vertical:** `perf.serviceTimeMs` is measured on the component's FIRST instance type; k = vCPU/baseline vCPU; μ × f(k) with `linear` f = k and `sublinear`/`single-writer` Amdahl f = 1/(0.1 + 0.9/k). Latency per request drops too (S/f).
- **Pools:** a node = instance pools, each instance its own M/M/c. Even replicas; consistent hash ⇒ hottest replica f = 1 + √(2 ln N/V) × average (V = LB `virtualNodes`, default 100); single-writer ⇒ per shard 1 primary (all writes + 1/(1+R) of reads) + R = readReplicas + (replicas − 1) read replicas; shards ⇒ hottest shard max(skew, 1/S). Node `utilization` = busiest instance; latency = traffic-weighted mean of (Wq + S); errors per saturated instance; capacity = λ at which the busiest instance hits ρ = 1 for the current mix.
- **LB algorithms:** round-robin/random/consistent-hash weight targets by instance count; least-connections by capacity (bigger instances get more).
- **Autoscaling:** analytical runs use the policy's steady state, replicas = clamp(⌈work/(c·target)⌉ per shard, min, max) on AVERAGE utilisation (like cloud target tracking); "capped at max" is explained. `autoscaleTimeline(policy, loadPerTick, …)` replays it tick by tick with warm-up and a scale-in cooldown (default 60 s) for S11; it is not wired to a run yet.
- **Serverless:** `maxInstances` role ⇒ one pool with c = concurrency limit × perf c; billed busy instances = λ_avg × S̄ (Little), at least `minInstances`.
- **Cost/month (730 h):** instance-priced ⇒ (serving instances + standbys) × $/h × provider `instancePriceMultiplier`; $0/h managed services ⇒ requests × provider `requestsUsdPerMillion`; + storage GB × copies (single-writer: primary + replicas + standby; else `storageCopies` role) × `storageUsdPerGbMonth`. Request/busy volumes use λ ÷ `peakMultiplier`. Prices come from the board's provider entry, `FALLBACK_PRICING` (= generic) if it isn't registered. Explain strings show every term.
- Quick actions: +1 replica (disabled while autoscaling owns the count), Size up/down within the instance family (`mem-*` vs plain, ordered by vCPU), Add read replica (`readReplicas` role, bounded by the schema's max), Shard ×2 (`shards` role). Each click = one store command = one undo step; failures show the store's reason in `role="alert"`.

Known gaps / follow-ups:

- **metrics-ui** (not touched): the system "Cost / month" tooltip appends the first service node's cost explain (`formulas.ts`), which now reads like that node's cost. Show the per-node breakdown there instead.
- Egress cost and edge `costPerMonth` are still 0 (S10 geo). Read-replica lag/stale reads, cold starts and the autoscaler's reaction over time are S10/S11.
- NoSQL `replicationFactor` and consistency affect storage cost only, not throughput; cache `replicasPerShard` is failover only; the message queue has no partitions knob, so queue partitions are not modelled.
- Hash imbalance applies within one target's replicas, not across several target nodes; LB weights use configured replicas even when targets autoscale.
- A node's percentiles still assume an exponential stage around the traffic-weighted mean (no mixture across pools), so a hot shard's tail is understated in node p99.
- The app now shows non-zero costs on every board; designs saved before S09 keep working (new config fields have defaults).
- Tests/e2e ran on a Linux copy of the repo (macOS-native `node_modules`); e2e used a local Playwright config pointing at the sandbox's Chromium (not committed). No new dependencies.
- A `.s09tmp/` folder (source tarball used to copy the repo) is left at the repo root because the connected folder blocks deletes; safe to delete.

Next suggested session: S10 — Global users and geo (fill `perEdge.latencyMs` and egress cost; the per-edge latency hook in `simulate.ts` is ready).

---

## S10 — Geography and real-world latency — 2026-11-01

Status: done
Changed: src/engine/{simulate.ts, index.ts, README.md, test-fixtures.ts, engine.test.ts, perf.test.ts}, src/engine/model/{expr,load,route}.ts, src/engine/behaviors/{types,index,loadBalancer}.ts + cdn.ts, dns.ts (new), src/engine/geo/{distance,diurnal,places,routing}.ts + geo.test.ts (new), src/core/schemas/result.ts, src/registry/{index.ts, README.md}, src/registry/geo/user-regions.ts + test (new), src/registry/providers/generic.ts, src/registry/components/network/dns.ts, src/inspector/{panels/ScenarioPanel.tsx, Inspector.test.tsx, README.md}, src/inspector/geo/{UsersMap.tsx, users-model.ts, users-model.test.ts, world-land.ts} (new), src/canvas/{to-flow.ts, nodes/GroupNode.tsx, canvas-logic.test.ts, README.md}, src/metrics-ui/{MetricsDrawer.tsx, formulas.ts, index.ts, metrics-ui.test.tsx, README.md}, e2e/geo.spec.ts (new), e2e/{scaling,performance}.spec.ts (users input renamed), docs/PROGRESS.md
Public APIs added/changed:

- `core` (**additive, approved by the user at the start of the session**): `SimResult.perRegion?: Record<userRegionId, RegionMetrics>`; `RegionMetricsSchema` / `RegionMetrics` (name, users, rps, p50/p95/p99, errorRate, networkMs, servedFrom?, explain). Optional, so saved results and boards need no migration.
- `registry` (**additive, approved**): `USER_REGIONS`, `UserRegionSchema`, `UserRegion`, `userRegion(id)`. Data only: the generic provider now has 26 regions (11 old ids unchanged); `network.dns` gained `behaviors: ['dns']`.
- `engine` (own module, additive): geo exports (see src/engine/README.md) — `haversineKm`, `propagationRttMs`, `netBetween`, `MEASURED_RTT_MS`/`measuredKey`, constants (`FIBRE_KM_PER_MS` 200, `ROUTE_FACTOR` 1.5, `PER_HOP_OVERHEAD_MS` 1, `EARTH_RADIUS_KM`), `DIURNAL_CURVE`/`DIURNAL_MEAN`/`diurnalFactor`/`diurnalPeak`, `buildGeoModel`, `findCloudRegion`, `cloudPlace`/`userPlace`/`edgePlace`, `placeOf`, `selectCalls`, `INTER_REGION_PRICE_FACTOR`, types `Place`, `NetHop`, `GeoModel`, `GeoWalk`, `RegionLoad`, `GeoPolicy`. Changed shapes: `FlowLoad.byRegion`, `RoutedFlow.regionId?`, `route(loads, model, options, geo?)`, `Expr` visit `net?`, `Behavior.placement? / geoRoutes? / dnsPolicy?`. `simulate`/`runSimulation` signatures unchanged.
- `metrics-ui`: `regionFormula`, `regionRows`, types `RegionField`, `RegionMetrics`. `inspector`, `canvas`: no export changes.
  Tests: 31 added (389 total), all passing; `pnpm build`, `pnpm lint`, `prettier --check src e2e` green. e2e: 7/7 pass (new `geo.spec.ts`; also 14/14 with `--repeat-each=2`).

F8 acceptance (`e2e/geo.spec.ts`, production build, real worker): client → LB → app server wrapped in a Region group set to us-east; users 6 000 North America + 4 000 India (40 %) set on the scenario map. "Latency by user region" shows both served from us-east and India's p50 ≈ North America's + 179 ms (asserted 150–210 ms; model: India → us-east 218.2 ms vs NA → us-east 38.8 ms). Adding LB2 + server2 in an ap-south Region group, connected to the same client: India is served from ap-south and its p50 drops by > 150 ms to within 15 ms of North America's. Unit level (`engine/geo/geo.test.ts`, distances computed independently in Python): the p50 gap equals the RTT gap exactly, per-node rps split 60/40 between the stacks, ap-south outage fails India back to us-east, CDN/DNS/replication/egress/read-local numbers.

Notes (decisions):

- **Where the data lives.** Cloud regions = each provider entry's `regions` (lat/long; engine falls back to generic for ids the board's provider lacks). User regions = registry `USER_REGIONS` (9: north-america, latam, europe, africa, middle-east, india, east-asia, se-asia, oceania; population-weighted lat/long, representative UTC offset, last-mile RTT 15–40 ms). Unknown ids in old scenarios are kept, shown as "(unknown)", 0 ms, always at peak, with an info finding.
- **RTT** = 2 × 1.5 × d / 200 km/ms + 1 ms per hop between two different places (+ the user's last mile on a user hop); d = haversine. A request/response over one edge costs one RTT. Same cloud region ⇒ 0 ms (sub-ms intra-region hops are left to S14 with handshakes). `MEASURED_RTT_MS` (empty) overrides the formula per region pair.
- **Geo is active only when ≥ 1 node is in a known cloud region** (nearest enclosing group with `regionId`). Otherwise every hop is 0 ms as before, with an info note when users are in several regions. Old boards keep their numbers (single-region diurnal = factor 1; all existing tests unchanged except the behaviour catalogue).
- **Placement:** clients = the user region's point; nodes with a region = that region; CDN and DNS (`placement: 'edge'`) = an edge PoP at the user's point (users pay only the last mile; a CDN miss travels PoP → origin over the backbone); unplaced nodes sit where their caller is.
- **Routing per user region.** With geo active each (flow, user region) is routed separately. A client (geo-DNS), or a node whose behavior has `geoRoutes` (LB → global LB, CDN → origin), whose targets span ≥ 2 cloud regions sends a request to ONE region: nearest healthy by RTT; a DNS node the client calls can switch the policy (`failover` = first healthy in edge order, `weighted`/`simple` = even split). Targets without a region are always called. Healthy = not named by a `regionOutage` event or a region-kind `groupOutage` (the analytical run treats every event as active — worst case; the chaos timeline is S11+). Failover and "every region down" raise findings.
- **Read-local:** for reads, sync calls to the same data-store `defId` in several regions keep only the nearest healthy copy. **Store → store edges are replication**: reads never travel them (an inferred read flow no longer loads a replica through its primary — behaviour change, more correct); their edge latency = replication lag = RTT/2 + Wq + S_write of the target, with an info finding when cross-region.
- **Daily cycle:** `usersByRegion` = users at each region's local peak. Curve: 24 hourly factors (peak 1.0 at 20:00, 0.26 at 04:00), linear in between. On ⇒ the run evaluates the busiest UTC moment (15-min grid) and each region gets users × f(local time); off ⇒ all regions peak together. Per-region explain shows the UTC/local time and factor.
- **Edges:** latency = rps-weighted mean hop RTT over user regions (explain = the heaviest hop's formula); cost = egress at the average rate (rps ÷ peakMultiplier): internet (user/edge hops) = response bytes × `egressUsdPerGb`; inter-region (incl. CDN → origin) = request + response bytes × egress × 0.25. System cost = Σ nodes + Σ edges; its tooltip now says so (fixes S09's misleading cost tooltip).
- **UI:** Board panel → "Users": static world map (Natural Earth 1:110m land, pre-simplified into a 15 kB SVG path — no new dependency), a marker per user region (area ∝ share, click = edit) and a violet square per Region group's cloud region; one number input per region ("North America users"; 0 removes the key); every edit = one `updateScenario`. Daily cycle / peak multiplier keep the schema form with clearer help. Region group headers show their region id or an amber "Pick a region". Metrics drawer: "Latency by user region" table (rps, served-from, network, p50, p99, errors when any), all formula buttons.
- Perf: 300 nodes in two regions × 9 user regions with the daily cycle ≈ 90 ms (`perf.test.ts`, budget 1 s).

Known gaps / follow-ups:

- **docs:** DATA-MODEL.md / ENGINE.md should record `SimResult.perRegion`, the user-region table's home (registry, not engine/geo as core's `RegionIdSchema` comment says) and the replication-edge rule, in the next architecture session.
- Only the generic provider exists, so AWS/GCP/Azure region codes (us-east-1…) resolve only once those provider files land (S12); until then they show "Unknown region".
- Health is static: no DNS TTL failover delay, no partial outages, no health from saturation; `networkPartition` / `packetLoss` / `latencyInjection` events are not applied (chaos session).
- No per-hour timeline (`SimResult.timeline`) of the daily cycle yet; costs use ÷ peakMultiplier but not the daily-cycle mean (`DIURNAL_MEAN` is exported for that).
- Writes in a multi-region design call every placed store they are wired to (no "write to primary" semantics beyond read-local); explicit write flows are the way to model them.
- `perRegion` explains are engine strings; percentile explains per region are short. Node percentiles stay per node (not per user region).
- e2e filters Chromium's `/favicon.ico` 404 (the app has no favicon); other long specs could hit the same.
- Tests and e2e ran on a Linux copy of the repo (macOS-native `node_modules`); e2e used a local Playwright config pointing at the sandbox's Chromium (not committed). No new runtime or dev dependencies, so no `pnpm install` needed for this session.
- A `.s10tmp/` folder (the source and change tarballs used to copy the repo) is left at the repo root because the connected folder blocks deletes; it is git-ignored (`.*tmp`) and safe to delete.

Next suggested session: S11 — Chaos and real-life conditions (apply outage/partition/packet-loss/spike events over a timeline; `buildGeoModel().unhealthy` and `selectCalls` are the hooks for region failover with DNS TTL delay).

---

## S11 — Failures over time — 2026-11-01

Status: done
Changed: src/core/schemas/{scenario,graph,result}.ts + schemas.test.ts, src/core/README.md; src/engine/{simulate.ts, index.ts, README.md, perf.test.ts}, src/engine/model/{evaluate.ts (new), types, compile, findings, latency}.ts + latency.test.ts, src/engine/queueing/node.ts (exports `effectiveReplicas`), src/engine/geo/distance.ts, src/engine/chaos/{events.ts, timeline.ts, timeline.test.ts} (new; the now-unneeded `chaos/.gitkeep` can be deleted); src/store/{simulation.ts, simulation.test.ts, index.ts, README.md}; src/canvas/{overlay.ts, overlay.test.tsx, nodes/ComponentNode.tsx, edges/ProtocolEdge.tsx, README.md}; src/metrics-ui/{FailuresPanel.tsx, chaos.ts, failures.test.tsx} (new), {MetricsDrawer.tsx, index.ts, README.md}; src/inspector/panels/EdgePanel.tsx (labels for the two breaker fields only); e2e/chaos.spec.ts (new); docs/PROGRESS.md
Public APIs added/changed (**additive changes to other modules, approved by the user at the start of the session**; nothing removed or renamed, no migration — every new field is optional):

- `core`: ChaosEvent kinds `hotKey` (nodeId, share), `dependencySlow` (nodeId, factor), `diskFull` (nodeId), `coldStartBurst` (nodeId?, addedMs?); `CHAOS_EVENT_KINDS`; `EdgeConfig.breakerErrorThreshold?` (ratio > 0) and `breakerOpenSec?`; `TimePoint.nodes?` / `edges?` / `activeEventIds?` with `NodeTickSchema` (utilization, rpsIn, errorRate, p99Ms, replicas, state up/degraded/down), `EdgeTickSchema` (rps, errorRate, breaker?), `NODE_TICK_STATES`, `BREAKER_STATES`; `SimResult.timelineEvents?` with `TimelineMarkerSchema` / `TIMELINE_MARKER_KINDS` (chaos-start/-end, detected, failover, breaker-open/-close, scale-out/-in).
- `store`: simulation store `playback` `{ tick, playing }`, `setTick`, `play`, `pause`, `advance`; `playbackPoint(result, playback)`; types `Playback`; re-exports `ChaosEventSchema`, `CHAOS_EVENT_KINDS`, `ChaosEvent`, `ChaosEventKind`, `TimePoint`, `TimelineMarker`, `NodeTick`, `EdgeTick`.
- `metrics-ui`: `FailuresPanel`, `CHAOS_KIND_META`, `buildChaosEvent`, `emptyDraft`, `chaosEventLabel`, `chaosWhen`, `boardRegions`, `eventSpans`, `PLAYBACK_MS_PER_TICK`, types `ChaosDraft`, `ChaosKindMeta`, `ChaosParam`, `ChaosTarget`.
- `engine` (own module): `evaluate`, `expectedAttempts`, `retrySuccess`, `timeoutProbability`, `RETRY_BACKOFF_BASE_MS`, `runTimeline`, chaos helpers + constants (see src/engine/README.md); `EngineOptions.timeline` (default true) and `maxTimelineTicks` (600); `CompiledEdge.config`; `NetHop.ends?`; engine findings may use `engine.chaos`. `simulate` / `runSimulation` signatures unchanged.
- `canvas`, `inspector`, `app`: no export changes.
  Registry entries added: none.
  Tests: 48 added (437 total), all passing; `pnpm build`, `pnpm lint`, `prettier --check src e2e docs` green. e2e: 9/9 pass (new `chaos.spec.ts`; also 4/4 with `--repeat-each=2`).

Done-when check:

- **Killing one AZ of a 2-AZ deployment shows a dip and recovery.** Unit (`engine/chaos/timeline.test.ts`, client → LB → app in AZ a + app in AZ b, 60 rps): availability 100 % until t = 20 s, exactly 50 % from 20 s to 49 s (the LB still sends half the traffic to the dead AZ until its health checks — 10 s × 3 — remove it), 100 % from 50 s, with AZ b going from ρ 0.3 to 0.6; markers `chaos-start` at 20 and `detected` at 50; finding "Dip and recovery … recovered to ≥ 99% at 50 s (30 s …)". Variants: client retries (2) hide most of the dip (87.5 % = 1 − 0.5³, at 1.75× calls); with autoscaling the survivor launches a 2nd replica at 50 s, it serves after its 15 s warm-up, and the p99 spike drains. e2e (production build, real worker): the same design built in the UI, AZ killed from the new editor; scrubbing shows availability 100 % → 50 % → 100 %, the dead server red-dashed with "Down", the warning in the notes, no console errors.
- **Killing the only DB shows an outage.** Unit: client → LB → app ×2 → single DB; DB down 30–50 s ⇒ availability exactly 0 for those ticks and back to 100 % after; error finding "Outage … fell to 0% from 30 s to 50 s (20 s) … Requests kept reaching "db" while down — nothing took over (single point of failure)". Without an end: 0 % until the end of the run. e2e: same in the browser (readout 0 %, DB `data-state="down"`, "Error: Outage", Play advances the readout).

Notes (decisions):

- **One model, two uses.** Steps 4–6 of `simulate` moved into `model/evaluate.ts` (propagation, fixed point, latency/success per routed flow) and every timeline tick calls the same function with a `Perturbation` (down nodes, failed writes, patched nodes, carried-over wait, added latency per node/edge, open breakers, cut hops). The refactor left all 389 previous tests unchanged.
- **Retries/timeouts now apply in the analytical run too** (they were ignored before): attempts A = (1 − (1 − a)^(r+1))/a, success 1 − (1 − a)^(r+1), P(timeout) ≈ e^(−τ/T̄), timed-out work still loads the target, latency = mixture over the answering attempt (failed attempt costs τ or T̄, + backoff 100 ms fixed / 100·2^(k−1) exp). With no failures and no `timeoutMs` the numbers are exactly the old ones. **Only explicit `timeoutMs` counts** — there is no engine default timeout yet, so an overloaded `queue` node shows rising latency rather than errors unless the edge has a timeout.
- **The headline (steady-state) numbers are unchanged**: still all-events-as-worst-case for region outages (S10) and no effect from the other event kinds. The timeline is computed only when the scenario has events (so ordinary edits cost nothing extra).
- **Ticks:** 1 s up to 600 ticks, else ⌈D/600⌉ s. State carried over: down streaks → LB eviction after `healthCheckIntervalSec × unhealthyThreshold` (only while one of that LB's targets is up; with all down it keeps trying them all); region outages → routing leaves the region after the DNS TTL (max `ttlSec` of the board's DNS nodes, else 60 s); `queue`-saturated backlog (λ − capacity per s, wait = backlog/capacity, dropped when the node dies); autoscaling (target tracking per tick from the baseline steady state, `warmupSec`, 60 s scale-in cooldown); breakers (closed → open when failures over the last 10 s ≥ threshold; open for `breakerOpenSec` from the next tick, failing fast with no load on the target; one half-open trial tick); error rates seed the next tick (so feedback like a retry storm carries over). Region-outage nodes are down (fail) from the start, not just unrouted.
- **Event semantics:** packet loss = +(1 − (1 − p)^⌈(req+res bytes)/1460⌉) × 200 ms per hop (all edges if no edge); latency injection on a node delays its answers without using its capacity (vs `dependencySlow`, which multiplies service time and so cuts capacity); hot key raises a sharded node's hottest-shard share (an unsharded node gets an info finding); cold-start burst adds `addedMs` (else the component's `coldStartMs`, else 1 s) × the share still cold, fading over the duration (default 30 s), on one node or every compute node; partitions cut cloud ↔ cloud hops between the two regions.
- **Speed:** unchanged ticks reuse the previous evaluation; queueing results are cached per (node object, rps) across ticks; `latency.compact` gained a single-branch fast path and a heap-based closest-pair merge that reproduces the old merge order exactly (randomised equivalence test). 300 nodes × 60 ticks with an outage, a spike, retries and breakers on 296 edges ≈ 400–700 ms here (`perf.test.ts`, budget 1 s); the saturated shared DB in that test defeats tick reuse — it is the worst case.
- **UI:** the drawer gets a full-width "Failures over time" section: event list (remove = one undo step) + a collapsed "Add chaos event…" form (collapsed so node names do not appear twice on the page — existing e2e use `getByText(<label>)`); two single-series line charts on a shared time axis (availability %, p99) per the dataviz rule against dual axes, with shaded event spans, dashed markers, the current tick line, hover tooltips and click-to-scrub; a clickable marker list and a "Show as table" view; Play (150 ms per simulated second) / slider / "Steady state". Scrubbing colours the canvas: node pills and borders from that tick, "Down" pill + red dashed border, "N% err" pill, autoscaled replica badge; edges sized by that tick's rps, dashed with "breaker open/half-open", red with "N% fail" at ≥ 50 % failures — always text, never colour alone.
- Edge inspector: the two breaker fields appear automatically (schema-driven form); only labels/help were added, under Advanced.

Known gaps / follow-ups:

- **docs:** ENGINE.md / DATA-MODEL.md should record the new event kinds, breaker fields, `TimePoint.nodes/edges/activeEventIds`, `SimResult.timelineEvents`, and the evaluate/timeline split, in the next architecture session. src/engine/README.md is 32 lines (it already was before S11; the convention is 30).
- No default timeout (see above); connection-pool exhaustion and threads blocked on slow dependencies are not modelled (a slow DB does not reduce the app server's capacity); cold starts add latency, not capacity loss.
- LB health checks: no "healthy threshold" on recovery (a target is re-added the tick it comes back); one detection delay per LB for all its targets; global LBs and clients use the DNS TTL for region failover.
- Hot key only affects sharded nodes (`shards` role); consistent-hash replicas are not keyed by it.
- Retries can re-pick a different LB target only when the retrying edge is upstream of the LB (client → LB); retries on LB → target edges retry the same target.
- Timeline markers/labels come from the engine as plain strings; the editor has its own label function (metrics-ui may not import the engine) — keep `chaos.ts` and `engine/chaos/events.ts` labels in step.
- The drawer body is still 240 px high, so the Failures panel needs scrolling; a resizable drawer would help.
- Tests and e2e ran on a Linux copy of the repo (macOS-native `node_modules`); e2e used a local Playwright config pointing at the sandbox's Chromium (not committed). No new dependencies, so no `pnpm install` needed.
- A `.s11tmp/` folder (the source tarball used to copy the repo) is left at the repo root because the connected folder blocks deletes; it is git-ignored (`.*tmp`) and safe to delete, as are `.s08tmp`–`.s10tmp` if still there.

Next suggested session: S12 — Cloud providers (AWS/GCP/Azure registry entries; region codes then resolve for geo and chaos region events).

---

## S12 — AWS, GCP, Azure providers — 2026-11-01

Status: done
Changed: src/registry/{schemas.ts, catalog.ts, index.ts, provider-tools.ts (new), README.md, define.test.ts, registry.test.ts, providers.test.ts (new)}, src/registry/providers/{generic.ts, aws.ts (new), gcp.ts (new), azure.ts (new)}, src/registry/components/messaging/{message-queue.ts, pubsub-topic.ts (new), event-stream.ts (new)}, src/registry/components/database/{aurora.ts (new), spanner.ts (new)}; src/store/{commands.ts, inspector-commands.test.ts, README.md}; src/engine/{simulate.ts, index.ts, README.md, provider.test.ts (new)}, src/engine/cost/cost.ts, src/engine/model/{findings.ts, limits.ts (new), names.ts (new)}; src/canvas/{to-flow.ts, palette-model.ts, Palette.tsx, nodes/ComponentNode.tsx, canvas-logic.test.ts, README.md}; src/inspector/{panels/NodePanel.tsx, panels/ProviderInfo.tsx (new), provider-info.test.tsx (new), README.md}; src/app/{layout/AppShell.tsx, workspace/ProviderSwitcher.tsx (new), workspace/ProviderSwitcher.test.tsx (new), workspace/index.ts, README.md}; e2e/providers.spec.ts (new); docs/PROGRESS.md
Public APIs added/changed (**additive changes outside registry approved by the user at the start of the session**; nothing removed or renamed; `core` untouched; no migration — saved boards already carry `providerId`):

- `registry` (own module): provider schema gains `pricing.asOf` (required ISO date) and `pricing.region`, region `genericId?`, `instanceFamilies` (generic size → provider VM: name, vCPU, GB, $/h; default []), `services` (by component id: `icon`, `instanceNamePrefix`, `instancePriceMultiplier`, `instancePrices`, `requestsUsdPerMillion`, `storageUsdPerGbMonth`, `limits`, `nearest`, `note`; default {}). New exports: `PROVIDER_ONLY_TAG`, `isProviderOnly`, `componentIcon`, `providerService`, `instancePrice`, `servicePricing`, `serviceLimits`, `mapRegion`, `mapRegionId`, `planProviderSwitch` + types (`InstancePrice`, `RegionMapping`, `ProviderSwitchPlan`, `SwitchRelabel`, `SwitchWarning`, `SwitchRegion`, `ProviderService`, `ServiceLimit`, `LimitCheck`, `ProviderInstanceFamily`, `ProviderInstanceSize`) and their schemas. `isAvailableOn` / `componentDisplayName` moved to provider-tools.ts (same signatures); `isAvailableOn` now hides `provider-only` components on every other provider **including generic** (behaviour change).
- `store`: `BoardCommand` `{ type: 'setProvider', providerId }` — sets `doc.providerId` and moves Region groups' `regionId` and `regionOutage` / `networkPartition` event regions to the same metro (nearest region when none); one undo step; label "Switch provider to <id>".
- `engine`: `Pricing.instance?` / `source?`; `exceededLimits`, `providerLimitFindings`, `LimitHit`; engine finding rule id `engine.limits`. `simulate`/`runSimulation` signatures unchanged.
- `canvas`: `ComponentNodeData.unavailableOn?`; `PaletteSection.items[].icon`. `inspector`: no export changes. `app/workspace`: `ProviderSwitcher`.
  Registry entries added: providers `aws`, `gcp`, `azure`; components `messaging.topic` (SNS / Pub/Sub / Event Grid), `messaging.stream` (Kinesis Data Streams / Managed Service for Apache Kafka / Event Hubs), `database.aurora` (AWS only), `database.spanner` (GCP only). `messaging.queue`'s GCP name is now "Pub/Sub (pull subscription)" (Pub/Sub is the topic's name).
  Tests: 58 added (495 total), all passing; `pnpm build`, `pnpm lint`, `prettier --check src e2e docs` green. e2e: 10/10 pass (new `providers.spec.ts`).

F4 acceptance (`e2e/providers.spec.ts`, production build, real worker): client → app server → object storage, 30 000 users (6 000 rps peak, 3 000 average). Generic: "Object Storage", node cost $3,177 (3 000 × 2.628 M s × $0.40/M + 1 000 GB × $0.023), no provider panel. Picking AWS opens a review ("Object Storage → S3", "App Server → EC2", price table as of 2026-10-01); after "Switch to AWS" the nodes read S3 / EC2 with new icons, the cost tooltip names "AWS price table (us-east-1, as of 2026-10-01, approximate)", the inspector lists S3's limits with "GET/HEAD per prefix 5,500 requests/s · Exceeded", the notes show the `AWS limit` warning, and EC2 costs $74 (m7i.large) vs $70 generic. Azure: Blob Storage $3,960 ($0.50/M, $0.018/GB) with the 20,000 requests/s account limit and no S3 limits; GCP: Cloud Storage $3,174. One Ctrl+Z goes back to Azure. Every price table carries an "as of" date (`pricing.asOf` is required by the schema; a test checks all four). Unit level: hand-computed costs in `engine/provider.test.ts` (EC2/GCE/generic, RDS $124.83 + $11.50, DynamoDB $65.70 + $24.99, API Gateway $91.98 vs $10.51); Lambda concurrency 2 000 > 1 000 and DynamoDB 1 500 writes/s on one partition (or 4 partitions with 0.8 skew) raise warnings, 2 partitions don't; region mapping distances checked in Python.

Notes (decisions):

- **Where provider data lives.** Product names stay in each component's `providerNames` (every generic component names a product on all three clouds — a test enforces it); everything else provider-specific (VM families, per-service prices, limits, icons, regions) lives in the provider file, so adding a provider or changing a price touches one file. Provider-only components carry the `provider-only` tag and one `providerNames` key; their provider's `services[id].nearest` names the generic fallback shown when switching away.
- **Prices.** A node keeps its generic size id (`small`, `mem-large`); the engine asks `instancePrice(provider, componentId, size)`: service `instancePrices[size]` (RDS db.m6i.\*, ElastiCache cache.r6g.\*, Bigtable nodes, Lambda/Functions per busy hour, Kinesis shard, Event Hubs TU, ALB) else the provider family size × the service premium (e.g. Cloud SQL ≈ 1.45 × N2), else the component price × `instancePriceMultiplier` (generic, Aurora/Spanner which carry their own prices). A $0/h price makes a service request-priced (DynamoDB on-demand blended $0.25/M, Cosmos DB $0.50/M). Per-service request/storage prices override the board defaults. Explain strings name the provider instance and "price table, region, as of date".
- **Simulated speed is unchanged by a switch** (family sizes have the generic presets' vCPU/GB — tested); only names, icons, prices, limits and regions change, so comparing providers compares cost and limits, not made-up performance differences.
- **Limits** are registry data with an optional check (`config` field > value, or λ total/read/write per node / hottest shard λ × max(1/S, skew) / replica > value) and an optional `when` (e.g. SQS FIFO). Exceeding one is an `engine.limits` warning ("default quota: request an increase" vs "hard limit: spread the load"); the run does not throttle. Limits without a check (item size, vCPU quotas) are shown for reference in the inspector.
- **Regions.** Each cloud region has `genericId` when it is in the same metro as a generic region; switching maps old → generic → new, and falls back to the nearest region by great-circle distance (marked "nearest" in the review), e.g. GCP us-central1 → AWS us-east-2.
- **Switcher UX.** Top bar select (Generic / AWS / GCP / Azure). An empty board switches at once; otherwise a review dialog lists renames, region moves, "no equivalent" warnings (role="alert"), limits that will be checked and the price-table date, then one `setProvider` command. Nodes on a provider that lacks their component get an amber "No AWS equivalent" badge (text, not colour only) and an engine warning; they keep simulating with their own model.
- Icons are lucide stand-ins chosen per product (e.g. S3 `package`, Blob `hard-drive`, Cosmos DB `orbit`), not the providers' official icons (trademarked artwork; a test checks every icon name exists in lucide).

Known gaps / follow-ups:

- **Prices are approximate list prices compiled for 2026-10-01 from published pricing, not re-checked live in this session**; spot-check before quoting real numbers. Not modelled: Lambda's $0.20/M request fee, ALB LCUs, Front Door base fee, Kinesis PUT units, S3/GCS/Blob write vs read request prices (read price used), DynamoDB/Cosmos read vs write prices (blended), free tiers and discounts. DynamoDB/Cosmos storage is priced per copy ($0.25 ÷ 3) so the default replication factor 3 gives the list price.
- Limits don't throttle or fail requests yet (findings only); burst limits (Lambda 1 000 per 10 s, API Gateway burst) and bandwidth limits (Kinesis 1 MB/s, 2 MB/s reads) are notes only.
- Switching never replaces a provider-only node with its `nearest` component; a "Replace with RDS" quick action would be a small follow-up (the plan already carries the nearest id in its message).
- Azure's NoSQL product is Cosmos DB (generic `database.nosql`), so there is no Azure-only component; Aurora (AWS) and Spanner (GCP) are the provider-only ones. Azure's load balancer is still named "Azure Load Balancer" (L4); Application Gateway is the L7 equivalent.
- **docs:** DATA-MODEL.md should record the provider entry's new fields (`pricing.asOf/region`, `instanceFamilies`, `services`, region `genericId`), the `provider-only` tag and the `setProvider` command in the next architecture session.
- The node "Instance type" field still stores generic ids; the provider's instance name and price appear in its option labels only.
- Tests and e2e ran on a Linux copy of the repo (macOS-native `node_modules`); e2e used a local Playwright config pointing at the sandbox's Chromium (not committed). No new dependencies, so no `pnpm install` needed.
- A `.s12tmp/` folder (the source and change tarballs used to copy the repo) is left at the repo root because the connected folder blocks deletes; it is git-ignored (`.*tmp`) and safe to delete, as are `.s10tmp`/`.s11tmp`.

Next suggested session: S13 — Data and messaging tools (Kafka, Redis, Cassandra, Elasticsearch… as components; give each its `providerNames` and add its prices/limits under `services` in aws.ts / gcp.ts / azure.ts). Small S12 follow-ups: "Replace with nearest equivalent" action, limit-based throttling.

## S13 — Deep components with real behavior — 2026-11-01

Status: done
Changed: src/engine/behaviors/{types.ts, index.ts, cache.ts, queue.ts, configPerf.ts (new), quorum.ts (new), consensus.ts (new), partitionedKv.ts (new), relational.ts (new), replicaReads.ts (new), scatterGather.ts (new), columnar.ts (new), podPacking.ts (new), metricsStore.ts (new), lib/{config.ts, order-stats.ts, zipf.ts, perf-effects.ts, lib.test.ts} (new)}; src/engine/{model/types.ts, model/compile.ts, queueing/node.ts, chaos/timeline.ts, index.ts, README.md, engine.test.ts, deep-components.test.ts (new)}; src/registry/components/{messaging/kafka.ts, messaging/rabbitmq.ts, cache/redis.ts, cache/memcached.ts, database/cassandra.ts, database/kv-store.ts, database/postgres.ts, database/mongodb.ts, database/elasticsearch.ts, database/clickhouse.ts, database/coordination.ts, network/reverse-proxy.ts, network/service-mesh.ts, compute/kubernetes.ts, observability/prometheus.ts} (all new), cache/cache.ts; src/registry/{README.md, registry.test.ts}; src/canvas/Canvas.test.tsx; docs/PROGRESS.md
Public APIs added/changed (all additive, inside `engine` and `registry`; `core` untouched; no saved-format change, no migration):

- `engine`: `Behavior.tune?(node) → NodeTuning` (compile-time, applied in behavior order by new `tuneNode`, exported with `compile`); type `NodeTuning`; `CompiledNode.responseServiceMs?` — what a caller waits for besides Wq when it differs from the work `serviceTimeMs` that sets ρ/capacity (nodeQueueing uses it for `responseMs`; chaos "dependency slow" scales both). New exports: `kthOfN`, `maxOfN`, `replicasFor`, `harmonic`, `zipfHitRate`, `evictionModel`, `EvictionModel`, `PerfEffectSchema`, `perfEffectsOf`, `activeEffects`, `PerfEffect`, `cacheModel`, `cacheCapacityItems`. New behaviors: `configPerf`, `quorum`, `consensus`, `partitionedKv`, `relational`, `replicaReads`, `scatterGather`, `columnar`, `podPacking`, `metricsStore`. `cache` and `queue` extended (below). `EngineOptions.defaultCacheHitRate` is now only the fallback for caches without Zipf inputs.
- `registry`: 15 component entries; a new data convention `.meta({ perfEffect })` on config fields (read by `configPerf`). Generic components went from 14 to 29.

What each component models (hand-computed tests in `engine/deep-components.test.ts`, one or more per component; math in `behaviors/lib/lib.test.ts`, Zipf checked against exact sums over 10^6 keys within 1%):

- **Kafka** (`messaging.kafka`; MSK / Managed Kafka / HDInsight Kafka): partitions, RF (broker write work × RF), acks (all = +2 ms producer wait, 0 = no wait note), min ISR, compression, retention vs disk warning, consumer groups (each consumer node = a group that reads everything; active consumers = min(instances, P); hottest partition must fit one consumer; lag and "s behind"). `messaging.stream` gets the same log semantics because it has `partitions` (its write work is now × RF too).
- **RabbitMQ** (self-hosted): competing consumers (work-queue lag), quorum/classic/stream queues, persistence, publisher confirms as perfEffects.
- **Redis** (ElastiCache / Memorystore Cluster / Azure Managed Redis): cluster shards, replicas (`readPreference` primary ⇒ replicas billed as standbys, no read capacity), maxmemory policies (LRU/LFU/random/volatile-ttl/noeviction), persistence (aof-always × 3 on writes), Zipf hit rate from keyCount × item size vs RAM × shards × usable fraction.
- **Memcached** (self-hosted): nodes = shards of memory, multi-threaded (linear), LRU Zipf hit rate.
- **Cassandra** (self-hosted): N/R/W from consistency levels (capped at cluster size), work R·S_r / N·S_w, wait slowest-of-R / W-th fastest of N, vnodes ⇒ ring imbalance, R + W > N explain, compaction strategy.
- **Key-Value Store (DynamoDB-style)** (`database.kv-store`; DynamoDB / Firestore Datastore mode / Cosmos DB for Table): 3 000 RU / 1 000 WU per partition, ⌈GB/10⌉ splits, eventual/strong/transactional reads, GSIs and transactional writes multiply units, hot keys throttle (reject).
- **PostgreSQL** (RDS / Cloud SQL / Azure Database): primary + read replicas, HA standby, index on/off (seq scan = rows ÷ 5 000 rows/ms), secondary indexes (+30% write each), sync vs async replication, connection pooling.
- **MongoDB** (DocumentDB / Firestore Mongo compat / Cosmos DB for MongoDB): shards, secondaries, readPreference, writeConcern majority (+1.5 ms), readConcern linearizable.
- **Elasticsearch / OpenSearch**: scatter-gather (work P·S, wait S·H_P), replicas multiply indexing, refresh delay, over-sharding / yellow-cluster notes, query type.
- **ClickHouse** (self-hosted): scan work = rows × columns ÷ (50 000 values/ms per vCPU), linear vertical scaling, "too many parts" warning for > 1 insert/s per server.
- **Coordination Service (ZooKeeper / etcd)** (self-hosted): leader + majority commit (S_w × (1 + ⌊n/2⌋-th fastest of n − 1 followers)), linearizable vs local reads, even-ensemble warning; write capacity independent of members.
- **Reverse Proxy (Nginx / Envoy)** (self-hosted): `loadBalancer` routing + TLS termination / upstream keep-alive costs.
- **Service Mesh** (VPC Lattice / Cloud Service Mesh / Istio add-on for AKS): sidecar vs ambient data plane, mTLS, `loadBalancer` routing.
- **Kubernetes Cluster** (EKS / GKE / AKS): replicas = worker nodes; pods per node from CPU/memory requests, c = pods × concurrency per pod; no vertical speedup (bigger nodes fit more pods); Pending warning.
- **Prometheus + Grafana** (AMP / GMP / Azure Monitor managed Prometheus): series → samples/s, storage (also billed via `scale.storageGb`), head memory vs instance RAM (OOM warning); dashboard queries are reads on its edges.

Notes (decisions):

- **Work vs wait.** One service time could not express quorum/acks/scatter-gather (latency ≠ load), hence `responseServiceMs`. Queueing (Wq) still comes from the work; the explain says when they differ.
- **Data over code.** Simple knobs (acks, queue type, persistence, mTLS, query type, compaction, write/read concerns…) are `perfEffect` data on the config field, applied by the generic `configPerf` behavior; only structural models (quorum, consensus, partition budgets, scatter-gather, scans, pod packing, TSDB sizing, Zipf) are code. Behaviors read their documented config keys by name (listed in each behavior header and the registry README).
- **Provider names.** Components with a first-party managed product on all three clouds name it; the rest (RabbitMQ, Memcached, Cassandra, ClickHouse, ZooKeeper/etcd, Nginx/Envoy) are provider-neutral (self-hosted on VMs) because the provider tests require all three clouds or exactly one. Elasticsearch names Elastic Cloud on GCP/Azure (a marketplace service). AWS App Mesh is retired (Sept 2026), so the mesh maps to VPC Lattice.
- The "Kubernetes cluster group" is a component (the canvas `cluster` group kind in `core` is unchanged); its replicas are worker nodes.
- Constants that are approximations are named and documented in the behavior files (5 000 rows/ms scan, +30% per index, 1 ms sync-replica RTT, 50 000 values/ms/vCPU, 4 KB per series, 64 B per cache item, 2 ms acks=all).

Known gaps / follow-ups:

- **Cache TTL is not in the Zipf hit rate** (needs per-key request rates at routing time, i.e. a load-aware second pass); write invalidations neither. `noeviction` is modelled as random replacement + an OOM note.
- No provider `services` entries (prices/limits) for the new components yet: on AWS/GCP/Azure they are priced with the component price × the provider multiplier (DynamoDB-style KV uses the board's $/million requests). MSK, ElastiCache, Keyspaces, OpenSearch prices and limits are a small follow-up in aws.ts / gcp.ts / azure.ts.
- Kafka: partitions are not instances (brokers = replicas); per-partition broker throughput limits, consumer rebalances and exactly-once are not modelled. RabbitMQ prefetch / exchange type are explain-only.
- Cassandra/quorum: node failures do not yet change R/W availability in the chaos timeline (explain says how many failures each tolerates). Elasticsearch replicas > nodes is a note, not a placement error.
- Kubernetes: HPA/cluster-autoscaler delays use the generic autoscale policy; control-plane fee ($0.10/h) not in cost.
- ENGINE.md still lists `replicatedStore`/`shardedStore` (used by `database.nosql`, not implemented); the new behaviors and the `tune` hook should be recorded in ENGINE.md / DATA-MODEL.md (`perfEffect` meta) in the next architecture session.
- **Build warning:** the app's main chunk is now ~1.53 MB (registry docs + behaviors, +72 KB), just over the 1.5 MB `chunkSizeWarningLimit` in vite.config.ts; the build succeeds. Next: code-split the app chunk (lazy-load panels or registry docs) or raise the limit deliberately.
- **Vitest module cache:** after adding a new behavior file, vitest kept the old `import.meta.glob` expansion of `behaviors/index.ts` until `node_modules/.vitest-cache` was deleted (noted in engine README).
- Tests and the build ran on a Linux copy of the repo (macOS-native `node_modules`); e2e was not run this session (no UI changes). A `.s13tmp/` folder (source tarball) is left at the repo root because deletes are blocked; it is git-ignored and safe to delete, as are `.s10tmp`–`.s12tmp`.

Tests: 87 added (582 total), all passing; `pnpm build` (one chunk-size warning, above), `pnpm lint`, `tsc -b` green.

Next suggested session: S14 — Protocol catalog and edge inspector (several new components already reference protocol ids with no entry yet: `kafka-wire`, `amqp`, `resp`, `memcache`, `cql`, `mongodb-wire`, `postgres-wire`, `http3`). Small S13 follow-ups: provider prices/limits for the new components, TTL-aware hit rate.

---

## S14 — Protocols on every edge — 2026-11-01

Status: done
Changed: eslint.config.js + docs/ARCHITECTURE.md (dependency table); src/core/schemas/{registry,graph,result}.ts, src/core/README.md; src/registry/protocols/{tcp,tls13,http1,http2,grpc,websocket}.ts + 27 new entries (http3, graphql, sse, dns, smtp, mqtt, amqp, kafka-wire, resp, memcache, postgres-wire, mysql-wire, mongodb-wire, cql, tls12, mtls, json, protobuf, avro, udp, quic, ipv4, ipv6, icmp, anycast, ethernet, fibre), src/registry/{protocol-tools.ts (new), protocols.test.ts (new), index.ts, registry.test.ts, README.md}, src/registry/components/{clients/client.ts, compute/app-server.ts, compute/kubernetes.ts, compute/serverless-function.ts} (port protocols only); src/network/{stack.ts, cost.ts, inspect.ts, network.test.ts} (new), {index.ts, README.md}; src/engine/{simulate.ts, README.md, protocols.test.ts (new)}, src/engine/model/{protocol.ts (new), compile.ts, route.ts, types.ts}, src/engine/geo/distance.ts, src/engine/chaos/{timeline.ts, events.ts}; src/store/{connections.ts, commands.ts, index.ts, README.md, board-store.test.ts, inspector-commands.test.ts}; src/inspector/{Inspector.tsx, panels/EdgePanel.tsx, panels/EdgeNetwork.tsx (new), edge-network.test.tsx (new), README.md}; e2e/protocols.spec.ts (new); docs/PROGRESS.md

**Architecture change (approved by the user at the start of the session):** `engine` and `inspector` may now import `network` (ARCHITECTURE.md module table + `MODULE_DEPENDENCIES`). Everything else is additive; nothing removed or renamed; no saved-format change, no migration (all new fields optional).

Public APIs added/changed:

- `core`: `ProtocolDefinitionSchema` optional `resumedHandshakeRtts`, `unitBytes`, `pattern`, `ports { plain?, secure? }`, `handshakeSequence`, `loss { recoveryRtts, minRecoveryMs, holBlocking }`, `implicit`, `conceptual`, `payloadSizeFactor`, `suggestedStacks [{ from, to, stack, why }]`; `HandshakeMessageSchema`, `ProtocolLossSchema`, `ProtocolSuggestionSchema`, `HOL_BLOCKING_SCOPES`, `PROTOCOL_PATTERNS`, `HANDSHAKE_SENDERS`. `EdgeConfig.newConnectionShare?` (ratio; default 0 = warm). `EdgeMetrics.rttMs?`, `coldLatencyMs?`, `overheadBytes?`; `handshakeMs` is now filled (cold handshake time, was always 0).
- `registry`: `suggestedStacks(registry, fromDef, toDef)`, `matchScore`, type `StackSuggestion`.
- `network` (new): `resolveStack`, `activeLayers`, `stackLabel`, `connectionCost(stack, rtt, warm)`, `requestLatency`, `perRequestOverhead(stack, payload)`, `lossDelay`, `osiView`, `handshakeSequence`, `stackPorts`, `isEncrypted`, `encryptionStatus`, `stackWarnings`, constants + types (see src/network/README.md). Note: functions take a `ResolvedStack` (from `resolveStack(registry, ids)`), not raw ids.
- `engine`: `CompiledEdge.stack`; `NetHop.rttMs?`; `TimelineInput.edgeRttMs?`. `simulate`/`runSimulation` signatures unchanged.
- `store`: `suggestedEdgeStack`, `edgeStackSuggestion`, type `EdgeStackSuggestion`; `connect` now uses a registry suggestion when one fits (behaviour change for client → CDN, compute → Kafka/stream, anything → DNS).
- `inspector`: no export changes (EdgePanel gets a `scenario` prop internally).
  Registry entries added: 27 protocols (33 total). Component ports: `client.app` out + `http3`; app server / serverless / Kubernetes out + `mysql-wire`, `memcache`, `kafka-wire`, `amqp`, `cql`, `mongodb-wire`, `dns`.
  Tests: 89 added (671 total), all passing; `pnpm build` (the pre-existing chunk-size warning, main chunk now 1.58 MB), `pnpm lint`, `prettier --check src e2e docs` green. e2e: 11/11 pass (new `protocols.spec.ts`).

Done-when check — **switching an edge from HTTP/1.1 to HTTP/2 to HTTP/3 changes cold-request latency by the expected RTTs:**

- Unit (`engine/protocols.test.ts`): client (North America) → server in us-east, RTT 38.79 ms. Cold request = (handshake RTTs + 1) × RTT: HTTP/1.1 over TLS 1.3 = 3 RTT = 116.4 ms; HTTP/2 = 3 RTT (no change: ALPN negotiates it inside the TLS handshake); HTTP/3 over QUIC = 2 RTT = 77.6 ms (−1 RTT); HTTP/1.1 over TLS 1.2 = 4 RTT. Warm steady state stays 1 RTT for all; `newConnectionShare` 0.5 on HTTP/2 makes the edge 2 RTT and raises the flow p50 by exactly one RTT.
- Packet loss (2 %, 11 kB): TCP +29.85 ms (8 segments, RTO 200 ms), QUIC +7.98 ms (10 packets, 9/8 × 38.8 ms).
- e2e (production build, real worker): client → reverse proxy in us-east; the edge's Network tab reads New connection 116 ms / Warm 38.8 ms for HTTP/1.1, the same for HTTP/2, and 77.6 ms for HTTP/3 (UDP 443).

Notes (decisions):

- **Handshake model:** layers add `handshakeRtts` (TCP 1, TLS 1.3 1 / resumed 0, TLS 1.2 2 / 1, QUIC 1 incl. TLS / resumed 0, WebSocket 1, MQTT 1, RESP 1 (AUTH), Kafka 2, CQL 2, MySQL 2, MongoDB 2, PostgreSQL 3 (startup + SCRAM), AMQP 4, SMTP 2). Steady-state latency assumes warm connections unless `newConnectionShare` is set, so every pre-S14 number is unchanged; the cold cost is reported per edge.
- **Stacks without a transport** (saved before S14, e.g. `['postgres-wire']`) are treated as running on TCP (`assumed`); the inspector says so. With no wire protocols registered before, such stacks were the default; new connections now get real stacks (`tcp › tls13 › postgres-wire`).
- **IP / link layers** are `implicit` registry entries shown in the OSI view, never placed in `protocolStack` (adding `ip` under TCP would have invalidated every saved stack). TCP/UDP header bytes already include IPv4.
- **Suggestions are data** on protocol entries (`suggestedStacks`): HTTP/3 for `category:clients` → `network.cdn`; Kafka wire over plain TCP for `category:compute` → Kafka / event stream (per the task; the inspector notes it is unencrypted); UDP for anything → DNS.
- **Warnings** (network `stackWarnings`): plaintext over the internet (an end is a client component), plaintext inside (info), TLS 1.2, HTTP/1.1 head-of-line, multiplexing over TCP (warning when the scenario has packet loss on the edge), ≥ 3-RTT handshakes with > 10 % new connections, unknown/assumed/invalid layers, unreliable UDP.

Known gaps / follow-ups:

- **docs:** NETWORK-SECURITY.md / DATA-MODEL.md / ENGINE.md should record the new protocol fields, `newConnectionShare`, the edge metrics and the engine → network dependency in the next architecture session. engine, registry and inspector READMEs are 33–36 lines (they were already over 30).
- Not in latency: head-of-line blocking (warned only), TCP slow start for large responses, bandwidth/serialisation time, DNS lookup time, TLS `SSLRequest` extra RTT for classic PostgreSQL. `bytesPerSec` and egress cost stay payload-only (header bytes are shown separately).
- Cold latency is per edge; there is no end-to-end "first request" figure per flow yet — S15's request trace is the natural place (`handshakeSequence` gives the steps).
- "Crosses the internet" in the inspector = one end is a client component; zones/security groups come with S16.
- Encodings (JSON/Protobuf/Avro) are catalog entries only; edges cannot carry them yet (`perRequestOverhead` already applies `payloadSizeFactor` if a stack ever includes one).
- Tests, build and e2e ran on a Linux copy of the repo (macOS-native `node_modules`); e2e used a local Playwright config pointing at the sandbox's Chromium (not committed). No new dependencies, so no `pnpm install` needed.
- A `.s14tmp/` folder (source and change tarballs) is left at the repo root because deletes are blocked; it is git-ignored and safe to delete, as are `.s10tmp`–`.s13tmp`.

Next suggested session: S15 — Request trace view (animate DNS → TCP → TLS → HTTP per hop using `handshakeSequence` and edge `rttMs`; add a per-flow cold first-request latency).

---

## S15 — Animate one request end to end — 2026-11-01

Status: done
Changed: src/engine/trace/{trace.ts, trace.test.ts} (new), src/engine/{index.ts, client.ts, worker-api.ts, README.md}; src/canvas/trace/{trace-store.ts, context.ts, colors.ts, sequence.ts, TracePanel.tsx, trace.test.tsx} (new), src/canvas/{index.ts, CanvasProvider.tsx, BoardCanvas.tsx, edges/ProtocolEdge.tsx, nodes/ComponentNode.tsx, README.md}; src/app/trace/{runner.ts, runner.test.ts, useTraceRunner.ts} (new), src/app/{layout/AppShell.tsx, index.css, README.md}; src/network/README.md (one line); e2e/trace.spec.ts (new); docs/PROGRESS.md
Public APIs added (all additive; nothing removed or renamed; `core`, `store`, `network` and `registry` code untouched; no saved-format change, no migration):

- `engine`: `traceRequest(board, flowId | undefined, userRegionId | undefined, { warm?, cache?, registry?, engine? }) → RequestTrace`, `runTrace` (same, in the worker; in-thread without Workers), `traceRegions`, `TRACE_CATEGORIES`, `TRACE_CATEGORY_LABEL`, `TRACE_DNS_ID`, types `RequestTrace`, `TraceStep`, `TraceStepKind`, `TraceCategory`, `TraceParticipant`, `TraceDecision`, `TraceOptions`. `WorkerApi.trace`.
- `canvas`: `TracePanel`, `createTraceStore`, `currentTraceStep`, `DEFAULT_TRACE_REQUEST`, `useTraceStore`, `useTraceStoreApi`, `traceColor`, `TRACE_COLOR_ORDER`, `sequenceLayout`, `breakdownShares`, `elapsedAt`, `tracedEdgeIds`, `PACKET_ANIMATION_MS`, `STEP_INTERVAL_MS`, types `TraceState`, `TraceStore`, `TraceStatus`, `TraceView`, `TraceViewStep`, `TraceViewSegment`, `TraceRequestSpec`, `TraceWarmth`. `CanvasProvider` takes an optional `traceStore` prop (creates its own otherwise).
- `app`: internal `trace/` runner (`startTraceRunner`, `toTraceView`, `TRACE_DEBOUNCE_MS`, `useTraceRunner`).
  Tests: 18 added (689 total), all passing; `pnpm build` (only the pre-existing chunk-size warning), `pnpm lint`, `prettier --check src e2e docs` green. e2e: 12/12 pass (new `trace.spec.ts`).

Done-when — **F10 trace acceptance ("a trace animates DNS → TCP → TLS → HTTP for one request")**, `e2e/trace.spec.ts` (production build, real worker): client → app server in us-east, North America users, "Trace request" (cold by default). The sequence lists DNS query/answer, TCP SYN / SYN-ACK / ACK, TLS 1.3 ClientHello / ServerHello … Finished / Finished, then the HTTP/2 read request, queue, service and response, in that order. Stepping shows no packet for DNS (no edge), then a `tcp` packet travelling forward on the client → server edge, the SYN-ACK travelling back, a `tls` packet with SNI/ALPN in the headers, the request with "Port 443"; the packet's position changes during the animation; Play runs to "Step n / n". Where time goes: DNS 15 ms, TCP ≈ 1 RTT (35–42 ms), TLS ≈ 1 RTT; switching to Warm removes DNS/TCP/TLS rows and the total drops by 15 ms + 2 RTT (±1.5 ms).
Unit (`engine/trace/trace.test.ts`, hand-computed, RTT 38.795 ms): warm = request RTT/2 + Wq 0.5 + S 2 + response RTT/2, equal to the simulation's RTT + node mean (p50 / ln 2); cold adds DNS 15 + TCP 1 RTT + TLS 1 RTT (ACK and Finished cost 0: same flight); HTTP/3 cold = QUIC 1 RTT; resumed = TCP only; India users (no users on the board) pay 218.17 ms; cache-aside miss/hit paths; LB pick listed; async calls flagged and off the critical path; explicit write flow; empty board; Σ breakdown = total; deterministic.

Notes (decisions):

- **Where the trace lives.** Trace generation needs routing, geo and queueing, so it is an engine function over the same routed expression tree as `simulate` (re-routed for the one user region, so any registry region works). It reuses `evaluate` for steady-state Wq/S, and the network module's `handshakeSequence`, `perRequestOverhead`, `stackPorts`, `stackLabel`.
- **One branch.** Cache hit/miss follows the `cache` option (miss by default, so the whole path shows); other choices (LB targets, regions, several clients) take the most likely option, first on ties; each is listed under the sequence ("Cache miss (20% of reads, hit rate 80%)", `"lb" → "a1" (50%…)`).
- **Timing model.** Means only. A message one way = RTT/2; a protocol layer's handshake costs exactly its `handshakeRtts` × RTT (messages beyond 2 × RTTs ride in the same flight at 0 ms), so cold − warm per hop = `connectionCost`. Cold = new connections on every hop (a note says pools normally keep internal hops warm; inside one region RTT ≈ 0 anyway) + one DNS lookup by the client = one last-mile RTT (answer assumed cached at the ISP resolver). Resumed = `resumedHandshakeRtts`, DNS cached. Node time = Wq for the op + response service time (S13 quorum/acks waits); data stores and caches count as "DB / cache". Async calls are listed (dashed arrows) but do not delay the caller; a queue's enqueue ack is waited for.
- **UI state lives in canvas** (a canvas-owned zustand store provided by `CanvasProvider`), not `store`, so no other module's API changed; the app owns the runner (engine → store), like the simulation runner. The canvas view types mirror `RequestTrace` structurally (canvas may not import engine); `toTraceView` adds labelled breakdown segments, so TypeScript catches drift.
- **Animation:** SMIL `animateMotion` on the edge's own bezier path (`begin="indefinite"` + `beginElement()` on mount, since a SMIL animation added to a running SVG with begin 0 would already be finished), 900 ms per packet, 1.2 s per step while playing; reversed key points for server → client messages. Node-local steps ring the node. Category colours: the reference categorical palette (validated, fixed order, dark steps via CSS variables); every coloured mark has a text label / legend row with values.

Known gaps / follow-ups:

- **ARCHITECTURE.md names a `trace-ui` owning module for F10;** the UI lives in `canvas/trace/` + `app/trace/` instead (no module-table change). An architecture session may split it out, and should record `traceRequest` in ENGINE.md / NETWORK-SECURITY.md.
- Not in the trace: retries/timeouts/breakers and errors (a note flags overloaded nodes), packet loss, TCP slow start / serialisation of large responses, DNS resolver misses (root → TLD → authoritative), the classic PostgreSQL `SSLRequest` RTT, chaos-timeline ticks (steady state only), percentiles (means only). HTTP/2's SETTINGS exchange (0 RTT) is not listed because `handshakeSequence` skips 0-RTT layers.
- React Flow draws no edges in jsdom, so the packet itself is covered only by e2e (unit tests cover the store, panel and node markers).
- The panel (w-96) narrows the canvas while open; a resizable/dockable panel would help. The canvas toolbar wraps on narrow screens.
- Tests, build and e2e ran on a Linux copy of the repo (macOS-native `node_modules`); e2e used a local Playwright config pointing at the sandbox's Chromium (not committed). No new dependencies.
- A `.s15tmp/` folder (source tarball) is left at the repo root because deletes are blocked; git-ignored and safe to delete, as are `.s10tmp`–`.s14tmp`.

Next suggested session: S16 — Security layer (zones, controls, threat checks); the trace can then show which hops cross a zone boundary and where TLS terminates.
