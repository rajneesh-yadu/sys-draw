/**
 * S15: one request end to end. Hand-computed with the S14 numbers:
 *   RTT North America → us-east = 38.795 ms (geo/geo.test.ts), NA last mile = 15 ms.
 *   compute.app: S_read = 2 ms, c = 1. 1000 NA users × 0.1 rps (inferred flow) = 100 rps,
 *   μ = 500 rps ⇒ ρ = 0.2, Wq = ρ·S/(1 − ρ) = 0.2 × 2 / 0.8 = 0.5 ms.
 *   Warm:  request RTT/2 + Wq 0.5 + S 2 + response RTT/2 = RTT + 2.5 ms.
 *   Cold:  + DNS 15 ms + TCP 1 RTT + TLS 1.3 1 RTT (HTTP/2 negotiates in TLS: 0 RTT).
 */
import { describe, expect, it } from 'vitest';
import type { EdgeInstance, Graph } from '@/core';
import { createRegistry, registry as appRegistry, type Registry } from '@/registry';
import { simulate } from '../simulate';
import { edge, flow, geoTestRegistry, graph, node, scenario } from '../test-fixtures';
import { TRACE_CATEGORIES, TRACE_DNS_ID, traceRequest, traceRegions } from './trace';

const RTT = 38.79453463411909;
const WQ = 0.5;
const S = 2;

const reg: Registry = createRegistry([
  ...geoTestRegistry
    .list()
    .map((entry) => ({ kind: geoTestRegistry.kindOf(entry.id)!, entry, source: 'test' })),
  ...appRegistry
    .list({ kind: 'protocol' })
    .map((entry) => ({ kind: 'protocol' as const, entry, source: 'test' })),
] as Parameters<typeof createRegistry>[0]);

function board(stack: string[], config: EdgeInstance['config'] = {}): Graph {
  return {
    nodes: [node('c', 'client.test'), { ...node('app', 'compute.app'), groupId: 'grp_use' }],
    edges: [{ ...edge('c', 'app'), protocolStack: stack, config }],
    groups: [{ id: 'grp_use', kind: 'region', label: 'US East', regionId: 'us-east' }],
  };
}

const H2 = ['tcp', 'tls13', 'http2'];
const H3 = ['udp', 'quic', 'http3'];

const trace = (
  stack: string[],
  warm: boolean | 'resumed',
  region?: string,
  config: EdgeInstance['config'] = {},
) =>
  traceRequest({ graph: board(stack, config), scenario: scenario(1000) }, undefined, region, {
    warm,
    registry: reg,
  });

const sumBreakdown = (t: ReturnType<typeof trace>) =>
  TRACE_CATEGORIES.reduce((s, c) => s + t.breakdown[c], 0);

describe('traceRequest — client → app server over HTTP/2 (S15)', () => {
  it('warm: request, queue, service, response = RTT + Wq + S', () => {
    const t = trace(H2, true);
    expect(t.steps.map((s) => s.kind)).toEqual(['request', 'queue', 'service', 'response']);
    expect(t.steps[0]).toMatchObject({
      from: 'node_c',
      to: 'node_app',
      edgeId: 'edge_c_app',
      direction: 'forward',
      layer: 'HTTP/2',
      osiLayer: 7,
    });
    expect(t.steps[0]!.timeMs).toBeCloseTo(RTT / 2, 9);
    expect(t.steps[1]!.timeMs).toBeCloseTo(WQ, 9);
    expect(t.steps[2]!.timeMs).toBeCloseTo(S, 9);
    expect(t.steps[3]).toMatchObject({ direction: 'back', from: 'node_app', to: 'node_c' });
    expect(t.totalMs).toBeCloseTo(RTT + WQ + S, 9);
    expect(t.breakdown.network).toBeCloseTo(RTT, 9);
    expect(t.breakdown.dns + t.breakdown.tcp + t.breakdown.tls).toBe(0);
    expect(t.regionId).toBe('north-america');
    expect(t.participants.map((p) => p.id)).toEqual(['node_c', 'node_app']);
    // Steps tile the timeline.
    t.steps.forEach((s, i) => {
      expect(s.index).toBe(i);
      if (i > 0) expect(s.startMs).toBeCloseTo(t.steps[i - 1]!.startMs + t.steps[i - 1]!.timeMs, 9);
    });
  });

  it('warm total matches the simulation of the same request (RTT + node response time)', () => {
    const sim = simulate({ graph: board(H2), scenario: scenario(1000) }, reg);
    const nodeMean = sim.perNode.node_app!.latencyMs.p50 / Math.LN2; // exponential: p50 = T·ln 2
    expect(trace(H2, true).totalMs).toBeCloseTo(RTT + nodeMean, 6);
  });

  it('cold: DNS → TCP SYN/SYN-ACK/ACK → TLS ClientHello/ServerHello/Finished → HTTP request', () => {
    const t = trace(H2, false);
    expect(t.steps.map((s) => `${s.layer}:${s.message}`)).toEqual([
      'DNS:Query A/AAAA "app"',
      'DNS:Answer: address + TTL',
      'TCP:SYN',
      'TCP:SYN-ACK',
      'TCP:ACK',
      'TLS 1.3:ClientHello',
      'TLS 1.3:ServerHello … Finished',
      'TLS 1.3:Finished',
      'HTTP/2:Read request',
      'Queue:Wait for a free worker (read)',
      'Service:app: read',
      'HTTP/2:Response',
    ]);
    const [q, a, syn, synAck, ack, ch, sh, fin] = t.steps;
    expect(q).toMatchObject({ kind: 'dns', from: 'node_c', to: TRACE_DNS_ID, category: 'dns' });
    expect(a!.to).toBe('node_c');
    expect(q!.timeMs + a!.timeMs).toBeCloseTo(15, 9);
    expect(syn).toMatchObject({ category: 'tcp', direction: 'forward', osiLayer: 4 });
    expect(synAck).toMatchObject({ direction: 'back', from: 'node_app' });
    expect(syn!.timeMs).toBeCloseTo(RTT / 2, 9);
    expect(synAck!.timeMs).toBeCloseTo(RTT / 2, 9);
    expect(ack!.timeMs).toBe(0); // rides with the next flight
    expect(ch).toMatchObject({ category: 'tls', osiLayer: 6 });
    expect(ch!.headers[0]).toContain('SNI');
    expect(sh!.timeMs).toBeCloseTo(RTT / 2, 9);
    expect(fin!.timeMs).toBe(0);
    expect(t.breakdown.dns).toBeCloseTo(15, 9);
    expect(t.breakdown.tcp).toBeCloseTo(RTT, 9);
    expect(t.breakdown.tls).toBeCloseTo(RTT, 9);
    expect(t.totalMs).toBeCloseTo(15 + 3 * RTT + WQ + S, 9);
    expect(t.totalMs - trace(H2, true).totalMs).toBeCloseTo(15 + 2 * RTT, 9);
    expect(sumBreakdown(t)).toBeCloseTo(t.totalMs, 9);
    expect(t.participants.map((p) => p.label)).toEqual(['c', 'DNS resolver', 'app']);
    expect(t.explain).toContain('cold');
  });

  it('cold HTTP/3: QUIC carries TLS in one round trip; resumed TLS 1.3 skips its RTT', () => {
    const h3 = trace(H3, false);
    expect(h3.breakdown.tcp).toBeCloseTo(RTT, 9);
    expect(h3.breakdown.tls).toBe(0);
    expect(h3.totalMs).toBeCloseTo(15 + 2 * RTT + WQ + S, 9);
    const resumed = trace(H2, 'resumed');
    expect(resumed.breakdown.dns).toBe(0);
    expect(resumed.breakdown.tcp).toBeCloseTo(RTT, 9);
    expect(resumed.breakdown.tls).toBe(0);
    expect(resumed.steps.some((s) => s.message === 'Resumption ticket / PSK')).toBe(false);
  });

  it('any user region can be traced, even one without users on the board', () => {
    const t = trace(H2, true, 'india');
    expect(t.regionId).toBe('india');
    expect(t.regionName).toBe('India & South Asia');
    expect(t.breakdown.network).toBeCloseTo(218.17, 1);
    expect(traceRegions({ india: 5 })[0]?.id).toBe('india');
  });

  it('is deterministic', () => {
    expect(trace(H2, false)).toEqual(trace(H2, false));
  });
});

describe('traceRequest — branches, async calls, empty boards', () => {
  const cacheBoard = graph(
    [
      node('c', 'client.test'),
      node('app', 'compute.app'),
      node('cache', 'cache.test'),
      node('db', 'database.test'),
    ],
    [edge('c', 'app'), edge('app', 'cache'), edge('app', 'db')],
  );

  it('cache-aside: miss goes to the DB (default), hit stops at the cache', () => {
    const input = { graph: cacheBoard, scenario: scenario(100) };
    const miss = traceRequest(input, undefined, undefined, { registry: reg });
    const visited = (t: typeof miss) =>
      t.steps.filter((s) => s.kind === 'service').map((s) => s.from);
    expect(visited(miss)).toEqual(['node_app', 'node_cache', 'node_db']);
    expect(miss.decisions[0]?.text).toMatch(/^Cache miss \(20% of reads, hit rate 80%\)/);
    expect(miss.steps.find((s) => s.from === 'node_db' && s.kind === 'service')?.category).toBe(
      'db',
    );
    expect(miss.steps.find((s) => s.from === 'node_cache' && s.kind === 'service')?.category).toBe(
      'db',
    );
    const hit = traceRequest(input, undefined, undefined, { registry: reg, cache: 'hit' });
    expect(visited(hit)).toEqual(['node_app', 'node_cache']);
    expect(hit.decisions[0]?.text).toMatch(/^Cache hit/);
    // No regions placed: RTT 0, so network time is 0 and the total is node time only.
    expect(miss.breakdown.network).toBe(0);
    expect(sumBreakdown(miss as ReturnType<typeof trace>)).toBeCloseTo(miss.totalMs, 9);
  });

  it('a load balancer picks one target and the choice is listed', () => {
    const g = graph(
      [
        node('c', 'client.test'),
        node('lb', 'network.lb'),
        node('a1', 'compute.app'),
        node('a2', 'compute.app'),
      ],
      [edge('c', 'lb'), edge('lb', 'a1'), edge('lb', 'a2')],
    );
    const t = traceRequest({ graph: g, scenario: scenario(100) }, undefined, undefined, {
      registry: reg,
    });
    expect(t.steps.filter((s) => s.kind === 'service').map((s) => s.from)).toEqual([
      'node_lb',
      'node_a1',
    ]);
    expect(t.decisions[0]).toEqual({
      nodeId: 'node_lb',
      text: '"lb" → "a1" (50% of requests; 2 options).',
    });
  });

  it('async calls are listed but do not delay the caller', () => {
    const g = graph(
      [node('c', 'client.test'), node('app', 'compute.app'), node('bg', 'compute.mm1')],
      [edge('c', 'app'), edge('app', 'bg', false)],
    );
    const t = traceRequest({ graph: g, scenario: scenario(10) }, undefined, undefined, {
      registry: reg,
    });
    const bg = t.steps.filter((s) => s.to === 'node_bg' || s.from === 'node_bg');
    expect(bg.length).toBeGreaterThan(0);
    expect(bg.every((s) => s.async)).toBe(true);
    expect(bg.some((s) => s.kind === 'response')).toBe(false);
    expect(sumBreakdown(t as ReturnType<typeof trace>)).toBeCloseTo(t.totalMs, 9);
    expect(t.steps.at(-1)).toMatchObject({ kind: 'response', to: 'node_c', async: false });
    expect(t.steps.at(-1)!.startMs + t.steps.at(-1)!.timeMs).toBeCloseTo(t.totalMs, 9);
  });

  it('follows an explicit flow path and reports a missing route', () => {
    const g = graph([node('c', 'client.test'), node('app', 'compute.app')], [edge('c', 'app')]);
    const f = flow('w', ['c', 'app'], 'write');
    const t = traceRequest({ graph: g, scenario: scenario(10, [f]) }, 'flow_w', undefined, {
      registry: reg,
    });
    expect(t.flowId).toBe('flow_w');
    expect(t.steps[0]?.message).toBe('Write request');
    expect(t.steps.find((s) => s.kind === 'service')?.timeMs).toBe(4); // S_write
    const empty = traceRequest(
      { graph: graph([], []), scenario: scenario(10) },
      undefined,
      undefined,
      { registry: reg },
    );
    expect(empty.steps).toEqual([]);
    expect(empty.notes[0]).toMatch(/empty/);
  });
});
