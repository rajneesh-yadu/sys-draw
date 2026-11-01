# core

Zod schemas and inferred types for every saved document and registry entry, prefixed ids, unit helpers, and the versioned migration framework.

- **Depends on:** nothing (only `zod`)
- **Rules:** Pure TS, no React. Saved types change only through a migration (bump `CURRENT_SCHEMA_VERSION`).
- **Built in:** session S02

## Public API (index.ts)

- Schemas + types: `WorkspaceSchema`/`Workspace`, `ProjectSchema`, `BoardSchema`, `SnapshotSchema`, `UserSettingsSchema` (+ `DEFAULT_USER_SETTINGS`), `GraphSchema`, `NodeInstanceSchema`, `EdgeInstanceSchema`, `GroupSchema`, `FirewallRuleSchema`, `ScenarioSchema`, `FlowSchema`, `ChaosEventSchema`, `SimResultSchema`, `NodeMetricsSchema`, `EdgeMetricsSchema`, `FindingSchema`, `TimePointSchema`, `ComponentDefinitionSchema`, `ProtocolDefinitionSchema`, `ProblemDefinitionSchema`, enums (`ProviderId`, `ModeId`, `Category`, …).
- Ids: `newId(kind, body?)`, `isId`, `idKindOf`, `idSchema(kind)`, `ID_PREFIXES`, `RegistryIdSchema`, `isRegistryId`.
- Units: `perDayToRps`, `usdPerHourToUsdPerMonth`, `HOURS_PER_MONTH`, byte/time conversions, `formatLatencyMs|Bytes|Rps|Usd|Percent`.
- Validation: `safeParseReadable(schema, x)` → `{ok, value} | {ok:false, errors: string[]}` (`"path[0].field: message"`), `parseOrThrow`, `ValidationError`, `formatIssues`.
- Migrations: `migrate(doc)`, `loadWorkspace(raw)` (migrate + validate), `CURRENT_SCHEMA_VERSION`, `MIGRATIONS`, `assertMigrationChain`, `getSchemaVersion`, `MigrationError`.
- Fixtures (tests only): `sampleWorkspace`, `sampleBoard`, `sampleWorkspaceV0`, `SAMPLE_IDS`.

## Layout

- schemas/ — common, graph, scenario, result, registry, workspace
- ids.ts, units.ts, validation.ts, load.ts
- migrations/ — `vN-to-vN+1.ts` files + `index.ts` (chain, `migrate`)
- fixtures/ — sample documents

## Extension points

- Saved type changes: add `migrations/vN-to-vN+1.ts`, append to `MIGRATIONS`, bump `CURRENT_SCHEMA_VERSION`, add a vN fixture test.
- New chaos event kinds are additive (no migration). S11 added `hotKey`, `dependencySlow`, `diskFull`, `coldStartBurst` (+ `CHAOS_EVENT_KINDS`), optional `EdgeConfig.breakerErrorThreshold` / `breakerOpenSec`, optional `TimePoint.nodes` / `edges` / `activeEventIds` (`NodeTickSchema`, `EdgeTickSchema`, `NODE_TICK_STATES`, `BREAKER_STATES`) and `SimResult.timelineEvents` (`TimelineMarkerSchema`, `TIMELINE_MARKER_KINDS`).
