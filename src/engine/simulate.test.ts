/**
 * S07 acceptance: hand-computed values must match within 1%.
 * Test components (test-fixtures.ts): mm1 S=10 ms c=1 (μ=100); lb S=1 ms (μ=1000);
 * app S=2 ms (μ=500); cache S=0.5 ms (μ=2000); database S=20 ms (μ=50).
 */
import { describe, expect, it } from 'vitest';
import { SimResultSchema, type SimResult } from '@/core';
import { simulate } from './simulate';
import { INFERRED_FLOW_ID } from './model/load';
import { edge, flow, graph, node, scenario, testRegistry as reg } from './test-fixtures';

function within(actual: number | undefined, expected: number, tol = 0.01) {
  expect(actual).toBeDefined();
  const a = actual as number;
  const err = expected === 0 ? Math.abs(a) : Math.abs(a - expected) / Math.abs(expected);
  expect(err, `${a} vs ${expected}`).toBeLessThanOrEqual(tol);
}

const LN2 = Math.LN2;
const LN20 = Math.log(20);
const LN100 = Math.log(100);
const one = { defaultRpsPerUser: 1 };

function valid(r: SimResult) {
  expect(SimResultSchema.safeParse(r).success).toBe(true);
  return r;
}

describe('single server', () => {
  // λ = 100 users × 0.5 rps = 50 rps; μ = 100 ⇒ ρ = 0.5, Wq = 10 ms, T = 20 ms
  const g = graph([node('c', 'client.test'), node('s', 'compute.mm1')], [edge('c', 's')]);
  const sc = scenario(100, [flow('f', ['c', 's'], 'read', 0.5)]);
  const r = valid(simulate({ graph: g, scenario: sc }, reg));
  const s = r.perNode.node_s;

  it('utilisation, queue and response time', () => {
    within(s?.utilization, 0.5);
    within(s?.rpsIn, 50);
    within(s?.queueDepth, 0.5); // Lq = λ·Wq = 50 × 0.010
    within(s?.latencyMs.p50, 20 * LN2);
    within(s?.latencyMs.p95, 20 * LN20);
    within(s?.latencyMs.p99, 20 * LN100);
  });

  it('flow latency equals the single stage (client adds nothing)', () => {
    const f = r.perFlow.flow_f;
    within(f?.p50, 13.8629);
    within(f?.p99, 92.1034);
    within(f?.rps, 50);
    expect(f?.errorRate).toBe(0);
    within(r.perEdge.edge_c_s?.rps, 50);
    within(r.perEdge.edge_c_s?.bytesPerSec, 50 * 11_000);
    expect(r.system.rps).toBe(50);
    expect(r.system.availability).toBe(1);
  });

  it('explains its numbers', () => {
    expect(s?.explain.utilization).toContain('ρ = λ/(c·μ)');
    expect(s?.explain.latencyMs).toContain('Wq');
  });

  it('M/M/2 instance: Erlang C', () => {
    // λ = 150, μ = 100, c = 2 ⇒ C = 0.642857, Wq = 12.857 ms, T = 22.857 ms
    const g2 = graph([node('c', 'client.test'), node('s', 'compute.mm2')], [edge('c', 's')]);
    const r2 = simulate({ graph: g2, scenario: scenario(150, [flow('f', ['c', 's'])]) }, reg);
    within(r2.perNode.node_s?.utilization, 0.75);
    within(r2.perNode.node_s?.latencyMs.p50, 22.857142857 * LN2);
    within(r2.perNode.node_s?.queueDepth, 1.928571);
  });
});

describe('2 replicas behind a load balancer', () => {
  // λ = 160. LB: μ = 1000, ρ = 0.16, T = 1/(1000−160) s = 1.190476 ms.
  // Servers: 80 rps per replica, ρ = 0.8, T = 1/(100−80) s = 50 ms, Lq = 0.8²/0.2 = 3.2 per replica.
  // Flow: mean 51.190476; θ = √(50² + 1.190476²) = 50.01417; pq = mean + θ(ln(1/(1−q)) − 1)
  const expected = { p50: 35.843487, p95: 151.00537, p99: 231.500072 };

  it('one node with replicas: 2', () => {
    const g = graph(
      [node('c', 'client.test'), node('lb', 'network.lb'), node('s', 'compute.mm1', 2)],
      [edge('c', 'lb'), edge('lb', 's')],
    );
    const r = valid(simulate({ graph: g, scenario: scenario(160) }, reg, one));
    within(r.perNode.node_lb?.utilization, 0.16);
    within(r.perNode.node_lb?.latencyMs.p50, 1.190476 * LN2);
    within(r.perNode.node_s?.utilization, 0.8);
    within(r.perNode.node_s?.rpsIn, 160);
    within(r.perNode.node_s?.queueDepth, 6.4);
    within(r.perNode.node_s?.latencyMs.p99, 50 * LN100);
    const f = r.perFlow[INFERRED_FLOW_ID];
    within(f?.p50, expected.p50);
    within(f?.p95, expected.p95);
    within(f?.p99, expected.p99);
    expect(r.system.bottlenecks).toEqual([]);
  });

  it('two separate target nodes split evenly', () => {
    const g = graph(
      [
        node('c', 'client.test'),
        node('lb', 'network.lb'),
        node('s1', 'compute.mm1'),
        node('s2', 'compute.mm1'),
      ],
      [edge('c', 'lb'), edge('lb', 's1'), edge('lb', 's2')],
    );
    const r = simulate({ graph: g, scenario: scenario(160) }, reg, one);
    within(r.perNode.node_s1?.rpsIn, 80);
    within(r.perNode.node_s2?.utilization, 0.8);
    within(r.perEdge.edge_lb_s1?.rps, 80);
    const f = r.perFlow[INFERRED_FLOW_ID];
    within(f?.p50, expected.p50);
    within(f?.p99, expected.p99);
  });

  it('halving replicas doubles utilisation and saturates the server', () => {
    const g = graph(
      [node('c', 'client.test'), node('lb', 'network.lb'), node('s', 'compute.mm1', 1)],
      [edge('c', 'lb'), edge('lb', 's')],
    );
    const r = valid(simulate({ graph: g, scenario: scenario(160) }, reg, one));
    within(r.perNode.node_s?.utilization, 1.6);
    expect(r.system.bottlenecks).toEqual(['node_s']);
    expect(r.perNode.node_s?.explain.saturation).toContain('queue');
  });
});

describe('cache in front of a database', () => {
  // λ = 100 reads, hit rate 0.9.
  // app ρ = 0.2, T = 2/0.8 = 2.5 ms; cache ρ = 0.05, T = 0.5/0.95 = 0.526316 ms;
  // db gets λ(1−h) = 10 rps, ρ = 0.2, T = 20/0.8 = 25 ms.
  // mean = 2.5 + 0.526316 + 0.1 × 25 = 5.526316 ms. Percentiles: mixture of
  // hit (p 0.9: app+cache) and miss (p 0.1: app+cache+db), each shift+Exp(√ΣT²).
  const expected = { p50: 2.54328, p95: 20.494237, p99: 60.760541 };

  function check(r: SimResult, flowId: string) {
    valid(r);
    within(r.perNode.node_db?.rpsIn, 10);
    within(r.perNode.node_db?.utilization, 0.2);
    within(r.perNode.node_cache?.rpsIn, 100);
    within(r.perNode.node_cache?.hitRate, 0.9);
    within(r.perNode.node_app?.utilization, 0.2);
    const f = r.perFlow[flowId];
    within(f?.p50, expected.p50);
    within(f?.p95, expected.p95);
    within(f?.p99, expected.p99);
  }

  const nodes = [
    node('c', 'client.test'),
    node('app', 'compute.app'),
    node('cache', 'cache.test', 1, { hitRate: 0.9 }),
    node('db', 'database.test'),
  ];

  it('cache-aside (app → cache, app → db)', () => {
    const g = graph(nodes, [edge('c', 'app'), edge('app', 'cache'), edge('app', 'db')]);
    const r = simulate({ graph: g, scenario: scenario(100) }, reg, one);
    check(r, INFERRED_FLOW_ID);
    within(r.perEdge.edge_app_db?.rps, 10);
    within(r.perEdge.edge_app_cache?.rps, 100);
  });

  it('read-through (app → cache → db)', () => {
    const g = graph(nodes, [edge('c', 'app'), edge('app', 'cache'), edge('cache', 'db')]);
    check(simulate({ graph: g, scenario: scenario(100) }, reg, one), INFERRED_FLOW_ID);
  });

  it('explicit flow path', () => {
    const g = graph(nodes, [edge('c', 'app'), edge('app', 'cache'), edge('app', 'db')]);
    const sc = scenario(100, [flow('read', ['c', 'app', 'cache', 'db'])]);
    check(simulate({ graph: g, scenario: sc }, reg), 'flow_read');
  });

  it('without the cache the database saturates', () => {
    const g = graph(
      [node('c', 'client.test'), node('app', 'compute.app'), node('db', 'database.test')],
      [edge('c', 'app'), edge('app', 'db')],
    );
    const r = simulate({ graph: g, scenario: scenario(100) }, reg, one);
    within(r.perNode.node_db?.utilization, 2);
    expect(r.system.bottlenecks).toEqual(['node_db']);
  });

  it('writes go through the cache to the database', () => {
    const g = graph(nodes, [edge('c', 'app'), edge('app', 'cache'), edge('app', 'db')]);
    const sc = scenario(10, [flow('w', ['c', 'app', 'cache', 'db'], 'write')]);
    within(simulate({ graph: g, scenario: sc }, reg).perNode.node_db?.rpsIn, 10);
  });

  it('defaults to a fixed 80% hit rate', () => {
    const g = graph(
      [
        node('c', 'client.test'),
        node('app', 'compute.app'),
        node('cache', 'cache.test'),
        node('db', 'database.test'),
      ],
      [edge('c', 'app'), edge('app', 'cache'), edge('app', 'db')],
    );
    const r = simulate({ graph: g, scenario: scenario(100) }, reg, one);
    within(r.perNode.node_db?.rpsIn, 20);
    within(r.perNode.node_cache?.hitRate, 0.8);
  });
});

describe('queue (async edges)', () => {
  const nodes = [
    node('c', 'client.test'),
    node('app', 'compute.app'),
    node('q', 'messaging.queue'),
    node('w', 'compute.mm1'),
  ];
  const edges = [edge('c', 'app'), edge('app', 'q', false), edge('q', 'w')];
  // λ = 50: app T = 2/0.9 = 2.2222 ms; queue T = 1/0.95 = 1.05263 ms ⇒ mean 3.27485 ms.
  const mean = 3.274854;
  const theta = Math.hypot(2 / 0.9, 1 / 0.95);

  it('caller waits for the enqueue only; consumers still get the load', () => {
    const r = valid(simulate({ graph: graph(nodes, edges), scenario: scenario(50) }, reg, one));
    within(r.perNode.node_w?.rpsIn, 50);
    within(r.perNode.node_w?.utilization, 0.5);
    within(r.perFlow[INFERRED_FLOW_ID]?.p99, mean + theta * (LN100 - 1));
    expect(r.perNode.node_q?.explain.lag).toContain('no backlog');
  });

  it('backlog grows when consumers are too slow', () => {
    // λ = 150 > consumer capacity 100 ⇒ backlog = 50 × 60 s = 3000 messages (+ tiny Lq)
    const r = simulate({ graph: graph(nodes, edges), scenario: scenario(150) }, reg, one);
    within(r.perNode.node_q?.queueDepth, 3000);
  });

  it('explicit path: steps after a queue are off the critical path', () => {
    const sc = scenario(50, [flow('f', ['c', 'app', 'q', 'w'])]);
    const r = simulate({ graph: graph(nodes, edges), scenario: sc }, reg);
    within(r.perNode.node_w?.rpsIn, 50);
    within(r.perFlow.flow_f?.p50, mean + theta * (LN2 - 1));
  });

  it('a plain async edge is fire-and-forget', () => {
    const g = graph(
      [node('c', 'client.test'), node('app', 'compute.app'), node('w', 'compute.mm1')],
      [edge('c', 'app'), edge('app', 'w', false)],
    );
    const r = simulate({ graph: g, scenario: scenario(50) }, reg, one);
    within(r.perNode.node_w?.rpsIn, 50);
    within(r.perFlow[INFERRED_FLOW_ID]?.p50, (2 / 0.9) * LN2);
  });
});

describe('saturation and errors', () => {
  it('a rejecting node drops the excess and protects downstream', () => {
    // λ = 200, capacity 100 ⇒ error = 1 − 100/200 = 50%; the node behind it gets 100 rps.
    const g = graph(
      [node('c', 'client.test'), node('s', 'compute.reject'), node('d', 'compute.mm2')],
      [edge('c', 's'), edge('s', 'd')],
    );
    const r = valid(simulate({ graph: g, scenario: scenario(200) }, reg, one));
    within(r.perNode.node_s?.errorRate, 0.5);
    within(r.perNode.node_s?.rpsOut, 100);
    within(r.perNode.node_d?.rpsIn, 100);
    within(r.perFlow[INFERRED_FLOW_ID]?.errorRate, 0.5);
    within(r.system.availability, 0.5);
  });

  it('a queueing node at ρ > 1 reports finite latency growing with the backlog', () => {
    const g = graph([node('c', 'client.test'), node('s', 'compute.mm1')], [edge('c', 's')]);
    const run = (d: number) =>
      simulate({ graph: g, scenario: scenario(150, [], { durationSec: d }) }, reg, one);
    const short = run(10);
    const long = valid(run(60));
    expect(long.perNode.node_s?.latencyMs.p50).toBeGreaterThan(
      short.perNode.node_s?.latencyMs.p50 ?? Infinity,
    );
    within(long.perNode.node_s?.utilization, 1.5);
  });
});

describe('flow inference and robustness', () => {
  it('infers one read flow from client nodes: λ = users × default rps/user × peak', () => {
    const g = graph([node('c', 'client.test'), node('s', 'compute.mm1')], [edge('c', 's')]);
    const r = simulate({ graph: g, scenario: scenario(100, [], { peakMultiplier: 2 }) }, reg);
    // 100 users × 0.1 × 2 = 20 rps
    within(r.perFlow[INFERRED_FLOW_ID]?.rps, 20);
    within(r.perNode.node_s?.rpsIn, 20);
  });

  it('splits users across several clients', () => {
    const g = graph(
      [
        node('c1', 'client.test'),
        node('c2', 'client.test'),
        node('a', 'compute.mm1'),
        node('b', 'compute.mm1'),
      ],
      [edge('c1', 'a'), edge('c2', 'b')],
    );
    const r = simulate({ graph: g, scenario: scenario(100) }, reg, one);
    within(r.perNode.node_a?.rpsIn, 50);
    within(r.perNode.node_b?.rpsIn, 50);
  });

  it('starts at root nodes when there is no client', () => {
    const g = graph([node('a', 'compute.mm1'), node('b', 'compute.mm1')], [edge('a', 'b')]);
    const r = simulate({ graph: g, scenario: scenario(10) }, reg, one);
    within(r.perNode.node_b?.rpsIn, 10);
    expect(r.findings.some((f) => f.title === 'No client nodes')).toBe(true);
  });

  it('ignores cycles with a finding instead of looping', () => {
    const g = graph(
      [node('c', 'client.test'), node('a', 'compute.mm2'), node('b', 'compute.mm2')],
      [edge('c', 'a'), edge('a', 'b'), edge('b', 'a')],
    );
    const r = valid(simulate({ graph: g, scenario: scenario(10) }, reg, one));
    within(r.perNode.node_b?.rpsIn, 10);
    const cycle = r.findings.find((f) => f.title === 'Cycle in request path');
    expect(cycle?.targetIds).toEqual(['edge_b_a']);
  });

  it('unknown components pass through with a warning', () => {
    const g = graph(
      [node('c', 'client.test'), node('x', 'compute.nope'), node('s', 'compute.mm1')],
      [edge('c', 'x'), edge('x', 's')],
    );
    const r = valid(simulate({ graph: g, scenario: scenario(50) }, reg, one));
    within(r.perNode.node_s?.rpsIn, 50);
    expect(r.findings[0]?.targetIds).toEqual(['node_x']);
  });

  it('empty board', () => {
    const r = valid(simulate({ graph: graph([], []), scenario: scenario(100) }, reg));
    expect(r.system.rps).toBe(0);
    expect(r.perFlow[INFERRED_FLOW_ID]?.p99).toBe(0);
  });

  it('is deterministic', () => {
    const g = graph(
      [
        node('c', 'client.test'),
        node('lb', 'network.lb'),
        node('s', 'compute.mm1', 3),
        node('db', 'database.test'),
      ],
      [edge('c', 'lb'), edge('lb', 's'), edge('s', 'db')],
    );
    const input = { graph: g, scenario: scenario(30) };
    expect(simulate(input, reg)).toEqual(simulate(input, reg));
  });

  it('mixes reads and writes on one queue (S̄ weighted by rate)', () => {
    // db: 10 reads (20 ms) + 10 writes (40 ms) ⇒ S̄ = 30 ms, μ = 33.33, λ = 20 ⇒ ρ = 0.6
    // Wq = ρ·S̄/(1−ρ) = 0.6×30/0.4 = 45 ms ⇒ read T = 65 ms, write T = 85 ms
    const g = graph([node('c', 'client.test'), node('db', 'database.test')], [edge('c', 'db')]);
    const sc = scenario(10, [flow('r', ['c', 'db'], 'read'), flow('w', ['c', 'db'], 'write')]);
    const r = simulate({ graph: g, scenario: sc }, reg);
    within(r.perNode.node_db?.utilization, 0.6);
    within(r.perFlow.flow_r?.p50, 65 * LN2);
    within(r.perFlow.flow_w?.p50, 85 * LN2);
  });
});
