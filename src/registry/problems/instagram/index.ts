/** S17 practice problem: a photo-sharing app like Instagram (level 4). */
import { defineProblem } from '../../define';
import { company, design, PB, scenario, STACK } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Instagram VPC', { parent: 'use1' })
  .node('client', 'client.app', 'Mobile apps', [0, 2], { type: 'mobile-device' })
  .node('cdn', 'network.cdn', 'Image CDN', [1, 0], {
    type: 'managed',
    config: { ttlSec: 2_592_000, originShield: true, edgeCacheGb: 10_000 },
  })
  .node('waf', 'security.waf', 'WAF', [1, 2], { type: 'managed', group: 'vpc' })
  .node('lb', 'network.load-balancer', 'Load balancer', [2, 2], { type: 'standard', group: 'vpc' })
  .node('api', 'compute.kubernetes', 'API services (Kubernetes)', [3, 2], {
    type: 'xlarge',
    replicas: 20,
    group: 'vpc',
  })
  .node('feedcache', 'cache.redis', 'Feed cache (Redis)', [4, 1], {
    type: 'mem-xlarge',
    group: 'vpc',
    config: {
      shards: 12,
      replicasPerShard: 2,
      readPreference: 'replicas',
      keyCount: 500_000_000,
      avgItemBytes: 3_000,
      ttlSec: 86_400,
    },
  })
  .node('db', 'database.sql', 'Users & posts (sharded SQL)', [5, 2], {
    type: 'xlarge',
    group: 'vpc',
    config: { shards: 16, readReplicas: 2, multiAz: true, storageGb: 16_000 },
  })
  .node('photos', 'storage.object', 'Photos (object store)', [2, 0], {
    type: 'managed',
    group: 'vpc',
    config: { storageGb: 5_000_000, storageClass: 'standard' },
  })
  .node('stream', 'messaging.stream', 'Post events (Kafka)', [4, 3], {
    type: 'large',
    replicas: 3,
    group: 'vpc',
    config: { partitions: 64 },
  })
  .node('workers', 'compute.app-server', 'Fan-out & thumbnail workers', [5, 3], {
    type: 'large',
    replicas: 10,
    group: 'vpc',
  })
  .node('search', 'database.elasticsearch', 'Search (users, hashtags)', [4, 4], {
    type: 'mem-xlarge',
    replicas: 12,
    group: 'vpc',
  })
  .edge('client', 'cdn', STACK.http3)
  .edge('client', 'waf', STACK.https)
  .edge('cdn', 'photos', STACK.internal)
  .edge('waf', 'lb', STACK.internal)
  .edge('lb', 'api', STACK.internal)
  .edge('api', 'feedcache', STACK.redis)
  .edge('api', 'db', STACK.postgres)
  .edge('api', 'photos', STACK.internal)
  .edge('api', 'stream', STACK.kafka)
  .edge('api', 'search', STACK.internal)
  .edge('stream', 'workers', STACK.internal, { async: true })
  .edge('workers', 'feedcache', STACK.redis)
  .edge('workers', 'search', STACK.internal)
  .build();

export default defineProblem({
  id: 'problem.instagram',
  title: 'Instagram',
  level: 4,
  tags: [
    'media',
    'cdn',
    'object-storage',
    'feed',
    'sharding',
    'fan-out',
    'search',
    company('meta'),
  ],
  requirements: {
    functional: [
      'Upload photos (and short videos) with a caption; the app shows them in several sizes.',
      'Follow users; the home feed shows recent posts from followed accounts.',
      'Like and comment on posts; view a user’s profile grid.',
      'Search users and hashtags.',
    ],
    nonFunctional: [
      'Feed loads in p99 < 250 ms; images load from a nearby edge.',
      'Photos are never lost (11 nines of durability).',
      'Read-heavy (≈ 50 feed loads per upload); uploads may take a few seconds to appear in feeds.',
      'Peak ≈ 150,000 feed loads/s, 600,000 image requests/s, 3,000 uploads/s.',
    ],
  },
  scale: { dau: 500_000_000, readWriteRatio: 50, dataSizeBytes: 5 * PB },
  scenario: scenario({
    usersByRegion: { 'north-america': 6_000_000, europe: 4_000_000, latam: 3_000_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 1_000, res: 150_000 },
    flows: [
      {
        key: 'feed',
        name: 'Load home feed',
        share: 0.2,
        rpsPerUser: 0.03,
        op: 'read',
        path: ['client', 'waf', 'lb', 'api', { key: 'feedcache', cacheable: false }, 'db'],
      },
      {
        key: 'images',
        name: 'Load images',
        share: 0.77,
        rpsPerUser: 0.03,
        op: 'read',
        path: ['client', { key: 'cdn', cacheable: true }, 'photos'],
      },
      {
        key: 'upload',
        name: 'Upload photo',
        share: 0.004,
        rpsPerUser: 0.03,
        op: 'write',
        path: ['client', 'waf', 'lb', 'api', 'photos', 'db', 'stream', 'workers', 'feedcache'],
      },
      {
        key: 'search',
        name: 'Search',
        share: 0.026,
        rpsPerUser: 0.03,
        op: 'read',
        path: ['client', 'waf', 'lb', 'api', 'search'],
      },
    ],
  }),
  hints: [
    'Separate media from metadata: photos go to object storage (via pre-signed upload URLs), metadata (post id, owner, caption, blob keys) to a database.',
    'Every image is read many times from all over the world: serve them through a CDN with long TTLs (images are immutable; new versions get new keys).',
    'Do slow work asynchronously: after the upload commits, publish an event; workers make thumbnails, update search and fan out to followers’ feeds.',
    'Shard users and posts by user id so a profile grid is one shard; keep each user’s feed (post ids) precomputed in a cache, with celebrities merged at read time.',
    'Feed reads hit the cache first and hydrate post metadata from the database (with read replicas), not the photos themselves.',
    'Search is a separate index (Elasticsearch) fed from the event stream; never run LIKE queries on the main database.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 250, flowId: 'flow_feed' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 250, flowId: 'flow_images' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.db-internet-reachable', weight: 1 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Design a photo-sharing network: media in object storage behind a CDN, sharded metadata, precomputed feeds and asynchronous processing after upload.',
  },
});
