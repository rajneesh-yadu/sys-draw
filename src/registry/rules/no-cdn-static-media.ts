/**
 * S19 design review: clients download from object storage directly instead of through a CDN.
 * Fix: put a CDN on that connection.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, edgeName, isClientDef, nodeMap } from '../design-tools';

const ID = 'rule.no-cdn-static-media';

export default defineRule({
  id: ID,
  title: 'Static media served without a CDN',
  category: 'performance',
  severity: 'warning',
  tags: ['cdn', 'edge', 'static', 'media', 'object-storage'],
  appliesTo: { categories: ['storage'] },
  check: (ctx) => {
    const byId = nodeMap(ctx.graph);
    const out: Finding[] = [];
    for (const e of ctx.graph.edges) {
      if (!isClientDef(defOf(ctx, byId.get(e.source)))) continue;
      const target = byId.get(e.target);
      if (defOf(ctx, target)?.category !== 'storage') continue;
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `Users download from "${target!.label}" directly`,
        message: `${edgeName(byId, e)} fetches images/video from the storage bucket in one region. Users far away pay the full round trip on every object, and you pay internet egress for every byte.`,
        targetIds: [e.id, target!.id],
        fix: 'Serve static media through a CDN with the bucket as its origin (long cache TTLs, versioned file names).',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const edgeId = finding.targetIds[0];
    const cdn = ctx.components.get('network.cdn');
    if (!edgeId || !cdn || !ctx.graph.edges.some((e) => e.id === edgeId)) return undefined;
    return {
      label: 'Serve it through a CDN',
      steps: [{ kind: 'insertOnEdge', edgeId, defId: cdn.id, label: 'CDN' }],
    };
  },
  docs: {
    summary: 'Flags clients that read object storage directly instead of through a CDN.',
    why: 'A CDN caches objects at edge locations near users: a 200 ms trans-ocean fetch becomes ~20 ms, the origin sees a fraction of the requests, and CDN egress is cheaper than bucket egress.',
    howToFix:
      'Put a CDN in front of the bucket (origin access control so only the CDN can read it), use long TTLs with content-hashed file names, and sign URLs for private media.',
  },
});
