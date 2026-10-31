# persistence

IndexedDB adapter (Dexie), load-on-start with migrations, debounced autosave, JSON import/export.

- **Depends on:** `core`, `store` · **Built in:** S06
- **Rules:** Runs core migrations on every load and import. Never drops data silently: anything migrated, repaired or skipped on load is backed up first (`backups` table).

## Public API (index.ts)

- Save format `SaveFile` = `{ format: 'sysdraw', kind: 'workspace'|'project'|'board', schemaVersion, exportedAt, settings, projects, boards, layouts }` — a Workspace doc plus boards and their group frames, all under one `schemaVersion`.
- Export: `workspaceFile(data)`, `projectFile(data, projectId)`, `boardFile(data, boardId)`, `serializeSaveFile`, `saveFileName`.
- `parseSaveFile(textOrObject, { lenient? })` → migrate + validate → `{ file, fromVersion, applied, warnings }` or readable `errors`. Strict (import) rejects any invalid board; lenient (storage) skips/repairs with warnings.
- `importSaveFile(workspaceStore, input, { projectId? })` — board files become tabs in the open project; project/workspace files add projects. Ids kept when free, re-minted on collision. Nothing changes on error.
- `openWorkspace(workspaceStore, adapter, { delayMs? })` → `{ status: new|loaded|upgraded|reset, applied, warnings, autosave }`.
- `startAutosave(store, adapter, { delayMs = 600 })` → `{ status (zustand store: saved|pending|saving|error), flush(), stop() }`. Writes only boards whose object changed; honours `settings.autosave`.
- Adapters: `createDexieAdapter(dbName = 'sysdraw')`, `createMemoryAdapter()`; interface `StorageAdapter { read, write, replaceAll, backup }`.
- `toWorkspaceData(file)`, `BoardLayoutSchema`.

## Storage layout (Dexie v1)

- `meta`: `workspace` → `{ schemaVersion, settings, projects }`; `ui` → `{ activeBoardId }` (per device, not exported).
- `boards`: `{ id, board, layout }` one row per board. `backups`: `{ at, reason, raw }`.
- Dexie's own version is table layout only; the document format is versioned by `schemaVersion`.

## Extension points

- New storage backend (e.g. cloud sync) = new `StorageAdapter`; nothing else changes.
- Saved type change = core migration; it must also migrate `boards[]` (they share `schemaVersion`).
