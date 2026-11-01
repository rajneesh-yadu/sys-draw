import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'database.postgres',
  name: 'PostgreSQL',
  category: 'database',
  tags: ['database', 'sql', 'relational', 'postgres', 'acid', 'replicas', 'indexes'],
  icon: 'database',
  providerNames: {
    aws: 'RDS for PostgreSQL',
    gcp: 'Cloud SQL for PostgreSQL',
    azure: 'Azure Database for PostgreSQL',
  },
  ports: [{ id: 'in', direction: 'in', protocols: ['postgres-wire', 'tls13', 'tcp'] }],
  configSchema: z.object({
    readReplicas: z
      .number()
      .int()
      .min(0)
      .max(15)
      .describe('Streaming replicas that serve reads (writes still all go to the primary)')
      .meta({ scaling: 'readReplicas' }),
    replication: z
      .enum(['async', 'sync'])
      .describe(
        'async: replicas lag, commits fast; sync: a commit waits for a standby (no data loss)',
      ),
    highAvailability: z
      .boolean()
      .describe('Hot standby in another zone for automatic failover (billed, serves no traffic)')
      .meta({ scaling: 'standby' }),
    queryUsesIndex: z
      .boolean()
      .describe('The hot read query has a matching index (off = sequential scan of the table)'),
    tableRows: z.number().int().min(1).max(1e11).describe('Rows in the table the hot query reads'),
    secondaryIndexes: z
      .number()
      .int()
      .min(0)
      .max(30)
      .describe('Indexes besides the primary key: faster reads, slower writes'),
    storageGb: z
      .number()
      .min(1)
      .max(65_536)
      .describe('Data + indexes stored')
      .meta({ scaling: 'storageGb' }),
    connectionPooling: z
      .boolean()
      .describe('PgBouncer-style pooling (each Postgres connection is a process)')
      .meta({
        advanced: true,
        perfEffect: {
          false: {
            read: 1.15,
            write: 1.15,
            why: 'thousands of backend processes waste memory and CPU on context switches',
          },
        },
      }),
  }),
  defaults: {
    readReplicas: 0,
    replication: 'async',
    highAvailability: true,
    queryUsesIndex: true,
    tableRows: 10_000_000,
    secondaryIndexes: 2,
    storageGb: 200,
    connectionPooling: true,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES, ...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    serviceTimeMs: { read: 2, write: 4 },
    maxConcurrencyPerInstance: 8,
    scaleCurve: 'single-writer',
    saturationBehavior: 'queue',
  },
  behaviors: ['relational', 'configPerf'],
  docs: {
    summary:
      'The open-source relational database: ACID transactions, rich SQL, joins and indexes, run as one primary that takes every write plus read replicas.',
    howItWorks:
      'Writes go to the primary, which appends them to the write-ahead log (WAL) and fsyncs before commit; replicas stream the WAL and replay it, asynchronously by default (they may lag) or synchronously (a commit waits for a standby). Reads can be spread over replicas, but write capacity is one machine per shard. Queries use B-tree indexes to find rows in O(log n) page reads; a query with no usable index scans the whole table, which turns a 2 ms lookup into seconds on a large table. Every extra index speeds some reads and slows every write.',
    tradeoffs: [
      'Strong consistency, transactions, joins and a mature ecosystem — but writes scale only vertically (or by sharding: Citus, app-level).',
      'Read replicas scale reads but return slightly stale data (replication lag); sync replication removes data loss but adds commit latency.',
      'Indexes make reads fast and writes slow; a missing index is the most common production outage cause.',
    ],
    interviewTips: [
      'Default to Postgres for relational data with transactions (orders, payments, users) until numbers say otherwise.',
      'Name the index for each hot query, and add read replicas + a cache before sharding.',
      'Discuss read-your-writes after replica reads (route the user to the primary right after a write).',
    ],
  },
  security: {
    defaultPorts: [5432],
    threats: [
      'SQL injection through string-built queries',
      'Database reachable from the internet',
      'Over-privileged application role (superuser)',
    ],
    controls: [
      'Parameterised queries; least-privilege roles; row-level security where needed',
      'Private subnet, TLS required (sslmode=verify-full)',
      'Encryption at rest, audit logging, automated backups + PITR',
    ],
  },
});
