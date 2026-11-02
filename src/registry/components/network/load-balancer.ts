import { z } from 'zod';
import { defineComponent } from '../../define';
import { managedHourly, scalingHelp } from '../../scaling-help';

export default defineComponent({
  id: 'network.load-balancer',
  name: 'Load Balancer',
  category: 'network',
  tags: ['load-balancer', 'routing', 'high-availability', 'managed'],
  icon: 'split',
  providerNames: {
    aws: 'Elastic Load Balancing (ALB)',
    gcp: 'Cloud Load Balancing',
    azure: 'Azure Load Balancer',
  },
  ports: [
    {
      id: 'in',
      direction: 'in',
      protocols: ['http1', 'http2', 'grpc', 'websocket', 'tls13', 'tcp'],
    },
    { id: 'targets', direction: 'out', protocols: ['http1', 'http2', 'grpc', 'websocket', 'tcp'] },
  ],
  configSchema: z
    .object({
      layer: z
        .enum(['L4', 'L7'])
        .describe('L4 forwards TCP connections; L7 understands HTTP and can route by path'),
      algorithm: z
        .enum(['round-robin', 'least-connections', 'consistent-hash', 'random'])
        .describe('How a target is picked for each request'),
      tlsTermination: z.boolean().describe('Decrypt TLS at the LB'),
      healthCheckIntervalSec: z
        .number()
        .int()
        .min(1)
        .max(300)
        .describe('Time between health probes')
        .meta({ advanced: true }),
      unhealthyThreshold: z
        .number()
        .int()
        .min(1)
        .max(10)
        .describe('Failed probes before a target is removed')
        .meta({ advanced: true }),
      idleTimeoutSec: z
        .number()
        .int()
        .min(1)
        .max(4000)
        .describe('Close idle connections after')
        .meta({ advanced: true }),
      crossZone: z
        .boolean()
        .describe('Spread traffic evenly across zones')
        .meta({ advanced: true }),
      stickySessions: z.boolean().describe('Pin a client to one target').meta({ advanced: true }),
      virtualNodes: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(100)
        .describe('Consistent hashing: ring points per target (more = more even spread)')
        .meta({ advanced: true }),
    })
    .meta(
      scalingHelp(
        managedHourly(
          'managed load balancer',
          'These are not the targets it balances across; give those their own replicas.',
        ),
      ),
    ),
  defaults: {
    layer: 'L7',
    algorithm: 'round-robin',
    tlsTermination: true,
    healthCheckIntervalSec: 10,
    unhealthyThreshold: 3,
    idleTimeoutSec: 60,
    crossZone: true,
    stickySessions: false,
    virtualNodes: 100,
  },
  instanceTypes: [{ id: 'standard', vCpu: 2, memGb: 4, netGbps: 25, costUsdPerHour: 0.0225 }],
  perf: {
    serviceTimeMs: { read: 0.5, write: 0.5 },
    maxConcurrencyPerInstance: 50_000,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['loadBalancer'],
  docs: {
    summary:
      'Spreads incoming requests over several servers and stops sending to the ones that fail health checks. The component that makes horizontal scaling and high availability work.',
    howItWorks:
      'Clients connect to one address. An L4 balancer forwards whole TCP connections; an L7 balancer terminates HTTP, so it can route by path or header and balance each request. Health checks probe every target and remove failing ones. Managed LBs scale themselves and span availability zones.',
    tradeoffs: [
      'L7 gives smarter routing and TLS offload at the cost of a little latency and CPU; L4 is faster but blind to requests.',
      'Round-robin is simple but ignores slow servers; least-connections adapts; consistent hashing keeps a key on one server (good for caches) but can create hot spots.',
      'Sticky sessions hide stateful servers but break even load and failover — prefer stateless servers.',
    ],
    interviewTips: [
      'Place an LB in front of any tier with more than one instance and say which algorithm and why.',
      'Mention health checks and how quickly a dead instance is removed (interval × threshold).',
      'The LB is not a SPOF when it is a managed, multi-zone service; a single self-hosted LB is.',
    ],
  },
  security: {
    defaultPorts: [80, 443],
    threats: [
      'Plaintext traffic behind the LB',
      'Exposed admin/target ports',
      'Slowloris-style connection exhaustion',
    ],
    controls: [
      'Redirect HTTP to HTTPS; re-encrypt to targets when required',
      'Security groups allowing targets to accept traffic only from the LB',
      'Connection and header timeouts',
      'Attach a WAF for public L7 balancers',
    ],
  },
});
