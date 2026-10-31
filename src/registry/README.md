# registry

Loads and validates every registry entry (components, providers, protocols, problems, rules, lessons) and offers lookup by id / category / tag / provider.

- **Depends on:** `core`
- **Rules:** Entries are plain objects created with `define*` helpers and auto-discovered with `import.meta.glob`.
- **Built in:** session S03

## Public API (index.ts)

- _Empty — scaffold only._

## Layout

- components/<category>/ — one file per component
- providers/ — aws, gcp, azure, generic
- protocols/ — one file per protocol
- problems/<id>/ — practice problems
- rules/ — review rules
- lessons/ — Learn-mode lessons

## Extension points

- Add a file in the right folder; no other edits needed (F2).
