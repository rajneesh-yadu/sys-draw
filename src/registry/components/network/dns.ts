import { z } from 'zod';
import { defineComponent } from '../../define';
import { managedHourly, scalingHelp } from '../../scaling-help';

export default defineComponent({
  id: 'network.dns',
  name: 'DNS',
  category: 'network',
  tags: ['dns', 'routing', 'managed', 'global'],
  icon: 'globe',
  providerNames: { aws: 'Route 53', gcp: 'Cloud DNS', azure: 'Azure DNS' },
  ports: [{ id: 'in', direction: 'in', protocols: ['dns', 'udp', 'tcp'] }],
  configSchema: z
    .object({
      ttlSec: z.number().int().min(0).max(86_400).describe('How long resolvers cache answers'),
      routingPolicy: z
        .enum(['simple', 'latency', 'geo', 'weighted', 'failover'])
        .describe('How the answer is chosen when several endpoints exist'),
      healthChecks: z
        .boolean()
        .describe('Stop returning unhealthy endpoints')
        .meta({ advanced: true }),
      anycast: z.boolean().describe('Serve from many locations on one IP').meta({ advanced: true }),
    })
    .meta(scalingHelp(managedHourly('managed DNS service'))),
  defaults: { ttlSec: 60, routingPolicy: 'latency', healthChecks: true, anycast: true },
  instanceTypes: [{ id: 'managed', vCpu: 1, memGb: 1, netGbps: 10, costUsdPerHour: 0.0007 }],
  perf: {
    serviceTimeMs: { read: 1, write: 60_000 }, // record updates propagate in ~a minute
    maxConcurrencyPerInstance: 100_000,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['dns'],
  docs: {
    summary:
      'Turns a hostname into an IP address. The first step of every new connection, and the cheapest global traffic router you have.',
    howItWorks:
      'The client asks a recursive resolver (ISP or 8.8.8.8), which walks root → TLD → your authoritative servers and caches the answer for the TTL. Managed DNS can answer differently per user: nearest region (latency), country (geo), percentages (weighted) or primary-unless-down (failover). Cached lookups cost ~0 ms; a cold lookup costs tens of milliseconds.',
    tradeoffs: [
      'Low TTL = fast failover but more lookups; high TTL = fewer lookups but clients keep hitting a dead region until the TTL expires.',
      'DNS routing is coarse: it routes by resolver location, not the user, and cannot see server load.',
      'Some clients and resolvers ignore TTLs, so failover is never instant.',
    ],
    interviewTips: [
      'Use latency- or geo-based DNS to send users to the nearest region in a multi-region design.',
      'Say what TTL you would pick and how it affects failover time.',
      'DNS is not a load balancer — pair it with an LB inside each region.',
    ],
  },
  security: {
    defaultPorts: [53],
    threats: [
      'DNS spoofing / cache poisoning',
      'Domain hijacking through a compromised registrar account',
      'DDoS against authoritative servers',
      'Dangling records pointing at released resources (subdomain takeover)',
    ],
    controls: [
      'DNSSEC',
      'Registrar lock and MFA',
      'Anycast DNS with DDoS protection',
      'Audit and remove stale records',
    ],
  },
});
