import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'security.ddos-shield',
  name: 'DDoS Protection',
  category: 'security',
  tags: ['ddos', 'anycast', 'scrubbing', 'managed', 'control:ddos-protection'],
  icon: 'shield-half',
  providerNames: {
    aws: 'AWS Shield Advanced',
    gcp: 'Cloud Armor Enterprise',
    azure: 'Azure DDoS Protection',
  },
  ports: [
    {
      id: 'in',
      direction: 'in',
      protocols: ['http1', 'http2', 'http3', 'grpc', 'websocket', 'tls13', 'quic', 'tcp', 'udp'],
    },
    {
      id: 'origin',
      direction: 'out',
      protocols: ['http1', 'http2', 'http3', 'grpc', 'websocket', 'tls13', 'quic', 'tcp', 'udp'],
    },
  ],
  configSchema: z.object({
    tier: z
      .enum(['standard', 'advanced'])
      .describe(
        'Standard: free network-layer (L3/L4) protection. Advanced: L7 detection, response team, cost protection',
      ),
    alwaysOnDetection: z
      .boolean()
      .describe('Baseline traffic continuously so floods are detected in seconds')
      .meta({ advanced: true }),
  }),
  defaults: { tier: 'advanced', alwaysOnDetection: true },
  // Shield Advanced: $3,000/month subscription per organisation (Standard is free).
  instanceTypes: [{ id: 'managed', vCpu: 2, memGb: 4, netGbps: 100, costUsdPerHour: 4.11 }],
  perf: {
    serviceTimeMs: { read: 0.05, write: 0.05 },
    maxConcurrencyPerInstance: 1_000_000,
    scaleCurve: 'linear',
    saturationBehavior: 'degrade',
  },
  behaviors: ['loadBalancer'],
  docs: {
    summary:
      'Absorbs volumetric floods (SYN/UDP floods, reflection, HTTP floods) on the provider’s global edge so only clean traffic reaches your entry points.',
    howItWorks:
      'Your public IPs are announced from many points of presence (anycast), so a flood is spread across the provider’s network instead of your one region. Traffic is baselined; when it deviates, scrubbing centres drop packets that match attack signatures (spoofed sources, malformed packets, reflection protocols) and, at the advanced tier, rate-limit or challenge L7 floods. Clean traffic is forwarded to the origin.',
    tradeoffs: [
      'Network-layer protection is free and on by default on major clouds; the advanced tier is expensive (about $3,000/month on AWS).',
      'Does not stop low-and-slow application attacks by itself: pair it with a WAF and rate limits.',
      'Only protects what is behind it: an origin with its own public IP is still exposed.',
    ],
    interviewTips: [
      'Layer it: anycast CDN + DDoS protection + WAF + rate limits + autoscaling with a cap.',
      'Mention cost protection: autoscaling during an attack can be a bill problem, not just an availability one.',
      'Hide the origin: only accept traffic from the CDN/shield ranges.',
    ],
  },
  security: {
    defaultPorts: [80, 443],
    threats: ['Origin IP leaked and attacked directly'],
    controls: ['Origin accepts only edge ranges', 'Attack runbooks and alarms'],
  },
});
