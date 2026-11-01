/**
 * S19 design review: a fleet sized for the peak runs all day although traffic has a daily cycle or
 * a peak multiplier ≥ 2. Needs the scenario. Fix: target-tracking autoscaling between a quarter of
 * the fleet (min 2) and today's size at 60 % utilisation.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, isComputeDef, isManagedDef, round } from '../design-tools';

const ID = 'rule.no-autoscaling';

export default defineRule({
  id: ID,
  title: 'Fixed fleet for variable traffic',
  category: 'cost',
  severity: 'info',
  tags: ['autoscaling', 'cost', 'diurnal', 'elasticity'],
  appliesTo: { categories: ['compute'], needs: ['scenario'] },
  check: (ctx) => {
    const s = ctx.scenario;
    if (!s || (s.peakMultiplier < 2 && !s.diurnal)) return [];
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      const def = defOf(ctx, n);
      if (!isComputeDef(def) || isManagedDef(def) || n.scaling.autoscale) continue;
      if (n.scaling.replicas < 2) continue;
      out.push({
        ruleId: ID,
        severity: 'info',
        title: `"${n.label}" runs ${n.scaling.replicas} instances around the clock`,
        message: `Traffic ${s.diurnal ? 'follows a daily cycle' : ''}${s.diurnal && s.peakMultiplier >= 2 ? ' and ' : ''}${s.peakMultiplier >= 2 ? `peaks at ${round(s.peakMultiplier, 1)}× the average` : ''}, but "${n.label}" always runs ${n.scaling.replicas} instances, so most of them idle (and are paid for) outside the peak.`,
        targetIds: [n.id],
        fix: 'Enable target-tracking autoscaling (≈ 60 % CPU) with a minimum for baseline + failover and a maximum for the peak.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const n = ctx.graph.nodes.find((x) => x.id === finding.targetIds[0]);
    if (!n || n.scaling.autoscale) return undefined;
    const max = n.scaling.replicas;
    const min = Math.min(max, Math.max(2, Math.ceil(max / 4)));
    return {
      label: `Autoscale ${n.label} between ${min} and ${max}`,
      steps: [
        {
          kind: 'setNodeScaling',
          nodeId: n.id,
          autoscale: { min, max, targetUtil: 0.6, warmupSec: 60 },
        },
      ],
    };
  },
  docs: {
    summary: 'Flags fixed-size fleets when traffic varies through the day or spikes.',
    why: 'Sizing for the peak means paying for peak capacity 24 hours a day; with a 3× daily swing about half of the instance-hours are idle.',
    howToFix:
      'Use target tracking on CPU or requests per instance, keep a minimum that survives losing a zone, set a maximum below downstream limits (e.g. database connections), and pre-warm before known events.',
  },
});
