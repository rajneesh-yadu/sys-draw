/** S17 practice problem: ride hailing like Uber (level 5). */
import { defineProblem } from '../../define';
import { company, design, scenario, STACK, TB } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Rides VPC', { parent: 'use1' })
  .node('drivers', 'client.app', 'Driver apps', [0, 0], { type: 'mobile-device' })
  .node('riders', 'client.app', 'Rider apps', [0, 3], { type: 'mobile-device' })
  .node('waf', 'security.waf', 'WAF', [1, 0], { type: 'managed', group: 'vpc' })
  .node('lb', 'network.load-balancer', 'Load balancer (WebSocket)', [2, 0], {
    type: 'standard',
    group: 'vpc',
    config: { idleTimeoutSec: 3_600 },
  })
  .node('location', 'compute.app-server', 'Location service', [3, 0], {
    type: 'xlarge',
    replicas: 24,
    group: 'vpc',
  })
  .node('geo', 'cache.redis', 'Driver geo index (Redis)', [4, 1], {
    type: 'mem-large',
    group: 'vpc',
    config: { shards: 8, replicasPerShard: 1, keyCount: 5_000_000, avgItemBytes: 200, ttlSec: 30 },
  })
  .node('stream', 'messaging.stream', 'Location events (Kafka)', [4, 0], {
    type: 'large',
    replicas: 3,
    group: 'vpc',
    config: { partitions: 128, retentionHours: 24 },
  })
  .node('analytics', 'compute.app-server', 'ETA, surge & trip-history workers', [5, 0], {
    type: 'xlarge',
    replicas: 30,
    group: 'vpc',
  })
  .node('gw', 'network.api-gateway', 'Rider API gateway', [1, 3], {
    type: 'managed',
    group: 'vpc',
    config: { rateLimitRps: 50_000, burst: 100_000 },
  })
  .node('rides', 'compute.app-server', 'Ride service', [2, 3], {
    type: 'large',
    replicas: 6,
    group: 'vpc',
  })
  .node('matching', 'compute.app-server', 'Matching / dispatch', [3, 2], {
    type: 'large',
    replicas: 6,
    group: 'vpc',
  })
  .node('trips', 'database.postgres', 'Trips & payments state (Postgres)', [4, 3], {
    type: 'xlarge',
    group: 'vpc',
    config: {
      readReplicas: 5,
      highAvailability: true,
      replication: 'sync',
      tableRows: 10_000_000_000,
    },
  })
  .edge('drivers', 'waf', STACK.wss)
  .edge('waf', 'lb', ['tcp', 'tls13', 'websocket'])
  .edge('lb', 'location', ['tcp', 'tls13', 'websocket'])
  .edge('location', 'geo', STACK.redis)
  .edge('location', 'stream', STACK.kafka)
  .edge('stream', 'analytics', STACK.internal, { async: true })
  .edge('riders', 'gw', STACK.https)
  .edge('gw', 'rides', STACK.svc)
  .edge('rides', 'matching', STACK.svc)
  .edge('rides', 'trips', STACK.postgres)
  .edge('matching', 'geo', STACK.redis)
  .edge('matching', 'location', STACK.svc)
  .build();

export default defineProblem({
  id: 'problem.uber',
  title: 'Uber',
  level: 5,
  tags: [
    'geo',
    'real-time',
    'location',
    'matching',
    'websocket',
    'consistency',
    'streaming',
    company('uber'),
    company('lyft'),
  ],
  requirements: {
    functional: [
      'Drivers report their location every 4 seconds while online.',
      'A rider requests a ride, sees nearby drivers and an ETA and price; the system offers the trip to the best driver, who accepts or declines.',
      'Both apps see live trip status and the driver’s position until drop-off.',
      'Trip history and receipts; surge pricing per area.',
    ],
    nonFunctional: [
      'Location writes are cheap and constant: ≈ 1.25 M drivers online at peak → ~300,000 updates/s.',
      'Matching answers in < 1 s; ride-request API p99 < 300 ms.',
      'A driver is never assigned to two trips (strong consistency for trip state); location data can be slightly stale.',
      'Highly available: an outage strands riders and drivers in real time.',
    ],
  },
  scale: { dau: 30_000_000, readWriteRatio: 0.2, dataSizeBytes: 100 * TB },
  scenario: scenario({
    usersByRegion: { 'north-america': 1_500_000, latam: 1_000_000 },
    peakMultiplier: 1.5,
    payloadBytes: { req: 300, res: 1_500 },
    flows: [
      {
        key: 'location',
        name: 'Driver location update',
        share: 0.9,
        rpsPerUser: 0.09,
        op: 'write',
        path: ['drivers', 'waf', 'lb', 'location', 'geo', 'stream', 'analytics'],
      },
      {
        key: 'request',
        name: 'Request ride',
        share: 0.004,
        rpsPerUser: 0.09,
        op: 'write',
        path: [
          'riders',
          'gw',
          'rides',
          { key: 'matching', op: 'read' },
          { key: 'geo', op: 'read', cacheable: false },
          'trips',
        ],
      },
      {
        key: 'status',
        name: 'Trip status & nearby cars',
        share: 0.096,
        rpsPerUser: 0.09,
        op: 'read',
        path: ['riders', 'gw', 'rides', 'trips'],
      },
    ],
  }),
  hints: [
    'Location updates dominate: keep the latest position per driver in memory (Redis GEO or an H3/S2 cell → drivers index) with a short TTL, not in the trip database.',
    'Partition the geo index by cell or city so a busy downtown does not hit one shard; stream every update to Kafka for ETA models, surge and history.',
    'Matching: look up drivers in the rider’s cell and neighbouring cells, rank by ETA, offer to one driver at a time with a timeout.',
    'Trip state needs strong consistency: assign a driver with a conditional update (or a lock) in a transactional store so a driver can never get two trips.',
    'Keep a WebSocket (or MQTT) connection per driver for offers and per rider for live status; the location service doubles as the push channel.',
    'Plan for regional isolation: cities are independent, so shard the whole stack by city/region.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 300, flowId: 'flow_request' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 250, flowId: 'flow_location' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.9995 }, weight: 2 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
    { ruleId: 'rule.missing-service-auth', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Design ride hailing: a firehose of driver locations into an in-memory geo index, matching riders to nearby drivers, and strongly consistent trip state.',
  },
});
