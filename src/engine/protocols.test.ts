/**
 * S14: protocol costs on edges. Hand-computed with RTT = North America → us-east = 38.795 ms
 * (see geo/geo.test.ts): a cold request costs (handshake RTTs + 1) × RTT.
 *   HTTP/1.1 over TLS 1.3 over TCP: 1 + 1 + 1 = 3 RTT = 116.38 ms
 *   HTTP/2   over TLS 1.3 over TCP: 1 + 1 + 1 = 3 RTT (ALPN: HTTP/2 adds no round trip)
 *   HTTP/3   over QUIC over UDP:    1 + 1     = 2 RTT =  77.59 ms
 *   HTTP/1.1 over TLS 1.2 over TCP: 1 + 2 + 1 = 4 RTT
 */
import { describe, expect, it } from 'vitest';
import { SimResultSchema, type EdgeInstance, type Graph } from '@/core';
import { lossDelay, resolveStack } from '@/network';
import { createRegistry, registry as appRegistry, type Registry } from '@/registry';
import { simulate } from './simulate';
import { edge, geoTestRegistry, node, scenario } from './test-fixtures';

const RTT = 38.79453463411909;

/** The geo test components plus the real protocol catalog. */
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

const run = (stack: string[], config: EdgeInstance['config'] = {}, extra = {}) =>
  simulate({ graph: board(stack, config), scenario: scenario(1000, [], extra) }, reg);

const flowP50 = (r: ReturnType<typeof run>) => Object.values(r.perFlow)[0]?.p50 ?? NaN;

const H1 = ['tcp', 'tls13', 'http1'];
const H2 = ['tcp', 'tls13', 'http2'];
const H3 = ['udp', 'quic', 'http3'];

describe('S14 done-when: HTTP/1.1 → HTTP/2 → HTTP/3 changes cold-request latency by the expected RTTs', () => {
  it('cold request = (handshake RTTs + 1) × RTT on the edge', () => {
    const h1 = run(H1).perEdge.edge_c_app!;
    const h2 = run(H2).perEdge.edge_c_app!;
    const h3 = run(H3).perEdge.edge_c_app!;
    expect(h1.rttMs).toBeCloseTo(RTT, 9);
    expect(h1.coldLatencyMs).toBeCloseTo(3 * RTT, 9);
    expect(h2.coldLatencyMs).toBeCloseTo(3 * RTT, 9);
    expect(h3.coldLatencyMs).toBeCloseTo(2 * RTT, 9);
    // HTTP/1.1 → HTTP/2: 0 RTT (both negotiate in the TLS handshake); HTTP/2 → HTTP/3: −1 RTT.
    expect((h2.coldLatencyMs ?? 0) - (h1.coldLatencyMs ?? 0)).toBeCloseTo(0, 9);
    expect((h3.coldLatencyMs ?? 0) - (h2.coldLatencyMs ?? 0)).toBeCloseTo(-RTT, 9);
    expect(h2.handshakeMs).toBeCloseTo(2 * RTT, 9);
    expect(h3.handshakeMs).toBeCloseTo(RTT, 9);
    expect(run(['tcp', 'tls12', 'http1']).perEdge.edge_c_app?.coldLatencyMs).toBeCloseTo(
      4 * RTT,
      9,
    );
    expect(h2.explain.coldLatencyMs).toContain('TCP 1 + TLS 1.3 1 = 2 RTT');
    expect(SimResultSchema.safeParse(run(H3)).success).toBe(true);
  });

  it('warm connections (the default) keep steady-state latency at one RTT', () => {
    const a = run(H1);
    const b = run(H3);
    expect(a.perEdge.edge_c_app?.latencyMs.p50).toBeCloseTo(RTT, 9);
    expect(b.perEdge.edge_c_app?.latencyMs.p50).toBeCloseTo(RTT, 9);
    expect(flowP50(a)).toBeCloseTo(flowP50(b), 9);
  });

  it('newConnectionShare charges that share of requests the handshake', () => {
    const warm = run(H2);
    const half = run(H2, { newConnectionShare: 0.5 });
    // RTT + 0.5 × 2 RTT = 2 RTT on the edge; the flow p50 rises by one RTT
    expect(half.perEdge.edge_c_app?.latencyMs.p50).toBeCloseTo(2 * RTT, 9);
    expect(flowP50(half) - flowP50(warm)).toBeCloseTo(RTT, 6);
    expect(half.perRegion?.['north-america']?.networkMs).toBeCloseTo(2 * RTT, 9);
    // QUIC: RTT + 0.5 × 1 RTT
    expect(run(H3, { newConnectionShare: 0.5 }).perEdge.edge_c_app?.latencyMs.p50).toBeCloseTo(
      1.5 * RTT,
      9,
    );
  });

  it('reports protocol header bytes per request', () => {
    // 1000 B request: +60 +22 +40 = 122; 10 000 B response: 10 060 → 10 082 → 7 segments × 40 = 280 + 82 = 362
    expect(run(H2).perEdge.edge_c_app?.overheadBytes).toBe(122 + 362);
  });
});

describe('packet loss penalises TCP more than QUIC', () => {
  const lossEvent = {
    id: 'evt_loss',
    kind: 'packetLoss' as const,
    lossRate: 0.02,
    atSec: 10,
    durationSec: 10,
  };
  const at = (r: ReturnType<typeof run>, t: number) =>
    r.timeline?.find((p) => p.tSec === t)?.p50Ms ?? NaN;

  it('adds the transport-specific recovery delay per call', () => {
    const tcp = run(H2, {}, { events: [lossEvent] });
    const quic = run(H3, {}, { events: [lossEvent] });
    const tcpAdded = at(tcp, 10) - at(tcp, 0);
    const quicAdded = at(quic, 10) - at(quic, 0);
    // TCP: 8 segments, 1 − 0.98^8 = 14.92 %, RTO max(200, 3 × 38.8) = 200 ms ⇒ 29.85 ms
    expect(tcpAdded).toBeCloseTo(lossDelay(resolveStack(reg, H2), RTT, 0.02, 11_000).ms, 6);
    expect(tcpAdded).toBeCloseTo(29.848, 2);
    // QUIC: 10 packets, 1 − 0.98^10 = 18.29 %, 9/8 × 38.8 = 43.64 ms ⇒ 7.98 ms
    expect(quicAdded).toBeCloseTo(0.182927 * 1.125 * RTT, 3);
    expect(quicAdded).toBeLessThan(tcpAdded / 3);
  });
});
