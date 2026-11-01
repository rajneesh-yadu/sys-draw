# canvas

React Flow rendering of the board: palette, component and group nodes, edge drawing, shortcuts, auto-layout.

- **Depends on:** `store`, `registry` · **Built in:** S04 (overlays S08)
- **Rules:** Renders store state; every edit goes through `store.dispatch`. Never computes metrics.

## Public API (index.ts)

- `<CanvasProvider>` — wraps palette + canvas (shared React Flow instance, snap and group-kind settings).
- `<Palette />` — registry components for the board's provider (S12: provider names and icons; provider-only components on their cloud only), by category, with search; drag to the canvas or Enter/click to add at the view centre. "Containers" adds Region/AZ/VPC/Subnet/Cluster (click wraps the selection).
- `<BoardCanvas />` — nodes (icon and product name from the board's provider — S12 — label, replica badge, amber "No <provider> equivalent" badge, one handle per port), groups (drag by header, resize when selected), edges labelled with their top protocol (async edges animated), minimap, controls, toolbar, error banner.
- Performance overlays (S08, read from `useSimulationStore`): node border + pill coloured by utilisation (green < 60 %, amber < 85 %, red with ⚠), rps and a p99 badge under each node; edges (`sdEdge` → `edges/ProtocolEdge.tsx`) get stroke width by rps (√ scale vs the busiest edge, `edgeStrokeWidth`) and a "protocol · latency" label; tooltips show `SimResult.explain`. A `focus` request zooms to that node.
- Failure timeline playback (S11): while the simulation store's `playback.tick` is set, nodes show that tick (`TimePoint.nodes`): utilisation colour, rps, p99, error share, autoscaled replica count, and a red dashed border + "Down" pill for dead nodes (`data-state` up/degraded/down); edges take that tick's rps for width, and `tickEdgeStyle` makes open/half-open breakers dashed with a text badge and ≥ 50 %-failing edges red with "N% fail".
- Region groups (S10) show their real cloud region id in the header (name in the tooltip), or an amber "Pick a region" when unset/unknown.
- Pure helpers: `computeGroupRects`, `findDropGroup`, `NODE_WIDTH`/`NODE_HEIGHT`/`GRID`, `computeAutoLayout` (ELK, lazy-loaded), `shortcutFor`, `SHORTCUT_HELP`.

- Request trace (S15, `trace/`): `createTraceStore` (open, request = flow / user region / `warm` false·'resumed'·true / cache branch, `trace: TraceView`, `step`, `playing`; `start`/`finish`/`fail` drop stale runs), provided by `<CanvasProvider traceStore?>` (`useTraceStore`, `useTraceStoreApi`). `<TracePanel />` = options, step controls (reset / prev / play / next), "Where time goes" bar + table, current-step card (layer, headers, explain), sequence diagram (click a row to jump). Edges draw the current step's packet (`data-testid="trace-packet"`, SMIL `animateMotion`, reversed for responses) and dash the traced path; nodes get `data-trace` (arriving / queue / service). Toolbar "Trace request" toggles it. View types mirror the engine's `RequestTrace` (the app maps it); colours `traceColor` (`--trace-<category>` in app/index.css).

- Security (S16, `security/`): `createSecurityStore` (open, `view: SecurityView` = node exposure, edge encryption/crossing, group zones, findings; `fixHandler` registered by the app; `fix(key)` → `lastFix`), provided by `<CanvasProvider securityStore?>`. Toolbar "Security" (red badge = critical + error count) opens `<SecurityPanel />` (legend, findings worst first, click a title to select targets, "Fix: …" button) and the overlay: node border + badge by exposure (`data-exposure`), edges coloured by encryption (plaintext dashed red) with a "· TLS 1.3 / Plaintext / blocked" label. Groups with security show a zone badge (`group-zone`) always.
- Review (S19, `review/`): `createReviewStore` (open, `view: ReviewView` = findings with category/ruleTitle/source/fixLabel, `checked`, `skipped`, `hasResult`; `filter`; `fixHandler` from the app; `fix(key)` → `lastFix`), `categoryCounts`, `jumpTarget`; `<CanvasProvider reviewStore?>`. Toolbar "Review" (red badge = critical + error) opens `<FindingsPanel />`: category chips, findings worst first, crosshair = select targets + `requestFocus` (edge → its source), "Apply fix: …" only when the rule offers a safe fix, coverage line ("N rules checked · M not applicable").

## Behaviour

- Connections are validated by `store.checkConnection` (ports + shared protocol) while dragging.
- Dropping a node/group inside a group sets `groupId`/`parentId`; dropping outside clears it.
- Groups are drawn at their stored frame grown to fit their contents.
- Shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z (Ctrl+Y), C/X/V, A, G (group as toolbar kind), Shift+G (ungroup), Delete, Esc. Shift-drag = box select.

## Extension points

- Overlays read the simulation store inside the node/edge components (not node data, so a result arriving mid-drag never resets positions); node/edge types are registered in `BoardCanvas.tsx`.
