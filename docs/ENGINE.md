# SysDraw — Simulation engine

> Source: `docs/SPEC.MD` (Oct 31, 2026), installed in session S01. This file is the source of truth from now on; change it only through an architecture-change session.

## Simulation engine

The engine is an analytical flow model first (instant results, used while editing) with an optional discrete-event mode later (for chaos timelines and tail-latency realism). Both share the same inputs and `SimResult` output.

**Pipeline (one run)**

1. **Compile**: validate the graph, resolve each node's `ComponentDefinition`, expand replicas, attach region from the enclosing group.
2. **Generate load**: for each region and flow, arrival rate = users × rpsPerUser × share × peakMultiplier (× diurnal curve for that region's local time).
3. **Route**: walk each flow's path; split traffic by load-balancer algorithm, cache hit rate, shard key distribution, and geo routing (nearest healthy region).
4. **Per-node queueing**: compute utilisation and waiting time (M/M/c below); saturated nodes queue, reject or degrade per `saturationBehavior`.
5. **Per-edge network cost**: propagation + handshake RTTs + serialisation + protocol overhead (section 6).
6. **Compose latency** along each flow; parallel fan-out takes the max, sequential calls add; retries multiply load on downstream nodes.
7. **Apply chaos events**: remove failed nodes/regions, add packet loss, re-route, recompute.
8. **Cost**: instances × $/hr × 730 + storage + egress per provider price table.
9. **Evaluate**: run review rules, produce findings and bottleneck list.

**Formulas (each shown in the UI's "show formula" tooltip)**

Utilisation of a node with c instances, arrival rate λ and per-instance service rate μ:

```latex
\rho = \frac{\lambda}{c\,\mu}
```

Mean queueing wait (M/M/c, Erlang C), then response time:

```latex
W_q = \frac{C(c, \lambda/\mu)}{c\mu - \lambda}, \qquad T = W_q + \frac{1}{\mu}
```

Percentiles are approximated from the exponential tail of the response time; p99 ≈ T × ln(100) for a single M/M/1 stage, and per-stage percentiles are composed with a documented approximation (sum of means + root-sum-square of tail excess).

Network latency between two points distance d apart (light in fibre ≈ 200 km/ms, route factor ≈ 1.5):

```latex
RTT \approx 2 \cdot \frac{1.5\, d}{200\ \text{km/ms}} + \text{per-hop overhead}
```

Cache: effective downstream load = λ × (1 − hitRate); hitRate comes from a Zipf model of key popularity vs cache size and TTL.

Vertical scaling changes μ (via vCPU and `scaleCurve`); horizontal scaling changes c. A `single-writer` store (e.g. one SQL primary) does not gain write capacity from replicas, only read capacity.

**Geo model.** A built-in table of about 25 cloud regions with lat/long; region-to-region RTT is computed from great-circle distance and can be overridden with measured values. User regions (e.g. North America, Europe, India, SE Asia, LATAM, Africa, Oceania) route to the nearest healthy deployment, or via CDN/edge if present.

**Real-life conditions to model** (each a scenario toggle or chaos event): diurnal traffic per time zone, flash spikes (×10 for N seconds), hot keys / celebrity users, cold starts for serverless, connection-pool exhaustion, GC pauses, replication lag and stale reads, cross-region partitions, AZ and region outages, packet loss and its effect on TCP vs QUIC, DNS TTL failover delay, retry storms and thundering herd, rate-limit rejections, disk full, noisy neighbour.

**Determinism and speed.** Same graph + scenario + seed gives the same result. Analytical runs re-execute on every edit (debounced 300 ms) in the worker; target under 1 s for 300 nodes.

**Behaviors.** Component-specific logic lives in small behavior modules selected by `ComponentDefinition.behaviors`: `loadBalancer` (round-robin, least-conn, consistent hash), `cache` (Zipf hit rate, eviction, TTL), `queue` (partitions, consumer groups, lag = backlog / consume rate), `replicatedStore` (leader/follower, quorum R/W/N, replication lag), `shardedStore` (key distribution, hot shard), `cdn` (edge hit ratio, origin shield), `rateLimiter` (token bucket, sliding window), `serverless` (concurrency limit, cold start), `circuitBreaker`. New behaviors are added as files without touching the core loop.
