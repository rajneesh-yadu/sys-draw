/**
 * S16 check on zone crossings: a connection the target's security group would drop (no ingress
 * rule allows it). Fix: add an allow rule for that port from the caller's zone group.
 */
import type { FirewallRule, Finding } from '@/core';
import { defineRule } from '../define';
import { zoneCrossings, zoneGroup } from '../security-tools';

const ID = 'rule.security-group-blocks';

export default defineRule({
  id: ID,
  title: 'Security group blocks a connection',
  category: 'security',
  severity: 'warning',
  tags: ['firewall', 'security-group', 'zones'],
  check: (ctx) => {
    const out: Finding[] = [];
    const lookups = { components: ctx.components, protocols: ctx.protocols };
    const label = (id: string) => ctx.graph.nodes.find((n) => n.id === id)?.label ?? id;
    for (const c of zoneCrossings(ctx.graph, lookups)) {
      if (c.guard?.verdict !== 'deny') continue;
      const e = ctx.graph.edges.find((x) => x.id === c.edgeId)!;
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `${label(e.source)} → ${label(e.target)} is blocked`,
        message: `${c.guard.explain} This connection is in the design but its packets would be dropped, so every call on it fails.`,
        targetIds: [e.id, c.guard.groupId],
        fix: `Add an ingress rule allowing ${c.transport.toUpperCase()} ${c.port ?? ''} from the caller’s group (not from the whole internet).`,
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const edge = ctx.graph.edges.find((e) => e.id === finding.targetIds[0]);
    const group = ctx.graph.groups.find((g) => g.id === finding.targetIds[1]);
    if (!edge || !group?.security) return undefined;
    const crossing = zoneCrossings(ctx.graph, {
      components: ctx.components,
      protocols: ctx.protocols,
    }).find((c) => c.edgeId === edge.id);
    // An explicit deny rule wins over any allow: leave that decision to the user.
    if (!crossing || crossing.guard?.ruleIndex !== undefined) return undefined;
    const source = ctx.graph.nodes.find((n) => n.id === edge.source);
    const sourceGroup = source && zoneGroup(ctx.graph, source.groupId);
    const peer = crossing.from === 'internet' ? 'internet' : (sourceGroup?.id ?? '10.0.0.0/8');
    const rule: FirewallRule = {
      direction: 'ingress',
      action: 'allow',
      protocol: crossing.transport,
      ...(crossing.port !== undefined ? { fromPort: crossing.port, toPort: crossing.port } : {}),
      peer,
      description: `Allow ${source?.label ?? 'caller'}`,
    };
    return {
      label:
        `Allow ${crossing.transport.toUpperCase()} ${crossing.port ?? ''} from ${sourceGroup?.label ?? peer}`.trim(),
      steps: [
        {
          kind: 'setGroupSecurity',
          groupId: group.id,
          security: { ...group.security, firewallRules: [...group.security.firewallRules, rule] },
        },
      ],
    };
  },
  docs: {
    summary:
      'Flags edges that cross into a zone whose security group has rules but none that allow this connection.',
    why: 'Security groups deny by default: a connection that is drawn but not allowed fails in production (timeouts), usually discovered at the worst moment.',
    howToFix:
      'Allow exactly the port the caller needs, from the caller’s security group (least privilege), never from 0.0.0.0/0.',
  },
});
