/**
 * S19 design review: a database serving a hot, read-mostly load with no cache in front (none of
 * its callers also calls a cache). Needs a simulation result. Fix: add a Redis cache next to the
 * database and connect its callers (cache-aside: the engine then sends reads to the DB on a miss).
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import {
  defOf,
  incoming,
  isCacheDef,
  isComputeDef,
  isDatabaseDef,
  metricsOf,
  nodeMap,
  outgoing,
  round,
  writeShare,
} from '../design-tools';

const ID = 'rule.no-cache-hot-read';
/** A read path counts as hot from this rate, or from this utilisation of the database. */
export const HOT_READ_RPS = 1000;
export const HOT_READ_UTILIZATION = 0.7;

export default defineRule({
  id: ID,
  title: 'No cache on a hot read path',
  category: 'performance',
  severity: 'warning',
  tags: ['caching', 'cache-aside', 'read-heavy', 'database'],
  appliesTo: { categories: ['database'], needs: ['result'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      if (!isDatabaseDef(defOf(ctx, n))) continue;
      const m = metricsOf(ctx, n.id);
      if (!m || (m.rpsIn < HOT_READ_RPS && m.utilization < HOT_READ_UTILIZATION)) continue;
      const ws = writeShare(ctx, n.id);
      if (ws !== undefined && ws >= 0.5) continue;
      const callers = incoming(ctx.graph, n.id)
        .map((e) => byId.get(e.source))
        .filter((c) => c !== undefined);
      if (callers.some((c) => isCacheDef(defOf(ctx, c)))) continue; // read-through cache
      const services = callers.filter((c) => isComputeDef(defOf(ctx, c)));
      if (services.length === 0) continue;
      const cached = services.some((s) =>
        outgoing(ctx.graph, s.id).some((e) => isCacheDef(defOf(ctx, byId.get(e.target)))),
      );
      if (cached) continue;
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `Hot reads hit "${n.label}" directly`,
        message: `"${n.label}" takes ${round(m.rpsIn).toLocaleString('en-US')} req/s at ${round(m.utilization * 100)} % utilisation${ws !== undefined ? `, ${round((1 - ws) * 100)} % of them reads` : ''}, and no cache sits in front. Every read pays a database round trip and the database must be sized for the full read rate.`,
        targetIds: [n.id, ...services.map((s) => s.id)],
        fix: 'Add a cache (Redis / Memcached) the services check first (cache-aside), with a TTL that matches how stale the data may be.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const [dbId, ...callers] = finding.targetIds;
    const cache = ctx.components.get('cache.redis') ?? ctx.components.get('cache.in-memory');
    if (!dbId || callers.length === 0 || !cache) return undefined;
    if (!ctx.graph.nodes.some((n) => n.id === dbId)) return undefined;
    return {
      label: 'Add a cache in front of the database',
      steps: [
        { kind: 'addNode', defId: cache.id, label: 'Cache', near: dbId, connectFrom: callers },
      ],
    };
  },
  docs: {
    summary: 'Flags busy, read-mostly databases that no cache protects.',
    why: 'Reads usually follow a Zipf distribution: a small set of keys gets most traffic. An in-memory cache serves those in well under a millisecond and absorbs 80–95 % of reads, so the database can be smaller and tail latency drops.',
    howToFix:
      'Use cache-aside: read the cache, on a miss read the database and fill the cache with a TTL; invalidate or update on writes. Size the cache for the hot working set and watch the hit rate.',
  },
});
