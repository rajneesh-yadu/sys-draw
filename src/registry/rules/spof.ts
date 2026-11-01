/**
 * S19 design review: a component on the request path that runs as a single instance with no
 * standby — when it fails, every request through it fails. Managed multi-zone services are exempt.
 * Fix (stateless compute): a second replica (plus a load balancer when one caller talks to it
 * directly); databases/caches with a standby or replica knob: turn the standby on.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import {
  defOf,
  fieldWithRole,
  incoming,
  isBalancerDef,
  isClientDef,
  isComputeDef,
  isManagedDef,
  minInstances,
  nodeMap,
  numberAt,
  requestPath,
} from '../design-tools';
import type { FixStep } from '../schemas';

const ID = 'rule.spof';
const CATEGORIES = ['compute', 'database', 'cache', 'network', 'messaging', 'storage'];

/** True when the node keeps serving after one instance dies (standby, replicas, multi-AZ). */
function hasRedundancy(def: Parameters<typeof fieldWithRole>[0], config: Record<string, unknown>) {
  const standby = fieldWithRole(def, 'standby');
  if (standby !== undefined && config[standby] === true) return true;
  const replicas = numberAt(config, fieldWithRole(def, 'readReplicas'));
  return replicas !== undefined && replicas > 0;
}

export default defineRule({
  id: ID,
  title: 'Single point of failure',
  category: 'reliability',
  severity: 'error',
  tags: ['availability', 'redundancy', 'replicas', 'failover'],
  appliesTo: { categories: ['clients'] },
  check: (ctx) => {
    const path = requestPath(ctx);
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      const def = defOf(ctx, n);
      if (!def || !path.has(n.id) || isClientDef(def) || isManagedDef(def)) continue;
      if (!CATEGORIES.includes(def.category)) continue;
      if (minInstances(n) > 1 || hasRedundancy(def, n.config)) continue;
      out.push({
        ruleId: ID,
        severity: 'error',
        title: `"${n.label}" is a single point of failure`,
        message: `Every request through "${n.label}" depends on one ${def.name} instance with no standby. A crash, a deploy or a zone outage takes this part of the system down for everyone until it is replaced.`,
        targetIds: [n.id],
        fix: isComputeDef(def)
          ? 'Run at least 2 replicas (in different zones) behind a load balancer.'
          : 'Add a standby / replica in another zone with automatic failover, or use a managed multi-zone service.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const n = ctx.graph.nodes.find((x) => x.id === finding.targetIds[0]);
    const def = defOf(ctx, n);
    if (!n || !def) return undefined;
    const standby = fieldWithRole(def, 'standby');
    if (standby !== undefined)
      return {
        label: `Turn on a standby for ${n.label}`,
        steps: [{ kind: 'setNodeConfig', nodeId: n.id, config: { [standby]: true } }],
      };
    if (!isComputeDef(def) || n.config.stateless === false) return undefined;
    const steps: FixStep[] = [
      n.scaling.autoscale
        ? {
            kind: 'setNodeScaling',
            nodeId: n.id,
            autoscale: {
              ...n.scaling.autoscale,
              min: 2,
              max: Math.max(2, n.scaling.autoscale.max),
            },
          }
        : { kind: 'setNodeScaling', nodeId: n.id, replicas: 2 },
    ];
    const byId = nodeMap(ctx.graph);
    const direct = incoming(ctx.graph, n.id).filter(
      (e) => !isBalancerDef(defOf(ctx, byId.get(e.source))),
    );
    const lb = ctx.components.get('network.load-balancer');
    if (direct.length === 1 && lb)
      steps.push({
        kind: 'insertOnEdge',
        edgeId: direct[0]!.id,
        defId: lb.id,
        label: 'Load Balancer',
      });
    return {
      label:
        steps.length > 1
          ? `Run 2 replicas of ${n.label} behind a load balancer`
          : `Run 2 replicas of ${n.label}`,
      steps,
    };
  },
  docs: {
    summary: 'Flags components on the request path that run as one instance with no standby.',
    why: 'Hardware fails, deploys restart processes and zones go down. With one instance, any of these is a full outage of everything behind it; availability is capped by that one machine (~99.5 % for a single VM).',
    howToFix:
      'Run stateless services as 2+ replicas across zones behind a load balancer; give databases and caches a standby or replica with automatic failover; prefer managed multi-zone services for load balancers, queues and object storage.',
  },
});
