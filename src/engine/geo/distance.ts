/**
 * Geo step — network distance (ENGINE.md "Network latency"):
 *   RTT ≈ 2 · routeFactor · d / (200 km/ms) + per-hop overhead   (+ last mile for user ends)
 * d is the great-circle (haversine) distance between two places. A request/response over one
 * connection costs one RTT. Same place (same cloud region, or a user and their own edge PoP over
 * the backbone) ⇒ no propagation.
 */
import { fmt } from '../model/format';

/** Light in optical fibre travels at ≈ 2/3 c ≈ 200 km per ms. */
export const FIBRE_KM_PER_MS = 200;
/** Real cable routes are ≈ 1.5× longer than the great circle. */
export const ROUTE_FACTOR = 1.5;
/** Routers, peering and queuing along a long-haul path, added once per hop between places. */
export const PER_HOP_OVERHEAD_MS = 1;
export const EARTH_RADIUS_KM = 6371;

/** Where a node or user sits: a cloud region, a user region's centre, or an edge PoP near users. */
export interface Place {
  /** Unique per place: `cloud:us-east`, `user:india`, `edge:india`. */
  key: string;
  kind: 'cloud' | 'user' | 'edge';
  /** Cloud region id or user region id. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** User places only: access-network RTT to the nearest exchange. */
  lastMileMs: number;
}

/** Network cost of one hop. `cls` classifies the traffic for egress pricing. */
export interface NetHop {
  ms: number;
  distanceKm: number;
  explain: string;
  cls?: 'internet' | 'inter-region' | undefined;
  /** S11: the two cloud regions a cloud ↔ cloud hop connects (for network partitions). */
  ends?: readonly [string, string] | undefined;
  /**
   * S14: round trip before protocol costs (propagation + last mile). `ms` = rttMs + the share of
   * new connections × their handshake. Undefined ⇒ `ms` is the bare RTT.
   */
  rttMs?: number | undefined;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Propagation RTT over d km (no last mile). 0 km ⇒ 0 ms. */
export function propagationRttMs(distanceKm: number): number {
  if (distanceKm <= 0) return 0;
  return (2 * ROUTE_FACTOR * distanceKm) / FIBRE_KM_PER_MS + PER_HOP_OVERHEAD_MS;
}

/** Measured cloud-to-cloud RTTs override the formula: key `a|b` with ids sorted. */
export type MeasuredRtt = Readonly<Record<string, number>>;
export const MEASURED_RTT_MS: MeasuredRtt = Object.freeze({});

export function measuredKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** RTT of one request/response between two places; `undefined` ends ⇒ unknown ⇒ 0 ms. */
export function netBetween(
  from: Place | undefined,
  to: Place | undefined,
  measured: MeasuredRtt = MEASURED_RTT_MS,
): NetHop {
  if (!from || !to || from.key === to.key) return { ms: 0, distanceKm: 0, explain: '' };
  const userEnd = from.kind === 'user' ? from : to.kind === 'user' ? to : undefined;
  const lastMile = userEnd?.lastMileMs ?? 0;
  const cls =
    userEnd !== undefined || from.kind === 'edge' || to.kind === 'edge'
      ? from.kind === 'edge' && to.kind === 'cloud'
        ? 'inter-region' // edge PoP → origin (CDN origin fetch)
        : 'internet'
      : from.id !== to.id
        ? 'inter-region'
        : undefined;
  const d = haversineKm(from, to);
  const ends =
    from.kind === 'cloud' && to.kind === 'cloud' ? ([from.id, to.id] as const) : undefined;
  const m =
    from.kind === 'cloud' && to.kind === 'cloud'
      ? measured[measuredKey(from.id, to.id)]
      : undefined;
  if (m !== undefined) {
    return {
      ms: m + lastMile,
      distanceKm: d,
      cls,
      ...(ends ? { ends } : {}),
      explain: `RTT ${from.name} → ${to.name} = measured ${fmt(m)} ms`,
    };
  }
  const prop = propagationRttMs(d);
  const ms = prop + lastMile;
  const parts =
    d > 0
      ? `2 × ${ROUTE_FACTOR} × ${fmt(d)} km / ${FIBRE_KM_PER_MS} km/ms + ${PER_HOP_OVERHEAD_MS} ms hop`
      : '0 km';
  const lm = lastMile > 0 ? ` + ${fmt(lastMile)} ms last mile` : '';
  return {
    ms,
    distanceKm: d,
    cls,
    ...(ends ? { ends } : {}),
    explain: `RTT ${from.name} → ${to.name} = ${parts}${lm} = ${fmt(ms)} ms`,
  };
}
