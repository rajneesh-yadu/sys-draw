/** Hand-computed checks for the behavior math helpers (order statistics, Zipf, perf effects). */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registry } from '@/registry';
import { kthOfN, maxOfN, replicasFor } from './order-stats';
import { activeEffects, perfEffectsOf } from './perf-effects';
import { evictionModel, harmonic, zipfHitRate } from './zipf';

const close = (a: number, b: number, tol = 1e-3) =>
  expect(Math.abs(a - b) / Math.max(1e-12, Math.abs(b)), `${a} vs ${b}`).toBeLessThanOrEqual(tol);

describe('order statistics of exponential replicas', () => {
  it('k-th fastest of n: S × Σ_{i=n−k+1..n} 1/i', () => {
    close(kthOfN(1, 3), 1 / 3);
    close(kthOfN(2, 3), 1 / 3 + 1 / 2); // 0.8333
    close(kthOfN(3, 3, 2), 2 * (1 / 3 + 1 / 2 + 1)); // 3.6667
    close(maxOfN(4), 1 + 1 / 2 + 1 / 3 + 1 / 4); // H_4 = 2.0833
    expect(kthOfN(0, 3)).toBe(0);
  });

  it('consistency levels map to replica counts', () => {
    expect(replicasFor('QUORUM', 3)).toBe(2);
    expect(replicasFor('LOCAL_QUORUM', 5)).toBe(3);
    expect(replicasFor('ONE', 3)).toBe(1);
    expect(replicasFor('ALL', 3)).toBe(3);
    expect(replicasFor('TWO', 1)).toBe(1);
  });
});

describe('Zipf hit rate', () => {
  it('harmonic numbers: exact and Euler–Maclaurin agree', () => {
    close(harmonic(3, 1), 1 + 1 / 2 + 1 / 3);
    let exact = 0;
    for (let i = 1; i <= 50_000; i++) exact += i ** -0.8;
    close(harmonic(50_000, 0.8), exact, 1e-9);
    let exact1 = 0;
    for (let i = 1; i <= 50_000; i++) exact1 += 1 / i;
    close(harmonic(50_000, 1), exact1, 1e-9);
  });

  it('two keys (p = 2/3, 1/3), room for one — solved by hand', () => {
    // LFU keeps key 1: h = 2/3.
    close(zipfHitRate(2, 1, 1, 'lfu'), 2 / 3);
    // LRU (Che): x = e^(−τ/3), x² + x = 1 ⇒ x = 0.618; h = ⅔(1 − x²) + ⅓(1 − x) = 0.53934.
    close(zipfHitRate(2, 1, 1, 'lru'), 0.5393446629);
    // Random: a = τ/3, 2a² = 1 ⇒ a = 0.7071; h = ⅔·2a/(1+2a) + ⅓·a/(1+a) = 0.52860.
    close(zipfHitRate(2, 1, 1, 'random'), 0.5286, 1e-3);
  });

  it('a million keys, 10% cached, s = 0.8 — matches the exact sums within 1%', () => {
    // Reference values from exact sums over all 10^6 keys (numpy + brentq).
    close(zipfHitRate(1e6, 1e5, 0.8, 'lfu'), 0.6090664, 1e-3);
    close(zipfHitRate(1e6, 1e5, 0.8, 'lru'), 0.4871133, 0.01);
    close(zipfHitRate(1e6, 1e5, 0.8, 'random'), 0.4481733, 0.01);
  });

  it('is 1 when everything fits, 0 with no room, and grows with capacity and skew', () => {
    expect(zipfHitRate(100, 100, 0.8, 'lru')).toBe(1);
    expect(zipfHitRate(100, 0, 0.8, 'lru')).toBe(0);
    const small = zipfHitRate(1e8, 1e6, 0.8, 'lru');
    const big = zipfHitRate(1e8, 1e7, 0.8, 'lru');
    expect(big).toBeGreaterThan(small);
    expect(zipfHitRate(1e8, 1e6, 1.1, 'lru')).toBeGreaterThan(small);
    expect(zipfHitRate(1e8, 1e6, 0, 'lru')).toBeCloseTo(0.01, 3); // uniform: C/N
  });

  it('maps eviction policy names', () => {
    expect(evictionModel('allkeys-lfu')).toBe('lfu');
    expect(evictionModel('allkeys-random')).toBe('random');
    expect(evictionModel('volatile-ttl')).toBe('lru');
    expect(evictionModel(undefined)).toBe('lru');
  });
});

describe('perf effects declared on config fields', () => {
  it('reads the map through wrappers and validates it', () => {
    const f = z
      .enum(['a', 'b'])
      .meta({ perfEffect: { b: { write: 2, why: 'because' } } })
      .optional();
    expect(perfEffectsOf(f)).toEqual({ b: { write: 2, why: 'because' } });
    expect(perfEffectsOf(z.string().meta({ perfEffect: { x: { why: '' } } }))).toBeUndefined();
  });

  it('every registry perfEffect is valid and keyed by a real option', () => {
    for (const def of registry.list({ kind: 'component' })) {
      for (const [field, schema] of Object.entries(def.configSchema.shape)) {
        const meta = (schema as { meta?: () => Record<string, unknown> | undefined }).meta?.();
        if (meta?.perfEffect === undefined) continue;
        const map = perfEffectsOf(schema);
        expect(map, `${def.id}.${field}`).toBeDefined();
        for (const value of Object.keys(map ?? {})) {
          const probe = value === 'true' ? true : value === 'false' ? false : value;
          expect(
            (schema as z.ZodType).safeParse(probe).success,
            `${def.id}.${field} = ${value}`,
          ).toBe(true);
        }
      }
    }
  });

  it('picks the effects for the configured options', () => {
    const kafka = registry.require('messaging.kafka', 'component');
    expect(activeEffects(kafka, { acks: 'all' }).map((e) => e.writeAddMs)).toEqual([2]);
    expect(activeEffects(kafka, { acks: '1' })).toEqual([]);
  });
});
