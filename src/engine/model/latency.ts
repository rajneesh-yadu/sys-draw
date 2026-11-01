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
  if (branches.length === 1) {
    const b = branches[0] as Branch;
    return b.p > 0 ? [{ ...b }] : [];
  }
  const byKey = new Map<string, Branch>();
  for (const b of branches) {
    if (b.p <= 0) continue;
    const key = `${b.mean.toPrecision(12)}|${b.sq.toPrecision(12)}|${b.fixed.toPrecision(12)}`;
    const prev = byKey.get(key);
    if (prev) prev.p += b.p;
    else byKey.set(key, { ...b });
  }
  const list = [...byKey.values()].sort((x, y) => x.fixed + x.mean - (y.fixed + y.mean));
  if (list.length <= maxBranches) return list;
  return mergeClosest(list, maxBranches);
}

/**
 * Repeatedly merges the two ADJACENT branches whose totals (fixed + mean) are closest — ties go
 * to the leftmost pair — until `maxBranches` remain (moment-weighted merge). Same result as a
 * linear scan per merge, in O(n log n) with a heap over a linked list.
 */
function mergeClosest(sorted: Branch[], maxBranches: number): Branch[] {
  const n = sorted.length;
  const items = sorted.map((b) => ({ ...b }));
  const next = Array.from({ length: n }, (_, i) => (i + 1 < n ? i + 1 : -1));
  const prev = Array.from({ length: n }, (_, i) => i - 1);
  const alive = new Array<boolean>(n).fill(true);
  const version = new Array<number>(n).fill(0);
  const total = (i: number) => (items[i] as Branch).fixed + (items[i] as Branch).mean;
  // Heap of [gap, left index, left version, right index, right version]; order: gap, then left.
  type H = [number, number, number, number, number];
  const heap: H[] = [];
  const less = (a: H, b: H) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (h: H) => {
    heap.push(h);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i] as H, heap[p] as H)) break;
      [heap[i], heap[p]] = [heap[p] as H, heap[i] as H];
      i = p;
    }
  };
  const pop = (): H | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l] as H, heap[m] as H)) m = l;
        if (r < heap.length && less(heap[r] as H, heap[m] as H)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m] as H, heap[i] as H];
        i = m;
      }
    }
    return top;
  };
  const pair = (i: number) => {
    const j = next[i] as number;
    if (j >= 0) push([total(j) - total(i), i, version[i] as number, j, version[j] as number]);
  };
  for (let i = 0; i + 1 < n; i++) pair(i);
  let count = n;
  while (count > maxBranches) {
    const h = pop();
    if (!h) break;
    const [, i, vi, j, vj] = h;
    if (!alive[i] || !alive[j] || version[i] !== vi || version[j] !== vj || next[i] !== j) continue;
    const a = items[i] as Branch;
    const b = items[j] as Branch;
    const p = a.p + b.p;
    items[i] = {
      p,
      mean: (a.p * a.mean + b.p * b.mean) / p,
      sq: (a.p * a.sq + b.p * b.sq) / p,
      fixed: (a.p * a.fixed + b.p * b.fixed) / p,
    };
    alive[j] = false;
    version[i] = (version[i] as number) + 1;
    const k = next[j] as number;
    next[i] = k;
    if (k >= 0) prev[k] = i;
    count--;
    const pi = prev[i] as number;
    if (pi >= 0) pair(pi);
    pair(i);
  }
  const out: Branch[] = [];
  for (let i = 0; i >= 0 && i < n; i = next[i] as number)
    if (alive[i]) out.push(items[i] as Branch);
  return out;
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
