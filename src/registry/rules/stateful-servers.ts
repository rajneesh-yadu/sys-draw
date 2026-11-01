/**
 * S19 design review: several replicas of a service keep session state on the instance (stateless
 * off), or a load balancer pins clients with sticky sessions. Scaling and failover then lose
 * users' sessions. No automatic fix: moving state out is an application change.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, isBalancerDef, isComputeDef, maxInstances } from '../design-tools';

const ID = 'rule.stateful-servers';

export default defineRule({
  id: ID,
  title: 'Stateful servers or sticky sessions',
  category: 'scalability',
  severity: 'warning',
  tags: ['stateless', 'sticky-sessions', 'sessions', 'horizontal-scaling'],
  appliesTo: { categories: ['compute', 'network'] },
  check: (ctx) => {
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      const def = defOf(ctx, n);
      if (isComputeDef(def) && n.config.stateless === false && maxInstances(n) >= 2) {
        out.push({
          ruleId: ID,
          severity: 'warning',
          title: `"${n.label}" keeps state on its instances`,
          message: `"${n.label}" runs ${maxInstances(n)} instances but stores session state in memory. A request that lands on another instance loses the session, scale-in and crashes log users out, and the load balancer has to pin clients.`,
          targetIds: [n.id],
          fix: 'Keep the service stateless: store sessions in Redis or a database (or use signed tokens).',
        });
      } else if (isBalancerDef(def) && n.config.stickySessions === true) {
        out.push({
          ruleId: ID,
          severity: 'warning',
          title: `Sticky sessions on "${n.label}"`,
          message: `"${n.label}" pins each client to one target. Load stops being even (a few heavy clients overload one server) and when that target dies its clients lose their state.`,
          targetIds: [n.id],
          fix: 'Turn sticky sessions off once the targets are stateless.',
        });
      }
    }
    return out;
  },
  docs: {
    summary:
      'Flags replicated services that keep session state locally, and sticky load balancers.',
    why: 'Horizontal scaling assumes any instance can serve any request. Local state breaks that: it forces stickiness, uneven load and lost sessions on every deploy, crash or scale-in.',
    howToFix:
      'Move session and user state to a shared store (Redis, database) or into signed client tokens (JWT), then disable sticky sessions.',
  },
});
