import { z } from 'zod';
import { defineComponent } from '../../define';
import { MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'cache.memcached',
  name: 'Memcached',
  category: 'cache',
  tags: ['cache', 'memcached', 'in-memory', 'key-value', 'multi-threaded', 'self-hosted'],
  icon: 'memory-stick',
  ports: [{ id: 'in', direction: 'in', protocols: ['memcache', 'tcp'] }],
  configSchema: z.object({
    nodes: z
      .number()
      .int()
      .min(1)
      .max(500)
      .describe('Cache nodes; clients consistent-hash keys over them, so memory adds up')
      .meta({ scaling: 'shards' }),
    keyCount: z
      .number()
      .int()
      .min(1)
      .max(1e12)
      .describe('Distinct keys that get read (the working set)'),
    avgItemBytes: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024)
      .describe('Average value size in bytes (max item 1 MB by default)'),
    zipfExponent: z
      .number()
      .min(0)
      .max(2)
      .describe('Popularity skew s: key i is read ∝ 1/i^s')
      .meta({ advanced: true }),
    evictionPolicy: z.enum(['lru']).describe('Segmented LRU per slab class (the only policy)'),
    usableMemoryFraction: z
      .number()
      .min(0.1)
      .max(0.98)
      .describe('Share of RAM given to -m (slab overhead wastes some of it)')
      .meta({ advanced: true }),
    threads: z
      .number()
      .int()
      .min(1)
      .max(64)
      .describe('Worker threads per node (-t)')
      .meta({ advanced: true }),
  }),
  defaults: {
    nodes: 2,
    keyCount: 50_000_000,
    avgItemBytes: 1024,
    zipfExponent: 0.8,
    evictionPolicy: 'lru',
    usableMemoryFraction: 0.9,
    threads: 4,
  },
  instanceTypes: [...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    serviceTimeMs: { read: 0.1, write: 0.12 },
    maxConcurrencyPerInstance: 4,
    scaleCurve: 'linear', // multi-threaded: bigger nodes serve proportionally more
    saturationBehavior: 'queue',
  },
  behaviors: ['cache'],
  docs: {
    summary:
      'A simple, multi-threaded in-memory key-value cache: GET/SET/DELETE of opaque blobs with LRU eviction, scaled out by client-side consistent hashing.',
    howItWorks:
      'Each node is independent: the client library hashes every key onto a ring of nodes, so adding nodes adds memory and throughput, and there is no replication or persistence. Memory is split into slab classes by item size, each with its own LRU. Losing a node loses only its share of keys (about 1/n), which then miss and are refetched from the database. Hit rate follows key popularity vs total memory; the simulator uses Zipf popularity with an LRU (Che) model.',
    tradeoffs: [
      'Multi-threaded and memory-efficient for plain blobs, but no data structures, persistence or replication.',
      'A node failure is a burst of misses on the database (plan headroom or use a replicated cache for critical data).',
      'Uneven item sizes waste memory in slab classes (slab calcification).',
    ],
    interviewTips: [
      'Choose Memcached for a big, simple look-aside cache of rendered objects; choose Redis when you need data structures, persistence or replication.',
      'Mention consistent hashing so adding a node remaps only ~1/n of the keys.',
      'Talk about lease / gutter pools (as at Facebook) to avoid stampedes and stale sets.',
    ],
  },
  security: {
    defaultPorts: [11211],
    threats: [
      'Open UDP port abused for reflection DDoS amplification',
      'No authentication by default: anyone on the network can read or flush',
    ],
    controls: [
      'Disable UDP; bind to private interfaces only',
      'SASL authentication and TLS where supported; security groups allowing app servers only',
    ],
  },
});
