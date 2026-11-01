/**
 * quorum: a leaderless replicated store (Cassandra, Dynamo). The cluster's instances are the
 * node's replicas; keys sit on a consistent-hash ring with `vnodes` tokens per instance, and every
 * key is stored on N = replicationFactor instances. Consistency levels pick R and W:
 *   work per read  = R × S_r   (the coordinator reads from R replicas: data + digests)
 *   work per write = N × S_w   (every replica applies every write; W only counts acks)
 *   wait for read  = S_r × Σ_{i=1..R} 1/i            (the slowest of the R contacted)
 *   wait for write = S_w × Σ_{i=N−W+1..N} 1/i        (the W-th fastest of N)
 * R + W > N ⇒ every read quorum overlaps the latest write quorum (read-your-writes).
 * Ring imbalance: hottest instance f = 1 + √(2 ln n / vnodes) × average (scaling/pools.ts).
 */
import { fmt } from '../model/format';
import type { CompiledNode } from '../model/types';
import { num, str } from './lib/config';
import { kthOfN, maxOfN, replicasFor } from './lib/order-stats';
import { defineBehavior } from './types';

export interface QuorumPlan {
  n: number;
  r: number;
  w: number;
  /** N was capped at the cluster size. */
  capped: boolean;
  strong: boolean;
}

export function quorumPlan(node: CompiledNode): QuorumPlan {
  const rf = Math.max(1, Math.round(num(node, 'replicationFactor') ?? 3));
  const n = Math.min(rf, Math.max(1, node.replicas));
  const r = replicasFor(str(node, 'readConsistency'), n);
  const w = replicasFor(str(node, 'writeConsistency'), n);
  return { n, r, w, capped: n < rf, strong: r + w > n };
}

export const behavior = defineBehavior({
  id: 'quorum',
  tune(node) {
    const { n, r, w } = quorumPlan(node);
    const s = node.serviceTimeMs;
    const vnodes = num(node, 'vnodes');
    return {
      serviceTimeMs: { read: s.read * r, write: s.write * n },
      responseServiceMs: { read: maxOfN(r, s.read), write: kthOfN(w, n, s.write) },
      ...(vnodes !== undefined ? { scale: { ...node.scale, hashVirtualNodes: vnodes } } : {}),
    };
  },
  finish({ node, stats }) {
    const p = quorumPlan(node);
    const base = node.serviceTimeMs;
    const Sr = base.read / p.r;
    const Sw = base.write / p.n;
    stats.explain.quorum =
      `N = ${p.n}, R = ${p.r}, W = ${p.w}${p.capped ? ` (replication factor capped at the ${node.replicas}-node cluster)` : ''}. ` +
      `Work: read = R × ${fmt(Sr)} = ${fmt(base.read)} ms, write = N × ${fmt(Sw)} = ${fmt(base.write)} ms (every replica stores every write). ` +
      `Wait: read = slowest of ${p.r} = ${fmt(Sr)} × Σ1/i = ${fmt(maxOfN(p.r, Sr))} ms; write = ${p.w}-th fastest of ${p.n} = ${fmt(kthOfN(p.w, p.n, Sw))} ms. ` +
      (p.strong
        ? `R + W = ${p.r + p.w} > N: reads always see the latest acknowledged write.`
        : `R + W = ${p.r + p.w} ≤ N: a read can miss the latest write (eventual consistency; read repair and hinted handoff converge it).`) +
      ` Survives ${p.n - p.r} replica failure(s) for reads and ${p.n - p.w} for writes per key.`;
  },
});
