# metrics-ui

Dashboards, per-node panels, charts and "show formula" tooltips for SimResult.

- **Depends on:** `store`
- **Rules:** Reads results from the store; never computes metrics itself.
- **Built in:** session S08

## Public API (index.ts)

- _Empty — scaffold only._

## Extension points

- New panel = component reading a SimResult field.
