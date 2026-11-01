# metrics-ui

Bottom metrics drawer: system KPIs, per-flow percentiles, bottlenecks, per-component detail with charts, and a "show formula" tooltip on every number.

- **Depends on:** `store` · **Built in:** S08
- **Rules:** Reads the store's simulation result (`useSimulationStore`); never computes metrics or calls the engine. "Run" only calls `requestRun()`.

## Public API (index.ts)

- `<MetricsDrawer defaultOpen? />` — header (run status, Run, Hide/Show) + body: KPIs (throughput, error rate, availability, cost/month), flow table (rps, p50/p95/p99, errors), bottleneck list (click = select node + `requestFocus` so the canvas zooms to it), latency by user region (S10: `SimResult.perRegion` — rps, served-from region, network ms, p50, p99, errors when any), simulation notes (engine findings), detail of the selected component.
- `<NodeDetail label m />`, `<UtilizationMeter m />` (60 %/85 % marks, colour + label), `<LatencyChart m />` (Recharts, p50/p95/p99).
- `<FormulaValue label formula>` — a number as a button; hover/focus/click shows the formula (portal, fixed position; one open at a time; Escape closes without clearing the canvas selection). Accessible name `"<label>: show formula"`.
- Formula text: `nodeFormula(field, m)` (= `SimResult.perNode[id].explain`), `systemFormulas(result, scenario)`, `flowFormula(field, flow, scenario)`, `flowName`, `bottleneckRows`, `regionFormula`/`regionRows` (S10), `INFERRED_FLOW_ID`/`INFERRED_FLOW_NAME`.

## Notes

- SimResult has `explain` only per node/edge, so system and flow formulas are stated here from the result's own numbers (no new metrics). Moving them into the engine needs a core schema change.
- Utilisation bands and number formatting come from the store (`utilizationLevel`, `formatRps/Ms/Percent/Usd`) so canvas and drawer agree.

## Extension points

- New panel = component reading a `SimResult` field from `useSimulationStore`; new number = wrap it in `FormulaValue`.
