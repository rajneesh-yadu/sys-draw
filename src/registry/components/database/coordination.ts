import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'database.coordination',
  name: 'Coordination Service (ZooKeeper / etcd)',
  category: 'database',
  tags: [
    'coordination',
    'zookeeper',
    'etcd',
    'consensus',
    'raft',
    'leader-election',
    'locks',
    'config',
    'self-hosted',
  ],
  icon: 'network',
  ports: [{ id: 'in', direction: 'in', protocols: ['grpc', 'tcp', 'tls13'] }],
  configSchema: z.object({
    engine: z.enum(['etcd', 'zookeeper']).describe('etcd (Raft, gRPC) or ZooKeeper (ZAB)'),
    members: z
      .number()
      .int()
      .min(1)
      .max(9)
      .describe('Voting members (use an odd number: 3 tolerates 1 failure, 5 tolerates 2)'),
    readMode: z
      .enum(['linearizable', 'local'])
      .describe(
        'linearizable: confirmed by the leader (etcd default); local: any member, may be stale (ZooKeeper default)',
      ),
    dataGb: z
      .number()
      .min(0.01)
      .max(8)
      .describe('Data kept in the store (small: keep it under a few GB)')
      .meta({ scaling: 'storageGb' }),
  }),
  defaults: { engine: 'etcd', members: 3, readMode: 'linearizable', dataGb: 1 },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    // a write is a WAL append + fsync on the leader (and on each follower)
    serviceTimeMs: { read: 0.3, write: 2 },
    maxConcurrencyPerInstance: 8,
    scaleCurve: 'single-writer',
    saturationBehavior: 'queue',
  },
  behaviors: ['consensus'],
  docs: {
    summary:
      'A small, strongly consistent key-value store replicated by consensus (Raft / ZAB), used for leader election, locks, service discovery and cluster configuration.',
    howItWorks:
      'One member is elected leader; every write is appended to its log and committed once a majority of members have it on disk, so the store stays consistent as long as a majority is alive. Clients watch keys to be notified of changes, and use leases/ephemeral nodes for locks and membership that disappear when a client dies. Reads can be served locally by any member (fast, maybe stale) or confirmed by the leader (linearizable). Throughput is limited by the one leader and by fsync latency, so it holds metadata, not application data.',
    tradeoffs: [
      'Correct coordination primitives (elections, locks, fencing tokens) — but only thousands of writes per second and small data sizes.',
      'More members = more fault tolerance, slightly slower commits and no extra write capacity.',
      'Unavailable for writes without a majority (it chooses consistency over availability, CP).',
    ],
    interviewTips: [
      'Use it for leader election, distributed locks with fencing tokens, and config/service discovery (Kubernetes stores all state in etcd).',
      'Never put high-volume data in it; store pointers, not payloads.',
      'Explain why 3 or 5 members: a majority must survive, and even sizes add no tolerance.',
    ],
  },
  security: {
    defaultPorts: [2379, 2380, 2181, 2888, 3888],
    threats: [
      'Unauthenticated clients reading secrets (etcd holds Kubernetes Secrets)',
      'Peer traffic interception or a rogue member joining',
    ],
    controls: [
      'Client and peer mTLS; RBAC / ACLs',
      'Encryption at rest of the data directory; network policy to control-plane hosts only',
    ],
  },
});
