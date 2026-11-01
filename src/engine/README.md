# engine

Analytical simulation: compile → load → route → M/M/c queueing → latency composition → `SimResult` with explain strings. Pure TS, no React, deterministic; runs in a Web Worker (Comlink).

- **Depends on:** `core`, `registry` · **Built in:** S07 (scaling + cost: S09)

## Public API (index.ts)

- `runSimulation(board, options?) → Promise<SimResult>` — the UI entry point; runs in the worker (in-thread fallback without `Worker`). `disposeSimulationWorker()`.
- `simulate(input, registry, options?) → SimResult` — the same run, synchronous. `SimInput = { graph, scenario, providerId? }`; `EngineOptions` / `DEFAULT_ENGINE_OPTIONS` (defaultRpsPerUser 0.1, defaultCacheHitRate 0.8, rhoCap 0.99, maxBranches 32, maxVisits 20 000).
- Stages: `compile(graph, registry) → Model`; `generateLoad(scenario, flows?) → FlowLoad[]`; `inferFlow(options)` / `INFERRED_FLOW_ID`; `route(loads, model, options) → RoutePlan`; `combineCalls`; `nodeQueueing`.
- Math: `mmc`, `erlangB`, `erlangC`, `expQuantileFactor`; latency `stageDist`, `fixedDist`, `sumDist`, `mixDist`, `quantile`, `percentiles`, `distMean`. Behaviors: `BEHAVIORS`, `defineBehavior`, type `Behavior`; LB `LB_ALGORITHMS`, `lbAlgorithm`, `targetWeight`. Types: `Model`, `CompiledNode`, `CompiledEdge`, `NodeStats`, `Expr`, `Op`, `Dist`.
- Scaling (S09): `verticalSpeedup`/`verticalScale` (Amdahl p = 0.9), `scaleSpecOf`, `buildPools`, `capacityForMix`, `poolUtilization`, `consistentHashImbalance`, `servingInstances`, `readersPerShard`, `SCALING_ROLES`/`scalingFields`/`roleValue`, `desiredReplicas`, `steadyStateReplicas`, `autoscaleTimeline` (for S11 ticks). Cost: `nodeCost`, `FALLBACK_PRICING`, `HOURS_PER_MONTH`.

## Model in one paragraph

Each replica is an M/M/c queue (c = `perf.maxConcurrencyPerInstance`, μ = 1000/S̄ with S̄ the read/write-weighted service time) receiving λ/replicas. A flow is an expression tree (visit / seq / choice / async): explicit `path` steps in order, or — for a flow with an empty path, or no flows at all — a walk from client nodes along edges. Latencies of a path add as a shifted exponential (Σ means + RSS of tail excess); LB splits and cache hit/miss make a mixture whose percentiles are solved by bisection. Rejections (`saturationBehavior: reject`) reduce downstream load (fixed-point iteration); `queue` saturation adds backlog wait over `durationSec`; nodes are evaluated at ρ ≤ `rhoCap`.

**Scaling (S09).** Service times are measured on a component's first instance type; a size with k× vCPU divides them by f(k) (`linear` k, `sublinear`/`single-writer` Amdahl). A node's traffic is spread over instance pools: even replicas (hottest gets f = 1 + √(2 ln N/V) × average behind a consistent-hash LB); single-writer = 1 primary per shard with all writes + R read replicas sharing reads; S shards with the hottest taking max(skew, 1/S). The node reports its busiest instance's ρ. Autoscale = steady state ⌈work/(c·target)⌉ clamped to min/max. Cost = instances × $/h × provider multiplier × 730 (+ standbys), or busy instances (Little) for serverless, or requests × $/M for $0/h managed services, + storage GB × copies × $/GB-month; volumes use peak ÷ peakMultiplier.

## Layout

- model/ — types, compile, load, route, expr, latency · queueing/ — mmc, node · behaviors/ — one file per behavior
- simulate.ts (one run) · worker.ts + worker-api.ts + client.ts (Comlink) · test-fixtures.ts (tests only)
- scaling/ — vertical, pools, roles, spec, autoscale · cost/ — cost.ts · geo/, chaos/ — empty until S10–S11

## Extension points

- New behavior = `behaviors/<id>.ts` exporting `behavior = defineBehavior({ id, routeOut?, routeRest?, cacheAsideHitRate?, hashVirtualNodes?, finish? })`; auto-discovered, matched by `ComponentDefinition.behaviors`.
- Scaling is data-driven: tag config fields with `.meta({ scaling: role })` (roles in `scaling/roles.ts`: shards, keySkew, readReplicas, standby, storageGb, storageCopies, maxInstances, minInstances).
