/**
 * S16 threat check: service-to-service calls with no authentication (no mTLS, no auth server or
 * service mesh). Fix: switch the edge to mTLS.
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { controlsOf, edgeEncryption, encryptedStack } from '../security-tools';

const ID = 'rule.missing-service-auth';

export default defineRule({
  id: ID,
  title: 'Missing authentication between services',
  category: 'security',
  severity: 'warning',
  tags: ['mtls', 'zero-trust', 'auth'],
  check: (ctx) => {
    const { graph, components } = ctx;
    // A mesh (mTLS everywhere) on the board covers every service-to-service call.
    const mesh = graph.nodes.some(
      (n) => controlsOf(components.get(n.defId)).includes('mtls') && n.config.mtls !== 'off',
    );
    if (mesh) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const out: Finding[] = [];
    for (const e of graph.edges) {
      if (!e.sync) continue;
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      const sd = s && components.get(s.defId);
      const td = t && components.get(t.defId);
      if (!s || !t || sd?.category !== 'compute' || td?.category !== 'compute') continue;
      if (controlsOf(sd).includes('auth') || controlsOf(td).includes('auth')) continue;
      if (edgeEncryption(ctx.protocols, e.protocolStack).status === 'mtls') continue;
      out.push({
        ruleId: ID,
        severity: 'warning',
        title: `"${t.label}" trusts any caller`,
        message: `${s.label} → ${t.label} carries no service identity: anything that reaches "${t.label}" on the network can call it. Zero trust means each service proves who it is (mTLS) and the callee authorises it.`,
        targetIds: [e.id],
        fix: 'Use mTLS between services (a service mesh automates certificates) or pass and verify a signed service token.',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const edge = ctx.graph.edges.find((e) => e.id === finding.targetIds[0]);
    if (!edge || !ctx.protocols) return undefined;
    const stack = encryptedStack(ctx.protocols, edge.protocolStack, 'mtls');
    if (!stack) return undefined;
    return {
      label: 'Switch to mTLS',
      steps: [{ kind: 'setEdgeStack', edgeId: edge.id, protocolStack: stack }],
    };
  },
  docs: {
    summary: 'Flags synchronous service-to-service calls without mutual authentication.',
    why: 'Network position is not identity: once an attacker is inside (SSRF, a compromised pod), unauthenticated internal APIs are open doors.',
    howToFix:
      'Give every service an identity and use mTLS (service mesh) or signed service tokens; authorise per caller.',
  },
});
