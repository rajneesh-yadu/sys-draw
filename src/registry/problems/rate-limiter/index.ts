/** S17 practice problem: a distributed API rate limiter (level 1). */
import { defineProblem } from '../../define';
import { company, design, GB, scenario, STACK } from '../kit';

const reference = design()
  .group('use1', 'region', 'US East', { regionId: 'us-east' })
  .group('vpc', 'vpc', 'API VPC', { parent: 'use1' })
  .node('client', 'client.app', 'API clients', [0, 1], { type: 'browser' })
  .node('gw', 'network.api-gateway', 'API gateway', [1, 1], {
    type: 'managed',
    group: 'vpc',
    config: { rateLimitRps: 1_000, burst: 2_000 },
  })
  .node('limiter', 'compute.app-server', 'Rate limiter service', [2, 1], {
    type: 'medium',
    replicas: 3,
    group: 'vpc',
  })
  .node('redis', 'cache.redis', 'Counters (Redis)', [3, 0], {
    type: 'mem-large',
    group: 'vpc',
    config: { shards: 6, replicasPerShard: 1, keyCount: 10_000_000, avgItemBytes: 100, ttlSec: 60 },
  })
  .node('rules', 'database.coordination', 'Rules (etcd)', [3, 2], {
    type: 'small',
    group: 'vpc',
  })
  .node('api', 'compute.app-server', 'Backend API', [4, 1], {
    type: 'large',
    replicas: 4,
    group: 'vpc',
  })
  .node('db', 'database.postgres', 'App database', [5, 1], {
    type: 'xlarge',
    group: 'vpc',
    config: { readReplicas: 2 },
  })
  .edge('client', 'gw', STACK.https)
  .edge('gw', 'limiter', STACK.svc)
  .edge('limiter', 'redis', STACK.redis)
  .edge('limiter', 'rules', STACK.grpc, { async: true })
  .edge('limiter', 'api', STACK.svc)
  .edge('api', 'db', STACK.postgres)
  .build();

export default defineProblem({
  id: 'problem.rate-limiter',
  title: 'Rate limiter',
  level: 1,
  tags: [
    'api',
    'rate-limiting',
    'redis',
    'distributed-counters',
    'algorithms',
    company('stripe'),
    company('cloudflare'),
  ],
  requirements: {
    functional: [
      'Limit requests per client (API key, user or IP) with configurable rules such as 100 requests per minute per key.',
      'Reject over-limit requests with HTTP 429 and Retry-After / X-RateLimit-Remaining headers.',
      'Enforce one limit across every API server (counters are shared, not per machine).',
      'Change rules without redeploying the API.',
    ],
    nonFunctional: [
      'Adds at most a few milliseconds to every request: p99 of the whole call < 200 ms for clients in North America and Europe.',
      'Highly available: if the counter store is down, fail open rather than take the API down.',
      'Accurate to within a few percent across servers; brief over-admission at window edges is acceptable.',
      'Peak ≈ 6,000 requests/s checked, 10 M active keys.',
    ],
  },
  scale: { dau: 10_000_000, readWriteRatio: 1, dataSizeBytes: 1 * GB },
  scenario: scenario({
    usersByRegion: { 'north-america': 200_000, europe: 50_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 800, res: 4_000 },
    flows: [
      {
        key: 'allowed',
        name: 'Allowed API call',
        share: 0.95,
        rpsPerUser: 0.012,
        op: 'read',
        path: ['client', 'gw', 'limiter', { key: 'redis', op: 'write' }, 'api', 'db'],
      },
      {
        key: 'rejected',
        name: 'Rejected (429)',
        share: 0.05,
        rpsPerUser: 0.012,
        op: 'read',
        path: ['client', 'gw', 'limiter', { key: 'redis', op: 'write' }],
      },
    ],
  }),
  hints: [
    'Start with the algorithm: token bucket (smooth, allows bursts) or sliding-window counter (cheap, accurate enough). Fixed windows let 2× the limit through at a window edge.',
    'Counters must be shared by every API server, so keep them in a fast in-memory store such as Redis: one INCR + EXPIRE (or a Lua script) per request.',
    'Put the check in front of the expensive work: a gateway or middleware that answers 429 before the request reaches your backend or database.',
    'Shard the counters by key (Redis Cluster) so one hot customer does not overload one node, and set a tight timeout on the limiter → Redis call.',
    'Decide what happens when Redis is unavailable: fail open (allow) with a local in-memory fallback limit is the usual choice for public APIs.',
    'Load rules from a config store (etcd, a database) asynchronously and cache them in the limiter; never read rules on the hot path.',
  ],
  referenceSolutions: [reference],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 200, flowId: 'flow_allowed' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 180, flowId: 'flow_rejected' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 2 },
    { ruleId: 'rule.plaintext-edge', weight: 1 },
  ],
  debugVariants: [],
  docs: {
    summary:
      'Design a distributed rate limiter that protects an API: shared counters, a fast check on every request and a clear answer (429) when a client is over its limit.',
  },
});
