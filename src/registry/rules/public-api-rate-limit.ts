/**
 * S16 threat check: a service the internet can reach with no rate limit (API gateway, WAF) in
 * front. Fix: put a WAF (rate-based rules + bot control) on the client's edge.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { controlsOf, isClient } from '../security-tools';

const ID = 'rule.no-rate-limit-public-api';

export default defineRule({
  id: ID,
  title: 'Public API without rate limiting',
  category: 'security',
  severity: 'warning',
  tags: ['rate-limit', 'waf', 'abuse', 'ddos'],
  check: (ctx) => {
    const { graph, components } = ctx;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const out = new Map<string, Finding>();
    for (const c of graph.nodes) {
      if (!isClient(components.get(c.defId))) continue;
      for (const first of graph.edges.filter((e) => e.source === c.id)) {
        // Walk downstream from this client edge until a rate-limiting control.
        const seen = new Set<string>();
        const queue = [first.target];
        while (queue.length > 0) {
          const id = queue.shift()!;
          if (seen.has(id)) continue;
          seen.add(id);
          const n = byId.get(id);
          const def = n && components.get(n.defId);
          if (!n || !def) continue;
          const ctl = controlsOf(def);
          if (ctl.includes('rate-limit') || ctl.includes('waf')) continue;
          if (def.category === 'compute') {
            if (!out.has(n.id))
              out.set(n.id, {
                ruleId: ID,
                severity: 'warning',
                title: `No rate limit in front of "${n.label}"`,
                message: `Internet traffic from "${c.label}" reaches "${n.label}" without passing a rate limiter or WAF. One script can exhaust it (scraping, brute force, cheap L7 floods) and every request costs you compute.`,
                targetIds: [n.id, first.id],
                fix: 'Put a WAF (rate-based rules, bot control) or an API gateway with per-client limits in front.',
              });
            continue;
          }
          for (const e of graph.edges) if (e.source === id) queue.push(e.target);
        }
      }
    }
    return [...out.values()];
  },
  fix: (ctx, finding) => {
    const edgeId = finding.targetIds[1];
    if (!edgeId || !ctx.graph.edges.some((e) => e.id === edgeId)) return undefined;
    if (!ctx.components.get('security.waf')) return undefined;
    return {
      label: 'Add a WAF in front',
      steps: [{ kind: 'insertOnEdge', edgeId, defId: 'security.waf', label: 'WAF' }],
    };
  },
  docs: {
    summary:
      'Flags services reachable from the internet with no rate limiting (API gateway or WAF) on the way.',
    why: 'Without limits, a single client can exhaust capacity (accidental retry loops, scrapers, credential stuffing, application-layer DDoS), and autoscaling turns the attack into a bill.',
    howToFix:
      'Add an API gateway with per-key quotas or a WAF with rate-based rules and bot control in front of public entry points; return HTTP 429 when over the limit.',
  },
});
