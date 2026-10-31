# SysDraw — Progress

Every session appends a handoff note below (template in ROADMAP.md → Templates). Newest last.
Read this file and ARCHITECTURE.md at the start of every session.

## Follow-ups

- Decide whether to keep `docs/SPEC.MD` (it still holds the session prompts, section 10) or delete it once all prompts have been run.
- Run `pnpm exec playwright install chromium` once per machine before `pnpm e2e`.

---

## S01 — Scaffold and docs — 2026-10-31

Status: done
Changed: repo root config (package.json, tsconfig*.json, vite.config.ts, eslint.config.js, playwright.config.ts, .prettierrc.json, .prettierignore, .gitignore, .editorconfig, index.html, README.md), src/\* (all 14 module folders with index.ts + README.md, registry/engine/core subfolders), src/app/{main.tsx,index.css,index.ts,layout/AppShell.tsx}, src/test/setup.ts, tests/boundaries.test.ts, e2e/shell.spec.ts, docs/\*.md
Public APIs added/changed: `app` → `AppShell()` (five-region layout). All other modules export nothing yet (`export {}`).
Registry entries added: none
Tests: 7 added (2 AppShell render tests, 5 boundary-lint tests), all passing; 1 Playwright smoke test (`pnpm e2e`)

Notes:

- Stack versions: React 19, Vite 8, TypeScript 6.0 (pinned `~6.0` — typescript-eslint does not support TS 7 yet), Tailwind 4 (via `@tailwindcss/vite`, no config file), ESLint 10 flat config, Vitest 5, Playwright 1.64, pnpm 9 (`packageManager` field).
- TS is strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Path alias `@/*` → `src/*` (tsconfig + Vite).
- Module boundaries: `MODULE_DEPENDENCIES` in `eslint.config.js` mirrors ARCHITECTURE.md. One `boundaries/dependencies` rule enforces both the table and "only through index.ts" (`fileInternalPath` selector; the separate `entry-point` rule is deprecated in plugin v7). `boundaries/no-unknown-files` means every file under `src/` must live in a module folder. `src/test/` is a `test-support` element for Vitest setup.
- The browser entry lives at `src/app/main.tsx` (part of the `app` composition root) rather than `src/main.tsx`, so every file under `src/` belongs to a module.
- Engine gets an extra `behaviors/` folder (the spec's component template refers to `src/engine/behaviors/`).
- The two embedded diagrams in the spec (architecture layers, roadmap) were not in the markdown; ARCHITECTURE.md has a text layer diagram and ROADMAP.md a phase table reconstructed from the session list.

Known gaps / follow-ups:

- No Radix, Zustand, React Flow, Zod, Dexie, Comlink yet — each owning session adds its own dependency.
- Dark mode follows the OS (`prefers-color-scheme`); a theme toggle is S21.

Next suggested session: S02 — Core schemas and migrations
