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
