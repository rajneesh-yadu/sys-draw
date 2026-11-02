# Sample workflow: Redis, Kafka & RabbitMQ on Kubernetes

Registry id `problem.sample-order-events` (tags `sample`, `kafka`, `rabbitmq`, `redis`, `kubernetes`). Open it with Problems → Tag "sample" → Start → "Reference solution". The board loads with its scenario.

The board is one food-order pipeline with four technologies, each doing a different job:

- **Redis** is a fast, disposable copy of data.
- **Kafka** is the durable record of what happened.
- **RabbitMQ** hands out the work that has to be done.
- **Kubernetes** runs and scales the services that do it.

They sit in one workflow because the contrast is the lesson: the same order touches all four, and each one does something the others can't.

## Layout

The board reads left to right:

- **Entry:** customers → API gateway (DMZ).
- **Middle row:** the Kubernetes cluster group, holding every workload.
- **Top row:** the data subnet (Postgres, Redis).
- **Bottom row:** the messaging subnet (Kafka, RabbitMQ).

Calls go up to data and down to the brokers. Brokers deliver back up to the consumer workloads.

## Main paths (scenario flows)

| Flow                                    | Path                                                                                                                                                                                                           | Peak           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `flow_status` Poll order status         | customers → gateway → Orders API → **Redis** (hit: answer) → on a miss, Postgres read replica                                                                                                                  | 24,000 rps     |
| `flow_order` Place order                | customers → gateway → Orders API → **Redis** rate-limit `INCR` → Postgres commit → **Kafka** `OrderPlaced` (the caller's wait ends here) → notification dispatcher → **RabbitMQ** job → receipt & push workers | 3,000 rps      |
| `flow_project` 2nd Kafka consumer group | order-status projector → **Redis** (writes the status view)                                                                                                                                                    | 3,000 events/s |

`flow_project` starts at the projector. In SysDraw a flow is one linear path, so the second consumer group's work needs its own flow, with the same rate as orders. Kafka's lag model already lets every connected consumer group read every event, so routing this flow through Kafka again would count each event twice there.

**Peak result on the generic provider:**

- p99 is about 94 ms for status and 123 ms for placing an order. Most of that is the mobile round trip to US East.
- Every node is at or below 0.6 utilisation.
- Kafka has no lag in either consumer group, and RabbitMQ has no backlog.
- Availability is about 99.999 %, and cost is about $28k/month.

The design review reports two findings, both left in on purpose to keep the board focused:

- `rule.single-region-data`: there is no DR region.
- `rule.secrets-in-config` (info): there is no secrets manager.

## Redis — low-latency cache and ephemeral state

- **Why it's here:** status polling is 8× the write rate. Answering it from memory in under 1 ms keeps polls off Postgres. Per-customer rate limits (`INCR` + `EXPIRE`) need a shared counter that every API pod sees.
- **Connections:**
  - Orders API → Redis over RESP on TLS 1.3 (`tcp/tls13/resp`), for reads and rate-limit writes.
  - Order-status projector → Redis over the same stack, writing the status view.
  - Redis has no outgoing port: on a miss, the API itself reads Postgres (cache-aside).
- **Key config:**
  - 2 shards × 1 replica, with `readPreference: replicas` (reads scale; reads may lag slightly).
  - 3M keys × 1 KB (active orders fit in memory, so the hit rate is about 100 %).
  - `ttlSec: 3600`, `allkeys-lru`, `persistence: none`.
- **Trade-offs and limits:**
  - Everything in Redis is rebuildable: from Postgres on a miss, or by replaying Kafka into the projector. That is why persistence is off.
  - Replication is asynchronous, so a failover can drop the latest writes and a rate-limit window may reset.
  - One shard runs commands on one thread, so a hot key or a slow command stalls that shard.
  - Never make Redis the only copy of an order.

## Kafka — durable, replayable event stream

- **Why it's here:** an order is a fact that several services need, each at its own pace. Today that is the status projector and the notification dispatcher. Analytics or fraud services could join later without touching the API. Kafka keeps the events for 7 days, so a consumer can rebuild its state by replaying them (for example, refilling Redis after a flush).
- **Connections:**
  - In: Orders API → Kafka over `tcp/tls13/kafka-wire`, after the Postgres commit. In production, use an outbox table so the commit and the publish cannot drift apart.
  - Out: Kafka → projector and Kafka → dispatcher. Each connected consumer node is its own **consumer group**, so both groups get every event. These edges are async and carry only `tcp` (see Known limits).
- **Key config:**
  - 3 brokers.
  - 24 partitions, keyed by `order_id`, so events for one order stay in order.
  - `replicationFactor: 3`, `acks: all`, `minInsyncReplicas: 2`: a broker can die without losing an event.
  - 168 h retention, `lz4` compression.
- **Trade-offs and limits:**
  - Ordering holds only within a partition.
  - A group can't use more consumer instances than partitions.
  - `acks=all` adds a follower round trip to every publish.
  - Consumers track offsets. There is no per-message acknowledgement or redelivery of one failed job, which is why notification jobs move to RabbitMQ.
  - Consumer lag is the metric to watch (see Kafka's lag explanation in the inspector).

## RabbitMQ — task queue with competing, acknowledged workers

- **Why it's here:** one `OrderPlaced` event becomes concrete jobs: a receipt e-mail and a push notification. Each job must be done exactly once by one worker, retried if that worker dies, and spread over however many workers are running. The dispatcher is the Kafka consumer that turns events into these jobs.
- **Connections:**
  - In: notification dispatcher → RabbitMQ over AMQP on TLS 1.3 (`tcp/tls13/amqp`), with publisher confirms.
  - Out: RabbitMQ → receipt & push workers. These are async and carry only `tcp`, as with Kafka.
  - The workers compete on one queue (work-queue drain: the sum of consumer capacity).
- **Key config:**
  - 3 nodes.
  - `queueType: quorum`: replicated through Raft. Writes are about 1.6× slower but survive a node loss.
  - `persistent: true`, `publisherConfirms: true`.
  - `prefetch: 20` (unacked jobs per worker; this balances load).
  - `exchangeType: direct`.
- **Trade-offs and limits:**
  - An acked message is gone: there is no replay, and no second reader of the same queue. For fan-out, use Kafka or bind several queues.
  - Delivery is at-least-once, so workers must be idempotent (dedupe on job id).
  - Per-queue throughput is far below a Kafka partition.
  - Use a dead-letter exchange after N failures. It isn't modelled here.

## Kubernetes — orchestrates the workloads; it isn't a dependency

- **Why it's here:** every service on the board is stateless and runs as pods: the Orders API, both Kafka consumer groups and the RabbitMQ workers. Kubernetes:
  - places pods on worker nodes by their CPU and memory requests;
  - restarts failed pods;
  - spreads Service traffic over ready pods;
  - adds pods (HPA) and nodes (cluster autoscaler) under load.

  It is **not a hop** a request passes through. The gateway → Orders API edge is the gateway reaching the API's pods through their Service.

- **How SysDraw models it:**
  - The cluster group is drawn around the workloads.
  - Each `compute.kubernetes` node is one workload (think: a Deployment on its own node pool). Its **replicas are worker nodes, not pods**: capacity = nodes × pods per node × concurrency per pod.
  - Autoscale settings stand for the cluster autoscaler (API 3–12 nodes, consumers 2–6, workers 2–10, target 0.6).
- **Connections:** gateway → API over mTLS + HTTP/2 (`tcp/mtls/http2`). The workloads call out over `resp`, `postgres-wire`, `kafka-wire` and `amqp`, all on TLS 1.3.
- **Trade-offs and limits:**
  - You get self-healing and dense packing, at the cost of operational complexity (networking, upgrades, RBAC).
  - Pods scale in seconds, nodes in minutes.
  - For Kafka consumers, more pods than partitions sit idle.
  - Keep state out of pods: it lives in Postgres, Redis, Kafka or RabbitMQ.

## Not interchangeable

| Need                                                             | Use        | Why not the others                                                     |
| ---------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| Sub-ms reads, counters, TTL'd state                              | Redis      | Kafka and RabbitMQ are not queryable by key                            |
| Many services read the same events and can replay them           | Kafka      | RabbitMQ deletes on ack; Redis is not a durable log of record          |
| Each job done once, by one of N workers, with ack and redelivery | RabbitMQ   | Kafka has offsets, not per-job acks; Redis lists lose jobs on failover |
| Run, restart and scale the services                              | Kubernetes | It hosts workloads; data never flows "through" it                      |

## Known limits (follow-ups, not modelled)

- **Broker → consumer edges are plain `tcp`.** `compute.kubernetes`' input port accepts `http1/http2/grpc/websocket/tcp` but not `kafka-wire` or `amqp` (or `tls13`), so TCP is the only shared protocol. Real consumers use SASL_SSL / AMQPS. Brokers and consumers sit in the same private zone, so the plaintext rule does not fire. Follow-up: add `kafka-wire`, `amqp` and `tls13` to the Kubernetes (and app-server) input port, then switch these edges.
- **Kafka consumer parallelism counts Kubernetes worker nodes**, not pods: the lag model uses the consumer node's replicas as instances.
- No dead-letter exchange, delayed retry or per-message TTL on RabbitMQ; no outbox node; e-mail and push providers are off the board (the workers are the end of the path).
- Single region; secrets come from config (both reported by the review).
