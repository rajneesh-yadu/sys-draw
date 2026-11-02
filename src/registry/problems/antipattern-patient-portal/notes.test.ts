/**
 * S23: the companion notes stay in sync with the anti-pattern sample. The exact findings per rule
 * and severity are pinned by src/app/problems/antipattern-board.test.ts (it needs the engine).
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../index';
import notes from './NOTES.md?raw';

/** Every rule the broken board triggers (same list as the app-level test). */
const DOCUMENTED_RULES = [
  'rule.db-internet-reachable',
  'rule.open-admin-ports',
  'rule.overloaded-node',
  'rule.plaintext-edge',
  'rule.spof',
  'rule.unbounded-retries',
  'rule.no-cache-hot-read',
  'rule.no-timeout-sync-call',
  'rule.missing-service-auth',
  'rule.no-rate-limit-public-api',
  'rule.single-region-data',
  'rule.no-circuit-breaker',
  'rule.secrets-in-config',
  'rule.no-autoscaling',
];

describe('S23 anti-pattern sample notes', () => {
  const p = registry.require('problem.antipattern-patient-portal', 'problem');

  it('warns that the board is broken on purpose and maps the severity vocabulary', () => {
    expect(notes).toMatch(/broken on purpose/);
    for (const s of ['critical', 'error', 'warning', 'info']) expect(notes).toContain(`\`${s}\``);
    for (const l of ['ERROR', 'WARNING', 'INFO']) expect(notes).toContain(l);
    expect(notes).toContain('22 findings: 5 critical, 6 error, 8 warning, 3 info');
  });

  it('documents every rule the board triggers, Debug mode’s pass list and the rubric', () => {
    const ids = new Set([
      ...DOCUMENTED_RULES,
      ...(p.debugVariants[0]?.fixedWhenRulesPass ?? []),
      ...p.rubric.flatMap((r) => (r.ruleId ? [r.ruleId] : [])),
    ]);
    for (const id of ids) {
      expect(registry.get(id, 'rule'), id).toBeDefined();
      expect(notes, id).toContain(`\`${id}\``);
    }
  });
});
