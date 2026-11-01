/**
 * S19 design review: a partitioned store or log whose hottest key/partition takes far more than
 * its fair share (skew ≥ 20 % and ≥ 2× 1/partitions), so one partition saturates while the rest
 * idle. Reads the component's `keySkew` / `shards` scaling roles (or `keySkew` / `partitions`
 * config). No automatic fix: it needs a better partition key.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, fieldWithRole, metricsOf, numberAt, round } from '../design-tools';

const ID = 'rule.hot-partition';
const MIN_SKEW = 0.2;

export default defineRule({
  id: ID,
  title: 'Hot partition',
  category: 'scalability',
  severity: 'warning',
  tags: ['partitioning', 'sharding', 'hot-key', 'skew'],
  appliesTo: { categories: ['database', 'messaging'] },
  check: (ctx) => {
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      const def = defOf(ctx, n);
      if (!def) continue;
      const skew =
        numberAt(n.config, fieldWithRole(def, 'keySkew')) ?? numberAt(n.config, 'keySkew');
      if (skew === undefined || skew < MIN_SKEW) continue;
      const parts =
        numberAt(n.config, fieldWithRole(def, 'shards')) ?? numberAt(n.config, 'partitions');
      if (parts !== undefined && (parts < 2 || skew < 2 / parts)) continue;
      const m = metricsOf(ctx, n.id);
      const saturated = m !== undefined && m.utilization >= 0.8;
      const usable = parts !== undefined ? 1 / (skew * parts) : undefined;
      out.push({
        ruleId: ID,
        severity: saturated ? 'error' : 'warning',
        title: `Hot ${def.category === 'messaging' ? 'partition' : 'shard'} on "${n.label}"`,
        message: `The hottest key takes ${round(skew * 100)} % of the traffic${parts !== undefined ? ` instead of ${round(100 / parts, 1)} % across ${parts} partitions, so the system saturates at ${round(usable! * 100)} % of its nominal capacity` : ''}. Adding partitions does not help: the hot key still lands on one of them.${saturated ? ` It is already at ${round(m.utilization * 100)} % utilisation.` : ''}`,
        targetIds: [n.id],
        fix: 'Choose a higher-cardinality partition key, salt or split the hot key (key#0..N), or cache the hot items in front.',
      });
    }
    return out;
  },
  docs: {
    summary: 'Flags partitioned stores and logs where one key gets a large share of traffic.',
    why: 'Capacity of a partitioned system is partitions × per-partition capacity only when load is even. A celebrity user, a popular product or a timestamp key sends most traffic to one partition, which throttles while others idle.',
    howToFix:
      'Pick keys with many evenly used values (user id, not country), add a random suffix to hot keys and fan reads in, use write sharding for counters, and cache hot reads.',
  },
});
