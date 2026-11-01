# estimator

Back-of-envelope capacity calculator (QPS, storage, bandwidth, cache) linked to the scenario (F12).

- **Depends on:** `core` · **Built in:** S20
- **Rules:** Pure math on core types; every number carries its formula. The UI never touches the store: "Push to scenario" hands a patch to an `onPush` callback (the app dispatches `updateScenario`).

## Public API (index.ts)

- Math (`estimate.ts`): `EstimatorInputsSchema` / `EstimatorInputs` (dau, actionsPerUserPerDay, readRatio:writeRatio, objectSizeBytes, retentionYears, peakFactor ≥ 1, replicationFactor, hotDataFraction), `DEFAULT_ESTIMATOR_INPUTS`, `parseEstimatorInputs`, `estimate(inputs)` → `Estimate` (qps avg/peak/read/write, storage per day/yr/retained, bandwidth in/out avg/peak, cacheBytes, `lines: EstimateLine[]` each with `formula`, `substituted`, `display`, `note?`), `ESTIMATE_SECTION_LABEL`, `formatCount`, `formatBandwidth`, `DAYS_PER_YEAR`.
- Push (`scenario.ts`): `scenarioPatchFromEstimate(estimate, scenario, { newFlowId?, defaultRegionId? })` → `{ patch, summary, notes }`. The patch sets `usersByRegion` (DAU in the current region proportions), `flows` (rpsPerUser = actions ÷ 86 400; shares = read:write split over read/write flows; no flows → one `flow_estimator` with an empty path), `peakMultiplier`, `diurnal: false`, `payloadBytes` (per-request average). Also `distributeUsers`, `isWriteFlow`, `DEFAULT_USER_REGION`.
- Latency card data (`latency.ts`): `LATENCY_NUMBERS`, `ESTIMATION_RULES`, `formatNs`, `humanScale` (L1 = 1 s), `latencyBarPercent`, `L1_REFERENCE_NS`.
- Form state (`draft.ts`): `EstimatorDraft`, `draftFromInputs`, `inputsFromDraft` (per-field errors), `parseNumber` ("100M", "1.5k", "2,000"), `SIZE_UNITS`.
- UI: `EstimatorButton({ scenario?, onPush? })` (top-bar button + dialog; draft kept while mounted), `EstimatorPanel`, `EstimateResults`, `LatencyCard`; types `PushResult`, `EstimatorProps`.

## Extension points

- New estimate = one more `line(...)` in `estimate()` with its formula; it shows up in its section.
- New latency fact = one entry in `LATENCY_NUMBERS`.
