/**
 * Anti-pattern sample board (S23): a clinic patient portal (appointments, visit notes, lab
 * results, scanned documents) built the way it should NOT be. It is a teaching fixture only: the
 * flaws live in this board's data, never in the app. Companion notes (every intended issue, the
 * rule that reports it, severity, impact and fix): ./NOTES.md.
 *
 * Shipped through the existing sample mechanism (a problem entry tagged `sample`, see S22):
 * - `debugVariants[0]` is the intentionally broken board. Problems → Tag "anti-pattern" → Debug →
 *   "Broken design" opens it; Debug mode lists symptoms and says when it is fixed.
 * - `referenceSolutions[0]` is the corrected board: same node and edge ids (so Debug mode can
 *   diff them), plus the bastion, cache and secrets manager the fixes add.
 * - The scenario's flow paths follow the broken board, so both boards simulate the same traffic.
 *   Components only the corrected board has sit next to those paths; see NOTES.md → Limits.
 *
 * Both boards come from one `portal(variant)` builder so every difference is visible in one place.
 * Layout, left to right: users → public subnet / DMZ → private app subnet → data subnet.
 */
import type { FirewallRule, Graph } from '@/core';
import { defineProblem } from '../../define';
import { design, groupId, scenario, STACK, TB } from '../kit';

type Variant = 'broken' | 'fixed';

/** Plain HTTP and Postgres without TLS (the broken board only). */
const PLAIN_HTTP = ['tcp', 'http1'] as const;
const PLAIN_PG = ['tcp', 'postgres-wire'] as const;

const allow = (
  port: number,
  peer: string,
  description: string,
  toPort: number = port,
): FirewallRule => ({
  direction: 'ingress',
  action: 'allow',
  protocol: 'tcp',
  fromPort: port,
  toPort,
  peer,
  description,
});

/** Security-group rules per subnet key (the kit leaves them empty). */
const FIREWALL: Record<Variant, Record<string, FirewallRule[]>> = {
  broken: {
    edge: [
      allow(80, 'internet', 'Portal over plain HTTP'),
      allow(443, 'internet', 'Admin console'),
      allow(22, '0.0.0.0/0', 'SSH to the admin VM from anywhere ("temporary")'),
    ],
    data: [
      allow(5432, '0.0.0.0/0', 'Postgres open to the world for the reporting laptop'),
      allow(443, '0.0.0.0/0', 'Document bucket from anywhere'),
    ],
  },
  fixed: {
    edge: [allow(443, 'internet', 'HTTPS only (portal, admin SSO, VPN)')],
    data: [
      allow(5432, groupId('app'), 'Postgres from the app tier'),
      allow(5432, groupId('edge'), 'Postgres from the bastion (audited sessions)'),
      allow(443, groupId('app'), 'Document bucket from the app tier'),
      allow(6379, groupId('app'), 'Redis from the app tier', 6380),
    ],
  },
};

function portal(v: Variant): Graph {
  const broken = v === 'broken';
  const d = design()
    // ---- groups: one region, one VPC, three subnets (the zones are what differ)
    .group('use1', 'region', 'US East', { regionId: 'us-east' })
    .group('vpc', 'vpc', 'Clinic VPC', { parent: 'use1' })
    .group('edge', 'subnet', broken ? 'Public subnet (LB + admin VM)' : 'DMZ (edge services)', {
      parent: 'vpc',
      zone: broken ? 'public' : 'dmz',
    })
    .group('app', 'subnet', 'Private subnet (app tier)', { parent: 'vpc', zone: 'private' })
    .group(
      'data',
      'subnet',
      broken ? 'Data subnet (public route, 5432 open)' : 'Data subnet (private)',
      { parent: 'vpc', zone: broken ? 'public' : 'data' },
    )

    // ---- users
    .node('patients', 'client.app', 'Patients (web & mobile)', [0, 2], { type: 'browser' })
    .node('staff', 'client.app', 'Clinic staff (admin console)', [0, 5], { type: 'browser' })

    // ---- edge
    .node(
      'lb',
      'network.load-balancer',
      broken ? 'Load balancer (HTTP :80)' : 'Load balancer (TLS)',
      [1, 2],
      {
        type: 'standard',
        group: 'edge',
        config: { tlsTermination: !broken },
      },
    )
    .node(
      'admin',
      'compute.app-server',
      broken ? 'Admin console VM (public IP, SSH open)' : 'Admin console (SSO + MFA via gateway)',
      broken ? [1, 5] : [3, 5],
      broken
        ? { type: 'small', group: 'edge', config: { stateless: true } }
        : {
            type: 'small',
            replicas: 2,
            group: 'app',
            config: { stateless: true },
            autoscale: { min: 2, max: 4, targetUtil: 0.6, warmupSec: 60 },
          },
    )

    .node(
      'gw',
      'network.api-gateway',
      broken ? 'API gateway (auth off, limit never hit)' : 'API gateway (JWT, rate limits)',
      [2, 2],
      {
        type: 'managed',
        group: 'edge',
        config: broken
          ? {
              authMode: 'none',
              rateLimitRps: 1_000_000,
              burst: 1_000_000,
              requestValidation: false,
            }
          : { authMode: 'jwt', rateLimitRps: 20_000, burst: 40_000, timeoutMs: 10_000 },
      },
    )

    // ---- app tier
    .node(
      'portal',
      'compute.app-server',
      broken ? 'Patient portal monolith (1 VM, in-memory sessions)' : 'Patient portal (stateless)',
      [3, 2],
      broken
        ? { type: 'small', group: 'app', config: { stateless: false } }
        : {
            type: 'medium',
            replicas: 4,
            group: 'app',
            config: { stateless: true },
            autoscale: { min: 3, max: 8, targetUtil: 0.6, warmupSec: 90 },
          },
    )
    .node(
      'labs',
      'compute.kubernetes',
      broken ? 'Lab results service (fixed 3 pods)' : 'Lab results service (autoscaled)',
      [4, 3],
      broken
        ? { type: 'medium', replicas: 3, group: 'app' }
        : {
            type: 'medium',
            replicas: 3,
            group: 'app',
            autoscale: { min: 2, max: 6, targetUtil: 0.6, warmupSec: 60 },
          },
    )

    // ---- data tier
    .node(
      'records',
      'database.postgres',
      broken ? 'Patient records (single Postgres, no standby)' : 'Patient records (Postgres HA)',
      [6, 2],
      broken
        ? {
            type: 'large',
            group: 'data',
            config: {
              highAvailability: false,
              readReplicas: 0,
              tableRows: 50_000_000,
              storageGb: 2_000,
            },
          }
        : {
            type: 'large',
            group: 'data',
            config: {
              highAvailability: true,
              replication: 'sync',
              readReplicas: 2,
              tableRows: 50_000_000,
              storageGb: 2_000,
            },
          },
    )
    .node(
      'files',
      'storage.object',
      broken ? 'Scanned documents (public bucket)' : 'Scanned documents (private, encrypted)',
      [6, 4],
      {
        type: 'managed',
        group: 'data',
        config: { storageGb: 20_000, publicAccess: broken, versioning: !broken },
      },
    );

  if (broken) {
    d.edge('patients', 'lb', PLAIN_HTTP)
      .edge('lb', 'gw', PLAIN_HTTP)
      .edge('gw', 'portal', PLAIN_HTTP)
      .edge('staff', 'admin', STACK.https)
      .edge('portal', 'records', PLAIN_PG)
      // Retry storm: 10 immediate retries, no timeout, no breaker, no service identity.
      .edge('portal', 'labs', PLAIN_HTTP, { config: { retries: 10, backoff: 'none' } })
      .edge('labs', 'records', PLAIN_PG)
      .edge('portal', 'files', STACK.internal)
      .edge('admin', 'records', PLAIN_PG);
  } else {
    d.node('bastion', 'security.bastion', 'Ops access (VPN + bastion, MFA)', [1, 6], {
      type: 'small',
      group: 'edge',
    })
      .node('cache', 'cache.redis', 'Appointment & slot cache (Redis)', [5, 1], {
        type: 'mem-medium',
        group: 'data',
        config: { keyCount: 5_000_000, avgItemBytes: 2_000, ttlSec: 120, replicasPerShard: 1 },
      })
      .node('secrets', 'security.secrets-manager', 'Secrets manager (DB credentials)', [4, 5], {
        type: 'managed',
        group: 'app',
      })
      .edge('patients', 'lb', STACK.https)
      .edge('lb', 'gw', STACK.internal)
      .edge('gw', 'portal', STACK.svc, { config: { timeoutMs: 5_000 } })
      .edge('staff', 'gw', STACK.https)
      .edge('gw', 'admin', STACK.svc, { config: { timeoutMs: 5_000 } })
      .edge('staff', 'bastion', STACK.https)
      .edge('bastion', 'records', STACK.postgres)
      .edge('portal', 'records', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 20 } })
      .edge('portal', 'cache', STACK.redis, { config: { timeoutMs: 50 } })
      .edge('portal', 'labs', STACK.svc, {
        config: { timeoutMs: 800, retries: 2, backoff: 'exp', breakerErrorThreshold: 0.5 },
      })
      .edge('labs', 'records', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 10 } })
      .edge('portal', 'files', STACK.internal, { config: { timeoutMs: 2_000 } })
      .edge('admin', 'records', STACK.postgres, { config: { timeoutMs: 1_000, poolSize: 5 } })
      .edge('portal', 'secrets', STACK.internal, { async: true })
      .edge('labs', 'secrets', STACK.internal, { async: true })
      .edge('admin', 'secrets', STACK.internal, { async: true });
  }

  const g = d.build();
  for (const grp of g.groups) {
    const rules = FIREWALL[v][grp.id.replace(/^grp_/, '')];
    if (rules && grp.security) grp.security.firewallRules = structuredClone(rules);
  }
  return g;
}

/** The intentionally broken board (what users open and review). */
const brokenPortal = portal('broken');
/** The same board with every intended issue fixed. */
const fixedPortal = portal('fixed');

/** Rules whose findings must all be gone for Debug mode to call the board fixed. */
const FIXED_WHEN_RULES_PASS = [
  'rule.db-internet-reachable',
  'rule.open-admin-ports',
  'rule.plaintext-edge',
  'rule.missing-service-auth',
  'rule.unbounded-retries',
  'rule.spof',
];

export default defineProblem({
  id: 'problem.antipattern-patient-portal',
  title: 'Anti-pattern sample: Clinic patient portal (intentionally insecure)',
  level: 2,
  tags: ['sample', 'anti-pattern', 'security', 'healthcare', 'reliability', 'retries', 'zones'],
  requirements: {
    functional: [
      'Patients sign in to see upcoming appointments and visit notes, and book or reschedule visits.',
      'Patients view lab results (served by a separate lab results service) and download scanned documents.',
      'Clinic staff use an admin console to look up and correct patient records.',
    ],
    nonFunctional: [
      'Health data (PHI) must be encrypted in transit and never reachable from the internet; only the app tier and audited admin sessions may touch the data stores.',
      'Monday-morning peak ≈ 2× the daily average; appointment pages p99 < 300 ms, lab results p99 < 400 ms, availability ≥ 99.9 %.',
      'No single instance failure may take the portal down; a slow lab service must not take the portal down with it.',
      'THIS SAMPLE IS INTENTIONALLY BROKEN: the "Broken design" (Debug mode) violates every requirement above. Use the review to find out how, then fix it.',
    ],
  },
  scale: { dau: 400_000, readWriteRatio: 9, dataSizeBytes: 20 * TB },
  scenario: scenario({
    usersByRegion: { 'north-america': 250_000 },
    peakMultiplier: 2,
    payloadBytes: { req: 1_000, res: 20_000 },
    flows: [
      {
        key: 'appts',
        name: 'View appointments & visit notes',
        share: 0.45,
        rpsPerUser: 0.02,
        op: 'read',
        path: ['patients', 'lb', 'gw', 'portal', 'records'],
      },
      {
        key: 'book',
        name: 'Book or reschedule',
        share: 0.1,
        rpsPerUser: 0.02,
        op: 'write',
        path: ['patients', 'lb', 'gw', 'portal', 'records'],
      },
      {
        key: 'labs',
        name: 'View lab results',
        share: 0.25,
        rpsPerUser: 0.02,
        op: 'read',
        path: ['patients', 'lb', 'gw', 'portal', 'labs', 'records'],
      },
      {
        key: 'docs',
        name: 'Download scanned documents',
        share: 0.15,
        rpsPerUser: 0.02,
        op: 'read',
        path: ['patients', 'lb', 'gw', 'portal', 'files'],
      },
      {
        key: 'admin',
        name: 'Staff record lookup',
        share: 0.05,
        rpsPerUser: 0.02,
        op: 'read',
        path: ['staff', 'admin', 'records'],
      },
    ],
  }),
  hints: [
    'Start with the Review panel on the broken board (run the simulation first so the capacity rules can run): sort by severity and read the critical findings before anything else.',
    'Trust boundaries: which subnets are public? The records database and the document bucket sit in a subnet with a public route and 0.0.0.0/0 rules; data stores belong in a private data zone reachable only from the app tier (and an audited bastion).',
    'Encryption: patients reach the load balancer over plain HTTP and the services talk to Postgres without TLS. Use HTTPS (TLS 1.3) at the edge, TLS to the database and mTLS between services.',
    'Front door: nothing rate-limits or authenticates requests before the portal and the admin VM. Put an API gateway (JWT validation, per-client limits) behind the load balancer and the admin console behind it with SSO; ops reach the database only through a VPN bastion.',
    'Reliability: the portal is one small VM with in-memory sessions, so it is both the bottleneck and a single point of failure. Make it stateless, run several replicas and autoscale; give Postgres a standby and read replicas.',
    'Retry storm: the portal retries the lab service 10 times immediately with no timeout. Cap retries at 2 with exponential backoff, set a timeout, add a circuit breaker and switch the call to mTLS.',
  ],
  referenceSolutions: [fixedPortal],
  rubric: [
    { slo: { metric: 'p99', op: 'lt', value: 300, flowId: 'flow_appts' }, weight: 3 },
    { slo: { metric: 'p99', op: 'lt', value: 400, flowId: 'flow_labs' }, weight: 2 },
    { slo: { metric: 'availability', op: 'gte', value: 0.999 }, weight: 2 },
    { ruleId: 'rule.db-internet-reachable', weight: 3 },
    { ruleId: 'rule.open-admin-ports', weight: 3 },
    { ruleId: 'rule.plaintext-edge', weight: 2 },
    { ruleId: 'rule.no-rate-limit-public-api', weight: 1 },
    { ruleId: 'rule.missing-service-auth', weight: 1 },
    { ruleId: 'rule.secrets-in-config', weight: 1 },
    { ruleId: 'rule.spof', weight: 2 },
    { ruleId: 'rule.unbounded-retries', weight: 1 },
    { ruleId: 'rule.no-cache-hot-read', weight: 1 },
  ],
  debugVariants: [
    {
      id: 'insecure-portal',
      title: 'Intentionally insecure & fragile patient portal (anti-pattern sample)',
      graph: brokenPortal,
      expectedFix:
        'Move the records database and document bucket into a private data zone and drop the 0.0.0.0/0 rules; use HTTPS at the edge, TLS to Postgres and mTLS to the lab service; cap retries (2, exponential backoff, timeout, breaker); make the portal stateless with several replicas and give Postgres a standby. NOTES.md lists every issue and its fix.',
      fixedWhenRulesPass: FIXED_WHEN_RULES_PASS,
    },
  ],
  docs: {
    summary:
      'Anti-pattern sample (intentionally broken, for learning): a clinic patient portal with a public database and bucket, plaintext health data, an exposed admin VM, no rate limiting, a single-instance monolith and a retry storm. Open the broken design in Debug mode, read the review, then fix it.',
  },
});
