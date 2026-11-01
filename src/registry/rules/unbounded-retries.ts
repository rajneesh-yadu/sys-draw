/**
 * S19 design review: retries that multiply load during an outage — more than 3 attempts, or
 * retries with no backoff (immediate hammering). Fix: cap at 3 retries with exponential backoff.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { edgeName, nodeMap } from '../design-tools';

const ID = 'rule.unbounded-retries';
const MAX_RETRIES = 3;

export default defineRule({
  id: ID,
  title: 'Unbounded or un-backed-off retries',
  category: 'reliability',
  severity: 'warning',
  tags: ['retries', 'backoff', 'retry-storm', 'cascading-failure'],
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const e of ctx.graph.edges) {
      const r = e.config.retries ?? 0;
      if (r === 0) continue;
      const tooMany = r > MAX_RETRIES;
      const noBackoff = e.config.backoff === 'none';
      if (!tooMany && !noBackoff) continue;
      const name = edgeName(byId, e);
      out.push({
        ruleId: ID,
        severity: tooMany && noBackoff ? 'error' : 'warning',
        title: tooMany ? `${r} retries on ${name}` : `Retries without backoff on ${name}`,
        message: `${name} retries ${r}× ${noBackoff ? 'immediately' : 'per call'}. When the target slows down, every failing call becomes up to ${r + 1} calls, multiplying the load on a service that is already struggling (retry storm) and stretching user latency.`,
        targetIds: [e.id],
        fix: `Retry at most ${MAX_RETRIES} times with exponential backoff and jitter, only on idempotent calls, and add a retry budget or circuit breaker.`,
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const e = ctx.graph.edges.find((x) => x.id === finding.targetIds[0]);
    if (!e) return undefined;
    return {
      label: `Cap retries at ${Math.min(e.config.retries ?? 0, MAX_RETRIES)} with exponential backoff`,
      steps: [
        {
          kind: 'setEdgeConfig',
          edgeId: e.id,
          config: { retries: Math.min(e.config.retries ?? 0, MAX_RETRIES), backoff: 'exp' },
        },
      ],
    };
  },
  docs: {
    summary: 'Flags connections that retry more than 3 times or retry with no backoff.',
    why: 'With failure probability a and r retries a caller sends up to (1 − (1 − a)^(r+1)) / a times the load. During an incident that amplification keeps the target down; immediate retries arrive in synchronized waves.',
    howToFix:
      'Use 2–3 retries with exponential backoff and jitter, retry only idempotent or idempotency-keyed operations, and stop retrying when a circuit breaker opens.',
  },
});
