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
