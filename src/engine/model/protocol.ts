/**
 * Pipeline step 5 — protocol cost of a network hop (S14, via the network module).
 *
 *   hop time = RTT + s × handshakeRtts × RTT
 *
 * where s = EdgeConfig.newConnectionShare (default 0: every request reuses a warm connection, so
 * steady-state latency is the bare RTT) and handshakeRtts sums the stack's layers (TCP 1 + TLS 1.3
 * 1, QUIC 1, …). The cold-request figure (s = 1) is reported per edge as `coldLatencyMs`.
 */
import { connectionCost } from '@/network';
import type { NetHop } from '../geo/distance';
import { fmt, pct } from './format';
import type { CompiledEdge } from './types';

export function withProtocol(hop: NetHop, edge: CompiledEdge | undefined): NetHop {
  const rttMs = hop.ms;
  const share = edge?.config.newConnectionShare ?? 0;
  if (!edge || !(share > 0) || !(rttMs > 0)) return { ...hop, rttMs };
  const c = connectionCost(edge.stack, rttMs, false);
  if (c.ms === 0) return { ...hop, rttMs };
  const added = share * c.ms;
  return {
    ...hop,
    rttMs,
    ms: rttMs + added,
    explain: `${hop.explain}; + ${pct(share)} of requests on new connections × ${fmt(c.ms)} ms handshake (${c.explain}) = +${fmt(added)} ms`,
  };
}
