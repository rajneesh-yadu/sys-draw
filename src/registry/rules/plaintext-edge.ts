/**
 * S16 threat check: plaintext connections carrying user data over the internet (error) or across
 * zones (warning). Fix: insert TLS 1.3 above TCP when the protocol above runs on it.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { edgeEncryption, encryptedStack, nodeZone, ZONE_LABEL } from '../security-tools';

const ID = 'rule.plaintext-edge';

export default defineRule({
  id: ID,
  title: 'Plaintext edge carrying user data',
  category: 'security',
  severity: 'error',
  tags: ['encryption', 'tls', 'mitm'],
  check: (ctx) => {
    const out: Finding[] = [];
    const byId = new Map(ctx.graph.nodes.map((n) => [n.id, n]));
    for (const e of ctx.graph.edges) {
      if (edgeEncryption(ctx.protocols, e.protocolStack).status !== 'plaintext') continue;
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t) continue;
      const from = nodeZone(ctx.graph, s, ctx.components);
      const to = nodeZone(ctx.graph, t, ctx.components);
      const name = `${s.label} → ${t.label}`;
      if (from === 'internet' || to === 'internet') {
        out.push({
          ruleId: ID,
          severity: 'error',
          title: `Plaintext over the internet: ${name}`,
          message: `${name} is not encrypted and crosses the public internet: anyone on the path (Wi-Fi, ISP, a compromised router) can read passwords, tokens and personal data, or change responses.`,
          targetIds: [e.id],
          fix: 'Use TLS 1.3 (HTTPS) on this connection.',
        });
      } else if (from !== undefined && to !== undefined && from !== to) {
        out.push({
          ruleId: ID,
          severity: 'warning',
          title: `Plaintext across zones: ${name}`,
          message: `${name} crosses from the ${ZONE_LABEL[from]} zone to the ${ZONE_LABEL[to]} zone unencrypted. An attacker who gets a foothold in one zone can sniff traffic into the next (zero trust: encrypt inside too).`,
          targetIds: [e.id],
          fix: 'Encrypt it with TLS (or mTLS between services).',
        });
      }
    }
    return out;
  },
  fix: (ctx, finding) => {
    const edge = ctx.graph.edges.find((e) => e.id === finding.targetIds[0]);
    if (!edge || !ctx.protocols) return undefined;
    const stack = encryptedStack(ctx.protocols, edge.protocolStack, 'tls13');
    if (!stack) return undefined;
    return {
      label: 'Encrypt with TLS 1.3',
      steps: [{ kind: 'setEdgeStack', edgeId: edge.id, protocolStack: stack }],
    };
  },
  docs: {
    summary: 'Flags unencrypted connections that cross the internet or a zone boundary.',
    why: 'Without TLS, traffic can be read and modified by anyone on the path (man in the middle). Inside the network, plaintext lets an attacker who breached one zone sniff the next.',
    howToFix:
      'Run the protocol over TLS 1.3 (HTTPS, TLS-enabled database drivers); use mTLS between services, typically via a service mesh.',
  },
});
