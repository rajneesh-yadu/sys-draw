import { z } from 'zod';
import { defineComponent } from '../../define';
import { scalingHelp } from '../../scaling-help';

/**
 * GCP-only (provider-only tag): horizontally scaling relational database with external
 * consistency (TrueTime). Modelled as `nodes` independent splits (shards role) with no hot key.
 */
export default defineComponent({
  id: 'database.spanner',
  name: 'Global SQL (Spanner)',
  category: 'database',
  tags: [
    'database',
    'sql',
    'relational',
    'distributed',
    'global',
    'strong-consistency',
    'gcp',
    'provider-only',
  ],
  icon: 'globe-lock',
  providerNames: { gcp: 'Spanner' },
  ports: [{ id: 'in', direction: 'in', protocols: ['grpc', 'postgres-wire'] }],
  configSchema: z
    .object({
      nodes: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .describe('Compute nodes (1 node = 1000 processing units); data splits spread across them')
        .meta({ scaling: 'shards' }),
      configuration: z
        .enum(['regional', 'multi-region'])
        .describe('Regional (3 zones) or multi-region (writes wait for a cross-region quorum)'),
      storageGb: z
        .number()
        .min(1)
        .max(10_000_000)
        .describe('Data stored (price includes replication)')
        .meta({ scaling: 'storageGb' }),
      hotKeySkew: z
        .number()
        .min(0)
        .max(1)
        .describe('Share of traffic on the hottest key range (monotonic keys make one hot split)')
        .meta({ advanced: true, scaling: 'keySkew' }),
    })
    .meta(
      scalingHelp({
        replicas:
          'Keep at 1: compute is set by Nodes, and zone (or region) replication is built in and included in the price. Values above 1 multiply the nodes (capacity and cost) in the simulation.',
        autoscale: 'Leave off and size Nodes instead; autoscaling here multiplies the nodes.',
      }),
    ),
  defaults: { nodes: 1, configuration: 'regional', storageGb: 100, hotKeySkew: 0 },
  // Regional node price in us-central1 (approximate, as of 2026-10-01).
  instanceTypes: [{ id: 'node', vCpu: 4, memGb: 16, netGbps: 10, costUsdPerHour: 0.9 }],
  perf: {
    // ≈ 22,500 reads/s or ≈ 3,600 writes/s per node (Google's regional guidance).
    serviceTimeMs: { read: 4, write: 25 },
    maxConcurrencyPerInstance: 90,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  behaviors: ['shardedStore'],
  docs: {
    summary:
      'Google’s globally distributed SQL database: relational schema and ACID transactions that scale horizontally by adding nodes, with strong (external) consistency across regions.',
    howItWorks:
      'Tables are split by primary-key range; each split is a Paxos group replicated across zones (or regions). Writes commit when a majority of replicas agree, and TrueTime clocks give every transaction a globally ordered timestamp, so reads anywhere see a consistent snapshot. Adding nodes moves splits and adds throughput roughly linearly.',
    tradeoffs: [
      'Scales writes horizontally without giving up SQL and transactions, but every write pays a quorum round trip.',
      'Only on GCP: elsewhere you choose between a single-writer SQL database and a NoSQL store.',
      'Monotonically increasing keys (timestamps, sequences) create a hot split; use UUIDs or hashed prefixes.',
    ],
    interviewTips: [
      'Reach for Spanner when you need global strong consistency and more writes than one primary can take (payments, inventory).',
      'Explain the cost: multi-region writes add tens of milliseconds.',
      'Mention interleaved tables to keep parent and child rows in the same split.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: ['Over-broad IAM roles on the database', 'Data exfiltration through exports'],
    controls: [
      'Fine-grained IAM and database roles',
      'VPC Service Controls around the project',
      'CMEK encryption and audit logs',
    ],
  },
});
