# SysDraw

A flight simulator for system design: draw a system, throw realistic global traffic at it,
watch where it breaks, and fix it. Runs fully in the browser.

## Getting started

```sh
corepack enable        # once, provides the pinned pnpm
pnpm install
pnpm dev               # http://localhost:5173
```

| Command       | What it does                                                                   |
| ------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`    | Vite dev server                                                                |
| `pnpm build`  | Type-check (`tsc -b`) and production build                                     |
| `pnpm test`   | Vitest unit tests (includes the module-boundary lint test)                     |
| `pnpm lint`   | ESLint, including module-boundary rules                                        |
| `pnpm format` | Prettier                                                                       |
| `pnpm e2e`    | Playwright smoke test (run `pnpm exec playwright install chromium` once first) |

## Docs

Start with `docs/ARCHITECTURE.md` and `docs/PROGRESS.md`. Then `DATA-MODEL.md`, `ENGINE.md`,
`NETWORK-SECURITY.md`, `MODES.md`, `ROADMAP.md`. Each module in `src/` has a short `README.md`.
