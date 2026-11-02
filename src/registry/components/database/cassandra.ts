import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from '../../presets';
import { scalingHelp } from '../../scaling-help';

const LEVELS = ['ONE', 'TWO', 'QUORUM', 'LOCAL_QUORUM', 'ALL'] as const;

export default defineComponent({
  id: 'database.cassandra',
  name: 'Apache Cassandra',
  category: 'database',
  tags: [
    'database',
    'cassandra',
    'scylla',
    'wide-column',
    'leaderless',
    'quorum',
    'consistent-hashing',
    'self-hosted',
  ],
  icon: 'circle-dot',
  ports: [{ id: 'in', direction: 'in', protocols: ['cql', 'tls13', 'tcp'] }],
  configSchema: z
    .object({
      replicationFactor: z
        .number()
        .int()
        .min(1)
        .max(7)
        .describe(
          'N: copies of every row, on N consecutive nodes of the token ring (capped at the node count, Scaling → Replicas)',
        )
        .meta({ scaling: 'storageCopies' }),
      readConsistency: z
        .enum(LEVELS)
        .describe('R: replicas that must answer a read (QUORUM = ⌊N/2⌋ + 1)'),
      writeConsistency: z.enum(LEVELS).describe('W: replicas that must acknowledge a write'),
      vnodes: z
        .number()
        .int()
        .min(1)
        .max(256)
        .describe('Tokens per node (num_tokens): more = smoother data spread')
        .meta({ advanced: true }),
      storageGb: z
        .number()
        .min(1)
        .max(1e7)
        .describe('Data stored (one copy)')
        .meta({ scaling: 'storageGb' }),
      compaction: z
        .enum(['size-tiered', 'leveled', 'time-window'])
        .describe('How SSTables are merged: STCS for writes, LCS for reads, TWCS for time series')
        .meta({
          advanced: true,
          perfEffect: {
            leveled: {
              read: 0.8,
              write: 1.3,
              why: 'reads touch ~1 SSTable, but compaction rewrites data more often (write amplification)',
            },
          },
        }),
    })
    .meta(
      scalingHelp({
        replicas:
          'Nodes in the cluster (the token ring). Each node owns a share of the data and traffic, so capacity and cost grow with nodes. Copies of each row are Replication factor (N), which is capped at this node count. Not backups.',
        autoscale: 'Adds or removes cluster nodes.',
      }),
    ),
  defaults: {
    replicationFactor: 3,
    readConsistency: 'LOCAL_QUORUM',
    writeConsistency: 'LOCAL_QUORUM',
    vnodes: 16,
    storageGb: 500,
    compaction: 'size-tiered',
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES, ...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    // per replica: an LSM write is a commit-log append + memtable insert; a read may touch SSTables
    serviceTimeMs: { read: 2, write: 0.5 },
    maxConcurrencyPerInstance: 32,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['quorum', 'configPerf'],
  docs: {
    summary:
      'A leaderless, wide-column database: every node is equal, data sits on a consistent-hash ring with N replicas, and each request picks how many replicas (R or W) must answer.',
    howItWorks:
      'The partition key is hashed onto a token ring; the next N nodes clockwise hold copies. Any node can coordinate a request: a write goes to all N replicas and succeeds after W acks; a read asks R replicas and returns the newest version (last-write-wins timestamps), repairing stale copies. With R + W > N reads see the latest write; ONE/ONE is fastest but eventually consistent. Writes are cheap appends (commit log + memtable, flushed to SSTables and compacted later), so Cassandra shines at heavy writes. The simulator charges R reads and N writes of work per request and waits for the slowest of R / the W-th fastest of N replicas.',
    tradeoffs: [
      'Linear write scaling and no single point of failure, but you must model tables around queries (no joins, limited secondary indexes).',
      'Tunable consistency per query: QUORUM is safe but waits for the second-fastest replica; ONE is fast but can read stale data.',
      'Tombstones, large partitions and compaction need care; a hot partition key still lands on N nodes only.',
    ],
    interviewTips: [
      'Use it for write-heavy, time-ordered data at scale: messages, activity feeds, IoT metrics.',
      'State N, R, W and the consistency you get: N = 3 with QUORUM/QUORUM tolerates one replica down.',
      'Design the partition key for even spread and bounded partition size (e.g. (user_id, month)).',
    ],
  },
  security: {
    defaultPorts: [9042, 7000, 7001, 7199],
    threats: [
      'Default authenticator (AllowAll) leaves the cluster open',
      'JMX port reachable from the network',
      'Unencrypted internode gossip and streaming',
    ],
    controls: [
      'PasswordAuthenticator + role-based authorization',
      'Client and internode TLS; JMX bound to localhost with auth',
      'Encryption at rest; private subnets per data center',
    ],
  },
});
