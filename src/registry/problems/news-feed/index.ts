/** S17 practice problem: a news feed / home timeline like X (Twitter) (level 3). */
import { defineProblem } from '../../define';
import { company, design, PB, scenario, STACK } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Feed VPC', { parent: 'use1' })
  .node('client', 'client.app', 'Apps & web', [0, 1], { type: 'mobile-device' })
  .node('cdn', 'network.cdn', 'Media CDN', [1, 3], { type: 'managed' })
  .node('waf', 'security.waf', 'WAF', [1, 1], { type: 'managed', group: 'vpc' })
  .node('lb', 'network.load-balancer', 'Load balancer', [1, 2], { type: 'standard', group: 'vpc' })
  .node('api', 'compute.app-server', 'Timeline & post API', [2, 1], {
    type: 'large',
    replicas: 10,
    group: 'vpc',
  })
  .node('timelines', 'cache.redis', 'Home timelines (Redis)', [3, 0], {
    type: 'mem-xlarge',
    group: 'vpc',
    config: {
      shards: 16,
      replicasPerShard: 2,
      readPreference: 'replicas',
      keyCount: 300_000_000,
      avgItemBytes: 4_000,
      zipfExponent: 1.0,
      ttlSec: 604_800,
    },
  })
  .node('posts', 'database.cassandra', 'Posts (Cassandra)', [4, 1], {
    type: 'xlarge',
    replicas: 12,
    group: 'vpc',
    config: { storageGb: 4_000 },
  })
  .node('stream', 'messaging.stream', 'Post events (Kafka)', [3, 2], {
    type: 'large',
    replicas: 3,
    group: 'vpc',
    config: { partitions: 64 },
  })
  .node('fanout', 'compute.app-server', 'Fan-out workers', [4, 2], {
    type: 'large',
    replicas: 8,
    group: 'vpc',
  })
  .node('graph', 'database.postgres', 'Social graph (followers)', [5, 2], {
    type: 'xlarge',
    group: 'vpc',
    config: { readReplicas: 3, tableRows: 50_000_000_000 },
  })
  .node('media', 'storage.object', 'Media (object store)', [2, 3], {
    type: 'managed',
    group: 'vpc',
    config: { storageGb: 1_000_000 },
  })
  .edge('client', 'waf', STACK.https)
  .edge('waf', 'lb', STACK.internal)
  .edge('client', 'cdn', STACK.http3)
  .edge('cdn', 'media', STACK.internal)
  .edge('lb', 'api', STACK.internal)
  .edge('api', 'timelines', STACK.redis)
  .edge('api', 'posts', STACK.cql)
  .edge('api', 'stream', STACK.kafka)
  .edge('stream', 'fanout', STACK.internal, { async: true })
  .edge('fanout', 'graph', STACK.postgres)
  .edge('fanout', 'timelines', STACK.redis)
  .build();

export default defineProblem({
  id: 'problem.news-feed',
  title: 'News feed (X / Twitter)',
  level: 3,
  tags: [
    'fan-out',
    'timeline',
    'caching',
    'celebrity-problem',
    'read-heavy',
    'social',
    company('x'),
    company('meta'),
  ],
  requirements: {
    functional: [
      'Users post short messages (up to 280 characters) with optional images.',
      'Users follow other users; the home timeline shows posts from followed accounts, newest first.',
      'Like and repost; counts are shown on each post.',
      'Open any user’s profile timeline.',
    ],
    nonFunctional: [
      'Home timeline loads in p99 < 200 ms; a new post reaches followers’ timelines within ~5 s.',
      'Extremely read-heavy: ~100 timeline reads per post.',
      'Accounts with 100 M followers must not melt the fan-out.',
      'Peak ≈ 200,000 timeline reads/s and 2,000 posts/s.',
    ],
  },
  scale: { dau: 250_000_000, readWriteRatio: 100, dataSizeBytes: 1 * PB },
  scenario: scenario({
    usersByRegion: { 'north-america': 5_000_000, europe: 3_000_000, latam: 2_000_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 500, res: 20_000 },
    flows: [
      {
        key: 'timeline',
        name: 'Load home timeline',
        share: 0.97,
        rpsPerUser: 0.01,
        op: 'read',
        path: ['client', 'waf', 'lb', 'api', { key: 'timelines', cacheable: false }, 'posts'],
      },
      {
        key: 'post',
        name: 'Post',
        share: 0.01,
        rpsPerUser: 0.01,
        op: 'write',
        path: [
          'client',
          'waf',
          'lb',
          'api',
          'posts',
          'stream',
          'fanout',
          { key: 'graph', op: 'read' },
          'timelines',
        ],
      },
      {
        key: 'media',
        name: 'Load images',
        share: 0.02,
        rpsPerUser: 0.01,
        op: 'read',
        path: ['client', { key: 'cdn', cacheable: true }, 'media'],
      },
    ],
  }),
  hints: [
    'Two ways to build a timeline: fan-out on read (merge followees’ posts at read time: cheap writes, slow reads) or fan-out on write (push each post id into every follower’s timeline: fast reads, heavy writes).',
    'Reads outnumber writes ~100:1, so precompute: keep each active user’s home timeline (a list of post ids) in Redis and update it when someone they follow posts.',
    'Fan out asynchronously: the post API stores the post and publishes an event; fan-out workers read the follower list and update timelines.',
    'Celebrities: do not fan out accounts with millions of followers; merge their recent posts in at read time (hybrid).',
    'Store posts partitioned by post id (or author + time); timelines hold only ids, so hydrate them with a multi-get.',
    'Serve images from object storage through a CDN; like counts are approximate and updated asynchronously.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_timeline' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 300, flowId: 'flow_post' }, weight: 1 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
    { ruleId: 'rule.db-internet-reachable', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Design the home timeline of a social network: fan-out on write vs read, precomputed timelines in a cache, async fan-out workers and the celebrity problem.',
  },
});
