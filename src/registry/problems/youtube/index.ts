/** S17 practice problem: video streaming like YouTube (level 4). */
import { defineProblem } from '../../define';
import { company, design, PB, scenario, STACK } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'Video VPC', { parent: 'use1' })
  .node('client', 'client.app', 'Players (web, TV, mobile)', [0, 2], { type: 'browser' })
  .node('cdn', 'network.cdn', 'Video CDN', [1, 0], {
    type: 'managed',
    config: { ttlSec: 2_592_000, originShield: true, edgeCacheGb: 10_000 },
  })
  .node('segments', 'storage.object', 'Encoded segments (HLS/DASH)', [2, 0], {
    type: 'managed',
    group: 'vpc',
    config: { storageGb: 50_000_000 },
  })
  .node('waf', 'security.waf', 'WAF', [1, 2], { type: 'managed', group: 'vpc' })
  .node('lb', 'network.load-balancer', 'Load balancer', [2, 2], { type: 'standard', group: 'vpc' })
  .node('api', 'compute.kubernetes', 'Watch-page & search API', [3, 2], {
    type: 'xlarge',
    replicas: 12,
    group: 'vpc',
  })
  .node('metacache', 'cache.redis', 'Video metadata cache', [4, 1], {
    type: 'mem-large',
    group: 'vpc',
    config: { shards: 6, keyCount: 1_000_000_000, avgItemBytes: 2_000, zipfExponent: 1.1 },
  })
  .node('metadb', 'database.sql', 'Video metadata (sharded SQL)', [5, 1], {
    type: 'xlarge',
    group: 'vpc',
    config: { shards: 8, readReplicas: 2, multiAz: true, storageGb: 8_000 },
  })
  .node('search', 'database.elasticsearch', 'Search index', [4, 3], {
    type: 'mem-xlarge',
    replicas: 30,
    group: 'vpc',
    config: { primaryShards: 12 },
  })
  .node('upload', 'compute.app-server', 'Upload service', [3, 4], {
    type: 'large',
    replicas: 4,
    group: 'vpc',
  })
  .node('raw', 'storage.object', 'Raw uploads', [4, 5], {
    type: 'managed',
    group: 'vpc',
    config: { storageGb: 5_000_000, lifecycleDays: 30 },
  })
  .node('jobs', 'messaging.queue', 'Transcode jobs', [5, 4], {
    type: 'managed',
    group: 'vpc',
    config: { consumers: 64, visibilityTimeoutSec: 900 },
  })
  .node('transcoders', 'compute.kubernetes', 'Transcoding workers', [6, 4], {
    type: 'xlarge',
    replicas: 40,
    group: 'vpc',
  })
  .edge('client', 'cdn', STACK.http3)
  .edge('client', 'waf', STACK.https)
  .edge('cdn', 'segments', STACK.internal)
  .edge('waf', 'lb', STACK.internal)
  .edge('lb', 'api', STACK.internal)
  .edge('lb', 'upload', STACK.internal)
  .edge('api', 'metacache', STACK.redis)
  .edge('api', 'metadb', STACK.postgres)
  .edge('api', 'search', STACK.internal)
  .edge('upload', 'raw', STACK.internal)
  .edge('upload', 'metadb', STACK.postgres)
  .edge('upload', 'jobs', STACK.internal)
  .edge('jobs', 'transcoders', STACK.internal, { async: true })
  .edge('transcoders', 'segments', STACK.internal)
  .build();

export default defineProblem({
  id: 'problem.youtube',
  title: 'YouTube',
  level: 4,
  tags: [
    'video',
    'streaming',
    'transcoding',
    'cdn',
    'object-storage',
    'search',
    'async',
    company('google'),
    company('netflix'),
  ],
  requirements: {
    functional: [
      'Creators upload videos (up to several GB); viewers can watch them minutes later.',
      'Playback adapts to bandwidth (several resolutions, chunked HLS/DASH segments).',
      'Watch page shows title, channel, view count and recommendations; search by title and tags.',
      'Count views (approximately) and resume where the viewer left off.',
    ],
    nonFunctional: [
      'Video start time < 2 s; segment fetches p99 < 250 ms from a nearby edge; no rebuffering for popular videos.',
      'Massive egress: almost all video bytes must come from the CDN, not the origin.',
      'Uploads are durable and processing is resumable (a crashed transcoder retries its chunk).',
      'Peak ≈ 600,000 segment requests/s, 50,000 watch-page loads/s, 500 uploads/s.',
    ],
  },
  scale: { dau: 2_000_000_000, readWriteRatio: 1_000, dataSizeBytes: 50 * PB },
  scenario: scenario({
    usersByRegion: { 'north-america': 4_000_000, europe: 3_000_000, latam: 2_000_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 800, res: 500_000 },
    flows: [
      {
        key: 'segments',
        name: 'Stream video segments',
        share: 0.9,
        rpsPerUser: 0.037,
        op: 'read',
        path: ['client', { key: 'cdn', cacheable: true }, 'segments'],
      },
      {
        key: 'watch',
        name: 'Load watch page',
        share: 0.075,
        rpsPerUser: 0.037,
        op: 'read',
        path: ['client', 'waf', 'lb', 'api', { key: 'metacache', cacheable: true }, 'metadb'],
      },
      {
        key: 'search',
        name: 'Search',
        share: 0.024,
        rpsPerUser: 0.037,
        op: 'read',
        path: ['client', 'waf', 'lb', 'api', 'search'],
      },
      {
        key: 'upload',
        name: 'Upload video',
        share: 0.001,
        rpsPerUser: 0.037,
        op: 'write',
        path: ['client', 'waf', 'lb', 'upload', 'raw', 'metadb', 'jobs', 'transcoders', 'segments'],
      },
    ],
  }),
  hints: [
    'Split the system in two: the upload/processing pipeline (write, slow, async) and the playback path (read, fast, served by the CDN).',
    'Upload in resumable chunks straight to object storage, then enqueue a transcoding job; the API never holds video bytes in memory.',
    'Transcode into several bitrates and cut each into 2–6 s segments with a manifest (HLS/DASH); the player picks the bitrate per segment (adaptive streaming).',
    'Segments are immutable: cache them at the CDN with very long TTLs and an origin shield so the origin sees only cache misses.',
    'Watch-page metadata is tiny and very hot: cache it; count views asynchronously (batch counters) instead of a database write per view.',
    'Search uses a dedicated index (Elasticsearch) updated after processing finishes.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 250, flowId: 'flow_segments' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 250, flowId: 'flow_watch' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.db-internet-reachable', weight: 1 },
    { ruleId: 'rule.plaintext-edge', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Design a video platform: resumable uploads, an async transcoding pipeline, adaptive segments in object storage and a CDN that serves almost all the bytes.',
  },
});
