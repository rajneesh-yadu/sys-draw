# inspector

Schema-driven forms for the selected node, edge, group or board scenario.

- **Depends on:** `store`, `registry`
- **Rules:** Forms are generated from Zod schemas in the registry; edits dispatch store commands.
- **Built in:** session S05

## Public API (index.ts)

- _Empty — scaffold only._

## Extension points

- New field kinds = new form widgets keyed by schema type.
