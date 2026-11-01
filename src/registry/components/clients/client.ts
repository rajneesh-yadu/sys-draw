import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'client.app',
  name: 'Client (web / mobile)',
  category: 'clients',
  tags: ['client', 'browser', 'mobile', 'edge-of-system'],
  icon: 'smartphone',
  ports: [
    {
      id: 'out',
      direction: 'out',
      protocols: ['http1', 'http2', 'http3', 'websocket', 'grpc', 'dns'],
    },
  ],
  configSchema: z.object({
    platform: z.enum(['web', 'mobile']).describe('Browser app or native mobile app'),
    connectionsPerHost: z
      .number()
      .int()
      .min(1)
      .max(32)
      .describe('Parallel connections per origin (browsers use about 6 for HTTP/1.1)')
      .meta({ advanced: true }),
    keepAlive: z.boolean().describe('Reuse connections between requests').meta({ advanced: true }),
    localCache: z
      .boolean()
      .describe('HTTP cache / on-device cache for static assets')
      .meta({ advanced: true }),
  }),
  defaults: { platform: 'web', connectionsPerHost: 6, keepAlive: true, localCache: true },
  instanceTypes: [
    { id: 'browser', vCpu: 4, memGb: 8, netGbps: 0.1, costUsdPerHour: 0 },
    { id: 'mobile-device', vCpu: 6, memGb: 6, netGbps: 0.05, costUsdPerHour: 0 },
  ],
  perf: {
    serviceTimeMs: { read: 1, write: 1 },
    maxConcurrencyPerInstance: 6,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  docs: {
    summary:
      'The user: a browser or mobile app that sends requests into your system. Traffic volume comes from the scenario (users per region), not from replicas.',
    howItWorks:
      'Each request starts with a DNS lookup, then opens (or reuses) a TCP + TLS connection and sends HTTP, gRPC or WebSocket messages. The client sits in a user region, so its distance to your servers sets the floor for latency. Mobile networks add more latency and packet loss than broadband.',
    tradeoffs: [
      'Fat clients (logic and caching on the device) cut server load but are harder to update — mobile releases take days to roll out.',
      'Keeping connections alive saves handshakes but holds server resources.',
      'Mobile clients go offline; design for retries, idempotency keys and sync on reconnect.',
    ],
    interviewTips: [
      'Start every design from the client: who are the users, where are they, and what do they do most?',
      'Mention client-side caching and CDN for static assets before scaling servers.',
      'Name the protocol per interaction: HTTP for request/response, WebSocket or SSE for live updates, push notifications for mobile.',
    ],
  },
  security: {
    defaultPorts: [],
    threats: [
      'Untrusted input: anything from the client can be forged',
      'Token theft from local storage (XSS) or a compromised device',
      'Reverse-engineered mobile apps exposing API keys',
    ],
    controls: [
      'Validate everything server-side',
      'Short-lived tokens with refresh (OAuth2 / OIDC)',
      'HttpOnly, Secure cookies; Content-Security-Policy',
      'Certificate pinning for high-risk mobile apps',
    ],
  },
});
