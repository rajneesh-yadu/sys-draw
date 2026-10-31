/**
 * Pipeline step 6 — latency composition (ENGINE.md: "sum of means + root-sum-square of tail
 * excess"). A path of exponential stages with means Tᵢ is approximated by a shifted exponential:
 *   θ = √ΣTᵢ²,  shift = fixed + ΣTᵢ − θ   ⇒   p_q = ΣTᵢ + fixed + θ·(ln(1/(1−q)) − 1)
 * which is exact for one stage. Branches (LB split, cache hit/miss) form a mixture; its
 * percentiles are found by bisection on the mixture CDF.
 */
import { expQuantileFactor } from '../queueing/mmc';

export interface Branch {
  p: number;
  /** Σ means of exponential stages (ms). */
  mean: number;
  /** Σ squared means (ms²). */
  sq: number;
  /** Deterministic latency (ms), e.g. network propagation. */
  fixed: number;
}
export type Dist = readonly Branch[];

export const ZERO_DIST: Dist = [{ p: 1, mean: 0, sq: 0, fixed: 0 }];

export function stageDist(meanMs: number): Dist {
  return [{ p: 1, mean: meanMs, sq: meanMs * meanMs, fixed: 0 }];
}

export function fixedDist(ms: number): Dist {
  return [{ p: 1, mean: 0, sq: 0, fixed: ms }];
}

function compact(branches: Branch[], maxBranches: number): Dist {
  const byKey = new Map<string, Branch>();
  for (const b of branches) {
    if (b.p <= 0) continue;
    const key = `${b.mean.toPrecision(12)}|${b.sq.toPrecision(12)}|${b.fixed.toPrecision(12)}`;
    const prev = byKey.get(key);
    if (prev) prev.p += b.p;
    else byKey.set(key, { ...b });
  }
  const list = [...byKey.values()].sort((x, y) => x.fixed + x.mean - (y.fixed + y.mean));
  // Merge the two adjacent branches with the closest totals until under the cap (moment-weighted).
  while (list.length > maxBranches) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i] as Branch;
      const b = list[i + 1] as Branch;
      const gap = b.fixed + b.mean - (a.fixed + a.mean);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    const a = list[best] as Branch;
    const b = list[best + 1] as Branch;
    const p = a.p + b.p;
    list.splice(best, 2, {
      p,
      mean: (a.p * a.mean + b.p * b.mean) / p,
      sq: (a.p * a.sq + b.p * b.sq) / p,
      fixed: (a.p * a.fixed + b.p * b.fixed) / p,
    });
  }
  return list;
}

/** Latency of A followed by B. */
export function sumDist(a: Dist, b: Dist, maxBranches: number): Dist {
  const out: Branch[] = [];
  for (const x of a) {
    for (const y of b) {
      out.push({ p: x.p * y.p, mean: x.mean + y.mean, sq: x.sq + y.sq, fixed: x.fixed + y.fixed });
    }
  }
  return compact(out, maxBranches);
}

/** One of several latencies, with probabilities summing to 1. */
export function mixDist(parts: readonly { p: number; dist: Dist }[], maxBranches: number): Dist {
  const out: Branch[] = [];
  for (const { p, dist } of parts) for (const b of dist) out.push({ ...b, p: b.p * p });
  return compact(out, maxBranches);
}

export function distMean(d: Dist): number {
  const total = d.reduce((s, b) => s + b.p, 0) || 1;
  return d.reduce((s, b) => s + b.p * (b.fixed + b.mean), 0) / total;
}

function branchQuantile(b: Branch, q: number): number {
  const theta = Math.sqrt(b.sq);
  return b.fixed + b.mean + theta * (expQuantileFactor(q) - 1);
}

function branchCdf(b: Branch, x: number): number {
  const theta = Math.sqrt(b.sq);
  const shift = b.fixed + b.mean - theta;
  if (theta === 0) return x >= shift ? 1 : 0;
  return x <= shift ? 0 : 1 - Math.exp(-(x - shift) / theta);
}

export function quantile(d: Dist, q: number): number {
  if (d.length === 0) return 0;
  if (d.length === 1) return Math.max(0, branchQuantile(d[0] as Branch, q));
  const total = d.reduce((s, b) => s + b.p, 0);
  let lo = Math.min(...d.map((b) => branchQuantile(b, q)));
  let hi = Math.max(...d.map((b) => branchQuantile(b, q)));
  const cdf = (x: number) => d.reduce((s, b) => s + b.p * branchCdf(b, x), 0) / total;
  for (let i = 0; i < 200 && hi - lo > 1e-9 * Math.max(1, hi); i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) >= q) hi = mid;
    else lo = mid;
  }
  return Math.max(0, hi);
}

export function percentiles(d: Dist): { p50: number; p95: number; p99: number } {
  return { p50: quantile(d, 0.5), p95: quantile(d, 0.95), p99: quantile(d, 0.99) };
}
