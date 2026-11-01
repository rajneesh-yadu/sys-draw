# security

Zones, exposure, security controls, threat review and the "Security" overlay model (S16).

- **Depends on:** `core`, `registry` · **Built in:** S16
- **Rules:** Pure TS, no React. Threat checks are registry rules (`category: 'security'`); fixes are plain-data `FixPlan`s the app turns into one undoable store batch.

## Public API (index.ts)

- Zone model (re-exported from `registry/security-tools.ts`, shared with rules and the engine): `SECURITY_ZONES` (public / dmz / private / data), `ownZone` (explicit `zone`, else `public` flag ⇒ public / private), `zoneGroup` / `groupZone` (nearest zoned ancestor), `nodeZone` (clients = 'internet'), `nodeExposure` (internet / exposed / dmz / internal / unzoned + reason), `edgeEncryption` (mtls / tls / plaintext / unknown), `edgePort`, `encryptedStack` (insert TLS/mTLS above TCP if `runsOn` allows), `zoneCrossings` + `evaluateIngress` (security-group check: deny wins, then allow; rules but no match = default deny; no ingress rules = `no-rules`), `ADMIN_PORTS`, `SECURITY_CONTROLS` / `controlsOf` (components declare `control:<id>` tags), labels.
- `reviewSecurity({ graph, scenario?, result?, registry })` → `SecurityFinding[]` (worst first; `key`, `ruleTitle`, `fixLabel` when the rule can fix it). A throwing rule becomes an info finding.
- `securityFix(input, key)` → `FixPlan | undefined` for the finding with that key on the current board.
- `securityOverlay(graph, lookups)` → nodes (exposure + badge text), edges (encryption + label, zone crossing with verdict and explain), groups (zone).
- `ATTACKS` — learn data for the four attack chaos events (what it does, impact, controls that stop it).
- `securityRules`, `ruleContext`, `findingKey`, `SEVERITY_RANK`.

## Extension points

- New threat check = `registry/rules/<name>.ts` with `category: 'security'` (+ optional `fix` returning `FixStep`s: setGroupSecurity, createGroup, setEdgeStack, insertOnEdge, addNode).
- New control = a component with a `control:<id>` tag (ids in `SECURITY_CONTROLS`); attack mitigation factors live in `engine/chaos/attacks.ts`.
