import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'network.cdn',
  name: 'CDN',
  category: 'network',
  tags: ['cdn', 'edge', 'cache', 'static', 'managed', 'global'],
  icon: 'cloud-lightning',
  providerNames: { aws: 'CloudFront', gcp: 'Cloud CDN', azure: 'Azure Front Door' },
  ports: [
    { id: 'in', direction: 'in', protocols: ['http1', 'http2', 'http3'] },
    { id: 'origin', direction: 'out', protocols: ['http1', 'http2'] },
  ],
  configSchema: z.object({
    ttlSec: z
      .number()
      .int()
      .min(0)
      .max(31_536_000)
      .describe('Default time an object stays cached at the edge'),
    cacheDynamic: z.boolean().describe('Also cache API responses (needs correct Cache-Control)'),
    originShield: z
      .boolean()
      .describe('Extra cache tier in front of the origin so edges share misses')
      .meta({ advanced: true }),
    edgeCacheGb: z
      .number()
      .min(1)
      .max(10_000)
      .describe('Cache size per edge location')
      .meta({ advanced: true }),
    compression: z.boolean().describe('gzip / brotli at the edge').meta({ advanced: true }),
  }),
  defaults: {
    ttlSec: 86_400,
    cacheDynamic: false,
    originShield: false,
    edgeCacheGb: 100,
    compression: true,
  },
  instanceTypes: [{ id: 'managed', vCpu: 1, memGb: 1, netGbps: 100, costUsdPerHour: 0 }],
  perf: {
    serviceTimeMs: { read: 2, write: 5 },
    maxConcurrencyPerInstance: 50_000,
    scaleCurve: 'linear',
    saturationBehavior: 'degrade',
  },
  behaviors: ['cdn', 'cache'],
  docs: {
    summary:
      'A worldwide network of caches close to users. Serves images, video, scripts and cacheable API responses from the nearest edge instead of your origin.',
    howItWorks:
      'DNS or anycast sends each user to a nearby edge location. On a hit, the edge answers in a few milliseconds; on a miss it fetches from the origin (optionally via a shield tier), stores the object for its TTL and returns it. Hit ratio depends on how popular objects are, cache size and TTL. Pricing is mostly per GB delivered.',
    tradeoffs: [
      'Huge latency and origin-load win for static and public content; little help for personalised responses.',
      'Long TTLs mean stale content — plan cache invalidation or versioned URLs.',
      'Cold objects (long tail) still go to the origin, so the origin must handle the miss traffic.',
    ],
    interviewTips: [
      'Put media and static assets behind a CDN early — it usually removes most of the bandwidth from your servers.',
      'Use versioned file names (app.3f9a.js) so you never need to purge.',
      'Mention TLS termination at the edge, which also cuts handshake RTT for distant users.',
    ],
  },
  security: {
    defaultPorts: [80, 443],
    threats: [
      'DDoS against the origin',
      'Cache poisoning via unkeyed headers',
      'Caching private responses for everyone',
    ],
    controls: [
      'Only allow origin traffic from the CDN',
      'WAF and DDoS protection at the edge',
      'Cache-Control: private / no-store for personal data',
      'Signed URLs for paid or private media',
    ],
  },
});
