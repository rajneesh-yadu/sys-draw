/**
 * S19 design review: a service in one cloud region calls a dependency in another region
 * synchronously on the request path, paying an inter-region round trip per call. Replication
 * between stores and geo-routing front doors (DNS, CDN, load balancers) are exempt. No automatic fix.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import {
  defOf,
  edgeName,
  isComputeDef,
  nodeMap,
  regionOf,
  requestPath,
  round,
} from '../design-tools';

const ID = 'rule.cross-region-sync-call';

export default defineRule({
  id: ID,
  title: 'Synchronous call across regions',
  category: 'performance',
  severity: 'warning',
  tags: ['geo', 'multi-region', 'latency', 'locality'],
  appliesTo: { categories: ['compute'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const path = requestPath(ctx);
    const out: Finding[] = [];
    for (const e of ctx.graph.edges) {
      if (!e.sync || !path.has(e.source)) continue;
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t || !isComputeDef(defOf(ctx, s))) continue;
      const from = regionOf(ctx.graph, s);
      const to = regionOf(ctx.graph, t);
      if (!from || !to || from === to) continue;
      const rtt = ctx.result?.perEdge[e.id]?.rttMs;
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `${edgeName(byId, e)} crosses regions`,
        message: `"${s.label}" (${from}) waits for "${t.label}" (${to}) on every request${rtt !== undefined ? `: ${round(rtt)} ms round trip per call` : ''}, plus inter-region transfer charges. A chatty sequence of such calls multiplies it.`,
        targetIds: [e.id],
        fix: 'Keep each request inside one region: deploy the dependency (or a read replica / cache of its data) next to the caller, and replicate asynchronously between regions.',
      });
    }
    return out;
  },
  docs: {
    summary: 'Flags request-path calls from a service to a dependency in a different cloud region.',
    why: 'Inside a region a round trip is ~1 ms; between continents it is 70–250 ms and billed per GB. Services that call across regions on the hot path make every user pay that latency.',
    howToFix:
      'Use cell / region-local architectures: every tier in each region, local read replicas or caches, and asynchronous cross-region replication; send only writes that need a global order to a home region.',
  },
});
