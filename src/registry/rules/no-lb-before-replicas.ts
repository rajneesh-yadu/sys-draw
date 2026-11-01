/**
 * S19 design review: a service runs several replicas but its callers connect to it directly (no
 * load balancer, proxy, mesh or DNS in between), so nothing spreads load or skips dead replicas.
 * Fix (one direct caller): put a load balancer on that connection.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import {
  defOf,
  edgeName,
  incoming,
  isBalancerDef,
  isComputeDef,
  isManagedDef,
  isMessagingDef,
  maxInstances,
  nodeMap,
} from '../design-tools';

const ID = 'rule.no-lb-before-replicas';

export default defineRule({
  id: ID,
  title: 'Replicas without a load balancer',
  category: 'reliability',
  severity: 'warning',
  tags: ['load-balancer', 'replicas', 'horizontal-scaling', 'health-checks'],
  appliesTo: { categories: ['compute'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      const def = defOf(ctx, n);
      if (!isComputeDef(def) || isManagedDef(def) || def!.tags.includes('kubernetes')) continue;
      if (maxInstances(n) < 2) continue;
      const direct = incoming(ctx.graph, n.id).filter((e) => {
        const src = defOf(ctx, byId.get(e.source));
        return !isBalancerDef(src) && !isMessagingDef(src);
      });
      if (direct.length === 0) continue;
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `${n.scaling.autoscale ? 'Autoscaled' : `${n.scaling.replicas}`} replicas of "${n.label}" with no load balancer`,
        message: `${direct.map((e) => edgeName(byId, e)).join(', ')} ${direct.length === 1 ? 'connects' : 'connect'} straight to "${n.label}". Without a load balancer the callers need every replica's address, load is not spread evenly, and a dead replica keeps receiving requests (no health checks).`,
        targetIds: [n.id, ...direct.map((e) => e.id)],
        fix: 'Put a load balancer (or service mesh / DNS-based discovery) in front of the replicas.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const edges = finding.targetIds.slice(1);
    const lb = ctx.components.get('network.load-balancer');
    if (edges.length !== 1 || !lb || !ctx.graph.edges.some((e) => e.id === edges[0]))
      return undefined;
    return {
      label: 'Add a load balancer in front',
      steps: [{ kind: 'insertOnEdge', edgeId: edges[0]!, defId: lb.id, label: 'Load Balancer' }],
    };
  },
  docs: {
    summary: 'Flags services with several replicas that callers reach without a load balancer.',
    why: 'Replicas only add capacity and availability when something spreads requests over them and stops sending to the ones that fail health checks. Callers that pin one replica overload it and fail when it dies.',
    howToFix:
      'Add a load balancer (L7 for HTTP/gRPC), a service mesh or client-side discovery; enable health checks so dead replicas are removed within seconds.',
  },
});
