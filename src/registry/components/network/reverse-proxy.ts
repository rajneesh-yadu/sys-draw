import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'network.reverse-proxy',
  name: 'Reverse Proxy (Nginx / Envoy)',
  category: 'network',
  tags: ['reverse-proxy', 'nginx', 'envoy', 'load-balancer', 'l7', 'tls', 'routing', 'self-hosted'],
  icon: 'arrow-left-right',
  ports: [
    {
      id: 'in',
      direction: 'in',
      protocols: ['http1', 'http2', 'http3', 'grpc', 'websocket', 'tls13', 'tcp'],
    },
    {
      id: 'upstreams',
      direction: 'out',
      protocols: ['http1', 'http2', 'grpc', 'websocket', 'tcp'],
    },
  ],
  configSchema: z.object({
    engine: z
      .enum(['nginx', 'envoy'])
      .describe('Nginx (config files) or Envoy (dynamic xDS config, rich telemetry)'),
    algorithm: z
      .enum(['round-robin', 'least-connections', 'consistent-hash', 'random'])
      .describe('How an upstream is picked (Envoy calls least-connections "least request")'),
    tlsTermination: z
      .boolean()
      .describe(
        'Decrypt TLS here (handshakes cost CPU; upstream traffic is plaintext unless re-encrypted)',
      )
      .meta({
        perfEffect: {
          true: {
            read: 1.6,
            write: 1.6,
            why: 'TLS record encryption plus amortised handshakes (session resumption helps)',
          },
        },
      }),
    upstreamKeepalive: z
      .boolean()
      .describe('Reuse connections to upstreams instead of a new TCP handshake per request')
      .meta({
        perfEffect: {
          false: {
            read: 1.3,
            write: 1.3,
            readAddMs: 0.5,
            writeAddMs: 0.5,
            why: 'a new upstream TCP connection per request (handshake RTT, ephemeral ports)',
          },
        },
      }),
    responseCaching: z
      .boolean()
      .describe(
        'Cache upstream responses (proxy_cache): not modelled as hits here — add a cache/CDN node for that',
      )
      .meta({ advanced: true }),
    rateLimitRps: z
      .number()
      .min(0)
      .max(1e7)
      .describe('Per-client request limit (0 = off)')
      .meta({ advanced: true }),
    healthCheckIntervalSec: z
      .number()
      .int()
      .min(1)
      .max(300)
      .describe('Time between active health checks')
      .meta({ advanced: true }),
    unhealthyThreshold: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Failed checks before an upstream is ejected')
      .meta({ advanced: true }),
    virtualNodes: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .describe('Consistent hashing: ring points per upstream (Envoy ring_hash / Maglev)')
      .meta({ advanced: true }),
  }),
  defaults: {
    engine: 'nginx',
    algorithm: 'least-connections',
    tlsTermination: true,
    upstreamKeepalive: true,
    responseCaching: false,
    rateLimitRps: 0,
    healthCheckIntervalSec: 5,
    unhealthyThreshold: 3,
    virtualNodes: 100,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    serviceTimeMs: { read: 0.1, write: 0.1 },
    // event-driven: one worker per core handles thousands of connections
    maxConcurrencyPerInstance: 64,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['loadBalancer', 'configPerf'],
  docs: {
    summary:
      'A self-run L7 proxy in front of services: terminates TLS, routes by host/path, load-balances upstreams, retries, rate-limits and adds observability.',
    howItWorks:
      'Nginx and Envoy run a few event-loop workers (one per core) that each multiplex thousands of connections. A request is matched against routes (host, path, headers), sent to one healthy upstream by the balancing algorithm over pooled keep-alive connections, and the response streamed back. Envoy is configured dynamically over xDS APIs, which is why it is the data plane of most service meshes; Nginx is configured with files and reloads. TLS termination costs CPU per request; reusing upstream connections avoids a handshake per request.',
    tradeoffs: [
      'Full control, very cheap per request and runs anywhere — but you operate it (HA pair, config rollout, certificates).',
      'Terminating TLS at the edge simplifies services but leaves internal hops plaintext unless you re-encrypt or use mTLS.',
      'Consistent hashing keeps caches warm per upstream at the cost of uneven load.',
    ],
    interviewTips: [
      'Put it at the edge of a cluster for TLS, routing, rate limiting and request IDs; keep two instances behind DNS/an L4 LB.',
      'Mention least-request balancing, outlier ejection and retries with budgets (not retry storms).',
      'Contrast with a managed LB/API gateway: cost and control vs operations.',
    ],
  },
  security: {
    defaultPorts: [80, 443, 8080, 9901],
    threats: [
      'Weak TLS configuration (old protocols, weak ciphers)',
      'Request smuggling via inconsistent HTTP parsing with upstreams',
      'Admin interface (Envoy :9901, nginx status) exposed',
    ],
    controls: [
      'TLS 1.2+/1.3 only, HSTS, OCSP stapling',
      'Normalise and reject ambiguous requests; keep the proxy updated',
      'Bind admin endpoints to localhost; WAF rules and rate limits at the edge',
    ],
  },
});
