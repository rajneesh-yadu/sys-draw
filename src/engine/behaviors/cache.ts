/**
 * cache: reads that hit stop here; only misses continue, so the load behind the cache is
 * λ × (1 − h). Works cache-aside (the caller's data-store calls happen only on a miss),
 * read-through (the cache's own outgoing edges) and on explicit flow paths. Writes always go through.
 *
 * Hit rate h (S13: Zipf model, ENGINE.md):
 * - `config.hitRate` set → that fixed value (an override for what-if questions);
 * - `config.keyCount` + `config.avgItemBytes` → Zipf popularity (`zipfExponent`, default 0.8)
 *   vs capacity C = memory × usable ÷ (item + 64 B key overhead), memory = instance GB × the
 *   instances that hold distinct keys (shards); eviction from `evictionPolicy` (lib/zipf.ts);
 * - otherwise the engine default (`EngineOptions.defaultCacheHitRate`).
 * Replicas hold copies (no extra capacity); whether they serve reads is `replicaReads`.
 * Not modelled: TTL expiry before eviction (needs per-key rates) and write invalidations.
 */
import { choice, EMPTY, isEmpty } from '../model/expr';
import { fmt, pct } from '../model/format';
import type { CompiledNode, EngineOptions } from '../model/types';
import { num, str } from './lib/config';
import { evictionModel, zipfHitRate } from './lib/zipf';
import { defineBehavior } from './types';

/** Per-item bookkeeping (key, pointers, expiry) added to the value size. */
export const CACHE_ITEM_OVERHEAD_BYTES = 64;
export const DEFAULT_ZIPF_EXPONENT = 0.8;
export const DEFAULT_USABLE_MEMORY = 0.75;

export interface CacheModel {
  hitRate: number;
  source: 'config' | 'zipf' | 'default';
  explain: string;
}

/** Items the cache can hold: memory × usable ÷ (item + overhead). */
export function cacheCapacityItems(node: CompiledNode): number | undefined {
  const itemBytes = num(node, 'avgItemBytes');
  const memGb = node.instanceType?.memGb;
  if (itemBytes === undefined || memGb === undefined) return undefined;
  const usable = num(node, 'usableMemoryFraction') ?? DEFAULT_USABLE_MEMORY;
  const bytes = memGb * 2 ** 30 * Math.max(1, node.scale.shards) * usable;
  return Math.floor(bytes / (itemBytes + CACHE_ITEM_OVERHEAD_BYTES));
}

export function cacheModel(node: CompiledNode, options: EngineOptions): CacheModel {
  const fixed = node.config.hitRate;
  if (typeof fixed === 'number' && fixed >= 0 && fixed <= 1) {
    return {
      hitRate: fixed,
      source: 'config',
      explain: `Fixed hit rate h = ${pct(fixed)} (config.hitRate).`,
    };
  }
  const N = num(node, 'keyCount');
  const C = cacheCapacityItems(node);
  if (N === undefined || C === undefined) {
    const h = options.defaultCacheHitRate;
    return {
      hitRate: h,
      source: 'default',
      explain: `Fixed hit rate h = ${pct(h)} (engine default).`,
    };
  }
  const s = num(node, 'zipfExponent') ?? DEFAULT_ZIPF_EXPONENT;
  const policy = str(node, 'evictionPolicy');
  const model = evictionModel(policy);
  const h = zipfHitRate(N, C, s, model);
  const usable = num(node, 'usableMemoryFraction') ?? DEFAULT_USABLE_MEMORY;
  const formula =
    model === 'lfu'
      ? 'h = H(C,s)/H(N,s) (LFU keeps the C most popular keys)'
      : model === 'lru'
        ? "Che's approximation for LRU: Σ(1 − e^(−p_i·τ)) = C, h = Σ p_i(1 − e^(−p_i·τ))"
        : 'random replacement: Σ p_i·τ/(1 + p_i·τ) = C, h = Σ p_i²τ/(1 + p_i·τ)';
  return {
    hitRate: h,
    source: 'zipf',
    explain:
      `Zipf popularity p_i ∝ i^(−${fmt(s)}) over N = ${fmt(N)} keys. Capacity C = ${fmt(node.instanceType?.memGb ?? 0)} GB × ${node.scale.shards} shard(s) × ${pct(usable)} usable ÷ (${fmt(num(node, 'avgItemBytes') ?? 0)} + ${CACHE_ITEM_OVERHEAD_BYTES} B) = ${fmt(C)} items` +
      (C >= N
        ? ' ≥ N: everything fits, h = 100%.'
        : ` (${pct(C / N)} of keys). ${formula} ⇒ h = ${pct(h)} (eviction: ${policy ?? 'lru'}).`) +
      ' TTL expiry and write invalidation are not modelled.',
  };
}

export function cacheHitRate(node: CompiledNode, options: EngineOptions): number {
  return cacheModel(node, options).hitRate;
}

export const behavior = defineBehavior({
  id: 'cache',
  routeOut({ node, op, calls, combine, options }) {
    if (op !== 'read' || calls.length === 0) return undefined;
    const h = cacheHitRate(node, options);
    return choice([
      { p: h, expr: EMPTY },
      { p: 1 - h, expr: combine(calls) },
    ]);
  },
  routeRest({ node, op, step, rest, options }) {
    if (op !== 'read' || step.cacheable === false || isEmpty(rest)) return undefined;
    const h = cacheHitRate(node, options);
    return choice([
      { p: h, expr: EMPTY },
      { p: 1 - h, expr: rest },
    ]);
  },
  cacheAsideHitRate(node, options) {
    return node.kind === 'service' ? cacheHitRate(node, options) : undefined;
  },
  finish({ node, stats, options }) {
    const m = cacheModel(node, options);
    const h = m.hitRate;
    stats.hitRate = h;
    stats.explain.hitRate =
      `${m.explain} Reads passed on = λr × (1 − h) = ${fmt(stats.rps.read)} × ${fmt(1 - h)} = ${fmt(stats.rps.read * (1 - h))} rps.` +
      (str(node, 'evictionPolicy') === 'noeviction'
        ? ' noeviction: once memory is full, writes of new keys fail (OOM) instead of evicting.'
        : '');
  },
});
