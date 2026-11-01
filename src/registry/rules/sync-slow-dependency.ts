/**
 * S19 design review: a service on the request path waits synchronously for a dependency whose p99
 * is slow, so every user request inherits that tail. Needs a simulation result. No automatic fix:
 * whether the work can move off the request path (queue, async, precompute) is a design decision.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import {
  defOf,
  edgeName,
  isComputeDef,
  metricsOf,
  nodeMap,
  requestPath,
  round,
} from '../design-tools';

const ID = 'rule.sync-slow-dependency';
/** A dependency is slow when its own p99 reaches this many ms. */
const SLOW_P99_MS = 500;

export default defineRule({
  id: ID,
  title: 'Synchronous call to a slow dependency',
  category: 'performance',
  severity: 'warning',
  tags: ['latency', 'async', 'tail-latency', 'coupling'],
  appliesTo: { categories: ['compute'], needs: ['result'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const path = requestPath(ctx);
    const out: Finding[] = [];
    for (const e of ctx.graph.edges) {
      if (!e.sync || !path.has(e.source)) continue;
      if (!isComputeDef(defOf(ctx, byId.get(e.source)))) continue;
      const m = metricsOf(ctx, e.target);
      if (!m || m.latencyMs.p99 < SLOW_P99_MS) continue;
      const target = byId.get(e.target);
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `Users wait on slow "${target?.label ?? e.target}"`,
        message: `${edgeName(byId, e)} is synchronous and "${target?.label ?? e.target}" answers in ${round(m.latencyMs.p99).toLocaleString('en-US')} ms at p99, so 1 in 100 requests through this path takes at least that long, and the caller holds a thread/connection the whole time.`,
        targetIds: [e.id, e.target],
        fix: 'Move the slow work off the request path (enqueue it and reply 202, or precompute), or make the dependency faster (cache, index, more capacity); always set a timeout.',
      });
    }
    return out;
  },
  docs: {
    summary: 'Flags request-path services that block on a dependency whose p99 is ≥ 500 ms.',
    why: 'Latency adds up along a synchronous chain and the slowest hop dominates the tail. Blocked callers also hold threads and connections, so a slow dependency can exhaust the caller too (cascading failure).',
    howToFix:
      'Ask whether the user needs the result now. If not, publish to a queue and process asynchronously. If yes, cache or precompute it, add capacity, and protect the caller with a timeout and a circuit breaker.',
  },
});
