import { z } from 'zod';
import { defineComponent } from '../../define';

/**
 * AWS-only (provider-only tag): Aurora is MySQL/PostgreSQL compatible but its storage layer is
 * shared by the writer and all replicas, so replicas add no storage copies and lag ~10–20 ms.
 */
export default defineComponent({
  id: 'database.aurora',
  name: 'Cloud-native SQL (Aurora)',
  category: 'database',
  tags: ['database', 'sql', 'relational', 'acid', 'postgres', 'mysql', 'aws', 'provider-only'],
  icon: 'database-zap',
  providerNames: { aws: 'Aurora' },
  ports: [{ id: 'in', direction: 'in', protocols: ['postgres-wire', 'mysql-wire', 'tcp'] }],
  configSchema: z.object({
    engine: z.enum(['postgres', 'mysql']).describe('Compatible engine'),
    storageGb: z
      .number()
      .int()
      .min(10)
      .max(131_072)
      .describe('Data in the shared cluster volume (grows automatically, up to 128 TiB)')
      .meta({ scaling: 'storageGb' }),
    readReplicas: z
      .number()
      .int()
      .min(0)
      .max(15)
      .describe('Aurora Replicas: share the cluster volume, take reads, and are failover targets')
      .meta({ scaling: 'readReplicas' }),
    clusterVolumes: z
      .number()
      .int()
      .min(1)
      .max(6)
      .describe('Billed storage volumes: 1 + secondary regions of an Aurora Global Database')
      .meta({ advanced: true, scaling: 'storageCopies' }),
    maxConnections: z
      .number()
      .int()
      .min(10)
      .max(16_000)
      .describe('Connection limit on the writer')
      .meta({ advanced: true }),
  }),
  defaults: {
    engine: 'postgres',
    storageGb: 100,
    readReplicas: 1,
    clusterVolumes: 1,
    maxConnections: 1000,
  },
  // Aurora PostgreSQL on-demand, us-east-1 (approximate, as of 2026-10-01).
  instanceTypes: [
    { id: 'db.r6g.large', vCpu: 2, memGb: 16, netGbps: 10, costUsdPerHour: 0.26 },
    { id: 'db.r6g.xlarge', vCpu: 4, memGb: 32, netGbps: 10, costUsdPerHour: 0.519 },
    { id: 'db.r6g.2xlarge', vCpu: 8, memGb: 64, netGbps: 10, costUsdPerHour: 1.038 },
    { id: 'db.r6g.4xlarge', vCpu: 16, memGb: 128, netGbps: 10, costUsdPerHour: 2.076 },
  ],
  perf: {
    serviceTimeMs: { read: 2, write: 6 },
    maxConcurrencyPerInstance: 100,
    scaleCurve: 'single-writer',
    saturationBehavior: 'queue',
  },
  behaviors: ['replicatedStore'],
  docs: {
    summary:
      'AWS’s cloud-native relational database: PostgreSQL / MySQL compatible, with a distributed storage volume shared by one writer and up to 15 read replicas.',
    howItWorks:
      'The writer sends only redo-log records to a storage layer that keeps six copies across three zones and acknowledges a write once four copies have it. Replicas read the same volume, so they need no copy of the data and usually lag 10–20 ms. Failover promotes a replica in about 30 seconds.',
    tradeoffs: [
      'Faster failover and cheaper replicas than classic replication, but writes still go through one writer.',
      'Only on AWS: switching providers means moving to a regular managed SQL database.',
      'Pricier per instance than RDS, plus per-I/O charges on the Standard storage option.',
    ],
    interviewTips: [
      'Mention the shared storage: read replicas scale reads without copying data.',
      'Global Database replicates to other regions in about a second for disaster recovery.',
      'Write scaling still needs sharding or a different database.',
    ],
  },
  security: {
    defaultPorts: [5432, 3306],
    threats: [
      'Cluster endpoint reachable from the internet',
      'SQL injection',
      'Long-lived master password in code',
    ],
    controls: [
      'Private subnets and security groups',
      'IAM database authentication / Secrets Manager rotation',
      'KMS encryption at rest, TLS in transit',
    ],
  },
});
