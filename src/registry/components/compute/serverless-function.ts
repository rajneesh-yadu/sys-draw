import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'compute.serverless-function',
  name: 'Serverless Function',
  category: 'compute',
  tags: ['compute', 'serverless', 'faas', 'event-driven', 'managed'],
  icon: 'zap',
  providerNames: { aws: 'Lambda', gcp: 'Cloud Run functions', azure: 'Azure Functions' },
  ports: [
    { id: 'in', direction: 'in', protocols: ['http1', 'http2'] },
    {
      id: 'out',
      direction: 'out',
      protocols: [
        'http1',
        'http2',
        'grpc',
        'tcp',
        'postgres-wire',
        'mysql-wire',
        'resp',
        'memcache',
        'kafka-wire',
        'amqp',
        'cql',
        'mongodb-wire',
        'dns',
      ],
    },
  ],
  configSchema: z.object({
    memoryMb: z
      .number()
      .int()
      .min(128)
      .max(10_240)
      .describe('Memory per invocation; CPU scales with it'),
    timeoutSec: z.number().int().min(1).max(900).describe('Maximum run time per invocation'),
    concurrencyLimit: z
      .number()
      .int()
      .min(1)
      .max(100_000)
      .describe('Maximum simultaneous invocations; extra requests are throttled')
      .meta({ scaling: 'maxInstances' }),
    provisionedConcurrency: z
      .number()
      .int()
      .min(0)
      .max(100_000)
      .describe('Pre-warmed instances that never cold-start (billed while idle)')
      .meta({ advanced: true, scaling: 'minInstances' }),
    coldStartMs: z
      .number()
      .min(0)
      .max(30_000)
      .describe('Extra latency when a new instance starts')
      .meta({ advanced: true }),
  }),
  defaults: {
    memoryMb: 1024,
    timeoutSec: 30,
    concurrencyLimit: 1000,
    provisionedConcurrency: 0,
    coldStartMs: 400,
  },
  // Price = per GB-second of execution, expressed per hour of continuous running for one instance.
  instanceTypes: [
    { id: '512mb', vCpu: 0.33, memGb: 0.5, netGbps: 0.6, costUsdPerHour: 0.03 },
    { id: '1024mb', vCpu: 0.58, memGb: 1, netGbps: 0.6, costUsdPerHour: 0.06 },
    { id: '2048mb', vCpu: 1.17, memGb: 2, netGbps: 0.6, costUsdPerHour: 0.12 },
    { id: '4096mb', vCpu: 2.33, memGb: 4, netGbps: 0.6, costUsdPerHour: 0.24 },
  ],
  perf: {
    serviceTimeMs: { read: 30, write: 50 },
    maxConcurrencyPerInstance: 1,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['serverless'],
  docs: {
    summary:
      'Code that runs per request or event with no servers to manage. Scales from zero to thousands of instances automatically and bills only for execution time.',
    howItWorks:
      'Each instance handles one request at a time. When all warm instances are busy, the platform starts a new one, paying a cold start (hundreds of ms to seconds). Above the concurrency limit, requests are throttled. CPU is proportional to memory, and you pay per GB-second plus per request, so idle time is free.',
    tradeoffs: [
      'Great for spiky or low traffic and event handlers; at steady high load, always-on servers are usually cheaper.',
      'Cold starts hurt p99 latency; provisioned concurrency fixes it but bills while idle.',
      'Thousands of instances can each open a database connection — use a connection proxy or an HTTP-based database.',
      'Hard execution time limits rule out long-running jobs.',
    ],
    interviewTips: [
      'Pick serverless for image processing, webhooks, cron jobs and unpredictable traffic.',
      'Call out cold starts and database connection limits as the two classic pitfalls.',
      'Compare cost: at constant 100% use, a function costs several times a VM of the same size.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: [
      'Over-permissive execution role',
      'Event injection from untrusted triggers',
      'Denial-of-wallet (attacker drives up invocations)',
    ],
    controls: [
      'One least-privilege role per function',
      'Validate event payloads',
      'Concurrency limits and API rate limits',
      'Billing alerts',
    ],
  },
});
