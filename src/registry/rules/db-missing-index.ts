/**
 * S19 design review: the hot query on a relational database has no usable index (sequential scan
 * of a table with ≥ 100 000 rows). Fix: add the index (`queryUsesIndex` on).
 */
import type { Finding } from '@/core';
import { defineRule } from '../define';
import { defOf, isDatabaseDef, numberAt } from '../design-tools';

const ID = 'rule.db-missing-index';
const MIN_ROWS = 100_000;

export default defineRule({
  id: ID,
  title: 'Hot query without an index',
  category: 'performance',
  severity: 'error',
  tags: ['index', 'sql', 'full-table-scan', 'database'],
  appliesTo: { categories: ['database'] },
  check: (ctx) => {
    const out: Finding[] = [];
    for (const n of ctx.graph.nodes) {
      if (!isDatabaseDef(defOf(ctx, n)) || n.config.queryUsesIndex !== false) continue;
      const rows = numberAt(n.config, 'tableRows');
      if (rows !== undefined && rows < MIN_ROWS) continue;
      out.push({
        ruleId: ID,
        severity: 'error',
        title: `Full table scan on "${n.label}"`,
        message: `The hot query on "${n.label}" has no matching index, so it reads ${rows !== undefined ? `all ${rows.toLocaleString('en-US')} rows` : 'the whole table'} instead of O(log n) index pages: milliseconds become seconds, and the scans evict useful pages from memory.`,
        targetIds: [n.id],
        fix: 'Create an index on the columns the query filters and sorts by (check with EXPLAIN).',
      });
    }
    return out;
  },
  fix: (ctx, finding) => {
    const n = ctx.graph.nodes.find((x) => x.id === finding.targetIds[0]);
    if (!n) return undefined;
    return {
      label: `Add an index for the hot query on ${n.label}`,
      steps: [{ kind: 'setNodeConfig', nodeId: n.id, config: { queryUsesIndex: true } }],
    };
  },
  docs: {
    summary: 'Flags relational databases whose hot query scans a large table.',
    why: 'A B-tree index finds a row in a handful of page reads; without one the database reads every row. A missing index is one of the most common causes of production database outages.',
    howToFix:
      'Index the filter and sort columns of every hot query (composite indexes in the right column order), confirm with EXPLAIN, and remember every index slows writes a little.',
  },
});
