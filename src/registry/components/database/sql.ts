import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'database.sql',
  name: 'SQL Database',
  category: 'database',
  tags: ['database', 'sql', 'relational', 'acid', 'postgres', 'mysql'],
  icon: 'database',
  providerNames: { aws: 'RDS', gcp: 'Cloud SQL', azure: 'Azure Database for PostgreSQL' },
  ports: [{ id: 'in', direction: 'in', protocols: ['postgres-wire', 'mysql-wire', 'tcp'] }],
  configSchema: z.object({
    engine: z.enum(['postgres', 'mysql']).describe('Database engine'),
    storageGb: z
      .number()
      .int()
      .min(10)
      .max(65_536)
      .describe('Provisioned storage (per copy)')
      .meta({ scaling: 'storageGb' }),
    readReplicas: z
      .number()
      .int()
      .min(0)
      .max(15)
      .describe('Read-only copies that take read traffic (writes still go to the one primary)')
      .meta({ scaling: 'readReplicas' }),
    multiAz: z
      .boolean()
      .describe(
        'Synchronous standby in another zone for automatic failover (billed, serves no traffic)',
      )
      .meta({ scaling: 'standby' }),
    shards: z
      .number()
      .int()
      .min(1)
      .max(1024)
      .default(1)
      .describe(
        'Split rows over N primaries by a shard key; each shard has its own primary and replicas',
      )
      .meta({ advanced: true, scaling: 'shards' }),
    shardKeySkew: z
      .number()
      .min(0)
      .max(1)
      .default(0)
      .describe('Share of traffic on the hottest shard (0 = evenly spread)')
      .meta({ advanced: true, scaling: 'keySkew' }),
    replication: z
      .enum(['async', 'semi-sync', 'sync'])
      .describe('How writes reach replicas (async = fast writes, replicas may lag)')
      .meta({ advanced: true }),
    isolation: z
      .enum(['read-committed', 'repeatable-read', 'serializable'])
      .describe('Transaction isolation level')
      .meta({ advanced: true }),
    maxConnections: z
      .number()
      .int()
      .min(10)
      .max(10_000)
      .describe('Connection limit on the primary')
      .meta({ advanced: true }),
    backupRetentionDays: z
      .number()
      .int()
      .min(0)
      .max(35)
      .describe('Point-in-time recovery window')
      .meta({ advanced: true }),
  }),
  defaults: {
    engine: 'postgres',
    storageGb: 100,
    readReplicas: 0,
    multiAz: false,
    shards: 1,
    shardKeySkew: 0,
    replication: 'async',
    isolation: 'read-committed',
    maxConnections: 500,
    backupRetentionDays: 7,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES, ...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    serviceTimeMs: { read: 2, write: 8 },
    maxConcurrencyPerInstance: 100,
    scaleCurve: 'single-writer',
    saturationBehavior: 'queue',
  },
  behaviors: ['replicatedStore'],
  docs: {
    summary:
      'Relational database (PostgreSQL / MySQL) with tables, joins, transactions and strong consistency. The default choice for structured data with relationships.',
    howItWorks:
      'One primary takes all writes and records them in a write-ahead log; read replicas replay that log and serve reads, usually a few milliseconds to seconds behind. Indexed point lookups take about a millisecond; writes cost more because they must be made durable. A standby in another zone can be promoted in about a minute if the primary fails.',
    tradeoffs: [
      'ACID transactions and flexible queries, but writes scale only vertically (one primary) until you shard.',
      'Read replicas multiply read capacity but return stale data under async replication.',
      'Sharding a SQL database is possible but complex: cross-shard joins and transactions get hard.',
    ],
    interviewTips: [
      'Choose SQL when you need transactions (payments, orders) or relational queries.',
      'Scale reads with replicas and a cache; scale writes by sharding on a key that spreads load (e.g. user_id).',
      "Mention read-your-writes: route a user's reads to the primary right after they write.",
    ],
  },
  security: {
    defaultPorts: [5432, 3306],
    threats: [
      'Database reachable from the internet',
      'SQL injection',
      'Shared admin credentials',
      'Unencrypted backups',
    ],
    controls: [
      'Private subnet, security group allowing only app servers',
      'Parameterised queries',
      'IAM / rotated credentials via secrets manager',
      'Encryption at rest (KMS) and in transit (TLS)',
    ],
  },
});
