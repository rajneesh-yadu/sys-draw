/**
 * S25 — sample workflow "Authentication, authorization & secrets" (`problem.sample-identity-access`).
 * Beyond the generic reference checks in references.test.ts: the sample is discoverable under the
 * identity tags; the user path goes through the gateway to the auth server only for sign-in and
 * refresh (tokens are verified locally on API calls); services authenticate each other with mTLS;
 * workloads reach IAM, the secrets manager and KMS; every zone crossing is encrypted and allowed by
 * a security group; the peak run holds its SLOs; the review reports only the documented scope cuts;
 * the existing security rules and attack events react when the controls are removed.
 */
import { describe, expect, it } from 'vitest';
import type { ChaosEvent, Graph, Scenario } from '@/core';
import { reviewDesign, simulate } from '@/engine';
import { filterProblems, findProblem, listProblems, startProblem } from '@/problems';
import { registry } from '@/registry';
import { edgeEncryption, nodeZone, reviewSecurity, ruleContext, zoneCrossings } from '@/security';
import { checkConnection, checkProtocolStack, createAppStores } from '@/store';

const ID = 'problem.sample-identity-access';
const sample = findProblem(registry, ID)!;
const graph: Graph = sample.referenceSolutions[0]!;
const ctx = ruleContext({ graph, registry });
const node = (key: string, g: Graph = graph) => g.nodes.find((n) => n.id === `node_${key}`)!;
const sources = (key: string) =>
  graph.edges
    .filter((e) => e.target === `node_${key}`)
    .map((e) => e.source.replace(/^node_/, ''))
    .sort();
const targets = (key: string) =>
  graph.edges
    .filter((e) => e.source === `node_${key}`)
    .map((e) => e.target.replace(/^node_/, ''))
    .sort();
const edge = (from: string, to: string, g: Graph = graph) =>
  g.edges.find((e) => e.id === `edge_${from}-${to}`)!;
const flow = (key: string) => sample.scenario.flows.find((f) => f.id === `flow_${key}`)!;
const pathOf = (key: string) => flow(key).path.map((s) => s.nodeId.replace(/^node_/, ''));
const effective = (key: string) => {
  const n = node(key);
  return { ...registry.require(n.defId, 'component').defaults, ...n.config };
};
const zoneOf = (key: string) => nodeZone(graph, node(key), ctx.components);
const run = (g: Graph = graph, scenario: Scenario = sample.scenario) =>
  simulate({ graph: g, scenario, providerId: 'generic' }, registry);
const ruleIds = (g: Graph, result?: ReturnType<typeof run>) =>
  [
    ...new Set(
      reviewDesign({
        graph: g,
        scenario: sample.scenario,
        registry,
        ...(result ? { result } : {}),
      }).findings.map((f) => f.ruleId),
    ),
  ].sort();

describe('S25 sample workflow — authentication, authorization & secrets', () => {
  it('is discoverable by the sample tag and by each identity topic', () => {
    const all = listProblems(registry);
    for (const tag of [
      'sample',
      'identity',
      'authentication',
      'authorization',
      'iam',
      'secrets',
      'kms',
    ])
      expect(
        filterProblems(all, { tag }).map((p) => p.id),
        tag,
      ).toContain(ID);
    expect(sample.title).toMatch(/^Sample workflow:/);
    expect(sample.docs.summary).toMatch(/auth server.*gateway.*mTLS.*IAM.*secrets manager.*KMS/s);
  });

  it('loads onto a new board in one step, with its scenario', () => {
    const { boardStore, workspaceStore } = createAppStores();
    const res = startProblem(workspaceStore, sample, { mode: 'sandbox', start: 'reference' });
    expect(res.ok).toBe(true);
    const doc = boardStore.getState().doc;
    expect(doc.graph).toEqual(graph);
    expect(doc.scenario.flows.map((f) => f.id)).toEqual([
      'flow_signin',
      'flow_refresh',
      'flow_myorders',
      'flow_checkout',
      'flow_support',
      'flow_secret',
      'flow_datakey',
    ]);
  });

  it('every edge is a legal connection with a valid, encrypted protocol stack', () => {
    for (const e of graph.edges) {
      const others = { ...graph, edges: graph.edges.filter((x) => x.id !== e.id) };
      const c = checkConnection(registry, others, { source: e.source, target: e.target });
      expect(c.ok, `${e.id}: ${c.ok ? '' : c.reason}`).toBe(true);
      expect(checkProtocolStack(registry, graph, e, e.protocolStack), e.id).toBeNull();
      expect(edgeEncryption(ctx.protocols, e.protocolStack).status, e.id).not.toBe('plaintext');
      expect(e.sync, e.id).toBe(true);
      // Every server-side call has a timeout (people's browsers are not configured here).
      if (!/^node_(client|staff)$/.test(e.source))
        expect(e.config.timeoutMs, e.id).toBeGreaterThan(0);
    }
  });

  it('authentication: users sign in at the auth server via the gateway; API calls verify JWTs locally', () => {
    expect(node('auth').defId).toBe('security.auth-server');
    expect(node('gw').defId).toBe('network.api-gateway');
    // The auth server is reached only through the gateway; only it reads the users DB.
    expect(sources('auth')).toEqual(['gw']);
    expect(sources('usersdb')).toEqual(['auth']);
    expect(sources('gw')).toEqual(['client', 'staff']);
    // JWTs (verified with cached public keys), short-lived, MFA required.
    expect(effective('gw').authMode).toBe('jwt');
    expect(effective('auth').tokenFormat).toBe('jwt');
    expect(effective('auth').accessTokenTtlMin).toBeLessThanOrEqual(15);
    expect(effective('auth').mfa).toBe('required');
    // Sign-in and refresh go to the auth server; data requests never do.
    expect(pathOf('signin')).toEqual(['client', 'gw', 'auth', 'usersdb']);
    expect(pathOf('refresh')).toEqual(['client', 'gw', 'auth', 'usersdb']);
    for (const f of ['myorders', 'checkout', 'support']) {
      expect(pathOf(f).slice(0, 3), f).toEqual([
        f === 'support' ? 'staff' : 'client',
        'gw',
        'orders',
      ]);
      expect(pathOf(f), f).not.toContain('auth');
    }
  });

  it('authorization: user roles reach the API; services authenticate each other with mTLS', () => {
    // Two populations with different roles share the same gateway and API.
    expect(node('client').label).toMatch(/role: customer/);
    expect(node('staff').label).toMatch(/role: support/);
    expect(node('orders').label).toMatch(/authorises user roles/);
    // Gateway → service and service → service are mutually authenticated.
    for (const [a, b] of [
      ['gw', 'orders'],
      ['orders', 'payments'],
    ] as const)
      expect(edgeEncryption(ctx.protocols, edge(a, b).protocolStack).status, `${a}→${b}`).toBe(
        'mtls',
      );
    // Payments is internal: only the Orders API calls it.
    expect(sources('payments')).toEqual(['orders']);
    expect(pathOf('checkout')).toEqual([
      'client',
      'gw',
      'orders',
      'ordersdb',
      'payments',
      'paymentsdb',
    ]);
    // Each data store is reached only by the service that owns it.
    expect(sources('ordersdb')).toEqual(['orders']);
    expect(sources('bucket')).toEqual(['orders']);
    expect(sources('paymentsdb')).toEqual(['payments']);
  });

  it('secrets: workloads use IAM roles, fetch DB credentials from the vault and keys from KMS', () => {
    expect(node('iam').defId).toBe('security.iam');
    expect(node('secrets').defId).toBe('security.secrets-manager');
    expect(node('kms').defId).toBe('security.kms');
    expect(sources('iam')).toEqual(['auth', 'orders', 'payments']);
    expect(sources('secrets')).toEqual(['auth', 'orders', 'payments']);
    expect(sources('kms')).toEqual(['auth', 'payments']);
    // Every workload that talks to a database also gets a role and its credential from the vault.
    for (const w of ['auth', 'orders', 'payments'])
      expect(targets(w), w).toEqual(expect.arrayContaining(['iam', 'secrets']));
    // The managed security services are endpoints, not request hops: nothing flows out of them.
    for (const s of ['iam', 'secrets', 'kms']) expect(targets(s), s).toEqual([]);
    expect(effective('iam').leastPrivilege).toBe(true);
    expect(effective('secrets').rotationDays).toBeGreaterThan(0);
    expect(effective('kms').keyType).toBe('customer-managed');
    expect(pathOf('secret')).toEqual(['orders', 'iam', 'secrets']);
    expect(pathOf('datakey')).toEqual(['payments', 'kms']);
    // No credential is written into any config.
    expect(
      reviewSecurity({ graph, registry }).filter((f) => f.ruleId === 'rule.secrets-in-config'),
    ).toEqual([]);
    expect(JSON.stringify(graph)).not.toMatch(/BEGIN|AKIA|sk_live|password\s*[:=]/i);
  });

  it('trust zones: data stores in data subnets, every crossing allowed by a scoped security group', () => {
    expect(zoneOf('gw')).toBe('dmz');
    for (const k of ['auth', 'orders', 'payments', 'iam', 'secrets', 'kms'])
      expect(zoneOf(k), k).toBe('private');
    for (const k of ['usersdb', 'ordersdb', 'paymentsdb', 'bucket'])
      expect(zoneOf(k), k).toBe('data');
    // The users DB has its own data subnet so the cluster cannot reach password hashes.
    expect(node('usersdb').groupId).not.toBe(node('ordersdb').groupId);
    const crossings = zoneCrossings(graph, ctx);
    expect(crossings.map((c) => c.edgeId).sort()).toEqual(
      [
        'edge_client-gw',
        'edge_staff-gw',
        'edge_gw-auth',
        'edge_gw-orders',
        'edge_auth-usersdb',
        'edge_orders-ordersdb',
        'edge_orders-bucket',
        'edge_payments-paymentsdb',
      ].sort(),
    );
    for (const c of crossings) expect(c.guard?.verdict, c.edgeId).toBe('allow');
    // No rule opens anything but 443 to the internet, and no data subnet is open to 0.0.0.0/0.
    for (const g of graph.groups)
      for (const r of g.security?.firewallRules ?? []) {
        expect(r.peer, `${g.id}`).not.toMatch(/0\.0\.0\.0\/0|::\/0/);
        if (r.peer === 'internet') expect([r.fromPort, r.toPort], g.id).toEqual([443, 443]);
      }
  });

  it('has flows that walk the highlighted paths, and every node is on one', () => {
    const onFlow = new Set(sample.scenario.flows.flatMap((f) => f.path.map((s) => s.nodeId)));
    for (const n of graph.nodes) expect(onFlow.has(n.id), n.label).toBe(true);
    expect(pathOf('support')).toEqual(['staff', 'gw', 'orders', 'ordersdb', 'bucket']);
    expect(flow('signin').path.every((s) => s.op === 'write')).toBe(true);
  });

  it('runs the peak scenario within its SLOs; the auth server carries only sign-in and refresh', () => {
    const r = run();
    for (const [id, n] of Object.entries(r.perNode))
      expect(n.utilization, `${id} utilisation`).toBeLessThan(0.75);
    for (const f of sample.scenario.flows) {
      expect(r.perFlow[f.id]!.rps, f.id).toBeGreaterThan(0);
      expect(r.perFlow[f.id]!.errorRate, f.id).toBeLessThan(0.001);
    }
    expect(r.perFlow.flow_myorders!.p99).toBeLessThan(150);
    expect(r.perFlow.flow_checkout!.p99).toBeLessThan(300);
    expect(r.perFlow.flow_signin!.p99).toBeLessThan(400);
    expect(r.system.availability).toBeGreaterThanOrEqual(0.999);
    const authRps = r.perFlow.flow_signin!.rps + r.perFlow.flow_refresh!.rps;
    expect(r.perNode.node_auth!.rpsIn).toBeCloseTo(authRps, 0);
    expect(r.perNode.node_auth!.rpsIn).toBeLessThan(r.perNode.node_gw!.rpsIn / 4);
    expect(r.findings).toEqual([]);
  });

  it('design review reports only the documented scope cuts (single region, uncached order reads)', () => {
    // After a run (as in the app): the uncached Orders DB reads are flagged too.
    expect(ruleIds(graph, run())).toEqual(['rule.no-cache-hot-read', 'rule.single-region-data']);
    expect(ruleIds(graph)).toEqual(['rule.single-region-data']);
  });

  it('existing security rules fire when an identity control is removed', () => {
    // Plain TLS instead of mTLS between Orders and Payments: Payments would trust any caller.
    const noMtls = structuredClone(graph);
    edge('orders', 'payments', noMtls).protocolStack = ['tcp', 'tls13', 'http2'];
    expect(ruleIds(noMtls)).toContain('rule.missing-service-auth');
    // No secrets manager: database passwords have no safe home.
    const noVault = structuredClone(graph);
    noVault.nodes = noVault.nodes.filter((n) => n.id !== 'node_secrets');
    noVault.edges = noVault.edges.filter((e) => e.target !== 'node_secrets');
    expect(
      reviewSecurity({ graph: noVault, registry }).find(
        (f) => f.ruleId === 'rule.secrets-in-config',
      )?.severity,
    ).toBe('info');
    // A password written into config is an error.
    const leaked = structuredClone(graph);
    node('orders', leaked).config.dbPassword = 'example-not-a-real-secret';
    expect(
      reviewSecurity({ graph: leaked, registry }).find((f) => f.ruleId === 'rule.secrets-in-config')
        ?.severity,
    ).toBe('error');
  });

  it('attack events: MFA stops credential stuffing, least-privilege IAM stops exfiltration, TLS stops MITM', () => {
    const events: ChaosEvent[] = [
      { id: 'event_stuff', kind: 'credentialStuffing', atSec: 10, durationSec: 20, rps: 2_000 },
      {
        id: 'event_exfil',
        kind: 'dataExfiltration',
        atSec: 10,
        durationSec: 20,
        nodeId: 'node_paymentsdb',
      },
      { id: 'event_mitm', kind: 'mitm', atSec: 10, durationSec: 20 },
    ];
    const scenario = { ...sample.scenario, events };
    const title = (r: ReturnType<typeof run>, t: string) => r.findings.find((f) => f.title === t);
    const guarded = run(graph, scenario);
    expect(title(guarded, 'Credential stuffing')?.message).toMatch(/MFA is required/);
    expect(title(guarded, 'Exfiltration denied by IAM')?.severity).toBe('info');
    expect(title(guarded, 'TLS stopped the man in the middle')).toBeDefined();

    const weak = structuredClone(graph);
    node('auth', weak).config.mfa = 'optional';
    node('iam', weak).config.leastPrivilege = false;
    const open = run(weak, scenario);
    expect(title(open, 'Credential stuffing')?.severity).toBe('error');
    expect(title(open, 'Data exfiltrated')?.severity).toBe('critical');
  });

  it('has a legible layout: distinct positions and non-overlapping sibling group boxes', () => {
    const at = new Set(graph.nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(at.size).toBe(graph.nodes.length);
    const x = (k: string) => node(k).position.x;
    const y = (k: string) => node(k).position.y;
    // Left to right: people → gateway → identity/workloads → data.
    expect(x('client')).toBeLessThan(x('gw'));
    expect(x('gw')).toBeLessThan(x('auth'));
    expect(x('gw')).toBeLessThan(x('orders'));
    expect(x('orders')).toBeLessThan(x('ordersdb'));
    // Identity on top, managed security services at the bottom.
    expect(y('auth')).toBeLessThan(y('orders'));
    for (const k of ['iam', 'secrets', 'kms'])
      expect(y(k), k).toBeGreaterThan(Math.max(...['orders', 'payments', 'paymentsdb'].map(y)));
    for (const n of graph.nodes) expect(n.label.length, n.id).toBeLessThanOrEqual(50);

    const W = 200;
    const H = 100;
    const box = (gid: string) => {
      const inside = (n: Graph['nodes'][number]) => {
        for (let g = n.groupId; g; g = graph.groups.find((q) => q.id === g)?.parentId)
          if (g === gid) return true;
        return false;
      };
      const ns = graph.nodes.filter(inside);
      return {
        x0: Math.min(...ns.map((n) => n.position.x)),
        y0: Math.min(...ns.map((n) => n.position.y)),
        x1: Math.max(...ns.map((n) => n.position.x + W)),
        y1: Math.max(...ns.map((n) => n.position.y + H)),
      };
    };
    for (const a of graph.groups)
      for (const b of graph.groups) {
        if (a.id >= b.id || a.parentId !== b.parentId) continue;
        const p = box(a.id);
        const q = box(b.id);
        const overlap = p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
        expect(overlap, `${a.label} / ${b.label}`).toBe(false);
      }
  });
});
