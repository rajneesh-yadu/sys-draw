import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';
import { scalingHelp } from '../../scaling-help';

export default defineComponent({
  id: 'messaging.stream',
  name: 'Event Stream (Kafka)',
  category: 'messaging',
  tags: ['kafka', 'log', 'stream', 'events', 'partitioned', 'replay', 'messaging', 'async'],
  icon: 'waves',
  providerNames: {
    aws: 'Kinesis Data Streams',
    gcp: 'Managed Service for Apache Kafka',
    azure: 'Event Hubs',
  },
  ports: [
    { id: 'producers', direction: 'in', protocols: ['kafka-wire', 'http2', 'amqp'] },
    { id: 'consumers', direction: 'out', protocols: ['kafka-wire', 'http2', 'amqp'] },
  ],
  configSchema: z
    .object({
      partitions: z
        .number()
        .int()
        .min(1)
        .max(10_000)
        .describe('Parallel append-only logs (shards); order holds within one partition')
        .meta({ scaling: 'shards' }),
      replicationFactor: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe('Copies of every partition on different brokers / zones')
        .meta({ scaling: 'storageCopies' }),
      retentionHours: z
        .number()
        .int()
        .min(1)
        .max(8760)
        .describe('How long events are kept for replay, whether consumed or not'),
      storageGb: z
        .number()
        .min(1)
        .max(1e6)
        .describe('Data retained (per copy)')
        .meta({ scaling: 'storageGb' }),
      consumerGroups: z
        .number()
        .int()
        .min(1)
        .max(100)
        .describe(
          'Independent readers that each see every event. Not simulated: each consumer node connected after the stream is its own group',
        )
        .meta({ advanced: true }),
      keySkew: z
        .number()
        .min(0)
        .max(1)
        .describe('Share of events on the hottest partition key (0 = evenly spread)')
        .meta({ advanced: true, scaling: 'keySkew' }),
    })
    .meta(
      scalingHelp({
        replicas:
          'Instances per partition that share its load: more throughput and cost. Copies of the data are Replication factor, not this. Ordering and the hot-key limit are per partition, so add Partitions to scale.',
        autoscale: 'Adds or removes instances per partition.',
      }),
    ),
  defaults: {
    partitions: 6,
    replicationFactor: 3,
    retentionHours: 168,
    storageGb: 100,
    consumerGroups: 1,
    keySkew: 0,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    serviceTimeMs: { read: 2, write: 4 },
    maxConcurrencyPerInstance: 50,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  behaviors: ['queue'],
  docs: {
    summary:
      'A durable, partitioned, replayable log of events (Kafka). Producers append; any number of consumer groups read at their own offset.',
    howItWorks:
      "Each event goes to one partition, chosen by hashing its key, and is appended to that partition's log and replicated to the other brokers. Consumers in a group split the partitions between them and remember an offset per partition; a new group can start from the beginning and replay history. Throughput scales with partitions, and ordering holds only within a partition.",
    tradeoffs: [
      'Replay and many independent readers, at the cost of running (or paying for) partitions and storage.',
      'Parallelism is capped by the partition count: more consumers than partitions sit idle.',
      'A hot key lands on one partition and caps that key at one partition’s throughput.',
    ],
    interviewTips: [
      'Choose a log when several consumers need the same events or you must rebuild state by replaying.',
      'Pick the partition key for ordering (user_id, order_id) and check it spreads load.',
      'Size partitions from peak write rate ÷ per-partition throughput, with headroom.',
    ],
  },
  security: {
    defaultPorts: [9092, 9093, 443],
    threats: [
      'Unauthenticated producers writing to any topic',
      'Consumers reading topics they should not',
      'Plaintext broker traffic',
    ],
    controls: [
      'mTLS or SASL authentication and per-topic ACLs',
      'TLS between clients and brokers and between brokers',
      'Encryption at rest; schema validation of events',
    ],
  },
});
