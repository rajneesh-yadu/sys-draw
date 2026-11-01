import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'messaging.rabbitmq',
  name: 'RabbitMQ',
  category: 'messaging',
  tags: ['rabbitmq', 'amqp', 'queue', 'broker', 'messaging', 'async', 'work-queue', 'self-hosted'],
  icon: 'rabbit',
  ports: [
    { id: 'publishers', direction: 'in', protocols: ['amqp', 'tls13', 'tcp'] },
    { id: 'consumers', direction: 'out', protocols: ['amqp', 'tls13', 'tcp'] },
  ],
  configSchema: z.object({
    queueType: z
      .enum(['classic', 'quorum', 'stream'])
      .describe('classic = one node; quorum = Raft-replicated; stream = append-only log')
      .meta({
        perfEffect: {
          quorum: {
            write: 1.6,
            writeAddMs: 1,
            why: 'each message is committed through Raft on a majority of nodes before it is confirmed',
          },
          stream: { write: 0.7, why: 'append-only log, no per-message queue bookkeeping' },
        },
      }),
    persistent: z
      .boolean()
      .describe('Persist messages to disk (survive a broker restart)')
      .meta({
        perfEffect: {
          true: { write: 1.5, why: 'messages are written and fsynced to disk' },
        },
      }),
    publisherConfirms: z
      .boolean()
      .describe('Broker confirms each publish once it is safely stored')
      .meta({
        perfEffect: {
          true: {
            writeAddMs: 0.5,
            why: 'the publisher waits for the confirm (batch them to keep throughput)',
          },
        },
      }),
    prefetch: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .describe(
        'Unacknowledged messages a consumer may hold (too low = idle consumers, too high = unfair)',
      )
      .meta({ advanced: true }),
    exchangeType: z
      .enum(['direct', 'topic', 'fanout', 'headers'])
      .describe('How the exchange routes messages to queues')
      .meta({ advanced: true }),
  }),
  defaults: {
    queueType: 'quorum',
    persistent: true,
    publisherConfirms: true,
    prefetch: 50,
    exchangeType: 'direct',
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    serviceTimeMs: { read: 0.2, write: 0.25 },
    maxConcurrencyPerInstance: 16,
    // a queue lives on one node (its leader): more nodes add queues, not one queue's speed
    scaleCurve: 'sublinear',
    saturationBehavior: 'queue',
  },
  behaviors: ['queue', 'configPerf'],
  docs: {
    summary:
      'A message broker (AMQP): publishers send to exchanges, which route messages into queues; consumers compete for messages and acknowledge each one.',
    howItWorks:
      'An exchange routes each message by its routing key to one or more queues (direct, topic patterns, fanout). Consumers of one queue compete: each message goes to one of them, which acks it when done; unacked messages are redelivered if the consumer dies. Quorum queues replicate through Raft for safety; classic queues live on one node. Once acked a message is gone — unlike Kafka there is no replay. If consumers drain slower than publishers send, the queue grows and RabbitMQ pages messages to disk and eventually blocks publishers.',
    tradeoffs: [
      'Rich routing, per-message acks, priorities, delays and dead-lettering — but throughput per queue is far lower than a Kafka partition.',
      'Durable (persistent + quorum + confirms) costs latency and throughput; transient queues are fast but lose messages on restart.',
      'One queue is served by one node; scale by sharding work across many queues.',
    ],
    interviewTips: [
      'Pick RabbitMQ for task queues and request routing (emails, image jobs) where each message is processed once; pick Kafka for event streams with many readers or replay.',
      'Explain at-least-once delivery: consumers must be idempotent; use a dead-letter exchange after N failures.',
      'Mention prefetch (QoS) to balance work across consumers.',
    ],
  },
  security: {
    defaultPorts: [5672, 5671, 15672],
    threats: [
      'Default guest/guest credentials or open management UI',
      'Plaintext AMQP between services',
      'Queue flooding exhausting broker memory/disk',
    ],
    controls: [
      'Per-vhost users and permissions; disable guest remotely',
      'AMQPS (TLS) and a private network only',
      'Queue length limits, publisher flow control and alarms',
    ],
  },
});
