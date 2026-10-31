import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'compute.app-server',
  name: 'App Server',
  category: 'compute',
  tags: ['compute', 'vm', 'container', 'stateless', 'service'],
  icon: 'server',
  providerNames: { aws: 'EC2', gcp: 'Compute Engine', azure: 'Virtual Machines' },
  ports: [
    { id: 'in', direction: 'in', protocols: ['http1', 'http2', 'grpc', 'websocket'] },
    {
      id: 'out',
      direction: 'out',
      protocols: ['http1', 'http2', 'grpc', 'tcp', 'postgres-wire', 'resp'],
    },
  ],
  configSchema: z.object({
    runtime: z
      .enum(['node', 'java', 'go', 'python', 'dotnet'])
      .describe('Language runtime (affects CPU cost per request)'),
    stateless: z
      .boolean()
      .describe('No session state on the instance, so any instance can serve any request'),
    workerThreads: z
      .number()
      .int()
      .min(1)
      .max(4096)
      .describe('Requests handled concurrently per instance')
      .meta({ advanced: true }),
    requestTimeoutMs: z
      .number()
      .int()
      .min(10)
      .max(300_000)
      .describe('Give up on a request after')
      .meta({ advanced: true }),
    dbPoolSize: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .describe('Database connections held per instance')
      .meta({ advanced: true }),
    gcPauseMs: z
      .number()
      .min(0)
      .max(5000)
      .describe('Typical stop-the-world pause (adds to tail latency)')
      .meta({ advanced: true }),
  }),
  defaults: {
    runtime: 'node',
    stateless: true,
    workerThreads: 200,
    requestTimeoutMs: 10_000,
    dbPoolSize: 20,
    gcPauseMs: 0,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    serviceTimeMs: { read: 20, write: 40 },
    maxConcurrencyPerInstance: 200,
    scaleCurve: 'sublinear',
    saturationBehavior: 'queue',
  },
  docs: {
    summary:
      'A server (VM or container) running your application code: it receives API requests, applies business logic and calls caches, databases and other services.',
    howItWorks:
      'Each instance serves requests concurrently up to its worker/thread limit; extra requests wait in a queue, which is where latency explodes as utilisation nears 100%. Bigger instances raise per-instance throughput (with diminishing returns); more replicas behind a load balancer raise it linearly, as long as servers are stateless. Cost is instances × hourly price.',
    tradeoffs: [
      'Scale out (more replicas) for capacity and availability; scale up (bigger instances) is simpler but has a ceiling and a single failure domain.',
      'Stateless servers scale and fail over freely; storing sessions in memory forces sticky sessions.',
      'Always-on VMs cost money at night; autoscaling or serverless trade that for warm-up delays.',
    ],
    interviewTips: [
      'Keep the app tier stateless — push state to a cache or database — then say "scale horizontally behind the LB".',
      'Estimate instances: peak RPS ÷ RPS per instance at ~60–70% target utilisation.',
      "Mention connection pools: 50 instances × 20 connections can exceed the database's max_connections.",
    ],
  },
  security: {
    defaultPorts: [8080],
    threats: [
      'Injection (SQL, command)',
      'Secrets in config or environment dumps',
      'Over-permissive IAM role',
      'Unpatched OS and dependencies',
    ],
    controls: [
      'Private subnet, reachable only from the LB',
      'Secrets manager',
      'Least-privilege IAM role',
      'Parameterised queries',
      'Automated patching / immutable images',
    ],
  },
});
