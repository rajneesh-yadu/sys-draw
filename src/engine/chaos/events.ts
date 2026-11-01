/**
 * Chaos events over time (S11): when each event is active, what it targets, and the small
 * formulas used to turn an event into model changes (packet-loss delay, detection delays).
 */
import type { ChaosEvent, Graph } from '@/core';
import { fmt, pct } from '../model/format';
import type { CompiledNode, Model } from '../model/types';

/** A cold-start burst with no duration fades out over this many seconds. */
export const DEFAULT_COLD_START_WINDOW_SEC = 30;
/** Cold start per request when neither the event nor the component sets one (ms). */
export const DEFAULT_COLD_START_MS = 1000;
/** Load-balancer health checks when the LB's config has none: every 10 s, 3 failures ⇒ removed. */
export const DEFAULT_HEALTH_CHECK_INTERVAL_SEC = 10;
export const DEFAULT_UNHEALTHY_THRESHOLD = 3;
/** Resolvers keep a dead region's DNS answer this long when the board has no DNS node. */
export const DEFAULT_DNS_TTL_SEC = 60;
/** TCP: a lost segment is resent after the minimum retransmission timeout (Linux: 200 ms). */
export const TCP_MIN_RTO_MS = 200;
/** Bytes of payload per TCP segment (1500 MTU − 40 B headers). */
export const TCP_MSS_BYTES = 1460;
/** Circuit breakers look at the failure rate over this window. */
export const BREAKER_WINDOW_SEC = 10;
export const DEFAULT_BREAKER_OPEN_SEC = 30;
/** Autoscalers wait this long at low load before removing replicas. */
export const SCALE_IN_COOLDOWN_SEC = 60;

/** [start, end) of an event in seconds (end = ∞ when it lasts until the end of the run). */
export function eventWindow(ev: ChaosEvent): { start: number; end: number } {
  const dur =
    ev.durationSec ?? (ev.kind === 'coldStartBurst' ? DEFAULT_COLD_START_WINDOW_SEC : Infinity);
  return { start: ev.atSec, end: ev.atSec + dur };
}

export function isActive(ev: ChaosEvent, tSec: number): boolean {
  const w = eventWindow(ev);
  return tSec >= w.start && tSec < w.end;
}

/**
 * S11 form, kept for compatibility: TCP at RTT ≈ 0. Since S14 the timeline uses the network
 * module's `lossDelay(stack, rtt, p, bytes)`, which picks the edge's transport (QUIC recovers in
 * ≈ 9/8 RTT instead of a ≥ 200 ms RTO).
 * Mean extra delay per request from packet loss: a request/response of `bytes` needs
 * k = ⌈bytes / MSS⌉ segments; if any is lost (P = 1 − (1 − p)^k) TCP waits one RTO to resend.
 */
export function packetLossDelayMs(lossRate: number, bytes: number): number {
  const k = Math.max(1, Math.ceil(bytes / TCP_MSS_BYTES));
  return (1 - (1 - lossRate) ** k) * TCP_MIN_RTO_MS;
}

export function packetLossExplain(lossRate: number, bytes: number): string {
  const k = Math.max(1, Math.ceil(bytes / TCP_MSS_BYTES));
  return (
    `Packet loss ${pct(lossRate)}: ${fmt(bytes)} B ≈ ${k} TCP segments; P(any lost) = 1 − (1 − ${fmt(lossRate)})^${k}` +
    ` = ${pct(1 - (1 - lossRate) ** k)}, each costing one RTO (${TCP_MIN_RTO_MS} ms) ⇒ +${fmt(packetLossDelayMs(lossRate, bytes))} ms per call on average. ` +
    'QUIC (HTTP/3) recovers in about 9/8 RTT and only stalls the affected stream (see the edge inspector).'
  );
}

/** Node ids inside a group, including nested groups. */
export function nodesInGroup(graph: Pick<Graph, 'nodes' | 'groups'>, groupId: string): string[] {
  const parent = new Map(graph.groups.map((g) => [g.id, g.parentId]));
  const inside = (gid: string | undefined): boolean => {
    const seen = new Set<string>();
    let cur = gid;
    while (cur !== undefined && !seen.has(cur)) {
      if (cur === groupId) return true;
      seen.add(cur);
      cur = parent.get(cur);
    }
    return false;
  };
  return graph.nodes.filter((n) => inside(n.groupId)).map((n) => n.id);
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Seconds before a load balancer stops sending to a dead target = interval × threshold. */
export function healthCheckDelaySec(lb: CompiledNode): number {
  const interval = num(lb.config.healthCheckIntervalSec) ?? DEFAULT_HEALTH_CHECK_INTERVAL_SEC;
  const threshold = num(lb.config.unhealthyThreshold) ?? DEFAULT_UNHEALTHY_THRESHOLD;
  return Math.max(0, interval * threshold);
}

/** DNS failover delay = the longest TTL of the board's DNS nodes (default 60 s). */
export function dnsTtlSec(model: Model): number {
  let ttl: number | undefined;
  for (const n of model.nodes.values()) {
    if (!n.behaviors.includes('dns')) continue;
    const v = num(n.config.ttlSec);
    if (v !== undefined) ttl = Math.max(ttl ?? 0, v);
  }
  return ttl ?? DEFAULT_DNS_TTL_SEC;
}

export function coldStartMs(ev: ChaosEvent & { kind: 'coldStartBurst' }, node: CompiledNode) {
  return ev.addedMs ?? num(node.config.coldStartMs) ?? DEFAULT_COLD_START_MS;
}

/** Human label for markers and the editor list, e.g. "AZ a down", "Spike ×3 (india)". */
export function eventLabel(
  ev: ChaosEvent,
  names: { node(id: string): string; edge(id: string): string; group(id: string): string },
): string {
  switch (ev.kind) {
    case 'nodeOutage':
      return `${names.node(ev.nodeId)} down`;
    case 'groupOutage':
      return `${names.group(ev.groupId)} down`;
    case 'regionOutage':
      return `Region ${ev.regionId} down`;
    case 'trafficSpike':
      return `Traffic ×${fmt(ev.multiplier)}${ev.regionId ? ` (${ev.regionId})` : ''}`;
    case 'packetLoss':
      return `${pct(ev.lossRate)} packet loss${ev.edgeId ? ` on ${names.edge(ev.edgeId)}` : ''}`;
    case 'latencyInjection':
      return `+${fmt(ev.addedMs)} ms on ${ev.nodeId ? names.node(ev.nodeId) : ev.edgeId ? names.edge(ev.edgeId) : 'every connection'}`;
    case 'networkPartition':
      return `Partition ${ev.regionA} ↮ ${ev.regionB}`;
    case 'hotKey':
      return `Hot key on ${names.node(ev.nodeId)} (${pct(ev.share)})`;
    case 'dependencySlow':
      return `${names.node(ev.nodeId)} ${fmt(ev.factor)}× slower`;
    case 'diskFull':
      return `${names.node(ev.nodeId)} disk full`;
    case 'coldStartBurst':
      return `Cold starts${ev.nodeId ? ` on ${names.node(ev.nodeId)}` : ''}`;
  }
}
