# registry

Loads, validates and looks up every registry entry (components, protocols, providers, problems, rules, lessons).

- **Depends on:** `core` · **Built in:** S03 (cloud providers: S12, protocol catalog: S14)

## Public API (index.ts)

- `registry` — the app registry, built at import: `get(id)`, `get(id, kind)`, `require(id, kind)`, `has`, `kindOf`, `sourceOf`, `size`, `list({ kind?, category?, tag?, provider? })` (sorted by kind, then id). Ids are unique across all kinds.
- `defineComponent | defineProtocol | defineProvider | defineProblem | defineRule | defineLesson` — validate with Zod on import, throw `RegistryEntryError` ("Invalid component "x": path: message"), return a deep-frozen entry.
- Providers (S12, `provider-tools.ts`): `isAvailableOn` (components tagged `provider-only` exist on their one cloud, never generic), `componentDisplayName`, `componentIcon`, `providerService`, `instancePrice(provider, componentId, typeId)` (service `instancePrices`, else family size × service premium; undefined ⇒ component price), `servicePricing`, `serviceLimits(provider, componentId, config?)`, `mapRegion`/`mapRegionId` (via region `genericId`, else nearest by great-circle), `planProviderSwitch(registry, graph, scenario, from, to)` (renames, icons, regions, no-equivalent warnings, limits); schemas `ProviderServiceSchema`, `ServiceLimitSchema`, `LimitCheckSchema`, `ProviderInstanceFamilySchema`, `AsOfDateSchema`.
- Protocols (S14, `protocol-tools.ts`): `suggestedStacks(registry, fromDef, toDef)` → matching `suggestedStacks` of every protocol, most specific first (`matchScore`: id 4 > `tag:` 3 > `category:` 2 > any 1). 33 protocols (NETWORK-SECURITY.md table + wire protocols); `implicit` (IPv4, Ethernet, fibre) and `conceptual` (IPv6, ICMP, BGP/Anycast, JSON, Protobuf, Avro) entries are never placed on edges.
- `findUnresolvedReferences(registry)` — protocol `runsOn` and port protocol ids with no entry.
- `createRegistry`, `discoverEntries`, `RegistryLoadError`, `REGISTRY_KINDS` — for tests and tooling.
- Schemas + types for kinds core lacks: `ProviderDefinition`, `RuleDefinition` (+ `RuleContext`, `RuleCheck`), `LessonDefinition`, `RegistryProblemDefinition` (core problem with required `docs`).
- Geo (S10): `USER_REGIONS` (9 user regions: lat/long, UTC offset, last-mile ms; `geo/user-regions.ts`), `userRegion(id)`, `UserRegionSchema`. Cloud regions live in each provider's `regions` (generic: 26).
- `presets.ts` (internal): `GENERAL_PURPOSE_INSTANCES`, `MEMORY_OPTIMISED_INSTANCES` for component files.

- Security (S16, `security-tools.ts`): zone/exposure/encryption/security-group helpers used by rules, the engine and `security` (see src/security/README.md). 7 security components (`security.*`: WAF, DDoS shield, secrets manager, KMS, IAM, bastion/VPN, auth server) and 8 security rules (`rules/`); `RuleDefinition.fix?` returns a `FixPlan`; `RuleContext.protocols?`. Controls are `control:<id>` tags (API gateway: rate-limit + auth; service mesh: mtls).

## Layout

- components/<category>/<name>.ts — one entry per file; id = `<category>.<name>` (`clients` → `client.`)
- protocols/<id>.ts — bare ids (`tcp`, `tls13`, `http2`) to match edge `protocolStack`s
- providers/<id>.ts (generic, aws, gcp, azure: regions with `genericId`, `pricing.asOf` + `region`, `instanceFamilies` by generic size, `services` by component id: icon, prices, limits, `nearest`) · rules/_.ts · lessons/_.ts · problems/<id>/index.ts
- sources.ts — the `import.meta.glob` calls; test-fixtures/ — never loaded by the app

## Extension points

- Add a file in the right folder exporting a `define*` result (default or named). Nothing else (F2).
- Config fields: `.describe('help text')`; mark advanced knobs with `.meta({ advanced: true })`.
- Scaling/cost roles (S09): `.meta({ scaling: 'shards' | 'keySkew' | 'readReplicas' | 'standby' | 'storageGb' | 'storageCopies' | 'maxInstances' | 'minInstances' })` — the engine and the inspector's Scale actions find fields by role. `perf.serviceTimeMs` is measured on the FIRST instance type.
- Performance knobs (S13): `.meta({ perfEffect: { <option>: { read?, write?, readAddMs?, writeAddMs?, why } } })` on a config field + behavior `configPerf` — factors scale work and wait, `*AddMs` add wait only (booleans key as 'true'/'false').
- Behavior config contracts (S13, read by name): cache `keyCount`, `avgItemBytes`, `zipfExponent`, `evictionPolicy`, `usableMemoryFraction`, `readPreference`; queue/log `partitions`, `replicationFactor`, `messageBytes`, `retentionHours`, `storageGb`, `keySkew`; quorum `replicationFactor`, `readConsistency`, `writeConsistency`, `vnodes`; see each behavior file's header for the rest.
- A file with no entry, or the wrong kind for its folder, fails loading with the file path.
