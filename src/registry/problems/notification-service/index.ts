/** S17 practice problem: a multi-channel notification service (level 2). */
import { defineProblem } from '../../define';
import { company, design, scenario, STACK, TB } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Notifications VPC', { parent: 'use1' })
  .node('client', 'client.app', 'Product services & apps', [0, 1], { type: 'browser' })
  .node('gw', 'network.api-gateway', 'API gateway', [1, 1], {
    type: 'managed',
    group: 'vpc',
    config: { rateLimitRps: 20_000, burst: 40_000 },
  })
  .node('api', 'compute.app-server', 'Notification API', [2, 1], {
    type: 'medium',
    replicas: 3,
    group: 'vpc',
  })
  .node('prefcache', 'cache.redis', 'Preference cache', [2, 0], {
    type: 'mem-medium',
    group: 'vpc',
    config: { keyCount: 20_000_000, avgItemBytes: 500 },
  })
  .node('prefs', 'database.postgres', 'Preferences & templates', [3, 0], {
    type: 'large',
    group: 'vpc',
    config: { readReplicas: 1, tableRows: 200_000_000 },
  })
  .node('queue', 'messaging.queue', 'Send queue', [3, 2], {
    type: 'managed',
    group: 'vpc',
    config: { consumers: 16, maxReceiveCount: 5 },
  })
  .node('workers', 'compute.app-server', 'Channel workers (push/email/SMS)', [4, 2], {
    type: 'medium',
    replicas: 6,
    group: 'vpc',
  })
  .node('dedupe', 'cache.redis', 'Dedupe & per-user limits', [5, 3], {
    type: 'mem-medium',
    group: 'vpc',
    config: { keyCount: 100_000_000, avgItemBytes: 100, ttlSec: 86_400 },
  })
  .node('inbox', 'database.cassandra', 'Inbox / delivery log', [5, 1], {
    type: 'large',
    replicas: 6,
    group: 'vpc',
    config: { storageGb: 2_000 },
  })
  .edge('client', 'gw', STACK.https)
  .edge('gw', 'api', STACK.svc)
  .edge('api', 'prefcache', STACK.redis)
  .edge('api', 'prefs', STACK.postgres)
  .edge('api', 'queue', STACK.internal)
  .edge('api', 'inbox', STACK.cql)
  .edge('queue', 'workers', STACK.internal, { async: true })
  .edge('workers', 'dedupe', STACK.redis)
  .edge('workers', 'inbox', STACK.cql)
  .build();

export default defineProblem({
  id: 'problem.notification-service',
  title: 'Notification service',
  level: 2,
  tags: [
    'queues',
    'fan-out',
    'push',
    'retries',
    'idempotency',
    'async',
    company('amazon'),
    company('uber'),
  ],
  requirements: {
    functional: [
      'Internal services send notifications to a user through push (APNs/FCM), email and SMS with one API call.',
      'Respect user preferences: opted-out channels, quiet hours, frequency caps.',
      'Templates with per-locale text; the caller passes a template id and variables.',
      'An in-app inbox lists a user’s recent notifications with read/unread state.',
    ],
    nonFunctional: [
      'The send API answers fast (p99 < 250 ms end to end) and never waits for the push/email provider.',
      'At-least-once delivery with retries and backoff; no duplicates reach the user (idempotency key).',
      'Survive provider outages and bursts (a marketing campaign can send 10× normal volume).',
      'Peak ≈ 5,000 sends/s and 8,000 inbox reads/s.',
    ],
  },
  scale: { dau: 50_000_000, readWriteRatio: 1.6, dataSizeBytes: 5 * TB },
  scenario: scenario({
    usersByRegion: { 'north-america': 300_000, europe: 100_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 1_500, res: 2_000 },
    flows: [
      {
        key: 'send',
        name: 'Send notification',
        share: 0.4,
        rpsPerUser: 0.016,
        op: 'write',
        path: [
          'client',
          'gw',
          'api',
          { key: 'prefcache', op: 'read', cacheable: false },
          'queue',
          'workers',
          'dedupe',
          'inbox',
        ],
      },
      {
        key: 'inbox',
        name: 'Read inbox',
        share: 0.6,
        rpsPerUser: 0.016,
        op: 'read',
        path: ['client', 'gw', 'api', 'inbox'],
      },
    ],
  }),
  hints: [
    'Accept fast, deliver later: the API validates, checks preferences and enqueues; workers talk to providers. A slow provider must never slow the caller.',
    'Use a queue per channel (or priority) so a broken SMS provider does not block push; retry with exponential backoff and park poison messages in a dead-letter queue.',
    'At-least-once queues redeliver: make workers idempotent with an idempotency key (SET NX in Redis with a TTL) before calling the provider.',
    'Preferences are read on every send: cache them and invalidate on change.',
    'The inbox is write-heavy and read by user id and time: a wide-column store (Cassandra) partitioned by user id fits.',
    'Rate-limit per user and per caller so a buggy service cannot spam users or exhaust provider quotas.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 250, flowId: 'flow_send' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_inbox' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
    { ruleId: 'rule.missing-service-auth', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Design a service that sends push, email and SMS on behalf of other teams: queues and workers, retries, idempotency, preferences and an in-app inbox.',
  },
});
