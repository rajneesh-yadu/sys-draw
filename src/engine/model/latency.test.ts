import { describe, expect, it } from 'vitest';
import {
  distMean,
  fixedDist,
  mixDist,
  quantile,
  stageDist,
  sumDist,
  ZERO_DIST,
  type Branch,
  type Dist,
} from './latency';

describe('latency composition', () => {
  it('one exponential stage is exact', () => {
    const d = stageDist(20);
    expect(quantile(d, 0.5)).toBeCloseTo(20 * Math.LN2, 9);
    expect(quantile(d, 0.99)).toBeCloseTo(20 * Math.log(100), 9);
    expect(distMean(d)).toBe(20);
  });

  it('stages add: sum of means + RSS of tail excess', () => {
    // means 30 and 40: Σ = 70, θ = 50 ⇒ p99 = 70 + 50·(ln100 − 1)
    const d = sumDist(stageDist(30), stageDist(40), 32);
    expect(quantile(d, 0.99)).toBeCloseTo(70 + 50 * (Math.log(100) - 1), 9);
    expect(distMean(d)).toBeCloseTo(70, 12);
  });

  it('fixed latency shifts every percentile', () => {
    const d = sumDist(stageDist(10), fixedDist(5), 32);
    expect(quantile(d, 0.5)).toBeCloseTo(5 + 10 * Math.LN2, 9);
  });

  it('mixture percentiles sit between the branches and the mean is weighted', () => {
    const d = mixDist(
      [
        { p: 0.9, dist: stageDist(1) },
        { p: 0.1, dist: stageDist(100) },
      ],
      32,
    );
    expect(distMean(d)).toBeCloseTo(0.9 + 10, 12);
    const p99 = quantile(d, 0.99);
    expect(p99).toBeGreaterThan(quantile(stageDist(1), 0.99));
    expect(p99).toBeLessThan(quantile(stageDist(100), 0.99));
    // F(p99) = 0.99
    const F = 0.9 * (1 - Math.exp(-p99 / 1)) + 0.1 * (1 - Math.exp(-p99 / 100));
    expect(F).toBeCloseTo(0.99, 8);
  });

  it('caps branches while keeping the mean', () => {
    const parts = Array.from({ length: 100 }, (_, i) => ({ p: 0.01, dist: stageDist(i + 1) }));
    const d = mixDist(parts, 8);
    expect(d.length).toBeLessThanOrEqual(8);
    expect(distMean(d)).toBeCloseTo(50.5, 9);
  });

  it('zero distribution', () => {
    expect(quantile(ZERO_DIST, 0.99)).toBe(0);
  });
});

describe('branch compaction (S11 heap merge)', () => {
  /** The S07 reference: scan for the closest adjacent pair on every merge. */
  function reference(parts: { p: number; dist: Dist }[], max: number): Dist {
    const byKey = new Map<string, Branch>();
    for (const { p, dist } of parts)
      for (const b0 of dist) {
        const b = { ...b0, p: b0.p * p };
        if (b.p <= 0) continue;
        const key = `${b.mean.toPrecision(12)}|${b.sq.toPrecision(12)}|${b.fixed.toPrecision(12)}`;
        const prev = byKey.get(key);
        if (prev) prev.p += b.p;
        else byKey.set(key, { ...b });
      }
    const list = [...byKey.values()].sort((x, y) => x.fixed + x.mean - (y.fixed + y.mean));
    while (list.length > max) {
      let best = 0;
      let bestGap = Infinity;
      for (let i = 0; i + 1 < list.length; i++) {
        const gap = list[i + 1]!.fixed + list[i + 1]!.mean - (list[i]!.fixed + list[i]!.mean);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
      const a = list[best]!;
      const b = list[best + 1]!;
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

  it('gives exactly the same branches as the linear-scan merge (random mixtures, ties included)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(rnd() * 120);
      const parts = Array.from({ length: n }, () => {
        // Coarse values create equal totals (ties) on purpose.
        const m = Math.round(rnd() * 20);
        const f = Math.round(rnd() * 10);
        return { p: 1 / n, dist: sumDist(stageDist(m), fixedDist(f), 32) };
      });
      const max = 1 + Math.floor(rnd() * 32);
      expect(mixDist(parts, max)).toEqual(reference(parts, max));
    }
  });
});
