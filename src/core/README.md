# core

Zod schemas and inferred types for every saved document and registry entry, prefixed ids, unit helpers, and the versioned migration framework.

- **Depends on:** nothing
- **Rules:** Pure TS, no React. Types change only through a migration (bump `schemaVersion`).
- **Built in:** session S02

## Public API (index.ts)

- _Empty — scaffold only._

## Layout

- schemas/ — one Zod schema per type in docs/DATA-MODEL.md
- ids.ts — prefixed ids (`node_`, `edge_`, `grp_`, `board_`)
- units.ts — unit helpers (`latencyMs`, `sizeBytes`, ...)
- migrations/ — ordered migration functions, `migrate(doc)`

## Extension points

- Add a migration file in migrations/ whenever a saved type changes.
