/**
 * Connection and per-request costs of a protocol stack (NETWORK-SECURITY.md, ENGINE.md step 5).
 *
 * - Connection setup: each layer adds its `handshakeRtts` (TCP 1, TLS 1.3 1, TLS 1.2 2, QUIC 1 for
 *   transport + TLS together, WebSocket upgrade 1, database auth 2–3). A warm (reused) connection
 *   pays nothing; a resumed session pays `resumedHandshakeRtts` (TLS 1.3 / QUIC 0-RTT = 0).
 * - One request on a connection = 1 RTT, so a cold request = (handshake RTTs + 1) × RTT.
 * - Overhead: walking the stack top-down, a layer adds `perMessageOverheadBytes` once per message,
 *   or once per `unitBytes` of the layer above (TLS records, TCP segments, QUIC packets).
 * - Packet loss: k = ⌈bytes / segment⌉ packets; P(any lost) = 1 − (1 − p)^k, each recovery costs
 *   max(minRecoveryMs, recoveryRtts × RTT) of the transport (TCP RTO ≥ 200 ms; QUIC ≈ 9/8 RTT).
 */
import { activeLayers, type ResolvedStack } from './stack';

/** `true` = connection reused; `false` = brand-new connection; `'resumed'` = new connection, resumed session. */
export type Warmth = boolean | 'resumed';

export interface HandshakeStep {
  protocolId: string;
  name: string;
  rtts: number;
}

export interface ConnectionCost {
  rtts: number;
  ms: number;
  steps: HandshakeStep[];
  explain: string;
}

const f = (n: number) => String(Number(n.toPrecision(4)));

function layerRtts(def: ResolvedStack['layers'][number]['def'], warm: Warmth): number {
  if (warm === true) return 0;
  if (warm === 'resumed') return def.resumedHandshakeRtts ?? def.handshakeRtts;
  return def.handshakeRtts;
}

/** Handshake cost of opening a connection over `stack` at round-trip time `rttMs`. */
export function connectionCost(
  stack: ResolvedStack,
  rttMs: number,
  warm: Warmth = false,
): ConnectionCost {
  const steps = activeLayers(stack)
    .map((l) => ({ protocolId: l.def.id, name: l.def.name, rtts: layerRtts(l.def, warm) }))
    .filter((s) => s.rtts > 0);
  const rtts = steps.reduce((s, x) => s + x.rtts, 0);
  const ms = rtts * rttMs;
  let explain: string;
  if (warm === true) explain = 'Warm connection (keep-alive / pool): no handshake';
  else if (rtts === 0)
    explain = `${warm === 'resumed' ? 'Resumed session' : 'New connection'}: no handshake round trips`;
  else
    explain =
      `${warm === 'resumed' ? 'Resumed session' : 'New connection'}: ` +
      `${steps.map((s) => `${s.name} ${f(s.rtts)}`).join(' + ')} = ${f(rtts)} RTT × ${f(rttMs)} ms = ${f(ms)} ms`;
  return { rtts, ms, steps, explain };
}

export interface RequestLatency {
  handshakeMs: number;
  /** The request/response itself: one RTT. */
  requestMs: number;
  totalMs: number;
  rtts: number;
  explain: string;
}

/** One request over `stack`: handshake (unless warm) + 1 RTT for the request and response. */
export function requestLatency(
  stack: ResolvedStack,
  rttMs: number,
  warm: Warmth = false,
): RequestLatency {
  const c = connectionCost(stack, rttMs, warm);
  const totalMs = c.ms + rttMs;
  return {
    handshakeMs: c.ms,
    requestMs: rttMs,
    totalMs,
    rtts: c.rtts + 1,
    explain: `${c.explain}; request + response 1 RTT ⇒ ${f(c.rtts + 1)} RTT = ${f(totalMs)} ms`,
  };
}

export interface LayerOverhead {
  protocolId: string;
  name: string;
  /** How many times the header is paid (records, segments, packets). */
  units: number;
  bytes: number;
}

export interface Overhead {
  /** Payload after encoding (an encoding layer such as Protobuf shrinks it). */
  payloadBytes: number;
  /** Header bytes added by the stack. */
  overheadBytes: number;
  /** payloadBytes + overheadBytes: what crosses the wire (link-layer framing excluded). */
  wireBytes: number;
  perLayer: LayerOverhead[];
  explain: string;
}

function messageOverhead(stack: ResolvedStack, bytes: number): Overhead {
  const layers = activeLayers(stack);
  const factor = stack.layers.reduce((p, l) => p * (l.def.payloadSizeFactor ?? 1), 1);
  const payload = bytes * factor;
  let inner = payload;
  const perLayer: LayerOverhead[] = [];
  for (const l of [...layers].reverse()) {
    if (l.def.perMessageOverheadBytes === 0) continue;
    const units = l.def.unitBytes ? Math.max(1, Math.ceil(inner / l.def.unitBytes)) : 1;
    const add = units * l.def.perMessageOverheadBytes;
    perLayer.push({ protocolId: l.def.id, name: l.def.name, units, bytes: add });
    inner += add;
  }
  const overheadBytes = inner - payload;
  return {
    payloadBytes: payload,
    overheadBytes,
    wireBytes: inner,
    perLayer,
    explain: perLayer
      .map((p) => `${p.name} ${p.units > 1 ? `${p.units} × ` : ''}${f(p.bytes / p.units)} B`)
      .join(' + '),
  };
}

/**
 * Header bytes the stack adds to one request and its response. `payload` is either one size for
 * both, or `{ req, res }`.
 */
export function perRequestOverhead(
  stack: ResolvedStack,
  payload: number | { req: number; res: number },
): Overhead {
  const { req, res } = typeof payload === 'number' ? { req: payload, res: payload } : payload;
  const a = messageOverhead(stack, req);
  const b = messageOverhead(stack, res);
  const perLayer = a.perLayer.map((l) => {
    const r = b.perLayer.find((x) => x.protocolId === l.protocolId);
    return { ...l, units: l.units + (r?.units ?? 0), bytes: l.bytes + (r?.bytes ?? 0) };
  });
  const overheadBytes = a.overheadBytes + b.overheadBytes;
  const payloadBytes = a.payloadBytes + b.payloadBytes;
  return {
    payloadBytes,
    overheadBytes,
    wireBytes: payloadBytes + overheadBytes,
    perLayer,
    explain:
      overheadBytes === 0
        ? 'No protocol headers counted'
        : `Headers per request + response = request (${a.explain}) + response (${b.explain}) = ${f(overheadBytes)} B on ${f(payloadBytes)} B of payload`,
  };
}

export interface LossDelay {
  ms: number;
  /** Packets the request and response need. */
  packets: number;
  /** P(at least one is lost). */
  pLoss: number;
  /** Time one recovery takes. */
  recoveryMs: number;
  explain: string;
}

/** Default segment size when a transport does not say (Ethernet MSS). */
export const DEFAULT_SEGMENT_BYTES = 1460;

/** Mean extra delay per request from packet loss `lossRate` on `stack` (see the file header). */
export function lossDelay(
  stack: ResolvedStack,
  rttMs: number,
  lossRate: number,
  bytes: number,
): LossDelay {
  const t = stack.transport;
  if (!t?.loss || !(lossRate > 0)) {
    return {
      ms: 0,
      packets: 0,
      pLoss: 0,
      recoveryMs: 0,
      explain: t ? 'No packet loss' : 'No transport in the stack: loss not modelled',
    };
  }
  const packets = Math.max(1, Math.ceil(bytes / (t.unitBytes ?? DEFAULT_SEGMENT_BYTES)));
  const pLoss = 1 - (1 - lossRate) ** packets;
  const recoveryMs = Math.max(t.loss.minRecoveryMs, t.loss.recoveryRtts * rttMs);
  const ms = pLoss * recoveryMs;
  const hol =
    t.loss.holBlocking === 'connection'
      ? ' A loss stalls everything behind it on the connection (head-of-line blocking).'
      : t.loss.holBlocking === 'stream'
        ? ' A loss stalls only its own stream.'
        : ' Nothing is resent by the transport; the application retries.';
  return {
    ms,
    packets,
    pLoss,
    recoveryMs,
    explain:
      `Packet loss ${f(lossRate * 100)}% on ${t.name}: ${f(bytes)} B ≈ ${packets} packets; ` +
      `P(any lost) = 1 − (1 − ${f(lossRate)})^${packets} = ${f(pLoss * 100)}%, each recovery ` +
      `max(${f(t.loss.minRecoveryMs)} ms, ${f(t.loss.recoveryRtts)} × ${f(rttMs)} ms RTT) = ${f(recoveryMs)} ms ⇒ +${f(ms)} ms per request.${hol}`,
  };
}
