import { z } from 'zod';
import { defineComponent } from '../../define';
import { MEMORY_OPTIMISED_INSTANCES } from '../../presets';
import { scalingHelp } from '../../scaling-help';

export default defineComponent({
  id: 'cache.redis',
  name: 'Redis',
  category: 'cache',
  tags: ['cache', 'redis', 'valkey', 'in-memory', 'key-value', 'cluster', 'data-structures'],
  icon: 'database-zap',
  providerNames: {
    aws: 'ElastiCache for Redis OSS / Valkey',
    gcp: 'Memorystore for Redis Cluster',
    azure: 'Azure Managed Redis',
  },
  ports: [{ id: 'in', direction: 'in', protocols: ['resp', 'tls13', 'tcp'] }],
  configSchema: z
    .object({
      shards: z
        .number()
        .int()
        .min(1)
        .max(500)
        .describe(
          'Cluster shards (hash slots split over primaries); memory and writes scale with shards',
        )
        .meta({ scaling: 'shards' }),
      replicasPerShard: z
        .number()
        .int()
        .min(0)
        .max(5)
        .describe(
          'Copies of each shard: failover targets that also serve reads when Read preference = replicas (billed either way)',
        )
        .meta({ scaling: 'readReplicas' }),
      readPreference: z
        .enum(['primary', 'replicas'])
        .describe(
          'Where reads go: the primary only (always current) or replicas too (READONLY, may lag)',
        ),
      keyCount: z
        .number()
        .int()
        .min(1)
        .max(1e12)
        .describe('Distinct keys that get read (the working set the cache could hold)'),
      avgItemBytes: z
        .number()
        .int()
        .min(1)
        .max(512 * 2 ** 20)
        .describe('Average value size in bytes'),
      zipfExponent: z
        .number()
        .min(0)
        .max(2)
        .describe(
          'Popularity skew s: key i is read ∝ 1/i^s (0 = uniform, ~0.8 typical web, >1 very hot)',
        )
        .meta({ advanced: true }),
      evictionPolicy: z
        .enum(['allkeys-lru', 'allkeys-lfu', 'allkeys-random', 'volatile-ttl', 'noeviction'])
        .describe('maxmemory-policy: what to drop when memory is full'),
      usableMemoryFraction: z
        .number()
        .min(0.1)
        .max(0.95)
        .describe(
          'maxmemory as a share of instance RAM (leave room for fragmentation, forks, buffers)',
        )
        .meta({ advanced: true }),
      persistence: z
        .enum(['none', 'rdb', 'aof-everysec', 'aof-always'])
        .describe(
          'Durability across restarts: none (data lost), rdb (snapshots; loses writes since the last one), aof-everysec (loses ≤ 1 s; writes ~10% slower), aof-always (fsync per write; writes ~3× slower). Not replication',
        )
        .meta({
          advanced: true,
          perfEffect: {
            'aof-everysec': {
              write: 1.1,
              why: 'every write is appended to the AOF buffer; fsync once a second',
            },
            'aof-always': {
              write: 3,
              why: 'every write waits for an fsync of the append-only file',
            },
          },
        }),
      ttlSec: z
        .number()
        .int()
        .min(0)
        .max(2_592_000)
        .describe('Default key TTL (0 = until evicted)')
        .meta({ advanced: true }),
    })
    .meta(
      scalingHelp({
        replicas:
          '1 = one primary per shard. Each extra replica adds one more read-serving replica to every shard (billed; holds a copy of the shard), on top of Replicas per shard. Prefer that field and leave this at 1. Writes and memory scale only with Shards.',
        autoscale:
          'Adds or removes read replicas per shard; writes and memory still scale only with Shards.',
        instanceType:
          'Memory and CPU of each primary and replica: memory sets how many keys fit per shard.',
      }),
    ),
  defaults: {
    shards: 1,
    replicasPerShard: 1,
    readPreference: 'primary',
    keyCount: 50_000_000,
    avgItemBytes: 1024,
    zipfExponent: 0.8,
    evictionPolicy: 'allkeys-lru',
    usableMemoryFraction: 0.75,
    persistence: 'none',
    ttlSec: 3600,
  },
  instanceTypes: [...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    serviceTimeMs: { read: 0.02, write: 0.025 },
    // ~50k simple commands/s per shard: commands run on one thread per shard (I/O threads help a little)
    maxConcurrencyPerInstance: 1,
    scaleCurve: 'single-writer',
    saturationBehavior: 'queue',
  },
  behaviors: ['cache', 'replicaReads', 'configPerf'],
  docs: {
    summary:
      'In-memory data-structure server (strings, hashes, sorted sets, streams) used as a cache, session store, rate limiter or leaderboard, answering in well under a millisecond.',
    howItWorks:
      "Redis Cluster splits keys into 16 384 hash slots spread over shard primaries; each command runs on one thread, so one shard does ~100k simple ops/s and you scale out with shards. Replicas copy their primary asynchronously and take over on failure. As a cache, hit rate follows key popularity: with Zipf-skewed reads a cache holding 20% of keys often serves 70–90% of reads. The simulator computes it from keyCount, item size, instance memory × shards and the eviction policy (Che's approximation for LRU). Persistence via RDB snapshots or the AOF trades write speed for durability.",
    tradeoffs: [
      'Sub-millisecond and versatile, but memory is the expensive, hard limit: size for the hot set, not the whole dataset.',
      'Single-threaded per shard: one hot key or a slow command (KEYS, big ZRANGE) stalls the shard.',
      'Async replication: a failover can lose the last writes; reading replicas can return stale data.',
      'LFU keeps the most popular keys better than LRU under skew; noeviction turns a full cache into write errors.',
    ],
    interviewTips: [
      'Say the expected hit rate and why (skew, working set vs memory), then what it does to DB load: DB reads = reads × (1 − h).',
      'Use Redis data structures for the job: INCR + EXPIRE for rate limits, sorted sets for leaderboards, streams for small queues.',
      'Handle hot keys (local cache, key replication) and stampedes (request coalescing, jittered TTLs).',
    ],
  },
  security: {
    defaultPorts: [6379, 6380, 16379],
    threats: [
      'Redis exposed to the internet without AUTH (mass-scanned and exploited)',
      'Dangerous commands (CONFIG, FLUSHALL, EVAL) available to app users',
      'Plaintext traffic carrying session tokens',
    ],
    controls: [
      'Private subnet; ACL users with least-privilege command sets',
      'TLS in transit; rename/disable dangerous commands',
      'Encrypt at rest; never store secrets without encryption',
    ],
  },
});
