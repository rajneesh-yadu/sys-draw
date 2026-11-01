import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'network.api-gateway',
  name: 'API Gateway',
  category: 'network',
  tags: [
    'api-gateway',
    'auth',
    'rate-limiting',
    'routing',
    'managed',
    'control:rate-limit',
    'control:auth',
  ],
  icon: 'door-open',
  providerNames: { aws: 'API Gateway', gcp: 'API Gateway', azure: 'API Management' },
  ports: [
    { id: 'in', direction: 'in', protocols: ['http1', 'http2', 'websocket'] },
    { id: 'backends', direction: 'out', protocols: ['http1', 'http2', 'grpc'] },
  ],
  configSchema: z.object({
    authMode: z
      .enum(['none', 'api-key', 'jwt', 'oauth2'])
      .describe('How callers are authenticated'),
    rateLimitRps: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .describe('Sustained requests per second allowed per client'),
    burst: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .describe('Extra requests allowed in a short burst'),
    requestValidation: z
      .boolean()
      .describe('Reject malformed requests before they reach services')
      .meta({ advanced: true }),
    responseCaching: z
      .boolean()
      .describe('Cache GET responses at the gateway')
      .meta({ advanced: true }),
    timeoutMs: z
      .number()
      .int()
      .min(50)
      .max(29_000)
      .describe('Backend timeout')
      .meta({ advanced: true }),
  }),
  defaults: {
    authMode: 'jwt',
    rateLimitRps: 100,
    burst: 200,
    requestValidation: true,
    responseCaching: false,
    timeoutMs: 29_000,
  },
  instanceTypes: [{ id: 'managed', vCpu: 2, memGb: 4, netGbps: 10, costUsdPerHour: 0 }],
  perf: {
    serviceTimeMs: { read: 5, write: 5 },
    maxConcurrencyPerInstance: 10_000,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['rateLimiter'],
  docs: {
    summary:
      'Single front door for your APIs: authenticates callers, enforces rate limits, validates requests and routes each path to the right backend service.',
    howItWorks:
      'Every request passes a pipeline: TLS termination → authentication (API key, JWT or OAuth2 token check) → rate-limit check (token bucket per client) → validation → routing to a service by path and method, optionally with response caching. Requests over the limit get HTTP 429. Managed gateways bill per million requests.',
    tradeoffs: [
      'Centralises cross-cutting concerns so services stay simple, but adds a few milliseconds and a hop to every call.',
      'Per-request pricing gets expensive at very high volume; an LB plus a service mesh can be cheaper.',
      'Too much logic in the gateway turns it into a hard-to-change monolith.',
    ],
    interviewTips: [
      'Use it for public APIs and microservices: auth, rate limiting, versioning in one place.',
      'Explain the rate-limit algorithm (token bucket vs sliding window) and where its counters live.',
      'Gateway vs load balancer: the gateway understands API semantics; the LB just spreads load.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: [
      'Credential stuffing and brute force',
      'Abuse / scraping without rate limits',
      'Broken object-level authorization behind the gateway',
    ],
    controls: [
      'Rate limiting and quotas per key',
      'JWT/OAuth2 validation',
      'WAF rules',
      'Request schema validation',
      'Services still authorise every object',
    ],
  },
});
