/**
 * S19 design review: the board uses availability-zone groups, but every component placed in one
 * sits in the same zone, so a zone outage takes the whole system down. No automatic fix.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, enclosingGroup, isClientDef } from '../design-tools';

const ID = 'rule.single-az';

export default defineRule({
  id: ID,
  title: 'Everything in one availability zone',
  category: 'reliability',
  severity: 'warning',
  tags: ['availability-zone', 'multi-az', 'failover'],
  check: (ctx) => {
    if (!ctx.graph.groups.some((g) => g.kind === 'az')) return [];
    const placed = ctx.graph.nodes
      .filter((n) => !isClientDef(defOf(ctx, n)))
      .map((n) => ({ n, az: enclosingGroup(ctx.graph, n, 'az') }))
      .filter((x) => x.az !== undefined);
    const zones = new Set(placed.map((x) => x.az!.id));
    if (placed.length < 2 || zones.size !== 1) return [];
    const az = placed[0]!.az!;
    const out: Finding[] = [
      {
        ruleId: ID,
        severity: 'warning',
        title: `All ${placed.length} components are in "${az.label}"`,
        message: `Every zoned component runs in availability zone "${az.label}". Zones fail independently (power, cooling, network); with one zone, a zone event is a full outage even if each tier has several replicas.`,
        targetIds: [az.id, ...placed.map((x) => x.n.id)],
        fix: 'Spread replicas of each tier over at least two zones (and enable multi-AZ standbys for databases).',
      },
    ];
    return out;
  },
  docs: {
    summary: 'Flags boards whose zoned components all sit in one availability zone.',
    why: 'An availability zone is one or more data centres with shared power and networking. Cloud SLAs for compute assume at least two zones; a single-zone deployment inherits the zone’s outages.',
    howToFix:
      'Run every stateless tier in 2–3 zones behind a cross-zone load balancer and give stateful tiers a synchronous standby in another zone.',
  },
});
