/** S17 practice problem: a URL shortener such as bit.ly or TinyURL (level 1). */
import { defineProblem } from '../../define';
import { broken, company, design, scenario, STACK, TB } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Shortener VPC', { parent: 'use1' })
  .node('client', 'client.app', 'Browsers', [0, 1], { type: 'browser' })
  .node('waf', 'security.waf', 'WAF', [1, 1], { type: 'managed', group: 'vpc' })
  .node('lb', 'network.load-balancer', 'Load balancer', [2, 1], { type: 'standard', group: 'vpc' })
  .node('api', 'compute.app-server', 'Shortener API', [3, 1], {
    type: 'medium',
    replicas: 4,
    group: 'vpc',
  })
  .node('cache', 'cache.redis', 'URL cache (Redis)', [4, 0], {
    type: 'mem-large',
    group: 'vpc',
    config: {
      shards: 3,
      replicasPerShard: 1,
      keyCount: 50_000_000,
      avgItemBytes: 500,
      ttlSec: 86_400,
      zipfExponent: 1.1,
    },
  })
  .node('keys', 'database.coordination', 'ID ranges (etcd)', [4, 2], {
    type: 'small',
    group: 'vpc',
  })
  .node('db', 'database.kv-store', 'URL store (key-value)', [5, 1], {
    type: 'managed',
    group: 'vpc',
    config: { partitions: 16, storageGb: 3_000, itemSizeKb: 1 },
  })
  .edge('client', 'waf', STACK.https)
  .edge('waf', 'lb', STACK.internal)
  .edge('lb', 'api', STACK.internal)
  .edge('api', 'cache', STACK.redis)
  .edge('api', 'keys', STACK.grpc)
  .edge('api', 'db', STACK.internal)
  .build();

export default defineProblem({
  id: 'problem.url-shortener',
  title: 'URL shortener',
  level: 1,
  tags: [
    'read-heavy',
    'caching',
    'key-generation',
    'hashing',
    'key-value',
    company('bitly'),
    company('google'),
  ],
  requirements: {
    functional: [
      'Given a long URL, return a short unique alias such as sho.rt/aZ3k9Q (optionally a custom alias).',
      'Visiting the short URL redirects (HTTP 301/302) to the long URL.',
      'Links can expire; expired or unknown links return 404.',
      'Count clicks per link (approximate counts are fine).',
    ],
    nonFunctional: [
      'Redirects are fast: p99 < 200 ms for North American and European users.',
      'Very read-heavy: about 100 redirects per new link.',
      'Highly available reads; a short link must never point to the wrong URL.',
      'Aliases must not be guessable in sequence (do not expose an auto-increment id).',
      'Peak ≈ 30,000 redirects/s, 100 M new links per month, kept for 5 years.',
    ],
  },
  scale: { dau: 50_000_000, readWriteRatio: 100, dataSizeBytes: 3 * TB },
  scenario: scenario({
    usersByRegion: { 'north-america': 600_000, europe: 300_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 500, res: 600 },
    flows: [
      {
        key: 'redirect',
        name: 'Redirect',
        share: 0.99,
        rpsPerUser: 0.017,
        op: 'read',
        path: ['client', 'waf', 'lb', 'api', { key: 'cache', cacheable: true }, 'db'],
      },
      {
        key: 'shorten',
        name: 'Create short link',
        share: 0.01,
        rpsPerUser: 0.017,
        op: 'write',
        path: ['client', 'waf', 'lb', 'api', { key: 'keys', op: 'read' }, 'db'],
      },
    ],
  }),
  hints: [
    'Estimate first: 100 M links/month × 60 months ≈ 6 B links; 7 base-62 characters give 62⁷ ≈ 3.5 T aliases, plenty of room.',
    'Generate ids without collisions: each API server leases a range of ids from a counter (ZooKeeper/etcd) and encodes them in base 62; shuffle or encrypt the id so aliases are not sequential.',
    'Store alias → long URL in a key-value store partitioned by alias. You never need joins.',
    'Redirects are about 100× more frequent than writes and a few links are very popular: put a cache (Redis) in front of the store, cache-aside, with a long TTL.',
    '301 lets browsers cache the redirect (less load, but you lose click counts); 302 keeps every click visible to you.',
    'Count clicks asynchronously (log or queue → batch aggregation) so the redirect path stays a single cache read.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_redirect' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 300, flowId: 'flow_shorten' }, weight: 1 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
    { ruleId: 'rule.db-internet-reachable', weight: 1 },
  ],
  debugVariants: [
    {
      id: 'single-api-server',
      title: 'Redirects time out at peak',
      graph: broken(reference, (g) => {
        g.node('api').scaling = { replicas: 1, instanceType: 'small' };
      }),
      expectedFix:
        'The Shortener API runs on one small instance and saturates at peak. Scale it out (≈ 4 medium replicas behind the load balancer) or up.',
    },
  ],
  docs: {
    summary:
      'Design a service that turns long URLs into short aliases and redirects millions of clicks a second: id generation, a key-value store and a hot-key cache.',
  },
});
