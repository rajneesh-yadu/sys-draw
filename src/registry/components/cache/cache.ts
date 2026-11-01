import { z } from 'zod';
import { defineComponent } from '../../define';
import { MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'cache.in-memory',
  name: 'Cache',
  category: 'cache',
  tags: ['cache', 'in-memory', 'redis', 'memcached', 'key-value'],
  icon: 'gauge',
  providerNames: { aws: 'ElastiCache', gcp: 'Memorystore', azure: 'Azure Cache for Redis' },
  ports: [{ id: 'in', direction: 'in', protocols: ['resp', 'tcp'] }],
  configSchema: z.object({
    engine: z.enum(['redis', 'memcached']).describe('Cache engine'),
    ttlSec: z
      .number()
      .int()
      .min(0)
      .max(2_592_000)
      .describe('How long an entry lives (0 = until evicted)'),
    writePolicy: z
      .enum(['cache-aside', 'write-through', 'write-back'])
      .describe('How writes keep the cache and the database in step'),
    shards: z
      .number()
      .int()
      .min(1)
      .max(500)
      .describe('Cluster shards (each holds part of the keys)')
      .meta({ advanced: true, scaling: 'shards' }),
    replicasPerShard: z
      .number()
      .int()
      .min(0)
      .max(5)
      .describe('Read replicas / failover copies per shard')
      .meta({ advanced: true }),
    evictionPolicy: z
      .enum(['lru', 'lfu', 'ttl', 'random'])
      .describe('What to drop when memory is full')
      .meta({ advanced: true }),
  }),
  defaults: {
    engine: 'redis',
    ttlSec: 300,
    writePolicy: 'cache-aside',
    shards: 1,
    replicasPerShard: 1,
    evictionPolicy: 'lru',
  },
  instanceTypes: [...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    serviceTimeMs: { read: 0.3, write: 0.4 },
    maxConcurrencyPerInstance: 10_000,
    scaleCurve: 'sublinear', // Redis executes commands on one thread per shard
    saturationBehavior: 'queue',
  },
  behaviors: ['cache'],
  docs: {
    summary:
      'In-memory key-value store (Redis / Memcached) that answers in well under a millisecond and absorbs read traffic before it reaches the database.',
    howItWorks:
      'With cache-aside, the app checks the cache first; on a miss it reads the database and stores the result with a TTL. Hit rate depends on how skewed popularity is (a few hot keys get most reads), how much memory you have and the TTL. Only misses reach the database: DB load = reads × (1 − hit rate). Sharding spreads keys over nodes; replicas add failover.',
    tradeoffs: [
      'Huge latency and cost win for read-heavy data, but the cache can serve stale values until TTL or invalidation.',
      'When a cache node fails or a hot key expires, misses stampede the database (thundering herd).',
      'Memory is expensive: size it for the hot working set, not the whole dataset.',
    ],
    interviewTips: [
      'Add a cache whenever reads ≫ writes, and state the expected hit rate and what it does to DB load.',
      'Explain invalidation: delete on write, short TTLs, or versioned keys.',
      'Mention request coalescing or jittered TTLs to prevent stampedes on hot keys.',
    ],
  },
  security: {
    defaultPorts: [6379, 11211],
    threats: [
      'Cache reachable from the internet with no auth',
      'Sensitive data held unencrypted in memory',
      'Cache poisoning via unvalidated keys',
    ],
    controls: [
      'Private subnet only',
      'AUTH / ACLs and TLS in transit',
      'Avoid caching secrets; encrypt at rest',
    ],
  },
});
