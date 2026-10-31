/**
 * queue: producers wait only for the enqueue (the queue node's own latency); consumers behind
 * the queue run asynchronously, off the caller's critical path, but still receive the load.
 * If consumers drain slower than messages arrive, the backlog grows:
 *   lag (messages) = (λ − Σ consumer capacity) × duration.
 */
import { asyncExpr, isEmpty } from '../model/expr';
import { fmt } from '../model/format';
import { defineBehavior } from './types';

export const behavior = defineBehavior({
  id: 'queue',
  routeOut({ calls, combine }) {
    if (calls.length === 0) return undefined;
    return asyncExpr(combine(calls));
  },
  routeRest({ rest }) {
    return isEmpty(rest) ? undefined : asyncExpr(rest);
  },
  finish({ node, stats, model, statsOf, durationSec }) {
    const consumers = (model.out.get(node.id) ?? [])
      .map((e) => statsOf(e.target))
      .filter((s) => s !== undefined);
    if (consumers.length === 0) {
      stats.explain.lag = 'No consumers connected: messages accumulate.';
      stats.queueDepth += stats.servedRps * durationSec;
      return;
    }
    const drain = consumers.reduce((s, c) => s + c.capacityRps, 0);
    const backlog = Math.max(0, stats.servedRps - drain) * durationSec;
    stats.queueDepth += backlog;
    stats.explain.lag =
      backlog > 0
        ? `Consumers drain ${fmt(drain)} rps < ${fmt(stats.servedRps)} rps in: backlog = (λ − drain) × D = ${fmt(backlog)} messages after ${fmt(durationSec)} s.`
        : `Consumers can drain ${fmt(drain)} rps ≥ ${fmt(stats.servedRps)} rps in: no backlog.`;
  },
});
