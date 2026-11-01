/**
 * S19 design review: a component runs at ≥ 85 % utilisation in the simulation (≥ 100 % =
 * saturated), where queueing delay explodes. Needs a simulation result. Fix (stateless,
 * self-managed compute): scale replicas so utilisation lands near 60 %.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, isComputeDef, isManagedDef, metricsOf, round } from '../design-tools';

const ID = 'rule.overloaded-node';
export const OVERLOAD_UTILIZATION = 0.85;
const TARGET_UTILIZATION = 0.6;

export default defineRule({
  id: ID,
  title: 'Overloaded component',
  category: 'scalability',
  severity: 'error',
  tags: ['capacity', 'utilization', 'bottleneck', 'queueing'],
  appliesTo: { needs: ['result'] },
  check: (ctx) => {
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      const m = metricsOf(ctx, n.id);
      if (!m || m.utilization < OVERLOAD_UTILIZATION) continue;
      const saturated = m.utilization >= 1;
      out.push({
        ruleId: ID,
        severity: saturated ? 'critical' : 'error',
        title: `"${n.label}" is ${saturated ? 'saturated' : 'overloaded'} (${round(m.utilization * 100)} %)`,
        message: `"${n.label}" runs at ${round(m.utilization * 100)} % of its capacity with ${round(m.rpsIn).toLocaleString('en-US')} req/s in. Past ~80 % queueing delay grows like ρ/(1 − ρ): p99 is ${round(m.latencyMs.p99).toLocaleString('en-US')} ms${saturated ? ' and requests pile up or are rejected' : ''}.`,
        targetIds: [n.id],
        fix: 'Add replicas (or shards / read replicas for a database), use a bigger instance, or take load off it with a cache.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const n = ctx.graph.nodes.find((x) => x.id === finding.targetIds[0]);
    const def = defOf(ctx, n);
    const m = n && metricsOf(ctx, n.id);
    if (!n || !m || !isComputeDef(def) || isManagedDef(def) || n.config.stateless === false)
      return undefined;
    const current = n.scaling.autoscale?.max ?? n.scaling.replicas;
    const want = Math.max(current + 1, Math.ceil((current * m.utilization) / TARGET_UTILIZATION));
    if (n.scaling.autoscale)
      return {
        label: `Raise ${n.label}'s autoscaling maximum to ${want}`,
        steps: [
          {
            kind: 'setNodeScaling',
            nodeId: n.id,
            autoscale: { ...n.scaling.autoscale, max: want },
          },
        ],
      };
    return {
      label: `Scale ${n.label} to ${want} replicas`,
      steps: [{ kind: 'setNodeScaling', nodeId: n.id, replicas: want }],
    };
  },
  docs: {
    summary: 'Flags components the simulation runs at 85 % utilisation or more.',
    why: 'In an M/M/c queue the waiting time grows without bound as utilisation approaches 100 %. Running hot leaves no headroom for spikes, failovers or a slow dependency.',
    howToFix:
      'Target ~60–70 % at peak: scale out stateless tiers (or enable autoscaling), scale databases with replicas, shards or a cache, and recheck the bottleneck moves where you expect.',
  },
});
