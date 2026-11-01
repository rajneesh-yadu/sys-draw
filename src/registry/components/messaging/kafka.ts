import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'messaging.kafka',
  name: 'Apache Kafka',
  category: 'messaging',
  tags: [
    'kafka',
    'log',
    'stream',
    'events',
    'partitioned',
    'replay',
    'messaging',
    'async',
    'brokers',
  ],
  icon: 'waves',
  providerNames: {
    aws: 'Amazon MSK',
    gcp: 'Managed Service for Apache Kafka',
    azure: 'HDInsight Kafka',
  },
  ports: [
    { id: 'producers', direction: 'in', protocols: ['kafka-wire', 'tls13', 'tcp'] },
    { id: 'consumers', direction: 'out', protocols: ['kafka-wire', 'tls13', 'tcp'] },
  ],
  configSchema: z.object({
    partitions: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .describe(
        'Partitions of the topic: ordered logs spread over the brokers. Caps consumer parallelism per group',
      ),
    replicationFactor: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe('Copies of every partition on different brokers (followers fetch every write)')
      .meta({ scaling: 'storageCopies' }),
    acks: z
      .enum(['0', '1', 'all'])
      .describe(
        'When the producer counts a write as done: never, leader on disk, or all in-sync replicas',
      )
      .meta({
        perfEffect: {
          '0': {
            why: 'fire-and-forget: the producer does not wait, and a broker crash loses messages',
          },
          all: {
            writeAddMs: 2,
            why: 'the leader answers only after every in-sync follower has fetched the record (one more round trip)',
          },
        },
      }),
    minInsyncReplicas: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe('With acks=all, writes fail if fewer replicas than this are in sync')
      .meta({ advanced: true }),
    retentionHours: z
      .number()
      .int()
      .min(1)
      .max(87_600)
      .describe('How long events stay on disk for replay, consumed or not'),
    messageBytes: z
      .number()
      .int()
      .min(1)
      .max(10_000_000)
      .describe('Average message size (sizes retention and network)'),
    storageGb: z
      .number()
      .min(1)
      .max(1e7)
      .describe('Disk provisioned for retained data (per copy)')
      .meta({ scaling: 'storageGb' }),
    keySkew: z
      .number()
      .min(0)
      .max(1)
      .describe('Share of events on the hottest partition key (0 = spread evenly)')
      .meta({ advanced: true }),
    compression: z
      .enum(['none', 'lz4', 'zstd'])
      .describe('Producer batch compression: less disk and network for some CPU')
      .meta({
        advanced: true,
        perfEffect: {
          zstd: {
            write: 1.15,
            why: 'compressing batches costs producer/broker CPU but cuts bytes by ~3–5×',
          },
        },
      }),
  }),
  defaults: {
    partitions: 12,
    replicationFactor: 3,
    acks: 'all',
    minInsyncReplicas: 2,
    retentionHours: 168,
    messageBytes: 1000,
    storageGb: 1000,
    keySkew: 0,
    compression: 'lz4',
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    // per message, batched: an append to the page cache; followers repeat it (× RF, see queue)
    serviceTimeMs: { read: 0.5, write: 1 },
    maxConcurrencyPerInstance: 64,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  behaviors: ['queue', 'configPerf'],
  docs: {
    summary:
      'A distributed, partitioned, replicated commit log. Producers append events to topic partitions; each consumer group reads every event at its own pace and can replay history.',
    howItWorks:
      "A topic is split into partitions; the producer hashes each event's key to pick one, so events with the same key stay in order. Each partition has a leader broker and followers that fetch from it; with acks=all the leader confirms a write only once every in-sync replica has it, so a broker can die without losing data. Each connected consumer is a consumer group: it sees every event, and inside the group each partition is read by exactly one consumer instance, which tracks its offset. If a group consumes slower than producers write, lag (messages not yet read) grows; events are deleted only by retention time or size, never by consumption.",
    tradeoffs: [
      'Very high throughput, durable and replayable, with many independent readers — but you run brokers, partitions and disks (or pay for MSK/Confluent).',
      'Order is per partition only, and a group cannot use more consumers than there are partitions; repartitioning later reshuffles keys.',
      'acks=all with min.insync.replicas=2 survives a broker loss at the cost of a follower round trip on every write; acks=1/0 is faster but can lose data.',
      'A hot key pins all its traffic to one partition and one consumer.',
    ],
    interviewTips: [
      'Use Kafka when several services need the same events (fan-out), or you need to replay/rebuild state; use a work queue for simple task distribution.',
      'Size partitions from peak throughput ÷ per-consumer throughput, with headroom: e.g. 50k msg/s ÷ 5k per consumer → ≥ 10, pick 12–24.',
      'Choose the key for ordering (order_id, user_id) and say how you handle hot keys.',
      'Mention consumer lag as the key SLO metric, and idempotent producers + transactional/outbox writes for exactly-once effects.',
    ],
  },
  security: {
    defaultPorts: [9092, 9093, 9094],
    threats: [
      'Unauthenticated clients producing to or consuming from any topic',
      'Plaintext traffic between clients and brokers or between brokers',
      'Poison messages that crash every consumer of a partition',
    ],
    controls: [
      'mTLS or SASL/SCRAM authentication with per-topic ACLs',
      'TLS for client and inter-broker listeners; encryption at rest',
      'Schema registry validation; dead-letter topics for bad messages',
    ],
  },
});
