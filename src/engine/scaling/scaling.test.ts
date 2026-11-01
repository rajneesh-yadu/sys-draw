/** Pure scaling math: vertical curves, pools, hash imbalance, autoscaling. Values by hand. */
import { describe, expect, it } from 'vitest';
import { registry } from '@/registry';
import { autoscaleTimeline, desiredReplicas } from './autoscale';
import {
  buildPools,
  capacityForMix,
  consistentHashImbalance,
  EVEN_SPEC,
  servingInstances,
  type ScaleSpec,
} from './pools';
import { scalingFields } from './roles';
import { AMDAHL_PARALLEL_FRACTION, verticalSpeedup } from './vertical';

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const spec = (p: Partial<ScaleSpec>): ScaleSpec => ({ ...EVEN_SPEC, ...p });

describe('vertical scaling', () => {
  it('linear: f(k) = k', () => {
    expect(verticalSpeedup('linear', 4)).toBe(4);
    expect(verticalSpeedup('linear', 1)).toBe(1);
  });
  it("sublinear and single-writer follow Amdahl's law with p = 0.9", () => {
    expect(AMDAHL_PARALLEL_FRACTION).toBe(0.9);
    close(verticalSpeedup('sublinear', 2), 1 / (0.1 + 0.45)); // 1.818182
    close(verticalSpeedup('single-writer', 4), 1 / (0.1 + 0.225)); // 3.076923
    close(verticalSpeedup('sublinear', 1), 1);
    expect(verticalSpeedup('sublinear', 1000)).toBeLessThan(10); // ceiling 1/(1−p)
  });
});

describe('consistent-hash imbalance', () => {
  it('f = 1 + √(2 ln N / V), 1 for a single instance', () => {
    close(consistentHashImbalance(2, 100), 1 + Math.sqrt((2 * Math.LN2) / 100)); // 1.117741
    close(consistentHashImbalance(10, 100), 1.214597, 1e-5);
    expect(consistentHashImbalance(1, 100)).toBe(1);
    expect(consistentHashImbalance(4, 1)).toBeLessThanOrEqual(4); // capped at N
    expect(consistentHashImbalance(10, 1000)).toBeLessThan(consistentHashImbalance(10, 100));
  });
});

describe('instance pools', () => {
  const S = { read: 10, write: 10 };

  it('stateless replicas split evenly; shares sum to 1', () => {
    const pools = buildPools(spec({}), 4, 1);
    expect(pools).toEqual([
      { label: 'replica', count: 4, servers: 1, readShare: 0.25, writeShare: 0.25 },
    ]);
    close(capacityForMix(pools, { read: 1, write: 0 }, S), 400);
  });

  it('single-writer: primary takes all writes, reads spread over primary + replicas', () => {
    const pools = buildPools(spec({ singleWriter: true, readReplicas: 1 }), 2, 1); // R = 1 + (2−1) = 2
    expect(pools.map((p) => [p.label, p.count, p.readShare, p.writeShare])).toEqual([
      ['primary', 1, 1 / 3, 1],
      ['read replica', 2, 1 / 3, 0],
    ]);
    expect(servingInstances(spec({ singleWriter: true, readReplicas: 1 }), 2)).toBe(3);
    // Reads: 3 instances × 100 = 300 rps. Writes: only the primary, 100 rps — replicas don't help.
    close(capacityForMix(pools, { read: 1, write: 0 }, S), 300);
    close(capacityForMix(pools, { read: 0, write: 1 }, S), 100);
    const noReplicas = buildPools(spec({ singleWriter: true }), 1, 1);
    close(capacityForMix(noReplicas, { read: 0, write: 1 }, S), 100);
  });

  it('shards with key skew: the hottest shard takes max(skew, 1/S)', () => {
    const even = buildPools(spec({ shards: 4, hotShardShare: 0.25 }), 1, 1);
    expect(even).toHaveLength(1);
    close(capacityForMix(even, { read: 1, write: 0 }, S), 400);
    const skewed = buildPools(spec({ shards: 4, hotShardShare: 0.5 }), 1, 1);
    expect(skewed.map((p) => [p.label, p.count])).toEqual([
      ['hot shard replica', 1],
      ['replica', 3],
    ]);
    close(skewed[1]!.readShare, 0.5 / 3);
    close(capacityForMix(skewed, { read: 1, write: 0 }, S), 200); // hot shard at 100 rps = 50 %
    // Doubling shards does not help a hot key.
    const doubled = buildPools(spec({ shards: 8, hotShardShare: 0.5 }), 1, 1);
    close(capacityForMix(doubled, { read: 1, write: 0 }, S), 200);
  });

  it('sharded single-writer: writes scale with shards, not replicas', () => {
    const p = buildPools(
      spec({ singleWriter: true, shards: 2, hotShardShare: 0.5, readReplicas: 3 }),
      1,
      1,
    );
    close(capacityForMix(p, { read: 0, write: 1 }, S), 200);
    close(capacityForMix(p, { read: 1, write: 0 }, S), 800);
  });

  it('consistent hashing loads the hottest replica f × the average', () => {
    const pools = buildPools(spec({ hashVirtualNodes: 100 }), 2, 1);
    const f = consistentHashImbalance(2, 100);
    close(pools[0]!.readShare, f / 2);
    close(pools[1]!.readShare, 1 - f / 2);
    close(capacityForMix(pools, { read: 1, write: 0 }, S), 100 / (f / 2));
  });

  it('platform-scaled: one pool with servers = concurrency limit × c', () => {
    const pools = buildPools(spec({ platform: { maxInstances: 50, minInstances: 0 } }), 1, 1);
    expect(pools).toEqual([
      { label: 'function instances', count: 1, servers: 50, readShare: 1, writeShare: 1 },
    ]);
  });
});

describe('autoscaling', () => {
  const policy = { min: 1, max: 10, targetUtil: 0.5, warmupSec: 3 };

  it('desired = clamp(⌈ρ₁ / target⌉, min, max)', () => {
    expect(desiredReplicas(1.6, policy)).toBe(4);
    expect(desiredReplicas(1.5, policy)).toBe(3);
    expect(desiredReplicas(0, policy)).toBe(1);
    expect(desiredReplicas(100, policy)).toBe(10);
  });

  it('timeline: new replicas serve only after warm-up; scale-in waits for the cooldown', () => {
    const load = [100, 100, 300, 300, 300, 300, 300, 50, 50, 50, 50];
    const t = autoscaleTimeline(policy, load, {
      capacityPerReplicaRps: 100,
      scaleInCooldownSec: 2,
    });
    expect(t.map((x) => x.replicas)).toEqual([1, 1, 1, 2, 2, 6, 6, 6, 6, 1, 1]);
    expect(t.map((x) => x.warming)).toEqual([1, 1, 5, 4, 4, 0, 0, 0, 0, 0, 0]);
    expect(t.map((x) => x.desired)).toEqual([2, 2, 6, 6, 6, 6, 6, 1, 1, 1, 1]);
    close(t[2]!.utilization, 3); // 300 rps on one replica while the rest warm up
    close(t[5]!.utilization, 0.5);
  });

  it('timeline with no warm-up reacts in the same tick, and respects max', () => {
    const t = autoscaleTimeline({ ...policy, warmupSec: 0, max: 3 }, [100, 1000], {
      capacityPerReplicaRps: 100,
    });
    expect(t.map((x) => x.replicas)).toEqual([2, 3]);
  });
});

describe('scaling roles in the app registry', () => {
  const roles = (id: string) =>
    Object.fromEntries(scalingFields(registry.require(id, 'component')));

  it('SQL: read replicas, standby, shards, skew, storage', () => {
    expect(roles('database.sql')).toEqual({
      storageGb: 'storageGb',
      readReplicas: 'readReplicas',
      standby: 'multiAz',
      shards: 'shards',
      keySkew: 'shardKeySkew',
    });
  });
  it('NoSQL partitions are shards; cache shards; serverless concurrency', () => {
    expect(roles('database.nosql')).toMatchObject({
      shards: 'partitions',
      keySkew: 'hotKeySkew',
      storageCopies: 'replicationFactor',
    });
    expect(roles('cache.in-memory')).toEqual({ shards: 'shards' });
    expect(roles('compute.serverless-function')).toEqual({
      maxInstances: 'concurrencyLimit',
      minInstances: 'provisionedConcurrency',
    });
    expect(roles('compute.app-server')).toEqual({});
  });
});
