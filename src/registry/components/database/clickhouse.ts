import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'database.clickhouse',
  name: 'ClickHouse',
  category: 'database',
  tags: ['database', 'olap', 'analytics', 'columnar', 'clickhouse', 'warehouse', 'self-hosted'],
  icon: 'chart-column',
  ports: [{ id: 'in', direction: 'in', protocols: ['http1', 'tcp', 'tls13'] }],
  configSchema: z.object({
    rowsScannedPerQuery: z
      .number()
      .min(0)
      .max(1e13)
      .describe('Rows a typical query reads after primary-key / partition pruning'),
    columnsRead: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .describe('Columns the query touches (only those are read from disk)'),
    rowsPerInsert: z
      .number()
      .int()
      .min(1)
      .max(1e8)
      .describe('Rows per INSERT (batch big: each insert creates a part to merge)'),
    storageGb: z
      .number()
      .min(1)
      .max(1e8)
      .describe('Compressed data stored')
      .meta({ scaling: 'storageGb' }),
    replication: z
      .number()
      .int()
      .min(1)
      .max(3)
      .describe('Replicas per shard (ReplicatedMergeTree via Keeper)')
      .meta({ advanced: true, scaling: 'storageCopies' }),
  }),
  defaults: {
    rowsScannedPerQuery: 100_000_000,
    columnsRead: 3,
    rowsPerInsert: 50_000,
    storageGb: 1000,
    replication: 2,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES, ...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    // fixed per-query/insert overhead; the scan/insert size is added by the columnar behavior
    serviceTimeMs: { read: 5, write: 10 },
    // one heavy analytical query uses all the instance's cores
    maxConcurrencyPerInstance: 1,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  behaviors: ['columnar'],
  docs: {
    summary:
      'A column-oriented OLAP database that scans billions of rows per second for analytics, dashboards and log/event exploration.',
    howItWorks:
      'Data is stored column by column, sorted by the table\'s primary key and compressed, so a query reads only the columns it uses and skips blocks outside its key range. Queries are vectorised and run on all cores in parallel. Each INSERT writes an immutable data part; background merges combine parts (MergeTree), so many small inserts overwhelm merges ("too many parts"). The simulator charges scan work ∝ rows × columns ÷ cores, and warns about frequent small inserts.',
    tradeoffs: [
      'Orders of magnitude faster than row stores for aggregations over many rows, but slow and awkward for point lookups, updates and deletes.',
      'Wants large batched inserts; streaming one row at a time needs a buffer (Kafka engine, async inserts).',
      'Joins between large tables are limited; denormalise or use dictionaries.',
    ],
    interviewTips: [
      'Use it for analytics on events: ad clicks, metrics, logs, product analytics — not as the transactional store.',
      'Feed it from Kafka in batches; pre-aggregate with materialized views for hot dashboards.',
      'Pick ORDER BY keys that match common filters (tenant, date) so queries scan little.',
    ],
  },
  security: {
    defaultPorts: [8123, 9000, 9440],
    threats: [
      'Default user without password reachable over HTTP',
      'Expensive queries used for denial of service',
    ],
    controls: [
      'Users with passwords/certs, RBAC and row policies; TLS ports only',
      'Quotas and max_execution_time / max_memory_usage per user',
    ],
  },
});
