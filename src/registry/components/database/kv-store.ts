import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'database.kv-store',
  name: 'Key-Value Store (DynamoDB-style)',
  category: 'database',
  tags: ['database', 'key-value', 'dynamodb', 'managed', 'serverless', 'partitioned', 'nosql'],
  icon: 'key-round',
  providerNames: {
    aws: 'DynamoDB',
    gcp: 'Firestore (Datastore mode)',
    azure: 'Cosmos DB for Table',
  },
  ports: [{ id: 'in', direction: 'in', protocols: ['http1', 'http2', 'tls13'] }],
  configSchema: z.object({
    capacityMode: z
      .enum(['on-demand', 'provisioned'])
      .describe('Pay per request, or reserve read/write units per second'),
    readConsistency: z
      .enum(['eventual', 'strong', 'transactional'])
      .describe('Eventual reads cost half a unit; strong reads 1; transactional 2'),
    writeMode: z
      .enum(['standard', 'transactional'])
      .describe('Transactional writes (TransactWriteItems) cost 2× units and wait longer'),
    itemSizeKb: z
      .number()
      .min(0.1)
      .max(400)
      .describe('Average item size: reads cost per 4 KB, writes per 1 KB'),
    globalSecondaryIndexes: z
      .number()
      .int()
      .min(0)
      .max(20)
      .describe('GSIs: every write is also written to each index'),
    partitions: z
      .number()
      .int()
      .min(1)
      .max(100_000)
      .describe('Minimum partitions (the table also splits every 10 GB)')
      .meta({ advanced: true, scaling: 'shards' }),
    storageGb: z.number().min(0).max(1e7).describe('Data stored').meta({ scaling: 'storageGb' }),
    hotKeySkew: z
      .number()
      .min(0)
      .max(1)
      .describe('Share of requests on the hottest partition key (0 = even)')
      .meta({ advanced: true, scaling: 'keySkew' }),
  }),
  defaults: {
    capacityMode: 'on-demand',
    readConsistency: 'eventual',
    writeMode: 'standard',
    itemSizeKb: 1,
    globalSecondaryIndexes: 1,
    partitions: 4,
    storageGb: 50,
    hotKeySkew: 0,
  },
  instanceTypes: [{ id: 'managed', vCpu: 1, memGb: 1, netGbps: 10, costUsdPerHour: 0 }],
  perf: {
    // what a caller waits; the per-partition work is derived from the 3 000 RU / 1 000 WU budget
    serviceTimeMs: { read: 4, write: 6 },
    maxConcurrencyPerInstance: 100,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['partitionedKv'],
  docs: {
    summary:
      'A fully managed, partitioned key-value/document table (DynamoDB-style) with single-digit-millisecond reads and writes at any scale, priced per request and limited per partition.',
    howItWorks:
      "Items are placed by hashing the partition key; each partition is stored on three replicas across zones and has a hard budget of 3 000 read units and 1 000 write units per second (a read unit = one strongly consistent 4 KB read, or two eventual ones; a write unit = one 1 KB write). Tables split partitions as data grows past 10 GB or throughput rises. Global secondary indexes are separate partitioned tables updated asynchronously from every write. The simulator turns those budgets into per-partition capacity, so a hot key throttles even when the table's total capacity is far from used.",
    tradeoffs: [
      'No servers, patching or capacity planning (on-demand), but only key-based access patterns — scans and ad-hoc queries are slow and expensive.',
      'Strong and transactional reads/writes cost 2× and take longer; GSIs multiply write cost and are eventually consistent.',
      'Per-partition limits make hot keys throttle; on-demand can be several times pricier than well-used provisioned capacity.',
    ],
    interviewTips: [
      'Design keys from the access patterns first (single-table design): PK = entity id, SK = sort/range.',
      'Do the unit math out loud: 10k writes/s of 2 KB items = 20k WU/s ⇒ ≥ 20 partitions.',
      'Spread hot keys with write sharding (key#0..9) and put a cache (DAX/Redis) in front of hot reads.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: [
      'Over-broad IAM policies granting access to every table',
      'Requests over the public endpoint from inside the VPC',
      'Accidental table deletion or overwrite',
    ],
    controls: [
      'Fine-grained IAM (leading-key conditions)',
      'VPC endpoints; encryption at rest with customer keys',
      'Point-in-time recovery and deletion protection',
    ],
  },
});
