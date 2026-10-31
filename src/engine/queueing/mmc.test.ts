import { describe, expect, it } from 'vitest';
import { erlangB, erlangC, expQuantileFactor, mmc } from './mmc';

describe('M/M/c', () => {
  it('M/M/1: C = ρ, Wq = ρ/(μ−λ), T = 1/(μ−λ)', () => {
    // λ = 50, μ = 100: ρ = 0.5, Wq = 0.5/50 s = 10 ms, T = 20 ms, Lq = 0.5
    const r = mmc(50, 100, 1);
    expect(r.rho).toBeCloseTo(0.5, 12);
    expect(r.waitProbability).toBeCloseTo(0.5, 12);
    expect(r.wqMs).toBeCloseTo(10, 9);
    expect(r.tMs).toBeCloseTo(20, 9);
    expect(r.lq).toBeCloseTo(0.5, 12);
  });

  it('M/M/2 matches the Erlang C closed form', () => {
    // a = 1.5, ρ = 0.75: C = (a²/2!)/(1−ρ) / (1 + a + (a²/2!)/(1−ρ)) = 4.5/7 = 0.642857
    // Wq = C/(cμ − λ) = 0.642857/50 s = 12.857 ms; T = 22.857 ms
    const r = mmc(150, 100, 2);
    expect(r.waitProbability).toBeCloseTo(4.5 / 7, 12);
    expect(r.wqMs).toBeCloseTo(12.857142857, 6);
    expect(r.tMs).toBeCloseTo(22.857142857, 6);
  });

  it('Erlang B/C basics', () => {
    expect(erlangB(1, 1)).toBeCloseTo(0.5, 12); // a/(1+a)
    expect(erlangC(1, 0.3)).toBeCloseTo(0.3, 12);
    expect(erlangC(2, 0)).toBe(0);
    expect(erlangC(2, 2)).toBe(1);
  });

  it('stays finite and fast for huge c', () => {
    const r = mmc(10_000, 2000, 50_000);
    expect(r.waitProbability).toBeLessThan(1e-12);
    expect(r.tMs).toBeCloseTo(0.5, 9);
  });

  it('is unstable at ρ ≥ 1', () => {
    const r = mmc(200, 100, 2);
    expect(r.stable).toBe(false);
    expect(r.wqMs).toBe(Infinity);
  });

  it('exponential quantile factor: p99 ≈ T·ln 100', () => {
    expect(expQuantileFactor(0.99)).toBeCloseTo(Math.log(100), 12);
    expect(expQuantileFactor(0.5)).toBeCloseTo(Math.LN2, 12);
  });
});
