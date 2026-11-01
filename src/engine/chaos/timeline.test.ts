/**
 * S11 — failures over time. Expected values are hand-computed from the test registry's round
 * numbers (compute.mm1: μ = 100 rps; network.lb: 1 ms, c = 1, reject; database.test: μ = 50 rps).
 */
import { describe, expect, it } from 'vitest';
import type { ChaosEvent, Graph, Group, SimResult } from '@/core';
import { simulate } from '../simulate';
import { edge, flow, geoTestRegistry, node, scenario, testRegistry } from '../test-fixtures';
import {
  eventWindow,
  healthCheckDelaySec,
  isActive,
  nodesInGroup,
  packetLossDelayMs,
  TCP_MIN_RTO_MS,
} from './events';
import { expectedAttempts, retrySuccess, timeoutProbability } from '../model/evaluate';

const az = (id: string, label: string, parentId?: string): Group => ({
  id: `grp_${id}`,
  kind: 'az',
  label,
  ...(parentId ? { parentId } : {}),
});

/** client → lb → { app_a in AZ a, app_b in AZ b }. */
function twoAz(appDef = 'compute.mm1', appB = {}): Graph {
  const a = { ...node('app_a', appDef), groupId: 'grp_a' };
  const b = { ...node('app_b', appDef), groupId: 'grp_b', ...appB };
  return {
    nodes: [node('client', 'client.test'), node('lb', 'network.lb', 1), a, b],
    edges: [edge('client', 'lb'), edge('lb', 'app_a'), edge('lb', 'app_b')],
    groups: [az('a', 'AZ a'), az('b', 'AZ b')],
  };
}

type EventInput = ChaosEvent extends infer T
  ? T extends ChaosEvent
    ? Omit<T, 'id'> & { id?: string }
    : never
  : never;
const ev = (e: EventInput): ChaosEvent => ({ id: 'evt_1', ...e }) as ChaosEvent;

const at = (r: SimResult, t: number) => {
  const p = r.timeline?.find((x) => x.tSec === t);
  if (!p) throw new Error(`no tick at ${t}`);
  return p;
};

/** Read flow at `rps` from the client through the graph (inferred route, rpsPerUser 1). */
function run(g: Graph, rps: number, events: ChaosEvent[], extra = {}, reg = testRegistry) {
  const sc = scenario(rps, [{ ...flow('f', []), rpsPerUser: 1 }], {
    events,
    durationSec: 90,
    ...extra,
  });
  return simulate({ graph: g, scenario: sc }, reg);
}

describe('event helpers', () => {
  it('windows, activity and defaults', () => {
    const outage = ev({ kind: 'nodeOutage', nodeId: 'node_x', atSec: 10 });
    expect(eventWindow(outage)).toEqual({ start: 10, end: Infinity });
    expect(isActive(outage, 9)).toBe(false);
    expect(isActive(outage, 10)).toBe(true);
    const cold = ev({ kind: 'coldStartBurst', atSec: 5 });
    expect(eventWindow(cold)).toEqual({ start: 5, end: 35 }); // default 30 s fade
    expect(isActive(ev({ kind: 'diskFull', nodeId: 'node_x', atSec: 0, durationSec: 5 }), 5)).toBe(
      false,
    );
  });

  it('packet loss delay = (1 − (1 − p)^k) × RTO with k = ⌈bytes / 1460⌉', () => {
    // 11 000 B ⇒ k = 8; p = 0.02 ⇒ 1 − 0.98^8 = 0.14924 ⇒ 29.85 ms.
    expect(packetLossDelayMs(0.02, 11_000)).toBeCloseTo((1 - 0.98 ** 8) * TCP_MIN_RTO_MS, 9);
    expect(packetLossDelayMs(0.02, 11_000)).toBeCloseTo(29.848, 2);
    expect(packetLossDelayMs(0, 11_000)).toBe(0);
  });

  it('retry math: attempts, success, timeouts', () => {
    expect(expectedAttempts(1, 3)).toBe(1);
    expect(expectedAttempts(0, 3)).toBe(4);
    expect(expectedAttempts(0.5, 2)).toBeCloseTo(1.75, 12); // 1 + 0.5 + 0.25
    expect(retrySuccess(0.5, 2)).toBeCloseTo(0.875, 12);
    expect(timeoutProbability(1000, 500)).toBeCloseTo(Math.exp(-2), 12);
    expect(timeoutProbability(undefined, 500)).toBe(0);
  });

  it('nested groups and health-check delay defaults (10 s × 3)', () => {
    const g = twoAz();
    g.groups.push(az('sub', 'sub', 'grp_a'));
    g.nodes.push({ ...node('deep', 'compute.mm1'), groupId: 'grp_sub' });
    expect(nodesInGroup(g, 'grp_a').sort()).toEqual(['node_app_a', 'node_deep']);
    const lb = { config: {} } as Parameters<typeof healthCheckDelaySec>[0];
    expect(healthCheckDelaySec(lb)).toBe(30);
    expect(
      healthCheckDelaySec({
        config: { healthCheckIntervalSec: 5, unhealthyThreshold: 2 },
      } as never),
    ).toBe(10);
  });
});

describe('done when — killing one AZ of a 2-AZ deployment: dip and recovery', () => {
  // 60 rps ⇒ 30 per app (ρ 0.3). AZ a dies at t = 20; the LB notices after 10 s × 3 = 30 s.
  const r = run(twoAz(), 60, [ev({ kind: 'groupOutage', groupId: 'grp_a', atSec: 20 })]);

  it('has one tick per second over the run', () => {
    expect(r.timeline).toHaveLength(90);
    expect(r.timeline?.[0]?.tSec).toBe(0);
    expect(r.timeline?.[89]?.tSec).toBe(89);
  });

  it('is fully available before the event', () => {
    expect(at(r, 19).availability).toBeCloseTo(1, 9);
    expect(at(r, 19).nodes?.node_app_a?.state).toBe('up');
  });

  it('dips to 50 % while the LB still sends half the traffic to the dead AZ', () => {
    expect(at(r, 20).availability).toBeCloseTo(0.5, 9);
    expect(at(r, 49).availability).toBeCloseTo(0.5, 9);
    expect(at(r, 20).nodes?.node_app_a?.state).toBe('down');
    expect(at(r, 20).nodes?.node_app_a?.errorRate).toBe(1);
  });

  it('recovers once health checks remove AZ a; AZ b takes all traffic (ρ 0.3 → 0.6)', () => {
    expect(at(r, 50).availability).toBeCloseTo(1, 9);
    expect(at(r, 89).availability).toBeCloseTo(1, 9);
    expect(at(r, 19).nodes?.node_app_b?.utilization).toBeCloseTo(0.3, 9);
    expect(at(r, 50).nodes?.node_app_b?.utilization).toBeCloseTo(0.6, 9);
    expect(at(r, 50).nodes?.node_app_a?.rpsIn).toBe(0);
  });

  it('marks the event and the detection, and reports a dip with recovery', () => {
    const kinds = r.timelineEvents?.map((m) => [m.tSec, m.kind]);
    expect(kinds).toContainEqual([20, 'chaos-start']);
    expect(kinds).toContainEqual([50, 'detected']);
    const f = r.findings.find((x) => x.ruleId === 'engine.chaos');
    expect(f?.title).toBe('Dip and recovery');
    expect(f?.message).toMatch(/dipped to 50% at 20 s and recovered to ≥ 99% at 50 s \(30 s/);
  });

  it('client retries hide most of the dip (1 − 0.5³ = 87.5 %) at the cost of extra calls', () => {
    const g = twoAz();
    g.edges[0] = { ...g.edges[0]!, config: { retries: 2 } };
    const rr = run(g, 60, [ev({ kind: 'groupOutage', groupId: 'grp_a', atSec: 20 })]);
    expect(at(rr, 30).availability).toBeCloseTo(0.875, 9);
    // Attempts to the LB = 1 + 0.5 + 0.25 = 1.75 per request.
    expect(at(rr, 30).edges?.edge_client_lb?.rps).toBeCloseTo(60 * 1.75, 6);
    expect(at(rr, 60).availability).toBeCloseTo(1, 9);
  });

  it('with autoscaling, the survivor scales out after warm-up and the latency spike drains', () => {
    // 100 rps ⇒ 50 per app; after failover AZ b gets 100 rps = its whole capacity (μ 100).
    const g = twoAz('compute.mm1', {
      scaling: {
        replicas: 1,
        instanceType: 'std',
        autoscale: { min: 1, max: 4, targetUtil: 0.6, warmupSec: 15 },
      },
    });
    const ra = run(g, 100, [ev({ kind: 'groupOutage', groupId: 'grp_a', atSec: 10 })]);
    // Steady state before: 50 rps ⇒ ⌈0.5 / 0.6⌉ = 1 replica.
    expect(at(ra, 5).nodes?.node_app_b?.replicas).toBe(1);
    // LB removes AZ a at t = 40 ⇒ desired ⌈1.0 / 0.6⌉ = 2, launched at 40, ready at 55.
    expect(at(ra, 54).nodes?.node_app_b?.replicas).toBe(1);
    expect(at(ra, 55).nodes?.node_app_b?.replicas).toBe(2);
    expect(at(ra, 55).nodes?.node_app_b?.utilization).toBeCloseTo(0.5, 9);
    const peak = Math.max(...ra.timeline!.map((p) => p.p99Ms));
    expect(at(ra, 54).p99Ms).toBeGreaterThan(at(ra, 39).p99Ms * 2);
    expect(at(ra, 89).p99Ms).toBeLessThan(peak / 4);
    expect(ra.timelineEvents?.some((m) => m.kind === 'scale-out' && m.tSec === 55)).toBe(true);
  });
});

describe('done when — killing the only database: outage', () => {
  // client → lb → app ×2 → db (single, μ 50); 20 rps.
  const g: Graph = {
    nodes: [
      node('client', 'client.test'),
      node('lb', 'network.lb'),
      node('app', 'compute.mm1', 2),
      node('db', 'database.test'),
    ],
    edges: [edge('client', 'lb'), edge('lb', 'app'), edge('app', 'db')],
    groups: [],
  };

  it('availability drops to 0 for as long as the DB is down, then comes back', () => {
    const r = run(g, 20, [
      ev({ kind: 'nodeOutage', nodeId: 'node_db', atSec: 30, durationSec: 20 }),
    ]);
    expect(at(r, 29).availability).toBeCloseTo(1, 9);
    expect(at(r, 30).availability).toBe(0);
    expect(at(r, 49).availability).toBe(0);
    expect(at(r, 50).availability).toBeCloseTo(1, 9);
    expect(at(r, 30).nodes?.node_db?.state).toBe('down');
    const outage = r.findings.find((f) => f.title === 'Outage');
    expect(outage?.severity).toBe('error');
    expect(outage?.message).toMatch(/fell to 0% from 30 s to 50 s \(20 s\)/);
    expect(outage?.message).toMatch(/"db".*single point of failure/);
    expect(outage?.targetIds).toEqual(['node_db']);
  });

  it('without an end, the outage lasts to the end of the run', () => {
    const r = run(g, 20, [ev({ kind: 'nodeOutage', nodeId: 'node_db', atSec: 30 })]);
    expect(at(r, 89).availability).toBe(0);
    expect(r.findings.find((f) => f.title === 'Outage')?.message).toMatch(/until the end/);
  });

  it('a circuit breaker stops calls to the dead DB and closes when it is back', () => {
    const gb = structuredClone(g);
    gb.edges[2] = {
      ...gb.edges[2]!,
      config: { breakerErrorThreshold: 0.5, breakerOpenSec: 20 },
    };
    // DB down 10–40 s. Window 10 s: 5 failing ticks of 10 reach 50 % ⇒ opens at t = 14.
    const r = run(gb, 20, [
      ev({ kind: 'nodeOutage', nodeId: 'node_db', atSec: 10, durationSec: 30 }),
    ]);
    expect(at(r, 14).edges?.edge_app_db?.breaker).toBe('closed');
    expect(at(r, 15).edges?.edge_app_db?.breaker).toBe('open');
    expect(at(r, 15).nodes?.node_db?.rpsIn).toBe(0); // fail fast: nothing reaches the DB
    expect(at(r, 15).edges?.edge_app_db?.errorRate).toBe(1);
    // Open 15–34 (20 s); half-open trial at 35 (DB still down) ⇒ open 36–55; trial at 56 ⇒ closed.
    expect(at(r, 34).edges?.edge_app_db?.breaker).toBe('open');
    expect(at(r, 35).edges?.edge_app_db?.breaker).toBe('half-open');
    expect(at(r, 36).edges?.edge_app_db?.breaker).toBe('open');
    expect(at(r, 55).availability).toBe(0); // still open after the DB is back (40 s)
    expect(at(r, 56).edges?.edge_app_db?.breaker).toBe('half-open');
    expect(at(r, 56).availability).toBeCloseTo(1, 9);
    expect(at(r, 57).edges?.edge_app_db?.breaker).toBe('closed');
    const kinds = r.timelineEvents?.map((m) => `${m.tSec}:${m.kind}`);
    expect(kinds).toEqual(
      expect.arrayContaining(['14:breaker-open', '35:breaker-open', '56:breaker-close']),
    );
  });
});

describe('other chaos events', () => {
  const single: Graph = {
    nodes: [node('client', 'client.test'), node('app', 'compute.reject')],
    edges: [edge('client', 'app')],
    groups: [],
  };

  it('traffic spike: reject node error = 1 − capacity/λ; retries turn it into a retry storm', () => {
    // 80 rps × 1.5 = 120 rps on μ = 100 ⇒ error 1 − 100/120.
    const r = run(single, 80, [
      ev({ kind: 'trafficSpike', multiplier: 1.5, atSec: 10, durationSec: 10 }),
    ]);
    expect(at(r, 9).rps).toBeCloseTo(80, 9);
    expect(at(r, 10).rps).toBeCloseTo(120, 9);
    expect(at(r, 10).availability).toBeCloseTo(100 / 120, 6);
    expect(at(r, 20).availability).toBeCloseTo(1, 9);

    const g = structuredClone(single);
    g.edges[0] = { ...g.edges[0]!, config: { retries: 3 } };
    const rs = run(g, 80, [
      ev({ kind: 'trafficSpike', multiplier: 1.5, atSec: 10, durationSec: 10 }),
    ]);
    const p = at(rs, 10);
    const e = p.edges!.edge_client_app!;
    // Fixed point f = 1 − 100/(120·A(f)), A = (1 − f⁴)/(1 − f): calls more than double.
    const f = e.errorRate;
    const A = (1 - f ** 4) / (1 - f);
    expect(e.rps).toBeCloseTo(120 * A, 3);
    expect(f).toBeCloseTo(1 - 100 / (120 * A), 3);
    expect(A).toBeGreaterThan(2);
    // Retries barely help: success = 1 − f⁴ while the server does 2× the work.
    expect(p.availability).toBeCloseTo(1 - f ** 4, 6);
    expect(rs.findings.some((x) => x.title === 'Retry storm')).toBe(true);
    expect(at(rs, 20).availability).toBeCloseTo(1, 9); // fast rejects: no lasting storm
  });

  it('dependency slow: service time × factor halves capacity, so ρ doubles', () => {
    const g: Graph = {
      nodes: [node('client', 'client.test'), node('app', 'compute.mm1')],
      edges: [edge('client', 'app')],
      groups: [],
    };
    const r = run(g, 40, [ev({ kind: 'dependencySlow', nodeId: 'node_app', factor: 2, atSec: 5 })]);
    expect(at(r, 4).nodes?.node_app?.utilization).toBeCloseTo(0.4, 9);
    expect(at(r, 5).nodes?.node_app?.utilization).toBeCloseTo(0.8, 9);
    // M/M/1: T = 1/(μ − λ): 1/(100 − 40) = 16.67 ms → 1/(50 − 40) = 100 ms; p99 = T ln 100.
    expect(at(r, 5).nodes?.node_app?.p99Ms).toBeCloseTo(100 * Math.log(100), 6);
    expect(at(r, 5).nodes?.node_app?.state).toBe('degraded');
  });

  it('disk full: writes fail, reads still work', () => {
    const g: Graph = {
      nodes: [node('client', 'client.test'), node('db', 'database.test')],
      edges: [edge('client', 'db')],
      groups: [],
    };
    const sc = scenario(
      10,
      [flow('r', ['client', 'db'], 'read', 1, 0.5), flow('w', ['client', 'db'], 'write', 1, 0.5)],
      {
        events: [ev({ kind: 'diskFull', nodeId: 'node_db', atSec: 3, durationSec: 4 })],
        durationSec: 10,
      },
    );
    const r = simulate({ graph: g, scenario: sc }, testRegistry);
    expect(at(r, 2).availability).toBeCloseTo(1, 9);
    expect(at(r, 3).availability).toBeCloseTo(0.5, 9);
    expect(at(r, 3).nodes?.node_db?.errorRate).toBeCloseTo(0.5, 9);
    expect(at(r, 7).availability).toBeCloseTo(1, 9);
  });

  it('hot key: the hottest shard takes `share` of the traffic', () => {
    // 2 shards, 100 rps: even ⇒ 50 per shard (ρ 0.5); a 0.8 hot key ⇒ hottest 80 rps (ρ 0.8).
    const g: Graph = {
      nodes: [node('client', 'client.test'), node('db', 'database.sharded', 1, { shards: 2 })],
      edges: [edge('client', 'db')],
      groups: [],
    };
    const r = run(g, 100, [ev({ kind: 'hotKey', nodeId: 'node_db', share: 0.8, atSec: 5 })]);
    expect(at(r, 4).nodes?.node_db?.utilization).toBeCloseTo(0.5, 9);
    expect(at(r, 5).nodes?.node_db?.utilization).toBeCloseTo(0.8, 9);
    const unsharded = run(single, 10, [
      ev({ kind: 'hotKey', nodeId: 'node_app', share: 0.9, atSec: 1 }),
    ]);
    expect(unsharded.findings.some((f) => f.title === 'Hot key on an unsharded node')).toBe(true);
  });

  it('latency injection and packet loss add fixed time to the path', () => {
    const r = run(single, 10, [
      ev({
        id: 'evt_lat',
        kind: 'latencyInjection',
        addedMs: 100,
        edgeId: 'edge_client_app',
        atSec: 5,
        durationSec: 5,
      }),
      ev({ id: 'evt_loss', kind: 'packetLoss', lossRate: 0.02, atSec: 20, durationSec: 5 }),
    ]);
    const base = at(r, 0).p50Ms;
    expect(at(r, 5).p50Ms - base).toBeCloseTo(100, 6);
    expect(at(r, 20).p50Ms - base).toBeCloseTo(packetLossDelayMs(0.02, 11_000), 6);
    expect(at(r, 5).activeEventIds).toEqual(['evt_lat']);
    expect(at(r, 30).p50Ms).toBeCloseTo(base, 9);
  });

  it('cold start burst: extra wait fades from coldStartMs to 0 over the window', () => {
    const r = run(single, 10, [
      ev({ kind: 'coldStartBurst', atSec: 10, addedMs: 600, durationSec: 30 }),
    ]);
    const base = at(r, 0).p50Ms;
    expect(at(r, 10).p50Ms - base).toBeCloseTo(600, 6);
    expect(at(r, 25).p50Ms - base).toBeCloseTo(300, 6);
    expect(at(r, 40).p50Ms).toBeCloseTo(base, 9);
  });

  it('timeouts turn a slow dependency into errors: P(timeout) = e^(−τ/T̄)', () => {
    const g = structuredClone(single);
    g.edges[0] = { ...g.edges[0]!, config: { timeoutMs: 200 } };
    const r = run(g, 10, [
      ev({ kind: 'latencyInjection', addedMs: 190, nodeId: 'node_app', atSec: 5 }),
    ]);
    // T̄ = 1/(μ − λ) + 190 = 1/90 s + 190 ms = 201.11 ms.
    const T = 1000 / 90 + 190;
    expect(at(r, 5).availability).toBeCloseTo(1 - Math.exp(-200 / T), 6);
  });
});

describe('regions: DNS failover and partitions', () => {
  // Two stacks in us-east and eu-west; North America users. us-east dies at t = 10.
  const region = (id: string, regionId: string): Group => ({
    id,
    kind: 'region',
    label: regionId,
    regionId,
  });
  const g: Graph = {
    nodes: [
      node('client', 'client.test'),
      { ...node('app_us', 'compute.mm1'), groupId: 'grp_us' },
      { ...node('app_eu', 'compute.mm1'), groupId: 'grp_eu' },
    ],
    edges: [edge('client', 'app_us'), edge('client', 'app_eu')],
    groups: [region('grp_us', 'us-east'), region('grp_eu', 'eu-west')],
  };

  it('users fail until the DNS TTL (60 s) passes, then are served from the other region', () => {
    const r = run(
      g,
      10,
      [ev({ kind: 'regionOutage', regionId: 'us-east', atSec: 10 })],
      { durationSec: 100 },
      geoTestRegistry,
    );
    expect(at(r, 9).availability).toBeCloseTo(1, 9);
    expect(at(r, 10).availability).toBe(0);
    expect(at(r, 69).availability).toBe(0);
    expect(at(r, 70).availability).toBeCloseTo(1, 9);
    expect(at(r, 70).p50Ms).toBeGreaterThan(at(r, 9).p50Ms + 50); // farther away now
    expect(r.timelineEvents?.some((m) => m.kind === 'failover' && m.tSec === 70)).toBe(true);
  });

  it('a partition cuts calls between the two regions', () => {
    const gp: Graph = {
      nodes: [
        node('client', 'client.test'),
        { ...node('app', 'compute.mm1'), groupId: 'grp_us' },
        { ...node('db', 'database.test'), groupId: 'grp_eu' },
      ],
      edges: [edge('client', 'app'), edge('app', 'db')],
      groups: [region('grp_us', 'us-east'), region('grp_eu', 'eu-west')],
    };
    const r = run(
      gp,
      5,
      [
        ev({
          kind: 'networkPartition',
          regionA: 'eu-west',
          regionB: 'us-east',
          atSec: 5,
          durationSec: 5,
        }),
      ],
      {},
      geoTestRegistry,
    );
    expect(at(r, 4).availability).toBeCloseTo(1, 9);
    expect(at(r, 5).availability).toBe(0);
    expect(at(r, 5).nodes?.node_db?.rpsIn).toBe(0);
    expect(at(r, 10).availability).toBeCloseTo(1, 9);
  });
});

describe('timeline plumbing', () => {
  it('no events ⇒ no timeline; analytical numbers unchanged', () => {
    const r = run(twoAz(), 60, []);
    expect(r.timeline).toBeUndefined();
    expect(r.timelineEvents).toBeUndefined();
  });

  it('is deterministic and coarsens ticks for long runs', () => {
    const e = [ev({ kind: 'nodeOutage', nodeId: 'node_app_a', atSec: 100 })];
    const a = run(twoAz(), 60, e, { durationSec: 1800 });
    const b = run(twoAz(), 60, e, { durationSec: 1800 });
    expect(a).toEqual(b);
    expect(a.timeline).toHaveLength(600);
    expect(a.timeline?.[1]?.tSec).toBe(3);
  });

  it('can be turned off with options.timeline = false', () => {
    const sc = scenario(60, [], {
      events: [ev({ kind: 'nodeOutage', nodeId: 'node_app_a', atSec: 1 })],
    });
    expect(
      simulate({ graph: twoAz(), scenario: sc }, testRegistry, { timeline: false }).timeline,
    ).toBeUndefined();
  });
});
