You are working on SysDraw, a browser app for practising system design: users draw
architectures on a canvas, configure components, simulate traffic from users worldwide,
and see latency/throughput/cost/failures per component and end to end. It also teaches
the network protocols and security on every connection.

Non-negotiable architecture (details in docs/ARCHITECTURE.md):
- TypeScript strict, React + Vite, Zustand store, React Flow canvas, Zod schemas.
- Everything is data-driven: components, protocols, cloud providers, problems and
  rules are REGISTRY ENTRIES (plain objects validated by Zod), never hard-coded in UI.
- The simulation engine is pure TS in src/engine, runs in a Web Worker, has no React
  imports, and is deterministic given a seed.
- Modules talk only through their index.ts public API.
- Saved files are versioned JSON with migrations.

Rules for this session:
- Do ONLY the task below. Read docs/ARCHITECTURE.md and docs/PROGRESS.md first, then
  only the folders the task lists.
- Don't change public APIs of other modules; if you must, say so and stop.
- Write unit tests for logic. Keep `npm test` and `npm run build` green.
- Finish by appending a handoff note to docs/PROGRESS.md (what changed, public APIs
  added, known gaps, next step) and listing the files you touched.

  Run tests with `pnpm test --reporter=dot` and builds with `pnpm build --logLevel warn`; only show failures.