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
