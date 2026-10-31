# engine

The simulation: compile graph -> load -> route -> queueing -> network -> latency -> chaos -> cost -> evaluate. Pure functions plus a Web Worker wrapper.

- **Depends on:** `core`, `registry`
- **Rules:** No React imports (lint-enforced). Deterministic given a seed. UI reaches it only via this index.ts.
- **Built in:** session S07

## Public API (index.ts)

- _Empty — scaffold only._

## Layout

- model/ — compiled internal model
- queueing/ — M/M/c, Erlang C
- geo/ — regions, great-circle RTT
- scaling/ — replicas, instance size, autoscale
- chaos/ — failure events, time series
- cost/ — price tables
- behaviors/ — loadBalancer, cache, queue, ... (one file each)
- worker.ts — Comlink worker entry (S07)

## Extension points

- New behavior = new file in behaviors/ selected by `ComponentDefinition.behaviors`.
