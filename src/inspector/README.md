# inspector

Schema-driven forms for the selected node, edge, group, or (nothing selected) the board scenario.

- **Depends on:** `store`, `registry` · **Built in:** S05
- **Rules:** Forms are generated from Zod schemas; every committed field edit dispatches exactly one store command (one undo step). Invalid values are blocked in the form with a reason, and again by the store.

## Public API (index.ts)

- `<Inspector />` — picks NodePanel / EdgePanel / GroupPanel / ScenarioPanel from the store selection; each has Settings and Docs tabs.
- `<SchemaForm schema value onCommit label overrides? sections? />` — generic form; `onCommit({ [topKey]: value })` returns `{ok} | {ok:false, reason}`.
- `buildFormModel(schema, overrides?)` → `{ basic, advanced }` `FieldModel[]`; `buildFields`, `buildField`, `defaultValueFor`, `inferUnit`, `humanize`.
- `issuesByPath(schema, value)`, `readableIssue`, `errorAt`, `setAtPath`, `getAtPath`.

## Scale quick actions (S09)

Node panel → Scaling: +1 replica, Size up/down (same instance family, by vCPU), Add read replica, Shard ×2 — each one store command; fields found via registry `.meta({ scaling })` roles; unavailable actions are disabled with a reason (`panels/scale-actions.ts`).

## Scenario editor (S10)

Board panel → Users: world map (`geo/world-land.ts`, static Natural Earth outline; `geo/users-model.ts` projection) with one marker per registry `USER_REGIONS` entry (area ∝ share, click = edit) and the board's Region-group cloud regions; one number input per region ("<Name> users"; 0 removes it). Daily cycle and peak multiplier stay in the schema form. Each edit = one `updateScenario`.

## Field kinds

number (unit from `.meta({unit})` or key suffix `Ms`/`Sec`/`Gb`/`Bytes`…, min/max/int), enum (select), boolean (switch), string, nested object (optional ⇒ on/off switch), array (add/remove), record (key/value rows). Anything else renders as "not editable here yet".

## Extension points

- Registry schemas: `.describe('help')`, `.meta({ advanced: true, label, unit, step })`.
- Schemas a panel doesn't own: pass `FieldOverrides` keyed by dotted path (`'autoscale.min'`, `'firewallRules.*.peer'`), incl. `options` (string → select) and `defaultValue`.
- New field kind = a case in `buildField` + a widget in `SchemaForm.tsx`.
