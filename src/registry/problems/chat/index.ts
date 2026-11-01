/** S17 practice problem: chat like WhatsApp or Discord (level 3). */
import { defineProblem } from '../../define';
import { company, design, PB, scenario, STACK } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Chat VPC', { parent: 'use1' })
  .node('client', 'client.app', 'Mobile & desktop apps', [0, 1], { type: 'mobile-device' })
  .node('cdn', 'network.cdn', 'Media CDN', [1, 3], { type: 'managed' })
  .node('waf', 'security.waf', 'WAF', [1, 2], { type: 'managed', group: 'vpc' })
  .node('lb', 'network.load-balancer', 'Load balancer (WebSocket)', [1, 1], {
    type: 'standard',
    group: 'vpc',
    config: { idleTimeoutSec: 3_600, stickySessions: true },
  })
  .node('gateway', 'compute.app-server', 'Connection gateways', [2, 1], {
    type: 'large',
    replicas: 8,
    group: 'vpc',
    config: { workerThreads: 1_000 },
  })
  .node('sessions', 'cache.redis', 'Sessions & presence', [2, 0], {
    type: 'mem-large',
    group: 'vpc',
    config: { shards: 4, keyCount: 50_000_000, avgItemBytes: 200, ttlSec: 120 },
  })
  .node('chat', 'compute.app-server', 'Chat service', [3, 1], {
    type: 'large',
    replicas: 6,
    group: 'vpc',
  })
  .node('messages', 'database.cassandra', 'Messages (Cassandra)', [4, 0], {
    type: 'xlarge',
    replicas: 12,
    group: 'vpc',
    config: { storageGb: 4_000 },
  })
  .node('stream', 'messaging.stream', 'Message events (Kafka)', [4, 2], {
    type: 'large',
    replicas: 3,
    group: 'vpc',
    config: { partitions: 64 },
  })
  .node('delivery', 'compute.app-server', 'Delivery / fan-out workers', [5, 2], {
    type: 'large',
    replicas: 6,
    group: 'vpc',
  })
  .node('media', 'storage.object', 'Media (object store)', [2, 3], {
    type: 'managed',
    group: 'vpc',
    config: { storageGb: 2_000_000 },
  })
  .edge('client', 'waf', STACK.wss)
  .edge('waf', 'lb', STACK.wss)
  .edge('client', 'cdn', STACK.http3)
  .edge('cdn', 'media', STACK.internal)
  .edge('lb', 'gateway', STACK.wss)
  .edge('gateway', 'sessions', STACK.redis)
  .edge('gateway', 'chat', STACK.svc)
  .edge('chat', 'messages', STACK.cql)
  .edge('chat', 'stream', STACK.kafka)
  .edge('stream', 'delivery', STACK.internal, { async: true })
  .edge('delivery', 'sessions', STACK.redis)
  .build();

export default defineProblem({
  id: 'problem.chat',
  title: 'Chat (WhatsApp / Discord)',
  level: 3,
  tags: [
    'real-time',
    'websocket',
    'presence',
    'messaging',
    'wide-column',
    'fan-out',
    company('meta'),
    company('discord'),
  ],
  requirements: {
    functional: [
      'One-to-one and group chats (up to 500 members; Discord-style channels with many more readers).',
      'Messages are delivered in real time to online users and stored for offline users, then synced on reconnect.',
      'Sent / delivered / read receipts and online / last-seen presence.',
      'Send images and videos; scroll back through message history.',
    ],
    nonFunctional: [
      'Delivery to an online recipient in < 250 ms p99 across the Americas and Europe.',
      'Messages are never lost and arrive in order within a conversation.',
      'Millions of long-lived connections: connection servers must scale horizontally.',
      'Peak ≈ 30,000 messages/s sent and 55,000 history reads/s.',
    ],
  },
  scale: { dau: 500_000_000, readWriteRatio: 2, dataSizeBytes: 2 * PB },
  scenario: scenario({
    usersByRegion: { 'north-america': 1_500_000, europe: 1_000_000, latam: 500_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 300, res: 2_000 },
    flows: [
      {
        key: 'send',
        name: 'Send message',
        share: 0.33,
        rpsPerUser: 0.015,
        op: 'write',
        path: [
          'client',
          'waf',
          'lb',
          'gateway',
          'chat',
          'messages',
          'stream',
          'delivery',
          { key: 'sessions', op: 'read' },
        ],
      },
      {
        key: 'history',
        name: 'Load conversation history',
        share: 0.62,
        rpsPerUser: 0.015,
        op: 'read',
        path: ['client', 'waf', 'lb', 'gateway', 'chat', 'messages'],
      },
      {
        key: 'media',
        name: 'Load image / video',
        share: 0.05,
        rpsPerUser: 0.015,
        op: 'read',
        path: ['client', { key: 'cdn', cacheable: true }, 'media'],
      },
    ],
  }),
  hints: [
    'Clients keep one persistent WebSocket to a connection gateway; keep a registry (Redis) of which gateway holds each user’s connection, with a short TTL refreshed by heartbeats (that is also presence).',
    'Persist first, then deliver: the chat service writes the message, acks the sender and publishes an event; delivery workers look up the recipients’ gateways and push.',
    'Store messages in a wide-column store partitioned by conversation id and clustered by a time-ordered message id (Snowflake/ULID): ordered history is one partition scan.',
    'Offline users: keep a per-user delivery cursor; on reconnect the client syncs from its last seen id. Send a mobile push for offline users.',
    'Large groups and channels: fan-out on read (members fetch the channel) beats writing a copy per member.',
    'Media goes to object storage via pre-signed upload URLs and is served through a CDN; only the URL travels in the message.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 250, flowId: 'flow_send' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_history' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.plaintext-edge', weight: 1 },
    { ruleId: 'rule.missing-service-auth', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Design a real-time chat system: persistent connections, a session registry, durable ordered message storage, fan-out to online users and sync for offline ones.',
  },
});
