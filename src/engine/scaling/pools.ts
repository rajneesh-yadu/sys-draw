/**
 * Horizontal and data scaling: how a node's traffic is spread over its instances.
 *
 * A node is a set of instance POOLS; every instance in a pool receives the same share of the
 * node's reads and writes and is its own M/M/c queue (c = servers per instance):
 * - stateless replicas: N instances, reads and writes split evenly — except behind a
 *   consistent-hash LB, where the hottest instance gets f(N, V) × the average (ring imbalance);
 * - single-writer store (scaleCurve `single-writer`): per shard ONE primary takes every write,
 *   reads spread over the primary and its R read replicas (R = readReplicas + replicas − 1);
 * - sharded store: S shards; the hottest takes max(skew, 1/S) of the traffic, the rest share
 *   the remainder evenly;
 * - platform-scaled (serverless): one logical pool whose servers = concurrency limit.
 * Shares are fractions of the node's total λ per instance, so Σ count × share = 1.
 */
import { fmt, pct } from '../model/format';

export interface ScaleSpec {
  /** vCPU of the chosen size / baseline size (first instance type). */
  vcpuRatio: number;
  /** Service-rate multiplier from vertical scaling (μ = μ_base × speedup). */
  speedup: number;
  verticalExplain: string;
  singleWriter: boolean;
  /** Configured read replicas per shard (role `readReplicas`), single-writer stores only. */
  readReplicas: number;
  /** Billed standbys per shard (role `standby`). */
  standby: number;
  shards: number;
  /** Share of all traffic on the hottest shard, in [1/shards, 1]. */
  hotShardShare: number;
  /** Platform-managed concurrency (serverless): pool servers = maxInstances × c. */
  platform?: { maxInstances: number; minInstances: number } | undefined;
  /** Consistent-hash ring points per instance set by an upstream LB (undefined = even split). */
  hashVirtualNodes?: number | undefined;
  storageGb: number;
  storageCopies?: number | undefined;
}

export const EVEN_SPEC: Readonly<ScaleSpec> = Object.freeze({
  vcpuRatio: 1,
  speedup: 1,
  verticalExplain: '',
  singleWriter: false,
  readReplicas: 0,
  standby: 0,
  shards: 1,
  hotShardShare: 1,
  storageGb: 0,
});

export interface Pool {
  /** Short name for explain strings: 'replica', 'primary', 'read replica', 'hot shard primary'… */
  label: string;
  /** Instances in this pool. */
  count: number;
  /** Parallel servers per instance (M/M/c's c). */
  servers: number;
  /** Fraction of the node's reads / writes received by EACH instance of this pool. */
  readShare: number;
  writeShare: number;
}

/**
 * Hottest-instance load ÷ average load for consistent hashing with V ring points per instance:
 * each instance's arc share has relative spread ≈ 1/√V, and the maximum of N such shares sits
 * about √(2 ln N) standard deviations above the mean ⇒ f = 1 + √(2 ln N / V), capped at N.
 */
export function consistentHashImbalance(instances: number, virtualNodes: number): number {
  if (instances <= 1 || virtualNodes <= 0) return 1;
  return Math.min(instances, 1 + Math.sqrt((2 * Math.log(instances)) / virtualNodes));
}

/** Read replicas per shard for a single-writer store with `replicas` instances configured. */
export function readersPerShard(spec: ScaleSpec, replicas: number): number {
  return spec.readReplicas + Math.max(0, replicas - 1);
}

/** Instances that serve traffic (all shards), not counting standbys. */
export function servingInstances(spec: ScaleSpec, replicas: number): number {
  if (spec.platform) return 1;
  const perShard = spec.singleWriter ? 1 + readersPerShard(spec, replicas) : replicas;
  return spec.shards * perShard;
}

export function buildPools(spec: ScaleSpec, replicas: number, serversPerInstance: number): Pool[] {
  const S = Math.max(1, Math.round(spec.shards));
  const hot = Math.min(1, Math.max(1 / S, spec.hotShardShare));
  const shardGroups: { n: number; share: number; tag: string }[] =
    S === 1
      ? [{ n: 1, share: 1, tag: '' }]
      : hot <= 1 / S + 1e-12
        ? [{ n: S, share: 1 / S, tag: '' }]
        : [
            { n: 1, share: hot, tag: 'hot shard ' },
            { n: S - 1, share: (1 - hot) / (S - 1), tag: '' },
          ];

  const perShard: Pool[] = [];
  if (spec.platform) {
    perShard.push({
      label: 'function instances',
      count: 1,
      servers: Math.max(1, spec.platform.maxInstances) * serversPerInstance,
      readShare: 1,
      writeShare: 1,
    });
  } else if (spec.singleWriter) {
    const R = readersPerShard(spec, replicas);
    perShard.push({
      label: 'primary',
      count: 1,
      servers: serversPerInstance,
      readShare: 1 / (1 + R),
      writeShare: 1,
    });
    if (R > 0) {
      perShard.push({
        label: 'read replica',
        count: R,
        servers: serversPerInstance,
        readShare: 1 / (1 + R),
        writeShare: 0,
      });
    }
  } else {
    const N = Math.max(1, Math.round(replicas));
    const f =
      spec.hashVirtualNodes !== undefined ? consistentHashImbalance(N, spec.hashVirtualNodes) : 1;
    if (N > 1 && f > 1 + 1e-12) {
      const hotShare = f / N;
      const rest = (1 - hotShare) / (N - 1);
      perShard.push({
        label: 'hottest replica',
        count: 1,
        servers: serversPerInstance,
        readShare: hotShare,
        writeShare: hotShare,
      });
      perShard.push({
        label: 'replica',
        count: N - 1,
        servers: serversPerInstance,
        readShare: rest,
        writeShare: rest,
      });
    } else {
      perShard.push({
        label: 'replica',
        count: N,
        servers: serversPerInstance,
        readShare: 1 / N,
        writeShare: 1 / N,
      });
    }
  }

  const pools: Pool[] = [];
  for (const g of shardGroups) {
    for (const p of perShard) {
      if (p.count <= 0) continue;
      pools.push({
        label: `${g.tag}${p.label}`,
        count: p.count * g.n,
        servers: p.servers,
        readShare: p.readShare * g.share,
        writeShare: p.writeShare * g.share,
      });
    }
  }
  return pools;
}

/** Utilisation of one instance of `pool` (ρ = work per second / servers). */
export function poolUtilization(
  pool: Pool,
  rps: { read: number; write: number },
  serviceMs: { read: number; write: number },
): number {
  const work =
    (rps.read * pool.readShare * serviceMs.read + rps.write * pool.writeShare * serviceMs.write) /
    1000;
  return work / pool.servers;
}

/**
 * Max throughput (rps) of the node for the given read/write MIX: the λ at which the busiest
 * instance reaches ρ = 1. With no traffic yet, a read-only mix is assumed.
 */
export function capacityForMix(
  pools: readonly Pool[],
  rps: { read: number; write: number },
  serviceMs: { read: number; write: number },
): number {
  const total = rps.read + rps.write;
  const mix =
    total > 0 ? { read: rps.read / total, write: rps.write / total } : { read: 1, write: 0 };
  let worst = 0;
  for (const p of pools) worst = Math.max(worst, poolUtilization(p, mix, serviceMs));
  return worst > 0 ? 1 / worst : Infinity;
}

/** One line describing the pools, for explain strings. */
export function describePools(spec: ScaleSpec, pools: readonly Pool[]): string {
  const parts = pools.map(
    (p) =>
      `${p.count}× ${p.label} (c = ${fmt(p.servers)}; each gets ${pct(p.readShare)} of reads, ${pct(p.writeShare)} of writes)`,
  );
  const notes: string[] = [];
  if (spec.singleWriter) {
    notes.push('single-writer: only the primary takes writes, so replicas add read capacity only');
  }
  if (spec.shards > 1) {
    notes.push(
      `${spec.shards} shards, hottest gets max(skew, 1/S) = ${pct(Math.max(spec.hotShardShare, 1 / spec.shards))} of traffic`,
    );
  }
  if (spec.hashVirtualNodes !== undefined) {
    notes.push(
      `consistent hashing, V = ${fmt(spec.hashVirtualNodes)} ring points: hottest replica gets f = 1 + √(2 ln N / V) × the average`,
    );
  }
  if (spec.platform) {
    notes.push(`platform-scaled up to ${fmt(spec.platform.maxInstances)} concurrent instances`);
  }
  return parts.join(' + ') + (notes.length > 0 ? `. ${notes.join('; ')}.` : '.');
}
