/**
 * Cache hit rate from key popularity (Zipf) vs cache capacity, under the independent reference
 * model (each request picks key i with probability p_i = i^(−s) / H(N, s)).
 *
 * - `lfu` (keeps the C most popular keys): h = H(C, s) / H(N, s).
 * - `lru` (Che's approximation): find τ with Σ (1 − e^(−p_i τ)) = C; h = Σ p_i (1 − e^(−p_i τ)).
 * - `random` / `fifo`: find τ with Σ p_i τ / (1 + p_i τ) = C; h = Σ p_i · p_i τ / (1 + p_i τ).
 * These are rate-free: the hit rate depends on popularity and capacity only.
 * Sums over up to 10^12 keys use the first EXACT_RANKS ranks exactly, then geometric rank buckets.
 */

export type EvictionModel = 'lfu' | 'lru' | 'random';

const EXACT_RANKS = 2000;
const BUCKET_RATIO = 1.02;

/** Generalised harmonic number H(n, s) = Σ_{i=1..n} i^(−s) (Euler–Maclaurin beyond 10 000). */
export function harmonic(n: number, s: number): number {
  const N = Math.max(0, Math.floor(n));
  const m = Math.min(N, 10_000);
  let sum = 0;
  for (let i = 1; i <= m; i++) sum += i ** -s;
  if (N <= m) return sum;
  const f = (x: number) => x ** -s;
  const integral =
    Math.abs(s - 1) < 1e-12 ? Math.log(N / m) : (N ** (1 - s) - m ** (1 - s)) / (1 - s);
  return sum + integral + (f(N) - f(m)) / 2 + (s * (m ** (-s - 1) - N ** (-s - 1))) / 12;
}

interface Bucket {
  /** Keys in the bucket. */
  n: number;
  /** Popularity of one key in it. */
  p: number;
}

function buckets(N: number, s: number): Bucket[] {
  const H = harmonic(N, s);
  const out: Bucket[] = [];
  const exact = Math.min(N, EXACT_RANKS);
  for (let i = 1; i <= exact; i++) out.push({ n: 1, p: i ** -s / H });
  let lo = exact + 1;
  while (lo <= N) {
    const hi = Math.min(N, Math.max(lo, Math.floor(lo * BUCKET_RATIO)));
    const n = hi - lo + 1;
    // mean popularity over the bucket's ranks: ∫ x^(−s) over [lo − ½, hi + ½] ÷ n
    const a = lo - 0.5;
    const b = hi + 0.5;
    const area =
      Math.abs(s - 1) < 1e-12 ? Math.log(b / a) : (b ** (1 - s) - a ** (1 - s)) / (1 - s);
    const p = area / n / H;
    out.push({ n, p });
    lo = hi + 1;
  }
  return out;
}

function solveTau(bs: readonly Bucket[], C: number, occupancy: (x: number) => number): number {
  const filled = (tau: number) => bs.reduce((a, b) => a + b.n * occupancy(b.p * tau), 0);
  let lo = 0;
  let hi = 1;
  while (filled(hi) < C && hi < 1e30) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (filled(mid) < C) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const memo = new Map<string, number>();

/** Hit rate for N keys, room for C, Zipf exponent s, eviction model. 1 when everything fits. */
export function zipfHitRate(N: number, C: number, s: number, model: EvictionModel): number {
  const n = Math.max(1, Math.floor(N));
  const c = Math.max(0, Math.floor(C));
  if (c >= n) return 1;
  if (c === 0) return 0;
  const key = `${model}|${n}|${c}|${s}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let h: number;
  if (model === 'lfu') h = harmonic(c, s) / harmonic(n, s);
  else {
    const bs = buckets(n, s);
    const occ = model === 'lru' ? (x: number) => 1 - Math.exp(-x) : (x: number) => x / (1 + x);
    const tau = solveTau(bs, c, occ);
    h = bs.reduce((a, b) => a + b.n * b.p * occ(b.p * tau), 0);
  }
  h = Math.min(1, Math.max(0, h));
  if (memo.size > 500) memo.clear();
  memo.set(key, h);
  return h;
}

/** Maps a component's eviction policy name to the model above. */
export function evictionModel(policy: string | undefined): EvictionModel {
  const p = (policy ?? 'lru').toLowerCase();
  if (p.includes('lfu')) return 'lfu';
  if (p.includes('random') || p.includes('fifo') || p === 'noeviction') return 'random';
  return 'lru'; // lru, allkeys-lru, volatile-lru, ttl, volatile-ttl
}
