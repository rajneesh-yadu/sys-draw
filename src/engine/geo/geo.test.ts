/**
 * S10 geo. Expected distances/RTTs were computed independently in Python (haversine, R = 6371 km,
 * RTT = 2 × 1.5 × d / 200 + 1 ms, + last mile for users):
 *   North America (39, −95) → us-east (38.9, −77.4): d = 1519.64 km ⇒ 23.795 + 15 = 38.795 ms
 *   India (22, 79) → us-east: d = 12811.10 km ⇒ 193.167 + 25 = 218.167 ms
 *   India → ap-south (19.1, 72.9): d = 712.18 km ⇒ 11.683 + 25 = 36.683 ms
 *   North America → ap-south: 217.494 ms;  us-east ↔ ap-south: d = 12862.79 km ⇒ 193.942 ms
 */
import { describe, expect, it } from 'vitest';
import { SimResultSchema, type ChaosEvent, type Graph, type NodeInstance } from '@/core';
import { registry } from '@/registry';
import { simulate } from '../simulate';
import { edge, flow, geoTestRegistry, node, scenario } from '../test-fixtures';
import { diurnalFactor, diurnalPeak } from './diurnal';
import { haversineKm, netBetween, propagationRttMs } from './distance';
import { findCloudRegion, userPlace } from './places';

const geoRegistry = geoTestRegistry;

const NA_USE = 38.79453463411909;
const IN_USE = 218.16654592996235;
const IN_APS = 36.682703144504885;
const USE_APS = 193.94186905692433;

function inGroup(n: NodeInstance, groupId: string): NodeInstance {
  return { ...n, groupId };
}

/** client → lb → app, all in us-east; optionally a second stack in ap-south. */
function board(withApSouth: boolean): Graph {
  const nodes = [
    node('c', 'client.test'),
    inGroup(node('lb', 'network.lb'), 'grp_use'),
    inGroup(node('app', 'compute.app'), 'grp_use'),
  ];
  const edges = [edge('c', 'lb'), edge('lb', 'app')];
  const groups: Graph['groups'] = [
    { id: 'grp_use', kind: 'region', label: 'US East', regionId: 'us-east' },
  ];
  if (withApSouth) {
    nodes.push(
      inGroup(node('lb2', 'network.lb'), 'grp_aps'),
      inGroup(node('app2', 'compute.app'), 'grp_aps'),
    );
    edges.push(edge('c', 'lb2'), edge('lb2', 'app2'));
    groups.push({ id: 'grp_aps', kind: 'region', label: 'Mumbai', regionId: 'ap-south' });
  }
  return { nodes, edges, groups };
}

const users = { 'north-america': 600, india: 400 };

describe('distance', () => {
  it('haversine and the RTT formula', () => {
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(10007.5434, 3);
    expect(propagationRttMs(1000)).toBeCloseTo(16, 12); // 2 × 1.5 × 1000 / 200 + 1
    expect(propagationRttMs(0)).toBe(0);
  });

  it('user → cloud adds the last mile; same place costs nothing', () => {
    const use = findCloudRegion(geoRegistry, 'generic', 'us-east');
    const na = userPlace('north-america');
    expect(netBetween(na, use).ms).toBeCloseTo(NA_USE, 9);
    expect(netBetween(na, use).cls).toBe('internet');
    expect(netBetween(use, use).ms).toBe(0);
    expect(netBetween(undefined, use).ms).toBe(0);
    const aps = findCloudRegion(geoRegistry, 'generic', 'ap-south');
    expect(netBetween(use, aps).ms).toBeCloseTo(USE_APS, 9);
    expect(netBetween(use, aps).cls).toBe('inter-region');
  });

  it('measured RTTs override the formula', () => {
    const use = findCloudRegion(geoRegistry, 'generic', 'us-east');
    const aps = findCloudRegion(geoRegistry, 'generic', 'ap-south');
    expect(netBetween(aps, use, { 'ap-south|us-east': 180 }).ms).toBe(180);
  });

  it('ships ~25 generic cloud regions', () => {
    const p = registry.require('generic', 'provider');
    expect(p.regions.length).toBeGreaterThanOrEqual(25);
  });
});

describe('diurnal', () => {
  it('curve: peak 1 at 20:00, trough at 04:00, linear in between', () => {
    expect(diurnalFactor(20)).toBe(1);
    expect(diurnalFactor(4)).toBe(0.26);
    expect(diurnalFactor(5.5)).toBeCloseTo(0.315, 12); // 0.28 + 0.5 × (0.35 − 0.28)
    expect(diurnalFactor(-4)).toBe(diurnalFactor(20));
  });

  it('busiest moment: one populated region is at its 20:00, the others follow', () => {
    // India (UTC+5:30) peaks at 14:30 UTC; North America (UTC−6) is then at 08:30 ⇒ 0.68.
    const p = diurnalPeak(
      [
        { id: 'india', users: 1000, utcOffsetHours: 5.5 },
        { id: 'north-america', users: 0, utcOffsetHours: -6 },
      ],
      true,
    );
    expect(p.utcHour).toBe(14.5);
    expect(p.factors.get('india')).toBe(1);
    expect(p.factors.get('north-america')).toBeCloseTo(0.68, 12);
    expect(diurnalPeak([{ id: 'x', users: 5, utcOffsetHours: 3 }], false).factors.get('x')).toBe(1);
  });

  it('spreads load: two regions 12 h apart never peak together', () => {
    const s = scenario(0, [], { usersByRegion: { 'north-america': 1000, india: 1000 } });
    const g = {
      nodes: [node('c', 'client.test'), node('app', 'compute.app')],
      edges: [edge('c', 'app')],
      groups: [],
    };
    const off = simulate({ graph: g, scenario: { ...s, diurnal: false } }, geoRegistry);
    const on = simulate({ graph: g, scenario: { ...s, diurnal: true } }, geoRegistry);
    expect(off.system.rps).toBeCloseTo(200, 9); // 2000 users × 0.1 rps
    // Busiest moment found on the 15-min grid; total = 100 × (f_NA + f_IN) < 200.
    const peak = diurnalPeak(
      [
        { id: 'north-america', users: 1000, utcOffsetHours: -6 },
        { id: 'india', users: 1000, utcOffsetHours: 5.5 },
      ],
      true,
    );
    const expected =
      100 * ((peak.factors.get('north-america') ?? 0) + (peak.factors.get('india') ?? 0));
    expect(on.system.rps).toBeCloseTo(expected, 9);
    expect(on.system.rps).toBeLessThan(200);
    expect(on.perRegion?.india?.explain.rps).toContain('local');
  });
});

describe('F8: users far from the only region pay the round trip', () => {
  it('40% of users in India with servers only in us-east: their p50 rises by the RTT gap', () => {
    const r = simulate(
      { graph: board(false), scenario: scenario(0, [], { usersByRegion: users }) },
      geoRegistry,
    );
    expect(SimResultSchema.safeParse(r).success).toBe(true);
    const na = r.perRegion?.['north-america'];
    const ind = r.perRegion?.india;
    expect(na?.servedFrom).toBe('us-east');
    expect(ind?.servedFrom).toBe('us-east');
    expect(na?.networkMs).toBeCloseTo(NA_USE, 9);
    expect(ind?.networkMs).toBeCloseTo(IN_USE, 9);
    // Same servers, same queues: the whole p50 difference is the network.
    expect((ind?.p50 ?? 0) - (na?.p50 ?? 0)).toBeCloseTo(IN_USE - NA_USE, 6);
    expect(r.perRegion?.india?.rps).toBeCloseTo(40, 9);
    // The client → LB edge shows the rps-weighted mean RTT: (60 × 38.79 + 40 × 218.17) / 100.
    expect(r.perEdge.edge_c_lb?.latencyMs.p50).toBeCloseTo((60 * NA_USE + 40 * IN_USE) / 100, 9);
    // Same region hop: 0 ms.
    expect(r.perEdge.edge_lb_app?.latencyMs.p50).toBe(0);
  });

  it('adding an ap-south region sends Indian users there (geo-DNS, nearest region)', () => {
    const before = simulate(
      { graph: board(false), scenario: scenario(0, [], { usersByRegion: users }) },
      geoRegistry,
    );
    const r = simulate(
      { graph: board(true), scenario: scenario(0, [], { usersByRegion: users }) },
      geoRegistry,
    );
    expect(r.perRegion?.india?.servedFrom).toBe('ap-south');
    expect(r.perRegion?.['north-america']?.servedFrom).toBe('us-east');
    expect(r.perRegion?.india?.networkMs).toBeCloseTo(IN_APS, 9);
    // Each region's traffic goes only to its own stack (no double calls).
    expect(r.perNode.node_app?.rpsIn).toBeCloseTo(60, 9);
    expect(r.perNode.node_app2?.rpsIn).toBeCloseTo(40, 9);
    expect((before.perRegion?.india?.p50 ?? 0) - (r.perRegion?.india?.p50 ?? 0)).toBeGreaterThan(
      150,
    );
  });

  it('nearest HEALTHY region: an ap-south outage fails India over to us-east', () => {
    const events: ChaosEvent[] = [
      { id: 'event_1', kind: 'regionOutage', regionId: 'ap-south', atSec: 0 },
    ];
    const r = simulate(
      { graph: board(true), scenario: scenario(0, [], { usersByRegion: users, events }) },
      geoRegistry,
    );
    expect(r.perRegion?.india?.servedFrom).toBe('us-east');
    expect(r.perRegion?.india?.networkMs).toBeCloseTo(IN_USE, 9);
    expect(r.findings.some((f) => f.title === 'Region failover')).toBe(true);
  });

  it('nothing placed ⇒ geo off: 0 ms network and an info note', () => {
    const g = {
      ...board(false),
      groups: [],
      nodes: board(false).nodes.map(({ groupId: _g, ...n }) => n),
    };
    const r = simulate(
      { graph: g, scenario: scenario(0, [], { usersByRegion: users }) },
      geoRegistry,
    );
    expect(r.perRegion?.india?.networkMs).toBe(0);
    expect(r.perRegion?.india?.p50).toBeCloseTo(r.perRegion?.['north-america']?.p50 ?? -1, 9);
    expect(r.perEdge.edge_c_lb?.latencyMs.p50).toBe(0);
    expect(r.findings.some((f) => f.title === 'No regions placed')).toBe(true);
  });

  it('unknown region ids are reported and ignored', () => {
    const g = board(false);
    g.groups[0] = { ...g.groups[0]!, regionId: 'us-east-1' };
    const r = simulate({ graph: g, scenario: scenario(100) }, geoRegistry);
    expect(r.findings.some((f) => f.title === 'Unknown region')).toBe(true);
    expect(r.perEdge.edge_c_lb?.latencyMs.p50).toBe(0);
  });
});

describe('egress, replication lag, read-local, explicit paths', () => {
  it('internet egress = avg rps × response bytes × seconds/month × $/GB', () => {
    const r = simulate(
      { graph: board(false), scenario: scenario(1000, [], { peakMultiplier: 2 }) },
      geoRegistry,
    );
    // 1000 users × 0.1 × peak 2 = 200 rps; average 100 rps × 10 000 B × 2 628 000 s = 2628 GB.
    expect(r.perEdge.edge_c_lb?.costPerMonth).toBeCloseTo(2628 * 0.09, 6);
    expect(r.perEdge.edge_lb_app?.costPerMonth).toBe(0);
    expect(r.system.costPerMonth).toBeGreaterThan(2628 * 0.09);
  });

  it('cross-region replication edge: lag = RTT/2 + apply time, and no reads replicate', () => {
    const g: Graph = {
      nodes: [
        node('c', 'client.test'),
        inGroup(node('app', 'compute.app'), 'grp_use'),
        inGroup(node('db', 'database.test'), 'grp_use'),
        inGroup(node('rep', 'database.test'), 'grp_aps'),
      ],
      edges: [edge('c', 'app'), edge('app', 'db'), edge('db', 'rep', false)],
      groups: [
        { id: 'grp_use', kind: 'region', label: 'US East', regionId: 'us-east' },
        { id: 'grp_aps', kind: 'region', label: 'Mumbai', regionId: 'ap-south' },
      ],
    };
    const r = simulate({ graph: g, scenario: scenario(100) }, geoRegistry);
    expect(r.perNode.node_rep?.rpsIn).toBe(0);
    // database.test S_write = 40 ms, idle ⇒ Wq = 0.
    expect(r.perEdge.edge_db_rep?.latencyMs.p50).toBeCloseTo(USE_APS / 2 + 40, 9);
    expect(r.findings.some((f) => f.title === 'Cross-region replication lag')).toBe(true);
  });

  it('reads go to the nearest copy of a data store (read-local)', () => {
    const g: Graph = {
      nodes: [
        node('c', 'client.test'),
        inGroup(node('app', 'compute.app'), 'grp_aps'),
        inGroup(node('db', 'database.test'), 'grp_use'),
        inGroup(node('rep', 'database.test'), 'grp_aps'),
      ],
      edges: [edge('c', 'app'), edge('app', 'db'), edge('app', 'rep')],
      groups: [
        { id: 'grp_use', kind: 'region', label: 'US East', regionId: 'us-east' },
        { id: 'grp_aps', kind: 'region', label: 'Mumbai', regionId: 'ap-south' },
      ],
    };
    const r = simulate({ graph: g, scenario: scenario(100) }, geoRegistry);
    expect(r.perNode.node_db?.rpsIn).toBe(0);
    expect(r.perNode.node_rep?.rpsIn).toBeCloseTo(10, 9);
  });

  it('explicit flow paths pay the hops between their steps', () => {
    const r = simulate(
      {
        graph: board(false),
        scenario: scenario(0, [flow('f', ['c', 'lb', 'app'], 'read', 0.1)], {
          usersByRegion: { india: 100 },
        }),
      },
      geoRegistry,
    );
    expect(r.perRegion?.india?.networkMs).toBeCloseTo(IN_USE, 9);
    expect(r.perFlow.flow_f?.rps).toBeCloseTo(10, 9);
  });
});

describe('real components: CDN at the edge, DNS policies', () => {
  const cdnBoard = (): Graph => ({
    nodes: [
      node('c', 'client.app', 1, {}, 'browser'),
      node('cdn', 'network.cdn', 1, {}, 'managed'),
      inGroup(node('lb', 'network.load-balancer', 1, {}, 'standard'), 'grp_use'),
    ],
    edges: [edge('c', 'cdn'), edge('cdn', 'lb')],
    groups: [{ id: 'grp_use', kind: 'region', label: 'US East', regionId: 'us-east' }],
  });

  it('users reach the CDN over their last mile; only misses travel to the origin', () => {
    const r = simulate(
      { graph: cdnBoard(), scenario: scenario(0, [], { usersByRegion: { india: 1000 } }) },
      registry,
    );
    const india = userPlace('india');
    const origin = findCloudRegion(registry, 'generic', 'us-east');
    // Edge PoP sits at the India centre: miss RTT = backbone India → us-east (no last mile).
    const miss = netBetween(india && { ...india, kind: 'edge', key: 'edge:india' }, origin).ms;
    expect(miss).toBeCloseTo(IN_USE - 25, 9);
    // Default CDN hit rate 0.8 ⇒ mean network = 25 + 0.2 × miss.
    expect(r.perRegion?.india?.networkMs).toBeCloseTo(25 + 0.2 * miss, 9);
  });

  it('DNS failover policy: everyone goes to the first healthy region', () => {
    const g = board(true);
    // client → DNS (failover) plus one LB per region; the first LB edge is the primary.
    const real: Graph = {
      nodes: [
        node('c', 'client.app', 1, {}, 'browser'),
        node('dns', 'network.dns', 1, { routingPolicy: 'failover' }, 'managed'),
        inGroup(node('lb', 'network.load-balancer', 1, {}, 'standard'), 'grp_use'),
        inGroup(node('lb2', 'network.load-balancer', 1, {}, 'standard'), 'grp_aps'),
      ],
      edges: [edge('c', 'dns'), edge('c', 'lb'), edge('c', 'lb2')],
      groups: g.groups,
    };
    const r = simulate(
      { graph: real, scenario: scenario(0, [], { usersByRegion: users }) },
      registry,
    );
    expect(r.perRegion?.india?.servedFrom).toBe('us-east');
    expect(r.perNode.node_lb2?.rpsIn).toBe(0);
    const latency = simulate(
      {
        graph: {
          ...real,
          nodes: real.nodes.map((n) => (n.id === 'node_dns' ? { ...n, config: {} } : n)),
        },
        scenario: scenario(0, [], { usersByRegion: users }),
      },
      registry,
    );
    expect(latency.perRegion?.india?.servedFrom).toBe('ap-south');
  });
});
