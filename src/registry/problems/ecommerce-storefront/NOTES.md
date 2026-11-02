# Sample board: E-commerce storefront & checkout

Companion notes for `problem.sample-ecommerce` (S22). To open it: **Problems → tag "sample" → Start problem → Reference** (Sandbox mode). You get a new board with the design and its peak scenario. Then press Run.

**Workload:** 2M concurrent shoppers (95 % North America, 5 % Europe), 0.02 requests/s each, 2.5× sale peak. That is about **100k requests/s**: 40k images, 30k product pages, 10k searches, 10k click events, 6k cart writes, 2k logins and 2k orders/s.

## Main paths

| Flow            | Path                                                                                                                                            | Why this way                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Images & assets | client → CDN → object store                                                                                                                     | Immutable keys + 30-day TTL + origin shield: the CDN answers about 80 % at the edge. |
| Product page    | client → DDoS shield → WAF → API gateway → mesh → storefront → Redis → (miss) Postgres replicas                                                 | Cache-aside. Redis hit ≈ 95 % with a 10-minute TTL, so Postgres only sees misses.    |
| Search          | … → storefront → Elasticsearch                                                                                                                  | Full-text search runs on its own index, never as LIKE queries on Postgres.           |
| Add to cart     | … → storefront → carts (key-value)                                                                                                              | Carts must be durable and are always read by cart id: a partitioned KV store fits.   |
| Sign in         | … → API gateway → auth server → Postgres (users)                                                                                                | Argon2 hashing is slow on purpose, so auth runs as its own fleet with MFA required.  |
| Place order     | … → checkout → carts → Postgres (order + stock + idempotency key, one transaction) → Kafka ⇢ workers ⇢ DR copy, email queue → serverless mailer | The user waits only for the commit and the publish. Everything else is asynchronous. |
| Clickstream     | … → storefront → Kafka ⇢ workers                                                                                                                | Workers batch about 50k rows per ClickHouse insert.                                  |

`→` = synchronous, `⇢` = asynchronous.

## Why each component is there

- **Edge:** Geo DNS (health-checked, DNS over TLS), CDN, DDoS shield (anycast), WAF (bot control), API gateway (JWT checks and per-client rate limits). They absorb or reject bad traffic before it costs any compute.
- **Service mesh ingress:** routes to the Kubernetes services and gives each service an mTLS identity. This is what satisfies "service-to-service authentication". It sits between the API gateway and the services.
- **Storefront vs checkout:** two deployments, so a browse surge can't starve checkout. Both autoscale on CPU, targeting 60 %.
- **Redis, Elasticsearch, KV store, Postgres:** one store per access pattern. Postgres is the system of record: sync replication, an HA standby, 3 read replicas and connection pooling.
- **Kafka (`messaging.stream`) + event workers:** decouple slow work and absorb bursts. They feed the search index, ClickHouse and the DR copy.
- **Queue + serverless mailer:** retries with a dead-letter queue (DLQ). Email traffic is bursty, so it scales to zero between bursts.
- **Control plane:** secrets manager (database credentials), KMS (keys for PII), IAM (least-privilege workload roles). They are called at start-up and cached, so the edges are async.
- **Prometheus:** scrapes every service. Its edges point from Prometheus to the targets because Prometheus pulls metrics.
- **Bastion + VPN:** the only route humans have to the database. No admin ports are open to the internet.
- **US West DR copy:** order data survives a regional outage.

## Trade-offs and limits of this sample

- **One active region.** Europe is only 5 % of users, so it is served through the CDN plus API calls to us-east. If Europe grows past about 10 %, the `single-region-global-users` rule fires. The next step is a second active region behind the geo-DNS.
- **Availability zones are not drawn.** A node belongs to one group, and subnets carry the security zones. Multi-AZ is expressed in config instead: Postgres HA, a Redis replica per shard, ≥ 3 mesh proxies and pods spread across zones. Drawing a copy of every node per AZ would double the board and split load that the engine already spreads over replicas.
- **The DR copy is written by the event workers.** `database.postgres` has no out port, so a DB → DB replication edge can't be drawn (same approach as the Payment system reference). In production this would be cross-region logical replication.
- **ClickHouse is not on a flow path.** The engine counts every request that reaches it as one insert, so the clickstream flow stops at the workers (which batch).
- **Card payments are out of scope.** For PSPs and the ledger, see the Payment system problem.
- **Monthly cost is about $380k on the generic provider.** Most of it is internet egress, because the scenario uses a single 30 kB average response for every flow.

## Patterns to reuse

- Put a DDoS shield, WAF and API gateway in front of the API, and a CDN in front of static content: two front doors.
- Use a mesh between services: mTLS, retries and least-connections routing without touching the code.
- Cache-aside reads, plus a separate search index kept fresh by events.
- Order writes: one transaction (order + stock + idempotency key), then publish to a log, then let idempotent consumers do the rest.
- Control-plane edges are async: fetch secrets and keys at start-up and cache them; never call them per request.
