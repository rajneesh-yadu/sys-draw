import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'security.waf',
  name: 'Web Application Firewall',
  category: 'security',
  // Rate-based rules are part of the WAF control (one 90 % factor, see engine/chaos/attacks.ts).
  tags: ['waf', 'firewall', 'l7', 'bot-control', 'rate-based-rules', 'managed', 'control:waf'],
  icon: 'shield-check',
  providerNames: { aws: 'AWS WAF', gcp: 'Cloud Armor', azure: 'Azure Web Application Firewall' },
  ports: [
    {
      id: 'in',
      direction: 'in',
      protocols: ['http1', 'http2', 'http3', 'grpc', 'websocket', 'tls13', 'tcp'],
    },
    { id: 'origin', direction: 'out', protocols: ['http1', 'http2', 'grpc', 'websocket', 'tcp'] },
  ],
  configSchema: z.object({
    mode: z
      .enum(['block', 'count'])
      .describe('Block matching requests, or only count them (rules being tuned: blocks nothing)'),
    managedRules: z
      .boolean()
      .describe('OWASP Top 10 managed rule set (SQL injection, XSS, known bad inputs)'),
    botControl: z
      .boolean()
      .describe(
        'Detect automated clients (credential stuffing, scraping) by fingerprint and behaviour',
      ),
    rateLimitPer5Min: z
      .number()
      .int()
      .min(0)
      .max(2_000_000_000)
      .describe('Rate-based rule: requests per client IP per 5 minutes (0 = off)'),
  }),
  defaults: { mode: 'block', managedRules: true, botControl: true, rateLimitPer5Min: 2000 },
  // ~$5 per web ACL + $1 per rule per month; request fees not modelled.
  instanceTypes: [{ id: 'managed', vCpu: 2, memGb: 4, netGbps: 10, costUsdPerHour: 0.014 }],
  perf: {
    serviceTimeMs: { read: 1, write: 1 },
    maxConcurrencyPerInstance: 100_000,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['loadBalancer'],
  docs: {
    summary:
      'Inspects every HTTP request at the edge and blocks attacks (SQL injection, XSS, bots, floods from one IP) before they reach your load balancer or API.',
    howItWorks:
      'The WAF sits in front of a CDN, load balancer or API gateway. Each request is matched against an ordered rule list: managed rule groups (OWASP signatures), IP reputation lists, geo rules, bot fingerprints and rate-based rules (requests per IP per 5 minutes). The first matching rule allows, blocks (HTTP 403) or only counts the request. Counting is how new rules are tuned without breaking real users.',
    tradeoffs: [
      'Stops whole classes of attacks without code changes, but false positives block real users until rules are tuned.',
      'Adds about a millisecond per request; inspection is limited to the first few KB of the body.',
      'Rate-based rules work per IP: botnets spread across thousands of IPs need bot control as well.',
    ],
    interviewTips: [
      'Put the WAF in front of every public HTTP entry point (with the CDN) and mention managed OWASP rules plus rate-based rules.',
      'A WAF is not a substitute for input validation and authorisation in the service.',
      'Start new rules in count mode, watch the logs, then switch to block.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: ['Rules left in count mode', 'Origin reachable directly, bypassing the WAF'],
    controls: [
      'Lock the origin so it only accepts traffic from the WAF/CDN',
      'Alert on blocked-request spikes',
    ],
  },
});
