# registry

Loads, validates and looks up every registry entry (components, protocols, providers, problems, rules, lessons).

- **Depends on:** `core` · **Built in:** S03

## Public API (index.ts)

- `registry` — the app registry, built at import: `get(id)`, `get(id, kind)`, `require(id, kind)`, `has`, `kindOf`, `sourceOf`, `size`, `list({ kind?, category?, tag?, provider? })` (sorted by kind, then id). Ids are unique across all kinds.
- `defineComponent | defineProtocol | defineProvider | defineProblem | defineRule | defineLesson` — validate with Zod on import, throw `RegistryEntryError` ("Invalid component "x": path: message"), return a deep-frozen entry.
- `isAvailableOn(def, provider)`, `componentDisplayName(def, provider)` — provider filtering / relabelling (F4).
- `findUnresolvedReferences(registry)` — protocol `runsOn` and port protocol ids with no entry.
- `createRegistry`, `discoverEntries`, `RegistryLoadError`, `REGISTRY_KINDS` — for tests and tooling.
- Schemas + types for kinds core lacks: `ProviderDefinition`, `RuleDefinition` (+ `RuleContext`, `RuleCheck`), `LessonDefinition`, `RegistryProblemDefinition` (core problem with required `docs`).
- `presets.ts` (internal): `GENERAL_PURPOSE_INSTANCES`, `MEMORY_OPTIMISED_INSTANCES` for component files.

## Layout

- components/<category>/<name>.ts — one entry per file; id = `<category>.<name>` (`clients` → `client.`)
- protocols/<id>.ts — bare ids (`tcp`, `tls13`, `http2`) to match edge `protocolStack`s
- providers/<id>.ts · rules/_.ts · lessons/_.ts · problems/<id>/index.ts (siblings hold graphs)
- sources.ts — the `import.meta.glob` calls; test-fixtures/ — never loaded by the app

## Extension points

- Add a file in the right folder exporting a `define*` result (default or named). Nothing else (F2).
- Config fields: `.describe('help text')`; mark advanced knobs with `.meta({ advanced: true })`.
- A file with no entry, or the wrong kind for its folder, fails loading with the file path.
