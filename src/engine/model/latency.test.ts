import { describe, expect, it } from 'vitest';
import { distMean, fixedDist, mixDist, quantile, stageDist, sumDist, ZERO_DIST } from './latency';

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
