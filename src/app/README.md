# app

Composition root: app shell layout, routing, theme, keyboard shortcuts.

- **Depends on:** any module (composition root)
- **Rules:** Wires modules together; contains no domain logic.
- **Built in:** session S01

## Public API (index.ts)

- `AppShell` — the five-region layout.

## Layout

- main.tsx — browser entry (mounted by index.html)
- index.css — Tailwind entry + global styles
- layout/ — AppShell (top bar, palette, canvas, inspector, metrics drawer)

## Extension points

- Panels are filled by mounting module components into the shell regions.
