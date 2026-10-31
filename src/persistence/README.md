# persistence

IndexedDB adapter (Dexie), autosave, snapshots, JSON import/export.

- **Depends on:** `core`, `store`
- **Rules:** Runs migrations on every load and import.
- **Built in:** session S06

## Public API (index.ts)

- _Empty — scaffold only._

## Extension points

- New storage backend = new adapter behind the same API.
