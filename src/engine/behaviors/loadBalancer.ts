/**
 * loadBalancer: a request goes to ONE target. How targets are weighted depends on
 * `config.algorithm`:
 * - round-robin / random: every instance gets the same share, so a target node gets a share
 *   ∝ its replicas — even if its instances are bigger or smaller than the others';
 * - least-connections: busy instances get fewer requests, so a target's share ∝ its capacity
 *   (replicas × c × μ) — bigger instances take more;
 * - consistent-hash: shares ∝ replicas like round-robin, but the ring is never perfectly even:
 *   the target's hottest replica gets f = 1 + √(2 ln N / V) × the average (V = virtualNodes).
 */
import { choice } from '../model/expr';
import type { CompiledNode } from '../model/types';
import { capacityForMix, buildPools } from '../scaling/pools';
import { defineBehavior } from './types';

export const LB_ALGORITHMS = [
  'round-robin',
  'least-connections',
  'consistent-hash',
  'random',
] as const;
export type LbAlgorithm = (typeof LB_ALGORITHMS)[number];

export const DEFAULT_VIRTUAL_NODES = 100;

export function lbAlgorithm(node: CompiledNode): LbAlgorithm {
  const a = node.config.algorithm;
  return typeof a === 'string' && (LB_ALGORITHMS as readonly string[]).includes(a)
    ? (a as LbAlgorithm)
    : 'round-robin';
}

/** Nominal read capacity of a target (configured replicas, no autoscaling), for least-connections. */
function nominalCapacity(t: CompiledNode): number {
  if (t.kind !== 'service') return t.replicas;
  const cap = capacityForMix(
    buildPools(t.scale, t.replicas, t.serversPerInstance),
    { read: 1, write: 0 },
    t.serviceTimeMs,
  );
  return Number.isFinite(cap) ? cap : t.replicas;
}

export function targetWeight(algorithm: LbAlgorithm, target: CompiledNode): number {
  return algorithm === 'least-connections' ? nominalCapacity(target) : target.replicas;
}

export const behavior = defineBehavior({
  id: 'loadBalancer',
  // A load balancer with targets in several regions acts as a global LB: nearest healthy region.
  geoRoutes: true,
  routeOut({ node, calls, combine }) {
    if (calls.length <= 1) return undefined;
    const alg = lbAlgorithm(node);
    const w = calls.map((c) => targetWeight(alg, c.target));
    const total = w.reduce((s, x) => s + x, 0);
    return choice(
      calls.map((c, i) => ({
        p: total > 0 ? (w[i] ?? 0) / total : 1 / calls.length,
        expr: combine([c]),
      })),
    );
  },
  hashVirtualNodes(node) {
    if (lbAlgorithm(node) !== 'consistent-hash') return undefined;
    const v = node.config.virtualNodes;
    return typeof v === 'number' && v >= 1 ? v : DEFAULT_VIRTUAL_NODES;
  },
});
