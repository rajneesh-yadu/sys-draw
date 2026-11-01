/** S17 practice problem: Pastebin / GitHub Gist (level 2). */
import { defineProblem } from '../../define';
import { broken, company, design, scenario, STACK, TB } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Paste VPC', { parent: 'use1' })
  .node('client', 'client.app', 'Browsers', [0, 1], { type: 'browser' })
  .node('cdn', 'network.cdn', 'CDN', [1, 0], {
    type: 'managed',
    config: { ttlSec: 3_600, cacheDynamic: true },
  })
  .node('waf', 'security.waf', 'WAF', [1, 2], { type: 'managed', group: 'vpc' })
  .node('lb', 'network.load-balancer', 'Load balancer', [2, 1], { type: 'standard', group: 'vpc' })
  .node('api', 'compute.app-server', 'Paste API', [3, 1], {
    type: 'medium',
    replicas: 3,
    group: 'vpc',
  })
  .node('cache', 'cache.redis', 'Paste cache (Redis)', [4, 0], {
    type: 'mem-large',
    group: 'vpc',
    config: { shards: 2, keyCount: 20_000_000, avgItemBytes: 10_000, ttlSec: 3_600 },
  })
  .node('db', 'database.postgres', 'Metadata (Postgres)', [5, 1], {
    type: 'large',
    group: 'vpc',
    config: { readReplicas: 2, tableRows: 500_000_000, storageGb: 500 },
  })
  .node('blobs', 'storage.object', 'Paste bodies (object store)', [6, 1], {
    type: 'managed',
    group: 'vpc',
    config: { storageGb: 20_000, lifecycleDays: 365 },
  })
  .node('cleaner', 'compute.serverless-function', 'Expiry cleaner', [4, 2], {
    type: '512mb',
    group: 'vpc',
  })
  .edge('client', 'cdn', STACK.http3)
  .edge('client', 'waf', STACK.https)
  .edge('cdn', 'waf', STACK.internal)
  .edge('waf', 'lb', STACK.internal)
  .edge('lb', 'api', STACK.internal)
  .edge('api', 'cache', STACK.redis)
  .edge('api', 'db', STACK.postgres)
  .edge('api', 'blobs', STACK.internal)
  .edge('cleaner', 'db', STACK.postgres, { async: true })
  .edge('cleaner', 'blobs', STACK.internal, { async: true })
  .build();

export default defineProblem({
  id: 'problem.pastebin',
  title: 'Pastebin',
  level: 2,
  tags: [
    'read-heavy',
    'object-storage',
    'cdn',
    'caching',
    'expiry',
    company('github'),
    company('pastebin'),
  ],
  requirements: {
    functional: [
      'Users paste text (up to 10 MB) and get a unique, unguessable URL.',
      'Anyone with the URL can read the paste; pastes can be public, unlisted or private.',
      'Pastes expire after a chosen time (10 minutes … never) and are then deleted.',
      'Optional syntax highlighting and raw view.',
    ],
    nonFunctional: [
      'Reads p99 < 300 ms for users in North America, Europe and India (popular pastes served from cache or CDN).',
      'Read-heavy: about 10 reads per paste.',
      'Durable: a paste is never lost before it expires.',
      'Peak ≈ 6,000 reads/s; 5 M new pastes/day, average 10 kB.',
    ],
  },
  scale: { dau: 10_000_000, readWriteRatio: 10, dataSizeBytes: 20 * TB },
  scenario: scenario({
    usersByRegion: { 'north-america': 120_000, europe: 60_000, india: 20_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 2_000, res: 10_000 },
    flows: [
      {
        key: 'read',
        name: 'Read paste',
        share: 0.9,
        rpsPerUser: 0.017,
        op: 'read',
        path: [
          { key: 'client' },
          { key: 'cdn', cacheable: true },
          'waf',
          'lb',
          'api',
          { key: 'cache', cacheable: true },
          'db',
          'blobs',
        ],
      },
      {
        key: 'create',
        name: 'Create paste',
        share: 0.1,
        rpsPerUser: 0.017,
        op: 'write',
        path: ['client', 'waf', 'lb', 'api', 'blobs', 'db'],
      },
    ],
  }),
  hints: [
    'Split the data: small metadata (id, owner, expiry, visibility, blob key) in a database; the paste body in object storage.',
    'Reads dominate and popular pastes are read many times: serve public pastes from a CDN and keep hot ones in Redis.',
    'Generate ids like a URL shortener (random or range-leased, base 62) so URLs are unguessable.',
    'Expiry: store expiresAt, return 404 on read once it passes, and delete in the background (a scheduled job or object-store lifecycle rules) — never on the request path.',
    'Uploads go straight to the API (or to object storage with a pre-signed URL); they must not go through the CDN cache.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 300, flowId: 'flow_read' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 500, flowId: 'flow_create' }, weight: 1 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.db-internet-reachable', weight: 1 },
    { ruleId: 'rule.plaintext-edge', weight: 1 },
  ],
  debugVariants: [
    {
      id: 'missing-index',
      title: 'Paste reads crawl on a cache miss',
      graph: broken(reference, (g) => {
        g.node('db').config = { ...g.node('db').config, queryUsesIndex: false };
      }),
      expectedFix:
        'The hot paste lookup has no index, so every cache miss scans 500 M rows. Turn on "query uses index" for the Metadata database.',
    },
  ],
  docs: {
    summary:
      'Design a text-sharing service: metadata vs blob storage, unguessable ids, CDN and cache for hot pastes, and background expiry.',
  },
});
