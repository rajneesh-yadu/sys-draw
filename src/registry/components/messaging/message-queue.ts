import { z } from 'zod';
import { defineComponent } from '../../define';
import { managedPerRequest, scalingHelp } from '../../scaling-help';

export default defineComponent({
  id: 'messaging.queue',
  name: 'Message Queue',
  category: 'messaging',
  tags: ['queue', 'messaging', 'async', 'decoupling', 'managed'],
  icon: 'inbox',
  providerNames: { aws: 'SQS', gcp: 'Pub/Sub (pull subscription)', azure: 'Service Bus' },
  ports: [
    { id: 'producers', direction: 'in', protocols: ['http1', 'http2', 'amqp'] },
    { id: 'consumers', direction: 'out', protocols: ['http1', 'http2', 'amqp'] },
  ],
  configSchema: z
    .object({
      delivery: z
        .enum(['at-most-once', 'at-least-once', 'exactly-once'])
        .describe('Delivery guarantee (at-least-once means consumers must be idempotent)'),
      ordering: z.enum(['none', 'fifo', 'per-key']).describe('Ordering guarantee'),
      consumers: z
        .number()
        .int()
        .min(1)
        .max(10_000)
        .describe(
          'Parallel consumers pulling messages. Not simulated: drain rate comes from the consumer nodes connected after the queue',
        ),
      retentionHours: z
        .number()
        .int()
        .min(1)
        .max(336)
        .describe('How long unconsumed messages are kept')
        .meta({ advanced: true }),
      visibilityTimeoutSec: z
        .number()
        .int()
        .min(0)
        .max(43_200)
        .describe('Time a consumer has to finish before the message is redelivered')
        .meta({ advanced: true }),
      maxReceiveCount: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .describe('Deliveries before a message goes to the dead-letter queue')
        .meta({ advanced: true }),
    })
    .meta(
      scalingHelp(
        managedPerRequest(
          'managed queue',
          'Consumers are the nodes connected after the queue (their replicas), not these units.',
        ),
      ),
    ),
  defaults: {
    delivery: 'at-least-once',
    ordering: 'none',
    consumers: 4,
    retentionHours: 96,
    visibilityTimeoutSec: 30,
    maxReceiveCount: 5,
  },
  instanceTypes: [{ id: 'managed', vCpu: 2, memGb: 4, netGbps: 10, costUsdPerHour: 0 }],
  perf: {
    serviceTimeMs: { read: 5, write: 5 },
    maxConcurrencyPerInstance: 3000,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  behaviors: ['queue'],
  docs: {
    summary:
      'Buffer that lets one service hand work to another without waiting. Producers enqueue messages; consumers process them at their own pace.',
    howItWorks:
      "A producer's write returns as soon as the message is durably stored, so the user-facing path stays fast. Consumers poll, process and acknowledge; an unacknowledged message becomes visible again after the visibility timeout and, after too many failures, moves to a dead-letter queue. When producers outpace consumers, the backlog grows: lag = backlog ÷ consume rate.",
    tradeoffs: [
      'Decouples services and absorbs spikes, but results are eventual — the user does not get the outcome in the response.',
      'At-least-once delivery means duplicates; consumers must be idempotent.',
      'Strict FIFO ordering limits throughput; per-key ordering (partitions) scales better.',
      'A queue hides overload until the backlog is hours long — monitor age of oldest message.',
    ],
    interviewTips: [
      'Move slow work (emails, thumbnails, fan-out to followers) off the request path into a queue.',
      'Say how consumers scale with backlog and what happens to poison messages (DLQ).',
      'Queue vs log (Kafka): a queue deletes messages once consumed; a log keeps them for replay by many consumer groups.',
    ],
  },
  security: {
    defaultPorts: [443, 5671],
    threats: [
      'Any service able to publish or read any queue',
      'Sensitive payloads stored unencrypted',
      'Message flooding by a compromised producer',
    ],
    controls: [
      'Per-queue IAM policies for producers and consumers',
      'Server-side encryption',
      'Validate messages in consumers',
      'Quotas and alarms on queue depth',
    ],
  },
});
