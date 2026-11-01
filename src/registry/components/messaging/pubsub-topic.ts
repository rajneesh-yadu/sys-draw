import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'messaging.topic',
  name: 'Pub/Sub Topic',
  category: 'messaging',
  tags: ['pubsub', 'topic', 'fan-out', 'messaging', 'async', 'events', 'managed'],
  icon: 'megaphone',
  providerNames: { aws: 'SNS', gcp: 'Pub/Sub', azure: 'Event Grid' },
  ports: [
    { id: 'publishers', direction: 'in', protocols: ['http1', 'http2'] },
    { id: 'subscribers', direction: 'out', protocols: ['http1', 'http2', 'amqp'] },
  ],
  configSchema: z.object({
    delivery: z
      .enum(['at-most-once', 'at-least-once'])
      .describe('Delivery guarantee to each subscription (at-least-once = possible duplicates)'),
    ordering: z
      .enum(['none', 'per-key'])
      .describe('Per-key ordering keeps one key in order, at lower throughput per key'),
    filtering: z
      .boolean()
      .describe('Subscribers receive only messages matching their filter policy')
      .meta({ advanced: true }),
    retryAttempts: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe('Delivery retries to a failing subscriber before dead-lettering')
      .meta({ advanced: true }),
  }),
  defaults: { delivery: 'at-least-once', ordering: 'none', filtering: false, retryAttempts: 3 },
  instanceTypes: [{ id: 'managed', vCpu: 2, memGb: 4, netGbps: 10, costUsdPerHour: 0 }],
  perf: {
    serviceTimeMs: { read: 10, write: 10 },
    maxConcurrencyPerInstance: 5000,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  behaviors: ['queue'],
  docs: {
    summary:
      'Publish once, deliver to every subscriber. A topic fans one event (a new post, an order placed) out to many independent services.',
    howItWorks:
      "A publisher's call returns once the message is stored. The service then pushes a copy to every subscription (an HTTP endpoint, a queue, a function), retrying failed deliveries with backoff. Each subscriber gets its own copy and processes at its own pace, so adding a consumer never touches the publisher.",
    tradeoffs: [
      'Loose coupling: new subscribers need no publisher change, but nobody owns the end-to-end outcome.',
      'Push delivery can overwhelm a slow subscriber; put a queue behind the topic to buffer (the SNS → SQS pattern).',
      'No replay: once delivered and acknowledged a message is gone — use a log (Kafka, Kinesis, Event Hubs) to re-read history.',
    ],
    interviewTips: [
      'Use a topic for fan-out (notify search, feed and analytics when a post is created); a queue for work distribution.',
      'Say how subscribers stay idempotent under at-least-once delivery.',
      'Topic + one queue per consumer gives fan-out and buffering together.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: [
      'Anyone able to publish fake events',
      'Subscriptions to endpoints outside your account',
      'Sensitive payloads fanned out to services that should not see them',
    ],
    controls: [
      'Topic policies limiting publishers and subscription endpoints',
      'Encryption at rest with a customer key',
      'Signed messages / verify the signature in HTTP subscribers',
    ],
  },
});
