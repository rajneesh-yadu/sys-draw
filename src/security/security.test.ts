/**
 * S16 — zones, controls and threat review on the real registry.
 * Done-when: a DB placed in a public zone raises a critical finding with a one-click fix.
 */
import { describe, expect, it } from 'vitest';
import type { EdgeInstance, Graph, Group, NodeInstance } from '@/core';
import { registry, type FixPlan } from '@/registry';
import {
  edgeEncryption,
  encryptedStack,
  evaluateIngress,
  groupZone,
  nodeExposure,
  nodeZone,
  reviewSecurity,
  securityFix,
  securityOverlay,
  securityRules,
  zoneCrossings,
  type SecurityFinding,
} from './index';

const components = { get: (id: string) => registry.get(id, 'component') };
const protocols = { get: (id: string) => registry.get(id, 'protocol') };
const lookups = { components, protocols };

function n(
  id: string,
  defId: string,
  groupId?: string,
  config: Record<string, unknown> = {},
): NodeInstance {
  const def = registry.require(defId, 'component');
  return {
    id: `node_${id}`,
    defId,
    label: id,
    position: { x: 0, y: 0 },
    ...(groupId ? { groupId: `grp_${groupId}` } : {}),
    config: { ...def.defaults, ...config },
    scaling: { replicas: 1, instanceType: def.instanceTypes[0]!.id },
  };
}
function e(source: string, target: string, protocolStack: string[]): EdgeInstance {
  return {
    id: `edge_${source}_${target}`,
    source: `node_${source}`,
    target: `node_${target}`,
    protocolStack,
    sync: true,
    config: {},
  };
}
function g(id: string, security?: Group['security'], extra: Partial<Group> = {}): Group {
  return {
    id: `grp_${id}`,
    kind: 'subnet',
    label: id,
    ...(security ? { security } : {}),
    ...extra,
  };
}

const HTTPS = ['tcp', 'tls13', 'http1'];
const PG_TLS = ['tcp', 'tls13', 'postgres-wire'];

/** Applies the plan steps the rules in these tests use (the app maps them to store commands). */
function applyPlan(graph: Graph, plan: FixPlan): Graph {
  const out = structuredClone(graph);
  for (const s of plan.steps) {
    if (s.kind === 'setGroupSecurity')
      out.groups = out.groups.map((x) => (x.id === s.groupId ? { ...x, security: s.security } : x));
    else if (s.kind === 'setEdgeStack')
      out.edges = out.edges.map((x) =>
        x.id === s.edgeId ? { ...x, protocolStack: s.protocolStack } : x,
      );
    else if (s.kind === 'createGroup') {
      const id = `grp_${s.ref}`;
      out.groups.push({
        id,
        kind: s.groupKind,
        label: s.label,
        security: s.security,
        ...(s.parentId ? { parentId: s.parentId } : {}),
      });
      out.nodes = out.nodes.map((x) => (s.memberIds.includes(x.id) ? { ...x, groupId: id } : x));
    } else throw new Error(`step ${s.kind} not applied in this helper`);
  }
  return out;
}

const review = (graph: Graph) => reviewSecurity({ graph, registry });
const byRule = (fs: SecurityFinding[], id: string) => fs.filter((f) => f.ruleId === id);

describe('zone model', () => {
  const graph: Graph = {
    nodes: [
      n('web', 'client.app'),
      n('lb', 'network.load-balancer', 'pub'),
      n('app', 'compute.app-server', 'app'),
      n('db', 'database.postgres', 'data'),
      n('loose', 'compute.app-server'),
    ],
    edges: [],
    groups: [
      g('vpc', { public: false, firewallRules: [] }, { kind: 'vpc' }),
      g('pub', { public: true, firewallRules: [] }, { parentId: 'grp_vpc' }),
      g('app', undefined, { parentId: 'grp_vpc' }),
      g('data', { public: false, firewallRules: [], zone: 'data' }, { parentId: 'grp_vpc' }),
    ],
  };

  it('derives zones: explicit zone, public flag, inherited from the parent; clients are on the internet', () => {
    expect(groupZone(graph, 'grp_pub')).toBe('public');
    expect(groupZone(graph, 'grp_app')).toBe('private'); // inherits the VPC's (public: false)
    expect(groupZone(graph, 'grp_data')).toBe('data');
    const zone = (id: string) =>
      nodeZone(
        graph,
        graph.nodes.find((x) => x.id === `node_${id}`)!,
        components,
      );
    expect(zone('web')).toBe('internet');
    expect(zone('lb')).toBe('public');
    expect(zone('loose')).toBeUndefined();
  });

  it('exposure: public zone or a direct client edge = internet-facing', () => {
    const withEdge = { ...graph, edges: [e('web', 'app', HTTPS)] };
    expect(nodeExposure(graph, 'node_lb', components).exposure).toBe('exposed');
    expect(nodeExposure(graph, 'node_app', components).exposure).toBe('internal');
    expect(nodeExposure(withEdge, 'node_app', components)).toMatchObject({
      exposure: 'exposed',
      clientSources: ['node_web'],
    });
    expect(nodeExposure(graph, 'node_loose', components).exposure).toBe('unzoned');
    expect(nodeExposure(graph, 'node_web', components).exposure).toBe('internet');
  });

  it('edge encryption follows the protocol catalog', () => {
    expect(edgeEncryption(protocols, HTTPS)).toEqual({ status: 'tls', by: 'TLS 1.3' });
    expect(edgeEncryption(protocols, ['tcp', 'mtls', 'http2']).status).toBe('mtls');
    expect(edgeEncryption(protocols, ['tcp', 'http1']).status).toBe('plaintext');
    expect(edgeEncryption(protocols, ['udp', 'quic', 'http3']).status).toBe('tls');
    expect(edgeEncryption(protocols, []).status).toBe('unknown');
  });

  it('encryptedStack inserts TLS above TCP only where the layer above runs on it', () => {
    expect(encryptedStack(protocols, ['tcp', 'http1'])).toEqual(['tcp', 'tls13', 'http1']);
    expect(encryptedStack(protocols, ['tcp', 'tls13', 'http2'], 'mtls')).toEqual([
      'tcp',
      'mtls',
      'http2',
    ]);
    expect(encryptedStack(protocols, ['tcp', 'postgres-wire'], 'mtls')).toBeUndefined(); // no mTLS for PG wire
    expect(encryptedStack(protocols, ['udp', 'dns'])).toBeUndefined();
  });
});

describe('security groups on zone crossings', () => {
  const data = g('data', {
    public: false,
    zone: 'data',
    firewallRules: [
      {
        direction: 'ingress',
        action: 'allow',
        protocol: 'tcp',
        fromPort: 6379,
        toPort: 6379,
        peer: 'grp_app',
      },
    ],
  });
  const app = g('app', { public: false, zone: 'private', firewallRules: [] });
  const src = { zone: 'private' as const, groupIds: ['grp_app'] };

  it('allow by group peer and port; default deny; deny wins; no rules = not checked', () => {
    expect(evaluateIngress(data, src, 6379, 'tcp').verdict).toBe('allow');
    expect(evaluateIngress(data, src, 5432, 'tcp').verdict).toBe('deny');
    expect(evaluateIngress(data, src, 5432, 'tcp').ruleIndex).toBeUndefined(); // default deny
    expect(evaluateIngress(data, src, 6379, 'udp').verdict).toBe('deny');
    const withDeny = g('d2', {
      public: false,
      firewallRules: [
        { direction: 'ingress', action: 'allow', protocol: 'any', peer: '10.0.0.0/8' },
        {
          direction: 'ingress',
          action: 'deny',
          protocol: 'tcp',
          fromPort: 5432,
          toPort: 5432,
          peer: '0.0.0.0/0',
        },
      ],
    });
    expect(evaluateIngress(withDeny, src, 5432, 'tcp')).toMatchObject({
      verdict: 'deny',
      ruleIndex: 1,
    });
    expect(evaluateIngress(withDeny, src, 443, 'tcp').verdict).toBe('allow'); // CIDR = inside
    expect(evaluateIngress(withDeny, { zone: 'internet', groupIds: [] }, 443, 'tcp').verdict).toBe(
      'deny',
    );
    expect(evaluateIngress(app, src, 443, 'tcp').verdict).toBe('no-rules');
  });

  it('crossings use the stack port (TLS → secure port) and flag the blocked edge, with a fix', () => {
    const graph: Graph = {
      nodes: [n('app', 'compute.app-server', 'app'), n('db', 'database.postgres', 'data')],
      edges: [e('app', 'db', PG_TLS)],
      groups: [app, data],
    };
    const [c] = zoneCrossings(graph, lookups);
    expect(c).toMatchObject({
      from: 'private',
      to: 'data',
      inbound: true,
      port: 5432,
      transport: 'tcp',
    });
    expect(c?.guard?.verdict).toBe('deny');
    const [f] = byRule(review(graph), 'rule.security-group-blocks');
    expect(f?.severity).toBe('warning');
    expect(f?.fixLabel).toBe('Allow TCP 5432 from app');
    const fixed = applyPlan(graph, securityFix({ graph, registry }, f!.key)!);
    expect(zoneCrossings(fixed, lookups)[0]?.guard?.verdict).toBe('allow');
    expect(byRule(review(fixed), 'rule.security-group-blocks')).toEqual([]);
  });
});

describe('S16 done-when: a DB in a public zone raises a critical finding with a one-click fix', () => {
  it('data-only public subnet → critical; the fix makes the subnet a private data zone', () => {
    const graph: Graph = {
      nodes: [n('app', 'compute.app-server', 'app'), n('db', 'database.postgres', 'pub')],
      edges: [e('app', 'db', PG_TLS)],
      groups: [
        g('app', { public: false, firewallRules: [] }),
        g('pub', {
          public: true,
          firewallRules: [
            {
              direction: 'ingress',
              action: 'allow',
              protocol: 'tcp',
              fromPort: 5432,
              toPort: 5432,
              peer: '0.0.0.0/0',
            },
          ],
        }),
      ],
    };
    const findings = review(graph);
    const [f] = byRule(findings, 'rule.db-internet-reachable');
    expect(f).toMatchObject({
      severity: 'critical',
      title: '"db" is in a public zone',
      targetIds: ['node_db'],
    });
    expect(findings[0]?.severity).toBe('critical'); // worst first
    expect(f?.fixLabel).toBe('Make "pub" a private data zone');

    const plan = securityFix({ graph, registry }, f!.key)!;
    expect(plan.steps).toEqual([
      {
        kind: 'setGroupSecurity',
        groupId: 'grp_pub',
        security: { public: false, zone: 'data', firewallRules: [] }, // the 0.0.0.0/0 rule is dropped
      },
    ]);
    const fixed = applyPlan(graph, plan);
    expect(nodeExposure(fixed, 'node_db', components).exposure).toBe('internal');
    expect(byRule(review(fixed), 'rule.db-internet-reachable')).toEqual([]);
  });

  it('a public subnet shared with an app server → the fix moves the DB into a new private data subnet', () => {
    const graph: Graph = {
      nodes: [n('app', 'compute.app-server', 'pub'), n('db', 'database.postgres', 'pub')],
      edges: [e('app', 'db', PG_TLS)],
      groups: [
        g('vpc', undefined, { kind: 'vpc' }),
        g('pub', { public: true, firewallRules: [] }, { parentId: 'grp_vpc' }),
      ],
    };
    const [f] = byRule(review(graph), 'rule.db-internet-reachable');
    expect(f?.fixLabel).toBe('Move "db" into a private data subnet');
    const plan = securityFix({ graph, registry }, f!.key)!;
    expect(plan.steps[0]).toMatchObject({
      kind: 'createGroup',
      groupKind: 'subnet',
      memberIds: ['node_db'],
      parentId: 'grp_vpc',
      security: { public: false, zone: 'data' },
    });
    expect(byRule(review(applyPlan(graph, plan)), 'rule.db-internet-reachable')).toEqual([]);
  });

  it('DMZ → error; a client connected straight to a cache → critical without an automatic fix', () => {
    const graph: Graph = {
      nodes: [
        n('web', 'client.app'),
        n('db', 'database.postgres', 'dmz'),
        n('redis', 'cache.redis'),
      ],
      edges: [e('web', 'redis', ['tcp', 'tls13', 'resp'])],
      groups: [g('dmz', { public: false, zone: 'dmz', firewallRules: [] })],
    };
    const fs = byRule(review(graph), 'rule.db-internet-reachable');
    expect(fs.map((f) => [f.severity, f.targetIds[0], f.fixLabel])).toEqual([
      ['critical', 'node_redis', undefined],
      ['error', 'node_db', 'Make "dmz" a private data zone'],
    ]);
  });
});

describe('threat review rules', () => {
  it('every security rule has a severity, an explanation and a fix text', () => {
    const rules = securityRules(registry);
    expect(rules).toHaveLength(8);
    for (const r of rules) {
      expect(r.docs.why.length).toBeGreaterThan(20);
      expect(r.docs.howToFix.length).toBeGreaterThan(20);
    }
  });

  it('plaintext over the internet → error, fixed by inserting TLS 1.3', () => {
    const graph: Graph = {
      nodes: [n('web', 'client.app'), n('app', 'compute.app-server')],
      edges: [e('web', 'app', ['tcp', 'http1'])],
      groups: [],
    };
    const [f] = byRule(review(graph), 'rule.plaintext-edge');
    expect(f).toMatchObject({
      severity: 'error',
      targetIds: ['edge_web_app'],
      fixLabel: 'Encrypt with TLS 1.3',
    });
    const fixed = applyPlan(graph, securityFix({ graph, registry }, f!.key)!);
    expect(fixed.edges[0]?.protocolStack).toEqual(['tcp', 'tls13', 'http1']);
    expect(byRule(review(fixed), 'rule.plaintext-edge')).toEqual([]);
  });

  it('plaintext across zones → warning; inside one zone → nothing', () => {
    const graph: Graph = {
      nodes: [
        n('app', 'compute.app-server', 'app'),
        n('db', 'database.postgres', 'data'),
        n('db2', 'database.postgres', 'app'),
      ],
      edges: [e('app', 'db', ['tcp', 'postgres-wire']), e('app', 'db2', ['tcp', 'postgres-wire'])],
      groups: [
        g('app', { public: false, firewallRules: [] }),
        g('data', { public: false, zone: 'data', firewallRules: [] }),
      ],
    };
    const fs = byRule(review(graph), 'rule.plaintext-edge');
    expect(fs.map((f) => [f.severity, f.targetIds[0]])).toEqual([['warning', 'edge_app_db']]);
  });

  it('no rate limit in front of a public service → warning; a WAF in front clears it; the fix inserts one', () => {
    const open: Graph = {
      nodes: [
        n('web', 'client.app'),
        n('lb', 'network.load-balancer'),
        n('app', 'compute.app-server'),
      ],
      edges: [e('web', 'lb', HTTPS), e('lb', 'app', ['tcp', 'http1'])],
      groups: [],
    };
    const [f] = byRule(review(open), 'rule.no-rate-limit-public-api');
    expect(f).toMatchObject({
      severity: 'warning',
      targetIds: ['node_app', 'edge_web_lb'],
      fixLabel: 'Add a WAF in front',
    });
    expect(securityFix({ graph: open, registry }, f!.key)?.steps).toEqual([
      { kind: 'insertOnEdge', edgeId: 'edge_web_lb', defId: 'security.waf', label: 'WAF' },
    ]);
    const guarded: Graph = {
      nodes: [...open.nodes, n('waf', 'security.waf')],
      edges: [
        e('web', 'waf', HTTPS),
        e('waf', 'lb', ['tcp', 'http1']),
        e('lb', 'app', ['tcp', 'http1']),
      ],
      groups: [],
    };
    expect(byRule(review(guarded), 'rule.no-rate-limit-public-api')).toEqual([]);
    const viaGateway: Graph = {
      nodes: [
        n('web', 'client.app'),
        n('gw', 'network.api-gateway'),
        n('app', 'compute.app-server'),
      ],
      edges: [e('web', 'gw', HTTPS), e('gw', 'app', ['tcp', 'http1'])],
      groups: [],
    };
    expect(byRule(review(viaGateway), 'rule.no-rate-limit-public-api')).toEqual([]);
  });

  it('SSH open to the internet → critical; the fix scopes it to the bastion group (or removes it)', () => {
    const ssh = {
      direction: 'ingress' as const,
      action: 'allow' as const,
      protocol: 'tcp' as const,
      fromPort: 22,
      toPort: 22,
      peer: '0.0.0.0/0',
    };
    const https = { ...ssh, fromPort: 443, toPort: 443 };
    const graph: Graph = {
      nodes: [n('app', 'compute.app-server', 'app')],
      edges: [],
      groups: [g('app', { public: false, firewallRules: [ssh, https] })],
    };
    const [f] = byRule(review(graph), 'rule.open-admin-ports');
    expect(f).toMatchObject({
      severity: 'critical',
      targetIds: ['grp_app'],
      fixLabel: 'Remove the internet rule',
    });
    expect(f?.title).toContain('SSH 22');
    const fixed = applyPlan(graph, securityFix({ graph, registry }, f!.key)!);
    expect(fixed.groups[0]?.security?.firewallRules).toEqual([https]);

    const withBastion: Graph = {
      ...graph,
      nodes: [...graph.nodes, n('bastion', 'security.bastion', 'dmz')],
      groups: [...graph.groups, g('dmz', { public: false, zone: 'dmz', firewallRules: [] })],
    };
    const [fb] = byRule(review(withBastion), 'rule.open-admin-ports');
    const fixedB = applyPlan(withBastion, securityFix({ graph: withBastion, registry }, fb!.key)!);
    expect(fixedB.groups[0]?.security?.firewallRules[0]).toMatchObject({
      fromPort: 22,
      peer: 'grp_dmz',
    });
    expect(byRule(review(fixedB), 'rule.open-admin-ports')).toEqual([]);
  });

  it('service-to-service without mTLS → warning, fixed by switching to mTLS; a mesh covers it', () => {
    const graph: Graph = {
      nodes: [n('a', 'compute.app-server'), n('b', 'compute.app-server')],
      edges: [e('a', 'b', ['tcp', 'tls13', 'http2'])],
      groups: [],
    };
    const [f] = byRule(review(graph), 'rule.missing-service-auth');
    expect(f?.fixLabel).toBe('Switch to mTLS');
    const fixed = applyPlan(graph, securityFix({ graph, registry }, f!.key)!);
    expect(fixed.edges[0]?.protocolStack).toEqual(['tcp', 'mtls', 'http2']);
    expect(byRule(review(fixed), 'rule.missing-service-auth')).toEqual([]);
    const meshed = { ...graph, nodes: [...graph.nodes, n('mesh', 'network.service-mesh')] };
    expect(byRule(review(meshed), 'rule.missing-service-auth')).toEqual([]);
  });

  it('secrets in config → error; DB callers with no secrets manager → info with an "add" fix', () => {
    const graph: Graph = {
      nodes: [
        n('app', 'compute.app-server', undefined, { dbPassword: 'hunter2' }),
        n('db', 'database.postgres'),
      ],
      edges: [e('app', 'db', PG_TLS)],
      groups: [],
    };
    const fs = byRule(review(graph), 'rule.secrets-in-config');
    expect(fs.map((f) => [f.severity, f.fixLabel])).toEqual([
      ['error', undefined],
      ['info', 'Add a secrets manager'],
    ]);
    expect(securityFix({ graph, registry }, fs[1]!.key)?.steps).toEqual([
      {
        kind: 'addNode',
        defId: 'security.secrets-manager',
        label: 'Secrets Manager',
        near: 'node_app',
        connectFrom: ['node_app'],
      },
    ]);
    const vaulted = { ...graph, nodes: [...graph.nodes, n('vault', 'security.secrets-manager')] };
    expect(byRule(review(vaulted), 'rule.secrets-in-config').map((f) => f.severity)).toEqual([
      'error',
    ]);
  });

  it('all databases in one region → warning; a second region clears it', () => {
    const region = (id: string, regionId: string) => g(id, undefined, { kind: 'region', regionId });
    const one: Graph = {
      nodes: [n('db', 'database.postgres', 'use'), n('app', 'compute.app-server', 'euw')],
      edges: [],
      groups: [region('use', 'us-east'), region('euw', 'eu-west')],
    };
    expect(byRule(review(one), 'rule.single-region-data').map((f) => f.title)).toEqual([
      'All databases are in us-east',
    ]);
    const two = { ...one, nodes: [...one.nodes, n('db2', 'database.postgres', 'euw')] };
    expect(byRule(review(two), 'rule.single-region-data')).toEqual([]);
  });

  it('an empty board has no findings', () => {
    expect(review({ nodes: [], edges: [], groups: [] })).toEqual([]);
  });
});

describe('security overlay', () => {
  it('nodes by exposure, edges by encryption and crossing verdict, groups by zone', () => {
    const graph: Graph = {
      nodes: [
        n('web', 'client.app'),
        n('lb', 'network.load-balancer', 'pub'),
        n('app', 'compute.app-server', 'app'),
      ],
      edges: [e('web', 'lb', HTTPS), e('lb', 'app', ['tcp', 'http1'])],
      groups: [
        g('pub', { public: true, firewallRules: [] }),
        g('app', {
          public: false,
          firewallRules: [
            {
              direction: 'ingress',
              action: 'allow',
              protocol: 'tcp',
              fromPort: 80,
              toPort: 80,
              peer: 'grp_pub',
            },
          ],
        }),
      ],
    };
    const o = securityOverlay(graph, lookups);
    expect(o.nodes.node_web).toMatchObject({ exposure: 'internet', label: 'Internet' });
    expect(o.nodes.node_lb).toMatchObject({ exposure: 'exposed', label: 'Internet-facing' });
    expect(o.nodes.node_app).toMatchObject({ exposure: 'internal', label: 'Private' });
    expect(o.edges.edge_web_lb).toMatchObject({ encryption: 'tls', label: 'TLS 1.3' });
    expect(o.edges.edge_lb_app).toMatchObject({ encryption: 'plaintext', label: 'Plaintext' });
    expect(o.edges.edge_lb_app?.crossing).toMatchObject({
      from: 'public',
      to: 'private',
      verdict: 'allow',
    });
    expect(o.edges.edge_lb_app?.crossing?.explain).toContain('TCP 80');
    expect(o.groups).toEqual({ grp_pub: 'public', grp_app: 'private' });
  });
});
