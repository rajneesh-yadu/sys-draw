/**
 * S16 threat check: secrets written into component config (error), and services that talk to a
 * database with no secrets manager on the board (info: their credentials end up in config/env).
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { controlsOf, isDataStore } from '../security-tools';

const ID = 'rule.secrets-in-config';
const SECRET_KEY =
  /(password|passwd|secret|api[-_]?key|token|private[-_]?key|access[-_]?key|credential)/i;

export default defineRule({
  id: ID,
  title: 'Secrets in config',
  category: 'security',
  severity: 'error',
  tags: ['secrets', 'credentials'],
  check: (ctx) => {
    const { graph, components } = ctx;
    const out: Finding[] = [];
    for (const n of graph.nodes) {
      const keys = Object.entries(n.config)
        .filter(([k, v]) => SECRET_KEY.test(k) && typeof v === 'string' && v.trim() !== '')
        .map(([k]) => k);
      if (keys.length > 0)
        out.push({
          ruleId: ID,
          severity: 'error',
          title: `Secret stored in "${n.label}" config`,
          message: `"${n.label}" has ${keys.map((k) => `"${k}"`).join(', ')} written into its configuration. Config ends up in repos, images and logs, where secrets leak and never rotate.`,
          targetIds: [n.id],
          fix: 'Store it in a secrets manager and let the service fetch it at start-up with its IAM role.',
        });
    }
    const hasVault = graph.nodes.some((n) =>
      controlsOf(components.get(n.defId)).includes('secrets'),
    );
    if (!hasVault) {
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      const callers = new Set<string>();
      for (const e of graph.edges) {
        const s = byId.get(e.source);
        const t = byId.get(e.target);
        if (!s || !t) continue;
        if (components.get(s.defId)?.category === 'compute' && isDataStore(components.get(t.defId)))
          callers.add(s.id);
      }
      if (callers.size > 0)
        out.push({
          ruleId: ID,
          severity: 'info',
          title: 'Database credentials have no safe home',
          message: `${callers.size} service(s) connect to data stores but the design has no secrets manager, so their database passwords live in config or environment variables.`,
          targetIds: [...callers],
          fix: 'Add a secrets manager and have each service fetch its credentials at runtime (with rotation).',
        });
    }
    return out;
  },
  fix: (ctx, finding) => {
    if (finding.severity !== 'info' || !ctx.components.get('security.secrets-manager'))
      return undefined;
    const near = finding.targetIds[0];
    if (!near) return undefined;
    return {
      label: 'Add a secrets manager',
      steps: [
        {
          kind: 'addNode',
          defId: 'security.secrets-manager',
          label: 'Secrets Manager',
          near,
          connectFrom: finding.targetIds,
        },
      ],
    };
  },
  docs: {
    summary:
      'Flags passwords and keys written into component config, and designs whose services have nowhere safe to keep database credentials.',
    why: 'Hard-coded secrets are copied into repositories, container images, logs and backups; they are rarely rotated and are a top cause of breaches.',
    howToFix:
      'Keep secrets in a secrets manager (encrypted with KMS, audited, rotated) and fetch them at runtime with the service’s IAM role.',
  },
});
