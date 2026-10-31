# canvas

React Flow rendering of the board: palette, component and group nodes, edge drawing, shortcuts, auto-layout.

- **Depends on:** `store`, `registry` · **Built in:** S04
- **Rules:** Renders store state; every edit goes through `store.dispatch`. Never computes metrics.

## Public API (index.ts)

- `<CanvasProvider>` — wraps palette + canvas (shared React Flow instance, snap and group-kind settings).
- `<Palette />` — registry components for the board's provider, by category, with search; drag to the canvas or Enter/click to add at the view centre. "Containers" adds Region/AZ/VPC/Subnet/Cluster (click wraps the selection).
- `<BoardCanvas />` — nodes (icon, label, product name, replica badge, one handle per port), groups (drag by header, resize when selected), edges labelled with their top protocol (async edges animated), minimap, controls, toolbar, error banner.
- Pure helpers: `computeGroupRects`, `findDropGroup`, `NODE_WIDTH`/`NODE_HEIGHT`/`GRID`, `computeAutoLayout` (ELK, lazy-loaded), `shortcutFor`, `SHORTCUT_HELP`.

## Behaviour

- Connections are validated by `store.checkConnection` (ports + shared protocol) while dragging.
- Dropping a node/group inside a group sets `groupId`/`parentId`; dropping outside clears it.
- Groups are drawn at their stored frame grown to fit their contents.
- Shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z (Ctrl+Y), C/X/V, A, G (group as toolbar kind), Shift+G (ungroup), Delete, Esc. Shift-drag = box select.

## Extension points

- Overlays (heatmap, badges) will be extra node data + layers; node/edge types are registered in `BoardCanvas.tsx`.
