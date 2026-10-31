# engine

Analytical simulation: compile → load → route → M/M/c queueing → latency composition → `SimResult` with explain strings. Pure TS, no React, deterministic; runs in a Web Worker (Comlink).

- **Depends on:** `core`, `registry` · **Built in:** S07

## Public API (index.ts)

- `runSimulation(board, options?) → Promise<SimResult>` — the UI entry point; runs in the worker (in-thread fallback without `Worker`). `disposeSimulationWorker()`.
- `simulate(input, registry, options?) → SimResult` — the same run, synchronous. `SimInput = { graph, scenario, providerId? }`; `EngineOptions` / `DEFAULT_ENGINE_OPTIONS` (defaultRpsPerUser 0.1, defaultCacheHitRate 0.8, rhoCap 0.99, maxBranches 32, maxVisits 20 000).
- Stages: `compile(graph, registry) → Model`; `generateLoad(scenario, flows?) → FlowLoad[]`; `inferFlow(options)` / `INFERRED_FLOW_ID`; `route(loads, model, options) → RoutePlan`; `combineCalls`; `nodeQueueing`.
- Math: `mmc`, `erlangB`, `erlangC`, `expQuantileFactor`; latency `stageDist`, `fixedDist`, `sumDist`, `mixDist`, `quantile`, `percentiles`, `distMean`.
- Behaviors: `BEHAVIORS`, `defineBehavior`, type `Behavior`. Types: `Model`, `CompiledNode`, `CompiledEdge`, `NodeStats`, `Expr`, `Op`, `Dist`.

## Model in one paragraph

Each replica is an M/M/c queue (c = `perf.maxConcurrencyPerInstance`, μ = 1000/S̄ with S̄ the read/write-weighted service time) receiving λ/replicas. A flow is an expression tree (visit / seq / choice / async): explicit `path` steps in order, or — for a flow with an empty path, or no flows at all — a walk from client nodes along edges. Latencies of a path add as a shifted exponential (Σ means + RSS of tail excess); LB splits and cache hit/miss make a mixture whose percentiles are solved by bisection. Rejections (`saturationBehavior: reject`) reduce downstream load (fixed-point iteration); `queue` saturation adds backlog wait over `durationSec`; nodes are evaluated at ρ ≤ `rhoCap`.

## Layout

- model/ — types, compile, load, route, expr, latency · queueing/ — mmc, node · behaviors/ — one file per behavior
- simulate.ts (one run) · worker.ts + worker-api.ts + client.ts (Comlink) · test-fixtures.ts (tests only)
- geo/, scaling/, chaos/, cost/ — empty until S09–S11

## Extension points

- New behavior = `behaviors/<id>.ts` exporting `behavior = defineBehavior({ id, routeOut?, routeRest?, cacheAsideHitRate?, finish? })`; auto-discovered, matched by `ComponentDefinition.behaviors`.
