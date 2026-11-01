/**
 * S14 network math. Expected values are hand-computed in the comments next to each assertion.
 */
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import {
  connectionCost,
  encryptionStatus,
  handshakeSequence,
  lossDelay,
  osiView,
  perRequestOverhead,
  requestLatency,
  resolveStack,
  stackLabel,
  stackPorts,
  stackWarnings,
} from './index';

const stack = (...ids: string[]) => resolveStack(registry, ids);
const H1 = stack('tcp', 'tls13', 'http1');
const H2 = stack('tcp', 'tls13', 'http2');
const H3 = stack('udp', 'quic', 'http3');

describe('connectionCost / requestLatency', () => {
  it('counts handshake RTTs per layer', () => {
    // TCP 1 + TLS 1.3 1 (HTTP/1.1 and HTTP/2 add none: ALPN inside TLS)
    expect(connectionCost(H1, 50).rtts).toBe(2);
    expect(connectionCost(H2, 50).ms).toBe(100);
    expect(connectionCost(H2, 50).explain).toBe(
      'New connection: TCP 1 + TLS 1.3 1 = 2 RTT × 50 ms = 100 ms',
    );
    // QUIC: transport + TLS in one RTT
    expect(connectionCost(H3, 50).rtts).toBe(1);
    // TLS 1.2: 1 + 2
    expect(connectionCost(stack('tcp', 'tls12', 'http1'), 10).rtts).toBe(3);
    // WebSocket upgrade adds one
    expect(connectionCost(stack('tcp', 'tls13', 'websocket'), 10).rtts).toBe(3);
  });

  it('warm connections pay nothing; resumption uses 0-RTT where the protocol allows it', () => {
    expect(connectionCost(H2, 80, true)).toMatchObject({ rtts: 0, ms: 0 });
    expect(connectionCost(H2, 80, 'resumed').rtts).toBe(1); // TCP 1 + TLS 1.3 0-RTT
    expect(connectionCost(H3, 80, 'resumed').rtts).toBe(0); // QUIC 0-RTT
    expect(connectionCost(stack('tcp', 'tls12', 'http1'), 80, 'resumed').rtts).toBe(2); // 1 + 1
  });

  it('a cold request = (handshake RTTs + 1) × RTT: HTTP/1.1 = HTTP/2 = 3 RTT, HTTP/3 = 2 RTT', () => {
    const rtt = 38.79;
    expect(requestLatency(H1, rtt).totalMs).toBeCloseTo(3 * rtt, 9);
    expect(requestLatency(H2, rtt).totalMs).toBeCloseTo(3 * rtt, 9);
    expect(requestLatency(H3, rtt).totalMs).toBeCloseTo(2 * rtt, 9);
    expect(requestLatency(H3, rtt, true)).toMatchObject({ handshakeMs: 0, totalMs: rtt, rtts: 1 });
  });

  it('assumes TCP under a stack saved without a transport', () => {
    const pg = stack('postgres-wire');
    expect(pg.layers[0]).toMatchObject({ assumed: true });
    expect(connectionCost(pg, 1).rtts).toBe(4); // TCP 1 + startup/SCRAM 3
    expect(stack('tcp', 'mystery').unknown).toEqual(['mystery']);
  });
});

describe('perRequestOverhead', () => {
  it('adds headers top-down, per TLS record and per TCP segment', () => {
    // 1000 B: HTTP/2 +60 = 1060; TLS 1 record +22 = 1082; TCP ⌈1082/1460⌉ = 1 segment +40 = 1122
    const o = perRequestOverhead(H2, 1000);
    expect(o.overheadBytes).toBe(2 * 122);
    expect(o.wireBytes).toBe(2 * 1122);
    // 3000 B response: 3060 → 3082 → 3 segments × 40 = 3202 (202 B); request 1000 B: 122
    const big = perRequestOverhead(H2, { req: 1000, res: 3000 });
    expect(big.overheadBytes).toBe(122 + 202);
    expect(big.perLayer.find((l) => l.protocolId === 'tcp')).toMatchObject({
      units: 4,
      bytes: 160,
    });
  });

  it('HTTP/3: QUIC packets of 1200 B inside UDP datagrams', () => {
    // 1000 → +50 = 1050 → QUIC 1 packet +30 = 1080 → UDP 1 datagram +28 = 1108
    expect(perRequestOverhead(H3, 1000).overheadBytes).toBe(2 * 108);
  });

  it('an encoding layer scales the payload', () => {
    const proto = resolveStack(registry, ['tcp', 'protobuf']);
    // 1000 × 0.5 = 500 → TCP +40
    expect(perRequestOverhead(proto, 1000)).toMatchObject({
      payloadBytes: 1000,
      overheadBytes: 80,
    });
  });
});

describe('lossDelay', () => {
  it('TCP: one RTO (≥ 200 ms) per affected request, as in S11', () => {
    // 11 000 B ⇒ 8 segments; 1 − 0.98^8 = 0.14924; × 200 ms = 29.848 ms
    expect(lossDelay(H2, 0, 0.02, 11_000).ms).toBeCloseTo(29.848, 2);
    // RTT 100 ms: RTO = max(200, 3 × 100) = 300 ⇒ 0.14924 × 300 = 44.77 ms
    expect(lossDelay(H2, 100, 0.02, 11_000).ms).toBeCloseTo(44.772, 2);
  });

  it('QUIC recovers in ≈ 9/8 RTT, so loss penalises TCP more', () => {
    // 11 000 B ⇒ ⌈11000/1200⌉ = 10 packets; 1 − 0.98^10 = 0.18293; × 112.5 ms = 20.58 ms
    const q = lossDelay(H3, 100, 0.02, 11_000);
    expect(q.ms).toBeCloseTo(20.58, 1);
    expect(q.ms).toBeLessThan(lossDelay(H2, 100, 0.02, 11_000).ms);
    // same region (RTT 0): QUIC 1 ms floor vs TCP 200 ms
    expect(lossDelay(H3, 0, 0.02, 11_000).ms).toBeLessThan(1);
    expect(lossDelay(H2, 0, 0, 11_000).ms).toBe(0);
  });
});

describe('inspector views', () => {
  it('OSI view fills IP, Ethernet and fibre implicitly and notes TLS inside QUIC', () => {
    const rows = osiView(registry, H3);
    expect(rows.map((r) => r.layer)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(rows[0]?.protocols.map((p) => p.id)).toEqual(['http3']);
    expect(rows[1]?.note).toMatch(/built into QUIC/);
    expect(rows[3]?.protocols.map((p) => p.id)).toEqual(['udp', 'quic']);
    expect(rows[4]?.protocols).toEqual([{ id: 'ipv4', name: 'IPv4', source: 'implicit' }]);
    expect(rows[5]?.protocols[0]?.id).toBe('ethernet');
    expect(rows[6]?.protocols[0]?.id).toBe('fibre');
    expect(osiView(registry, stack('tcp', 'http2'))[1]?.note).toMatch(/clear text/);
  });

  it('handshake sequence: TCP then TLS, with RTT offsets', () => {
    const seq = handshakeSequence(H2);
    expect(seq.map((g) => [g.protocolId, g.startRtt, g.rtts])).toEqual([
      ['tcp', 0, 1],
      ['tls13', 1, 1],
    ]);
    expect(seq[0]?.messages.map((m) => m.message)).toEqual(['SYN', 'SYN-ACK', 'ACK']);
    expect(handshakeSequence(H2, true)).toEqual([]);
    expect(handshakeSequence(H2, 'resumed').map((g) => g.protocolId)).toEqual(['tcp']);
  });

  it('ports and encryption', () => {
    expect(stackPorts(H2)).toMatchObject({ ports: [443], transport: 'TCP', secure: true });
    expect(stackPorts(stack('tcp', 'http1'))?.ports).toEqual([80]);
    expect(stackPorts(H3)).toMatchObject({ ports: [443], transport: 'UDP' });
    expect(stackPorts(stack('tcp', 'kafka-wire'))?.ports).toEqual([9092]);
    expect(stackPorts(stack('tcp', 'tls13', 'kafka-wire'))?.ports).toEqual([9093]);
    expect(encryptionStatus(H3)).toMatchObject({ encrypted: true, by: 'QUIC', mutual: false });
    expect(encryptionStatus(stack('tcp', 'mtls', 'http2')).mutual).toBe(true);
    expect(encryptionStatus(stack('tcp', 'http2')).encrypted).toBe(false);
    expect(stackLabel(registry, ['udp', 'quic', 'http3'])).toBe('UDP › QUIC › HTTP/3');
  });

  it('warnings', () => {
    const plain = stackWarnings(registry, stack('tcp', 'http2'), {
      crossesInternet: true,
      lossRate: 0.01,
    });
    expect(plain.filter((w) => w.level === 'warning').map((w) => w.message)).toEqual([
      expect.stringMatching(/Plaintext over the public internet/),
      expect.stringMatching(/one lost packet stalls all of them — and this edge has packet loss/),
    ]);
    expect(stackWarnings(registry, H3).some((w) => /stalls/.test(w.message))).toBe(false);
    expect(stackWarnings(registry, stack('tcp', 'tls12', 'http1')).map((w) => w.message)).toEqual([
      expect.stringMatching(/TLS 1\.2 needs 2 RTTs/),
      expect.stringMatching(/HTTP\/1\.1 serves one request at a time/),
    ]);
    expect(
      stackWarnings(registry, stack('tcp', 'postgres-wire'), { newConnectionShare: 0.5 }).some(
        (w) => w.level === 'warning' && /4 RTTs/.test(w.message),
      ),
    ).toBe(true);
    expect(stackWarnings(registry, stack('udp', 'http2'))[0]?.message).toMatch(
      /HTTP\/2 does not run on UDP/,
    );
    expect(stackWarnings(registry, stack('postgres-wire'))[0]?.message).toMatch(/TCP is assumed/);
  });
});
