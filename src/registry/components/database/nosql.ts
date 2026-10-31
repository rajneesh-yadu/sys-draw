import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'database.nosql',
  name: 'NoSQL Database',
  category: 'database',
  tags: ['database', 'nosql', 'key-value', 'document', 'wide-column', 'partitioned'],
  icon: 'layers',
  providerNames: { aws: 'DynamoDB', gcp: 'Bigtable', azure: 'Cosmos DB' },
  ports: [{ id: 'in', direction: 'in', protocols: ['http1', 'http2', 'tcp', 'cql'] }],
  configSchema: z.object({
    dataModel: z.enum(['key-value', 'document', 'wide-column']).describe('How records are shaped'),
    partitions: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .describe('Number of shards the key space is split into'),
    replicationFactor: z.number().int().min(1).max(7).describe('Copies of each partition'),
    consistency: z
      .enum(['eventual', 'quorum', 'strong'])
      .describe('Read consistency: eventual is fastest, strong always sees the latest write'),
    storageGb: z.number().int().min(1).max(1_000_000).describe('Data stored'),
    capacityMode: z
      .enum(['provisioned', 'on-demand'])
      .describe('Pre-buy throughput or pay per request')
      .meta({ advanced: true }),
    hotKeySkew: z
      .number()
      .min(0)
      .max(1)
      .describe('Share of traffic hitting the single hottest partition (0 = perfectly even)')
      .meta({ advanced: true }),
  }),
  defaults: {
    dataModel: 'key-value',
    partitions: 8,
    replicationFactor: 3,
    consistency: 'eventual',
    storageGb: 100,
    capacityMode: 'on-demand',
    hotKeySkew: 0,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES, ...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    serviceTimeMs: { read: 1, write: 2 },
    maxConcurrencyPerInstance: 1000,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['shardedStore', 'replicatedStore'],
  docs: {
    summary:
      'Horizontally partitioned database (key-value, document or wide-column) built for huge scale and predictable single-digit-millisecond lookups by key.',
    howItWorks:
      'Each record has a partition key; hashing the key picks the partition, and each partition is replicated (typically 3×) across zones. Reads and writes go straight to the owning partition, so capacity grows almost linearly with partitions. Quorum settings (R + W > N) trade latency for consistency. A hot key overloads one partition no matter how many others exist.',
    tradeoffs: [
      'Scales writes horizontally and stays fast at any size, but only for access patterns you designed keys for — no ad-hoc joins.',
      'Eventual consistency is cheap and fast; strong reads cost more and may be slower.',
      'Hot partitions (celebrity users, viral items) throttle even when total capacity is fine.',
    ],
    interviewTips: [
      'Design the table from the queries: partition key = what you look up by, sort key = how you range-scan.',
      'Pick NoSQL for feeds, sessions, chat messages, IoT — high write volume, simple lookups.',
      'Explain how you avoid hot keys: add a random suffix, or cache the hottest items.',
    ],
  },
  security: {
    defaultPorts: [443, 9042],
    threats: [
      'Overly broad IAM access to the whole table',
      'NoSQL injection in query filters',
      'Public endpoints without network restrictions',
    ],
    controls: [
      'Fine-grained IAM per table / key prefix',
      'VPC endpoints / private access',
      'Encryption at rest',
      'Input validation',
    ],
  },
});
