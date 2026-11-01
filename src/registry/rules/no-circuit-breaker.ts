/**
 * S19 design review: a service retries calls to another service with no circuit breaker, so when
 * the callee fails the caller keeps hammering it. Fix: a breaker that opens at 50 % failures for 30 s.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, edgeName, isComputeDef, nodeMap } from '../design-tools';

const ID = 'rule.no-circuit-breaker';

export default defineRule({
  id: ID,
  title: 'Retries without a circuit breaker',
  category: 'reliability',
  severity: 'info',
  tags: ['circuit-breaker', 'retries', 'fail-fast', 'microservices'],
  appliesTo: { categories: ['compute'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const e of ctx.graph.edges) {
      if (!e.sync || (e.config.retries ?? 0) === 0) continue;
      if (e.config.breakerErrorThreshold !== undefined) continue;
      if (!isComputeDef(defOf(ctx, byId.get(e.source)))) continue;
      if (!isComputeDef(defOf(ctx, byId.get(e.target)))) continue;
      out.push({
        ruleId: ID,
        severity: 'info',
        title: `No circuit breaker on ${edgeName(byId, e)}`,
        message: `${edgeName(byId, e)} retries ${e.config.retries}× but never stops trying. When the callee is down, callers keep sending ${(e.config.retries ?? 0) + 1}× the traffic at it and users wait for every attempt to time out.`,
        targetIds: [e.id],
        fix: 'Add a circuit breaker: after a failure ratio over a short window, fail fast (or serve a fallback) for a while, then let a trial request through.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const e = ctx.graph.edges.find((x) => x.id === finding.targetIds[0]);
    if (!e) return undefined;
    return {
      label: 'Add a circuit breaker (opens at 50 % failures)',
      steps: [
        {
          kind: 'setEdgeConfig',
          edgeId: e.id,
          config: { breakerErrorThreshold: 0.5, breakerOpenSec: 30 },
        },
      ],
    };
  },
  docs: {
    summary: 'Flags retried service-to-service calls with no circuit breaker.',
    why: 'Retries help with blips but hurt during outages. A breaker notices a failing dependency and stops calling it, which lets it recover and lets callers answer quickly with a fallback.',
    howToFix:
      'Wrap remote calls in a breaker (closed → open after a failure ratio → half-open trial), return a cached or degraded response while open, and alert on breaker state.',
  },
});
