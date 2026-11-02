/**
 * Sample workflow (S24): Redis, Kafka, RabbitMQ and Kubernetes in one order pipeline, each in the
 * role it is built for. Shipped as a problem entry (tag `sample`, the S22 mechanism) so it loads
 * onto a board with its scenario ("Start problem" → "Reference"). Companion notes: ./NOTES.md.
 *
 * Layout is a sandwich read left to right: users → API gateway (DMZ) → the Kubernetes cluster
 * band in the middle row (every workload: API, consumers, workers), the data subnet above it
 * (Postgres, Redis) and the messaging subnet below it (Kafka, RabbitMQ). Calls go up to data and
 * down to brokers; brokers deliver back up to consumer workloads.
 *
 * Broker → consumer edges carry only `tcp`: Kubernetes' input port lists HTTP/gRPC/WebSocket/TCP
 * but not `kafka-wire` or `amqp`, so TCP is the only protocol both ports share (see NOTES.md →
 * Known limits). Brokers and consumers share the private zone, so no zone boundary is crossed.
 */
import { defineProblem } from '../../define';
import { company, design, GB, scenario, STACK } from '../kit';

const reference = design()
  // ---- groups
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Orders VPC', { parent: 'use1' })
  .group('dmz', 'subnet', 'DMZ (public entry)', { parent: 'vpc', zone: 'dmz' })
  .group('k8s', 'cluster', 'Kubernetes cluster (EKS / GKE / AKS)', {
    parent: 'vpc',
    zone: 'private',
  })
  .group('data', 'subnet', 'Data subnet', { parent: 'vpc', zone: 'data' })
  .group('msg', 'subnet', 'Messaging subnet (brokers)', { parent: 'vpc', zone: 'private' })

  // ---- callers
  .node('client', 'client.app', 'Customers (app & web)', [0, 2], { type: 'mobile-device' })
  .node('gw', 'network.api-gateway', 'API gateway (JWT, rate limits)', [1, 2], {
    type: 'managed',
    group: 'dmz',
    config: { authMode: 'jwt', rateLimitRps: 60_000, burst: 120_000, timeoutMs: 5_000 },
  })

  // ---- workloads scheduled by Kubernetes (middle band)
  .node('api', 'compute.kubernetes', 'Orders API (stateless pods)', [2, 2], {
    type: 'large',
    replicas: 6,
    group: 'k8s',
    autoscale: { min: 3, max: 12, targetUtil: 0.6, warmupSec: 60 },
    config: { podCpuRequest: 0.5, podMemoryGb: 1, concurrencyPerPod: 8 },
  })
  .node('projector', 'compute.kubernetes', 'Order-status projector (Kafka group)', [4, 2], {
    type: 'medium',
    replicas: 3,
    group: 'k8s',
    autoscale: { min: 2, max: 6, targetUtil: 0.6, warmupSec: 60 },
  })
  .node('notifier', 'compute.kubernetes', 'Notification dispatcher (Kafka group)', [5, 2], {
    type: 'medium',
    replicas: 3,
    group: 'k8s',
    autoscale: { min: 2, max: 6, targetUtil: 0.6, warmupSec: 60 },
  })
  .node('workers', 'compute.kubernetes', 'Receipt & push workers (RabbitMQ)', [7, 2], {
    type: 'large',
    replicas: 4,
    group: 'k8s',
    autoscale: { min: 2, max: 10, targetUtil: 0.6, warmupSec: 60 },
  })

  // ---- data subnet (top band)
  .node('db', 'database.postgres', 'Orders DB (Postgres HA, system of record)', [2, 0], {
    type: 'xlarge',
    group: 'data',
    config: {
      readReplicas: 2,
      replication: 'sync',
      highAvailability: true,
      tableRows: 500_000_000,
      storageGb: 2_000,
      connectionPooling: true,
    },
  })
  .node('redis', 'cache.redis', 'Redis (status cache, rate limits)', [4, 0], {
    type: 'mem-medium',
    group: 'data',
    config: {
      shards: 2,
      replicasPerShard: 1,
      readPreference: 'replicas',
      keyCount: 3_000_000,
      avgItemBytes: 1_000,
      ttlSec: 3_600,
      evictionPolicy: 'allkeys-lru',
      persistence: 'none',
    },
  })

  // ---- messaging subnet (bottom band)
  .node('kafka', 'messaging.kafka', 'Kafka topic: order-events', [3, 4], {
    type: 'large',
    replicas: 3,
    group: 'msg',
    config: {
      partitions: 24,
      replicationFactor: 3,
      acks: 'all',
      minInsyncReplicas: 2,
      retentionHours: 168,
      messageBytes: 1_000,
      storageGb: 4_000,
      keySkew: 0,
      compression: 'lz4',
    },
  })
  .node('rabbit', 'messaging.rabbitmq', 'RabbitMQ: notification-jobs queue', [6, 4], {
    type: 'medium',
    replicas: 3,
    group: 'msg',
    config: {
      queueType: 'quorum',
      persistent: true,
      publisherConfirms: true,
      prefetch: 20,
      exchangeType: 'direct',
    },
  })

  // ---- request path
  .edge('client', 'gw', STACK.https)
  .edge('gw', 'api', STACK.svc, { config: { timeoutMs: 3_000 } })
  .edge('api', 'redis', STACK.redis, { config: { timeoutMs: 50 } })
  .edge('api', 'db', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 20 } })
  .edge('api', 'kafka', STACK.kafka, { config: { timeoutMs: 500 } })
  // ---- Kafka: two consumer groups read every event independently
  .edge('kafka', 'projector', ['tcp'], { async: true })
  .edge('kafka', 'notifier', ['tcp'], { async: true })
  .edge('projector', 'redis', STACK.redis, { config: { timeoutMs: 50 } })
  // ---- RabbitMQ: one job per message, workers compete and ack
  .edge('notifier', 'rabbit', STACK.amqp, { config: { timeoutMs: 500 } })
  .edge('rabbit', 'workers', ['tcp'], { async: true })
  .build();

export default defineProblem({
  id: 'problem.sample-order-events',
  title: 'Sample workflow: Redis, Kafka & RabbitMQ on Kubernetes',
  level: 3,
  tags: [
    'sample',
    'reference-board',
    'kafka',
    'rabbitmq',
    'redis',
    'kubernetes',
    'messaging',
    'event-driven',
    'caching',
    'work-queue',
    company('doordash'),
  ],
  requirements: {
    functional: [
      'Customers place food orders and poll the order status every few seconds while they wait.',
      'Every placed order is a durable event that independent services consume at their own pace (status view, notifications) and can replay.',
      'Each order produces a receipt e-mail and push notification job that exactly one worker handles, with retries if a worker dies mid-job.',
      'Per-customer rate limits and a fast order-status read that does not hit the database on every poll.',
    ],
    nonFunctional: [
      'Peak ≈ 30,000 requests/s: 24k status polls, 3k order placements (2× the daily average).',
      'Status poll p99 < 150 ms and place order p99 < 200 ms, measured from the customer (mobile round trip to US East included). Placing an order waits only for the DB commit and the Kafka ack, never for consumers.',
      'No order event lost on a broker failure (Kafka RF 3, acks=all; RabbitMQ quorum queues with publisher confirms).',
      'Stateless services scale horizontally on Kubernetes; all state lives in Postgres, Redis, Kafka or RabbitMQ.',
    ],
  },
  scale: { dau: 3_000_000, readWriteRatio: 8, dataSizeBytes: 2_000 * GB },
  scenario: scenario({
    usersByRegion: { 'north-america': 1_500_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 800, res: 2_000 },
    flows: [
      {
        key: 'status',
        name: 'Poll order status (Redis cache-aside)',
        share: 0.8,
        rpsPerUser: 0.01,
        op: 'read',
        path: ['client', 'gw', 'api', { key: 'redis', cacheable: true }, 'db'],
      },
      {
        key: 'order',
        name: 'Place order → Kafka → notifier → RabbitMQ → worker',
        share: 0.1,
        rpsPerUser: 0.01,
        op: 'write',
        path: ['client', 'gw', 'api', 'redis', 'db', 'kafka', 'notifier', 'rabbit', 'workers'],
      },
      {
        key: 'project',
        name: '2nd Kafka consumer group: project status into Redis',
        share: 0.1,
        rpsPerUser: 0.01,
        op: 'write',
        // Starts at the consumer: Kafka's lag model already lets every connected group read every
        // event, so routing this flow through Kafka again would count each event twice there.
        path: ['projector', 'redis'],
      },
    ],
  }),
  hints: [
    'Redis is the low-latency, ephemeral layer: the API reads order status cache-aside (hit → answer, miss → Postgres read replica) and keeps per-customer rate-limit counters (INCR + EXPIRE). Nothing in Redis is the only copy: a lost key is re-read from Postgres or re-projected from Kafka.',
    'Kafka is the durable event log: after committing the order in Postgres the API publishes OrderPlaced (key = order_id, acks=all) and answers. Each connected consumer service is its own consumer group, so the status projector and the notification dispatcher both read every event, at their own pace, and either can replay the last 7 days.',
    'RabbitMQ is the task queue: the dispatcher turns one event into jobs (receipt e-mail, push). Workers on the same queue compete — each job goes to one worker, which acks when done; an unacked job is redelivered. Quorum queues + publisher confirms make jobs survive a broker loss.',
    'Kubernetes is not a hop in the request: it schedules and scales the stateless workloads (API pods behind a Service, consumer and worker Deployments), restarts them, and adds nodes when pods do not fit. In SysDraw each Kubernetes node is one workload with its own worker nodes.',
    'Do not swap them: Kafka has no per-message ack/redelivery for individual jobs, RabbitMQ deletes a message once acked (no replay, no second reader of the same queue), and Redis is not a durable log or queue of record.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 150, flowId: 'flow_status' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_order' }, weight: 3 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.no-cache-hot-read', weight: 1 },
    { ruleId: 'rule.queue-without-consumer', weight: 1 },
    { ruleId: 'rule.hot-partition', weight: 1 },
    { ruleId: 'rule.no-autoscaling', weight: 1 },
    { ruleId: 'rule.plaintext-edge', weight: 1 },
    { ruleId: 'rule.db-internet-reachable', weight: 1 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
    { ruleId: 'rule.spof', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Sample workflow: a food-order pipeline that shows four technologies in their own roles — Redis for a sub-millisecond status cache and rate limits, Kafka for a durable, replayable event log read by two consumer groups, RabbitMQ for acknowledged jobs shared by competing workers, and Kubernetes hosting and scaling every stateless workload.',
  },
});
