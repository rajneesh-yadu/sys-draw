/**
 * S16 threat check: security-group rules opening admin or database ports (SSH, RDP, 5432…) to the
 * internet. Fix: allow them only from the bastion's group, or remove the rule.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { ADMIN_PORTS, adminPortsIn, controlsOf, opensToInternet } from '../security-tools';

const ID = 'rule.open-admin-ports';

export default defineRule({
  id: ID,
  title: 'Admin ports open to the internet',
  category: 'security',
  severity: 'critical',
  tags: ['firewall', 'security-group', 'ssh', 'rdp'],
  check: (ctx) => {
    const out: Finding[] = [];
    for (const g of ctx.graph.groups) {
      (g.security?.firewallRules ?? []).forEach((r, i) => {
        if (!opensToInternet(r)) return;
        const ports = adminPortsIn(r);
        if (ports.length === 0) return;
        const names = ports
          .slice(0, 4)
          .map((p) => `${ADMIN_PORTS[p]} ${p}`)
          .join(', ');
        out.push({
          ruleId: ID,
          severity: 'critical',
          title: `"${g.label}" opens ${names}${ports.length > 4 ? '…' : ''} to the internet`,
          message: `Rule ${i + 1} of "${g.label}" allows ${r.peer} in on ${r.fromPort === undefined ? 'every port' : `ports ${r.fromPort}–${r.toPort}`}. Bots scan the whole internet for SSH, RDP and database ports within minutes and brute-force them.`,
          targetIds: [g.id],
          fix: 'Allow admin ports only from a bastion / VPN security group (or use a session manager with no inbound port).',
        });
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const g = ctx.graph.groups.find((x) => x.id === finding.targetIds[0]);
    if (!g?.security) return undefined;
    const bastion = ctx.graph.nodes.find((n) =>
      controlsOf(ctx.components.get(n.defId)).includes('bastion'),
    );
    const peer = bastion?.groupId;
    const rules = g.security.firewallRules.flatMap((r) => {
      if (!opensToInternet(r) || adminPortsIn(r).length === 0) return [r];
      return peer ? [{ ...r, peer, description: 'Admin access via the bastion only' }] : [];
    });
    return {
      label: peer ? 'Allow admin ports from the bastion only' : 'Remove the internet rule',
      steps: [
        {
          kind: 'setGroupSecurity',
          groupId: g.id,
          security: { ...g.security, firewallRules: rules },
        },
      ],
    };
  },
  docs: {
    summary:
      'Flags firewall / security-group rules that open SSH, RDP or database ports to 0.0.0.0/0.',
    why: 'Internet-wide scanners find open admin ports within minutes; brute force, leaked keys and unpatched daemons then give full control of the host or database.',
    howToFix:
      'Restrict admin ports to the bastion or VPN security group, or use a managed session broker (no inbound port at all).',
  },
});
