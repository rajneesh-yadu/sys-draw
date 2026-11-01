/**
 * S16 threat check: a database / cache / storage node reachable from the internet — placed in a
 * public (or DMZ) zone, or connected straight from a client. Fix: make its subnet a private data
 * zone, or move it into a new private data subnet.
 */
import type { Finding, NodeInstance } from '@/core';
import { defineRule } from '../define';
import type { FixPlan, RuleContext } from '../schemas';
import { isDataStore, nodeExposure, nodesInside, opensToInternet } from '../security-tools';

const ID = 'rule.db-internet-reachable';

export default defineRule({
  id: ID,
  title: 'Database reachable from the internet',
  category: 'security',
  severity: 'critical',
  tags: ['zones', 'exposure', 'data'],
  check: (ctx) => {
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      if (!isDataStore(ctx.components.get(n.defId))) continue;
      const exp = nodeExposure(ctx.graph, n.id, ctx.components);
      if (exp.zone === 'public') {
        out.push({
          ruleId: ID,
          severity: 'critical',
          title: `"${n.label}" is in a public zone`,
          message: `"${n.label}" holds data but sits in a public zone, so it has a route from the internet: one leaked password or unpatched port and the data is gone. Data stores belong in a private data subnet that only the app tier can reach.`,
          targetIds: [n.id],
          fix: 'Move it into a private data subnet (zone: data) and allow only the app tier in its security group.',
        });
      } else if (exp.clientSources.length > 0) {
        out.push({
          ruleId: ID,
          severity: 'critical',
          title: `Clients connect straight to "${n.label}"`,
          message: `Clients on the internet talk to "${n.label}" directly, so its port must be open to the world and every client holds database credentials. Put an API in front and keep the data store private.`,
          targetIds: [n.id, ...exp.clientSources],
          fix: 'Route clients through an API (gateway → service → database) and remove the direct edge.',
        });
      } else if (exp.zone === 'dmz') {
        out.push({
          ruleId: ID,
          severity: 'error',
          title: `"${n.label}" is in the DMZ`,
          message: `The DMZ is for edge services (load balancers, gateways, bastion). "${n.label}" holds data and should sit one layer further in, in a private data subnet.`,
          targetIds: [n.id],
          fix: 'Move it into a private data subnet (zone: data).',
        });
      }
    }
    return out;
  },
  fix: (ctx: RuleContext, finding: Finding): FixPlan | undefined => {
    const node = ctx.graph.nodes.find((n) => n.id === finding.targetIds[0]);
    if (!node) return undefined;
    const exp = nodeExposure(ctx.graph, node.id, ctx.components);
    if (exp.zone !== 'public' && exp.zone !== 'dmz') return undefined;
    const group = ctx.graph.groups.find((g) => g.id === node.groupId);
    if (!group) return undefined;
    const members: NodeInstance[] = nodesInside(ctx.graph, group.id);
    if (members.every((m) => isDataStore(ctx.components.get(m.defId)))) {
      return {
        label: `Make "${group.label}" a private data zone`,
        steps: [
          {
            kind: 'setGroupSecurity',
            groupId: group.id,
            security: {
              public: false,
              zone: 'data',
              firewallRules: (group.security?.firewallRules ?? []).filter(
                (r) => !opensToInternet(r),
              ),
            },
          },
        ],
      };
    }
    return {
      label: `Move "${node.label}" into a private data subnet`,
      steps: [
        {
          kind: 'createGroup',
          ref: 'data-subnet',
          groupKind: 'subnet',
          label: 'Data subnet (private)',
          memberIds: [node.id],
          parentId: group.parentId,
          security: { public: false, zone: 'data', firewallRules: [] },
        },
      ],
    };
  },
  docs: {
    summary:
      'Flags databases, caches and storage that sit in a public zone or the DMZ, or that clients connect to directly.',
    why: 'Exposed databases are one of the most common causes of data breaches: scanners find open database ports within minutes, and default or leaked credentials do the rest.',
    howToFix:
      'Keep data stores in a private data subnet, reachable only from the app tier (security-group rule from the app subnet on the database port). Clients go through an API; admins through a bastion.',
  },
});
