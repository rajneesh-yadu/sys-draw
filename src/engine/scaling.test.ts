/**
 * S09 — scaling and cost through the whole pipeline. Expected values are computed by hand
 * (derivations inline). Test components: mm1/mm2 S = 10 ms (μ = 100 rps per server);
 * database.primary is single-writer, database.sharded is not (both μ = 100); lb S = 1 ms.
 */
import { describe, expect, it } from 'vitest';
import { SimResultSchema, type EdgeInstance, type Graph, type NodeInstance } from '@/core';
import { registry } from '@/registry';
import { consistentHashImbalance } from './scaling/pools';
import { simulate } from './simulate';
import { edge, flow, graph, node, scenario, testRegistry as reg } from './test-fixtures';

function within(actual: number | undefined, expected: number, tol = 0.01) {
  expect(actual).toBeDefined();
  const a = actual as number;
  const err = expected === 0 ? Math.abs(a) : Math.abs(a - expected) / Math.abs(expected);
  expect(err, `${a} vs ${expected}`).toBeLessThanOrEqual(tol);
}

/** client → db with one flow of `rps` requests per second (users = rps, 1 rps per user). */
function store(
  defId: string,
  rps: number,
  op: 'read' | 'write',
  config = {},
  replicas = 1,
  instanceType = 'std',
) {
  const g = graph(
    [node('c', 'client.test'), node('db', defId, replicas, config, instanceType)],
    [edge('c', 'db')],
  );
  const r = simulate({ graph: g, scenario: scenario(rps, [flow('f', ['c', 'db'], op)]) }, reg);
  expect(SimResultSchema.safeParse(r).success).toBe(true);
  return r.perNode.node_db!;
}

describe('single-writer database: replicas add read capacity only', () => {
  it('write throughput does not grow with read replicas', () => {
    // 80 writes/s all land on the primary (μ = 100): ρ = 0.8 with 0, 3 or 7 read replicas.
    for (const readReplicas of [0, 3, 7]) {
      within(store('database.primary', 80, 'write', { readReplicas }).utilization, 0.8);
    }
    // replicas (scale-out) are read replicas too — still no write gain.
    within(store('database.primary', 80, 'write', {}, 4).utilization, 0.8);
  });

  it('at 150 writes/s the primary saturates no matter how many replicas', () => {
    for (const readReplicas of [0, 5]) {
      const s = store('database.primary', 150, 'write', { readReplicas });
      within(s.utilization, 1.5);
      expect(s.explain.writeCapacity).toContain('whatever the number of read replicas');
    }
  });

  it('read throughput grows with read replicas', () => {
    // 240 reads/s: alone ρ = 2.4; with 2 replicas each of 3 instances gets 80 ⇒ ρ = 0.8.
    within(store('database.primary', 240, 'read').utilization, 2.4);
    within(store('database.primary', 240, 'read', { readReplicas: 2 }).utilization, 0.8);
  });

  it('mixed load: primary carries writes + its share of reads', () => {
    // 60 reads + 40 writes, 1 replica: primary λ = 30 + 40 = 70 (ρ 0.7), replica λ = 30 (ρ 0.3).
    // M/M/1 Wq = λ/(μ(μ−λ)): primary 70/(100·30) s = 23.333 ms, replica 30/(100·70) s = 4.2857 ms.
    // Read T = 10 + (23.333 + 4.2857)/2 = 23.810 ms; write T = 33.333 ms; mean = 27.619 ms.
    const g = graph(
      [node('c', 'client.test'), node('db', 'database.primary', 1, { readReplicas: 1 })],
      [edge('c', 'db')],
    );
    const sc = scenario(1, [
      { ...flow('r', ['c', 'db'], 'read', 60) },
      { ...flow('w', ['c', 'db'], 'write', 40) },
    ]);
    const r = simulate({ graph: g, scenario: sc }, reg);
    const db = r.perNode.node_db!;
    within(db.utilization, 0.7);
    within(r.perFlow.flow_r?.p50, 23.8095 * Math.LN2);
    within(r.perFlow.flow_w?.p50, 33.3333 * Math.LN2);
    within(db.latencyMs.p50, 27.619 * Math.LN2);
    // Lq = λ·Wq: 70 × 0.023333 + 30 × 0.0042857 = 1.6333 + 0.12857
    within(db.queueDepth, 1.7619);
  });

  it('sharding is what scales writes (and a bigger primary, sublinearly)', () => {
    // 150 writes over 2 shards = 75 each ⇒ ρ 0.75.
    within(store('database.primary', 150, 'write', { shards: 2 }).utilization, 0.75);
    // big = 4× vCPU ⇒ μ × 1/(0.1 + 0.9/4) = 3.0769 ⇒ ρ = 150 / 307.69 = 0.4875.
    within(store('database.primary', 150, 'write', {}, 1, 'big').utilization, 0.4875);
  });
});

describe('sharding with key skew', () => {
  it('even shards divide load; a hot key caps the gain', () => {
    // 160 rps over 4 even shards: 40 each ⇒ ρ 0.4.
    within(store('database.sharded', 160, 'read', { shards: 4 }).utilization, 0.4);
    // skew 0.5: the hot shard gets 80 ⇒ ρ 0.8, and doubling shards keeps it at 0.8.
    within(store('database.sharded', 160, 'read', { shards: 4, keySkew: 0.5 }).utilization, 0.8);
    within(store('database.sharded', 160, 'read', { shards: 8, keySkew: 0.5 }).utilization, 0.8);
    // writes are sharded too (not single-writer)
    within(store('database.sharded', 160, 'write', { shards: 4 }).utilization, 0.4);
  });
});

describe('load-balancer algorithms', () => {
  const lbGraph = (config: Record<string, unknown>, targets: NodeInstance[]) =>
    graph(
      [node('c', 'client.test'), node('lb', 'network.lb', 1, config), ...targets],
      [edge('c', 'lb'), ...targets.map((t) => edge('lb', t.id.slice(5)))],
    );
  const run = (g: Graph, users: number) =>
    simulate({ graph: g, scenario: scenario(users, [], {}) }, reg, { defaultRpsPerUser: 1 });

  it('consistent hashing overloads the hottest replica by f = 1 + √(2 ln N / V)', () => {
    // 160 rps over 2 replicas: avg 80; hottest gets 80 × 1.117741 = 89.42 ⇒ ρ 0.8942.
    const rr = run(lbGraph({ algorithm: 'round-robin' }, [node('s', 'compute.mm1', 2)]), 160);
    within(rr.perNode.node_s?.utilization, 0.8);
    const ch = run(
      lbGraph({ algorithm: 'consistent-hash', virtualNodes: 100 }, [node('s', 'compute.mm1', 2)]),
      160,
    );
    within(ch.perNode.node_s?.utilization, 0.8 * consistentHashImbalance(2, 100));
    expect(ch.perNode.node_s?.explain.scaling).toContain('consistent hashing');
    // More ring points ⇒ more even.
    const ch1000 = run(
      lbGraph({ algorithm: 'consistent-hash', virtualNodes: 1000 }, [node('s', 'compute.mm1', 2)]),
      160,
    );
    expect(ch1000.perNode.node_s!.utilization).toBeLessThan(ch.perNode.node_s!.utilization);
  });

  it('round-robin splits by instance count; least-connections by capacity', () => {
    // Targets: mm1 (c = 1, 100 rps) and mm2 (c = 2, 200 rps); 160 rps.
    const targets = [node('a', 'compute.mm1'), node('b', 'compute.mm2')];
    const rr = run(lbGraph({ algorithm: 'round-robin' }, targets), 160);
    within(rr.perNode.node_a?.rpsIn, 80);
    within(rr.perNode.node_a?.utilization, 0.8);
    within(rr.perNode.node_b?.utilization, 0.4);
    // least-connections: shares 100 : 200 ⇒ 53.33 and 106.67 rps ⇒ both ρ = 0.5333.
    const lc = run(lbGraph({ algorithm: 'least-connections' }, targets), 160);
    within(lc.perNode.node_a?.rpsIn, 53.333);
    within(lc.perNode.node_a?.utilization, 0.53333);
    within(lc.perNode.node_b?.utilization, 0.53333);
  });
});

describe('autoscaling (steady state in the analytical run)', () => {
  const withPolicy = (min: number, max: number) => ({
    ...node('s', 'compute.mm1'),
    scaling: {
      replicas: 1,
      instanceType: 'std',
      autoscale: { min, max, targetUtil: 0.5, warmupSec: 60 },
    },
  });
  const run = (n: NodeInstance) =>
    simulate(
      {
        graph: graph([node('c', 'client.test'), n], [edge('c', 's')]),
        scenario: scenario(160, [flow('f', ['c', 's'])]),
      },
      reg,
    ).perNode.node_s!;

  it('holds the target: 160 rps, μ 100, target 50 % ⇒ ⌈1.6/0.5⌉ = 4 replicas, ρ 0.4', () => {
    const s = run(withPolicy(1, 10));
    within(s.utilization, 0.4);
    expect(s.explain.scaling).toContain('replicas = 4');
    within(s.costPerMonth, 4 * 0.1 * 730);
  });

  it('is capped by max (and says so)', () => {
    const s = run(withPolicy(1, 2));
    within(s.utilization, 0.8);
    expect(s.explain.scaling).toContain('capped at max');
  });

  it('never goes below min', () => {
    within(run(withPolicy(8, 10)).utilization, 0.2);
  });
});

describe('cost model', () => {
  it('instance-priced: instances × $/h × 730', () => {
    // 2 replicas × $0.1/h × 730 = $146; big = $0.4/h.
    within(store('compute.mm1', 10, 'read', {}, 2).costPerMonth, 146);
    within(store('compute.mm1', 10, 'read', {}, 1, 'big').costPerMonth, 292);
  });

  it('single-writer store: primary + replicas + standby, storage per copy', () => {
    // 1 primary + 2 replicas + 1 standby = 4 × $0.1 × 730 = $292; storage 100 GB × 4 copies × $0.023 = $9.2.
    const s = store('database.primary', 10, 'read', {
      readReplicas: 2,
      standby: true,
      storageGb: 100,
    });
    within(s.costPerMonth, 292 + 9.2);
    expect(s.explain.costPerMonth).toContain('storage');
  });

  it('pay-per-request: average requests per month × $/million (+ storage)', () => {
    // λ 100 at peak ×2 ⇒ avg 50 rps × 2 628 000 s = 131.4 M × $0.4 = $52.56; 1000 GB × $0.023 = $23.
    const g = graph(
      [node('c', 'client.test'), node('o', 'storage.managed', 1, {}, 'managed')],
      [edge('c', 'o')],
    );
    const r = simulate(
      { graph: g, scenario: scenario(50, [flow('f', ['c', 'o'])], { peakMultiplier: 2 }) },
      reg,
    );
    within(r.perNode.node_o?.costPerMonth, 52.56 + 23);
    within(r.system.costPerMonth, 75.56);
  });

  it('platform-scaled: busy instances by Little’s law, at least the provisioned ones', () => {
    // λ 100 × S 30 ms = 3 busy instances × $0.1 × 730 = $219; with 5 warm: 5 × 73 = $365.
    within(store('compute.fn', 100, 'read').costPerMonth, 219);
    within(store('compute.fn', 100, 'read', { warm: 5 }).costPerMonth, 365);
    // Utilisation = λ / (limit × μ) = 100 / (10 × 33.33) = 0.3
    within(store('compute.fn', 100, 'read').utilization, 0.3);
  });

  it('system cost is the sum of node costs; clients are free', () => {
    const g = graph(
      [node('c', 'client.test'), node('lb', 'network.lb'), node('s', 'compute.mm1', 3)],
      [edge('c', 'lb'), edge('lb', 's')],
    );
    const r = simulate({ graph: g, scenario: scenario(10, [flow('f', ['c', 'lb', 's'])]) }, reg);
    expect(r.perNode.node_c?.costPerMonth).toBe(0);
    within(r.system.costPerMonth, 73 + 219);
  });
});

// ---------- F6 acceptance on the real registry ----------

function realGraph(replicas: number, instanceType: string): Graph {
  const n = (id: string, defId: string, type: string, rep = 1): NodeInstance => ({
    id,
    defId,
    label: id,
    position: { x: 0, y: 0 },
    config: {},
    scaling: { replicas: rep, instanceType: type },
  });
  const e = (id: string, s: string, t: string): EdgeInstance => ({
    id,
    source: s,
    target: t,
    protocolStack: ['tcp', 'http2'],
    sync: true,
    config: {},
  });
  return {
    groups: [],
    nodes: [
      n('node_c', 'client.app', 'browser'),
      n('node_lb', 'network.load-balancer', 'standard'),
      n('node_a', 'compute.app-server', instanceType, replicas),
    ],
    edges: [e('edge_1', 'node_c', 'node_lb'), e('edge_2', 'node_lb', 'node_a')],
  };
}

describe('F6 acceptance (app registry)', () => {
  // 60 000 users × 0.1 rps = 6 000 rps; app server small: 200 workers / 20 ms = 10 000 rps.
  const run = (replicas: number, type: string) =>
    simulate(
      { graph: realGraph(replicas, type), scenario: scenario(60_000), providerId: 'generic' },
      registry,
    ).perNode.node_a!;

  it('doubling replicas behind an LB halves utilisation', () => {
    const one = run(1, 'small');
    const two = run(2, 'small');
    within(one.utilization, 0.6);
    within(two.utilization, one.utilization / 2);
    within(two.costPerMonth, 2 * one.costPerMonth);
  });

  it('changing instance size changes capacity and cost', () => {
    const small = run(1, 'small');
    const medium = run(1, 'medium');
    // medium = 2× vCPU, app servers are sublinear: f(2) = 1/(0.1 + 0.45) = 1.818 ⇒ ρ 0.6/1.818 = 0.33
    within(medium.utilization, 0.33);
    expect(medium.explain.scaling).toContain('Amdahl');
    // $0.096/h vs $0.192/h × 730
    within(small.costPerMonth, 70.08);
    within(medium.costPerMonth, 140.16);
  });

  it('SQL with Multi-AZ and a read replica is priced per instance and copy', () => {
    const g: Graph = {
      groups: [],
      nodes: [
        {
          id: 'node_c',
          defId: 'client.app',
          label: 'c',
          position: { x: 0, y: 0 },
          config: {},
          scaling: { replicas: 1, instanceType: 'browser' },
        },
        {
          id: 'node_db',
          defId: 'database.sql',
          label: 'db',
          position: { x: 0, y: 0 },
          config: { readReplicas: 1, multiAz: true, storageGb: 100 },
          scaling: { replicas: 1, instanceType: 'medium' },
        },
      ],
      edges: [
        {
          id: 'edge_1',
          source: 'node_c',
          target: 'node_db',
          protocolStack: ['tcp'],
          sync: true,
          config: {},
        },
      ],
    };
    const r = simulate({ graph: g, scenario: scenario(100), providerId: 'generic' }, registry);
    // 3 instances (primary, replica, standby) × $0.192 × 730 = $420.48; 100 GB × 3 × $0.023 = $6.90
    within(r.perNode.node_db?.costPerMonth, 427.38);
    within(r.system.costPerMonth, 427.38); // the client is free
  });
});
