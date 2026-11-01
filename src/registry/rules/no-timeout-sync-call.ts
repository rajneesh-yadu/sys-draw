/**
 * S19 design review: a service calls another service synchronously with no timeout, so a hung
 * dependency pins the caller's threads until they run out. Fix: a timeout of 3 × the target's
 * p99 (≥ 250 ms) when a result exists, else 1 s.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, edgeName, isComputeDef, metricsOf, nodeMap } from '../design-tools';

const ID = 'rule.no-timeout-sync-call';
const DEFAULT_TIMEOUT_MS = 1000;

export default defineRule({
  id: ID,
  title: 'Service call without a timeout',
  category: 'reliability',
  severity: 'warning',
  tags: ['timeouts', 'cascading-failure', 'microservices'],
  appliesTo: { categories: ['compute'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const e of ctx.graph.edges) {
      if (!e.sync || e.config.timeoutMs !== undefined) continue;
      if (!isComputeDef(defOf(ctx, byId.get(e.source)))) continue;
      if (!isComputeDef(defOf(ctx, byId.get(e.target)))) continue;
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `No timeout on ${edgeName(byId, e)}`,
        message: `${edgeName(byId, e)} waits as long as the callee takes. If the callee hangs (GC pause, deadlock, network black hole), every caller thread ends up waiting on it and the caller stops serving everything else.`,
        targetIds: [e.id],
        fix: 'Set a timeout a little above the callee’s p99 (and a total deadline for the request), then fail fast or degrade.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const e = ctx.graph.edges.find((x) => x.id === finding.targetIds[0]);
    if (!e) return undefined;
    const p99 = metricsOf(ctx, e.target)?.latencyMs.p99;
    const timeoutMs =
      p99 !== undefined ? Math.max(250, Math.ceil((3 * p99) / 50) * 50) : DEFAULT_TIMEOUT_MS;
    return {
      label: `Set a ${timeoutMs} ms timeout`,
      steps: [{ kind: 'setEdgeConfig', edgeId: e.id, config: { timeoutMs } }],
    };
  },
  docs: {
    summary: 'Flags synchronous service-to-service calls that have no timeout.',
    why: 'Most client libraries default to waiting minutes or forever. One stuck dependency then exhausts the caller’s thread or connection pool and the outage spreads upstream.',
    howToFix:
      'Give every remote call a timeout just above the dependency’s p99, propagate a deadline across hops (gRPC deadlines), and pair it with bounded retries and a circuit breaker.',
  },
});
