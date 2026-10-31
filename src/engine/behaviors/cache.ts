/**
 * cache: a fixed hit rate h (node `config.hitRate` if set, else the engine default; the Zipf
 * model comes later). Reads that hit stop here; only misses continue, so the load behind the
 * cache is λ × (1 − h). Works three ways:
 * - cache-aside: the caller has edges to the cache AND to databases/storage → for reads those
 *   data-store calls happen only on a miss (handled by the default combiner via cacheAsideHitRate);
 * - read-through: the cache itself has outgoing edges → reads continue there only on a miss;
 * - explicit flow path: steps after a cache step run only on a miss (unless `cacheable: false`).
 * Writes always go through.
 */
import { choice, EMPTY, isEmpty } from '../model/expr';
import { fmt, pct } from '../model/format';
import type { CompiledNode, EngineOptions } from '../model/types';
import { defineBehavior } from './types';

export function cacheHitRate(node: CompiledNode, options: EngineOptions): number {
  const v = node.config.hitRate;
  return typeof v === 'number' && v >= 0 && v <= 1 ? v : options.defaultCacheHitRate;
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
    const h = cacheHitRate(node, options);
    stats.hitRate = h;
    stats.explain.hitRate =
      `Fixed hit rate h = ${pct(h)}` +
      (node.config.hitRate === undefined ? ' (engine default)' : ' (config.hitRate)') +
      `; reads passed on = λr × (1 − h) = ${fmt(stats.rps.read)} × ${fmt(1 - h)} = ${fmt(stats.rps.read * (1 - h))} rps.`;
  },
});
