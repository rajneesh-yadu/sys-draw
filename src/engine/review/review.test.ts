/**
 * S19 — design review engine: rules filtered by `appliesTo`, engine findings merged from the
 * result, worst first, fix labels and fix plans by key, and robustness against throwing rules.
 */
import { describe, expect, it } from 'vitest';
import type { EdgeInstance, Graph, NodeInstance, Scenario } from '@/core';
import { createRegistry, defineRule, registry, type Registry } from '@/registry';
import { simulate } from '../simulate';
import { designFix, designRules, reviewDesign, ruleSkipReason, reviewContext } from './review';

function node(
  id: string,
  defId: string,
  config: Record<string, unknown> = {},
  replicas = 1,
): NodeInstance {
  const def = registry.require(defId, 'component');
  return {
    id: `node_${id}`,
    defId,
    label: id,
    position: { x: 0, y: 0 },
    config: { ...def.defaults, ...config },
    scaling: { replicas, instanceType: def.instanceTypes[0]!.id },
  };
}
function edge(s: string, t: string, stack = ['tcp', 'tls13', 'http1']): EdgeInstance {
  return {
    id: `edge_${s}_${t}`,
    source: `node_${s}`,
    target: `node_${t}`,
    protocolStack: stack,
    sync: true,
    config: {},
  };
}

/** client → app (1 replica) → Postgres without a standby. */
const GRAPH: Graph = {
  nodes: [
    node('c', 'client.app'),
    node('app', 'compute.app-server'),
    node('db', 'database.postgres', { highAvailability: false }),
  ],
  edges: [edge('c', 'app'), edge('app', 'db', ['tcp', 'tls13', 'postgres-wire'])],
  groups: [],
};
const SCENARIO: Scenario = {
  usersByRegion: { 'north-america': 100_000 },
  flows: [],
  peakMultiplier: 1,
  diurnal: false,
  payloadBytes: { req: 1000, res: 1000 },
  events: [],
  seed: 1,
  durationSec: 600,
};

describe('reviewDesign', () => {
  it('runs every registry rule (security included) and reports SPOFs worst first', () => {
    const r = reviewDesign({ graph: GRAPH, scenario: SCENARIO, registry });
    expect(designRules(registry).length).toBe(28);
    const spof = r.findings.filter((f) => f.ruleId === 'rule.spof');
    expect(spof.map((f) => f.targetIds[0]).sort()).toEqual(['node_app', 'node_db']);
    expect(spof[0]).toMatchObject({
      category: 'reliability',
      source: 'rule',
      ruleTitle: 'Single point of failure',
    });
    expect(spof.every((f) => f.fixLabel)).toBe(true);
    const ranks = r.findings.map((f) =>
      ['info', 'warning', 'error', 'critical'].indexOf(f.severity),
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(r.findings.map((f) => f.key)).size).toBe(r.findings.length);
  });

  it('skips rules that need a result until one exists, and says why', () => {
    const r = reviewDesign({ graph: GRAPH, scenario: SCENARIO, registry });
    expect(r.skipped).toContainEqual({
      ruleId: 'rule.overloaded-node',
      reason: 'needs a simulation result',
    });
    expect(r.checked).toContain('rule.spof');
    expect(r.skipped.find((s) => s.ruleId === 'rule.queue-without-consumer')?.reason).toBe(
      'no messaging component on the board',
    );
  });

  it('filters by category', () => {
    const r = reviewDesign({
      graph: GRAPH,
      scenario: SCENARIO,
      registry,
      categories: ['performance'],
    });
    expect(r.findings.every((f) => f.category === 'performance')).toBe(true);
    expect(r.checked.every((id) => registry.require(id, 'rule').category === 'performance')).toBe(
      true,
    );
  });

  it('with a simulation: result-based rules run, engine findings are merged, stale ones dropped', () => {
    const hot: Scenario = { ...SCENARIO, usersByRegion: { 'north-america': 5_000_000 } };
    const result = simulate({ graph: GRAPH, scenario: hot }, registry);
    result.findings.push(
      {
        ruleId: 'engine.limits',
        severity: 'warning',
        title: 'Limit',
        message: 'over',
        targetIds: ['node_db'],
      },
      {
        ruleId: 'engine.route',
        severity: 'error',
        title: 'Gone',
        message: 'old node',
        targetIds: ['node_deleted'],
      },
    );
    const r = reviewDesign({ graph: GRAPH, scenario: hot, result, registry });
    expect(r.checked).toContain('rule.overloaded-node');
    expect(r.findings.some((f) => f.ruleId === 'rule.overloaded-node')).toBe(true);
    const limit = r.findings.find((f) => f.ruleId === 'engine.limits');
    expect(limit).toMatchObject({ source: 'engine', category: 'scalability' });
    expect(r.findings.some((f) => f.title === 'Gone')).toBe(false);
  });

  it('a throwing rule becomes an info finding instead of breaking the review', () => {
    const boom = defineRule({
      id: 'rule.boom',
      title: 'Boom',
      category: 'reliability',
      severity: 'error',
      tags: [],
      check: () => {
        throw new Error('kaput');
      },
      docs: { summary: 'Always throws.', why: '', howToFix: '' },
    });
    const reg: Registry = createRegistry([
      ...registry
        .list({ kind: 'component' })
        .map((entry) => ({ entry, kind: 'component' as const, source: 'app' })),
      { entry: boom, kind: 'rule', source: 'test' },
    ]);
    const r = reviewDesign({ graph: GRAPH, registry: reg });
    expect(r.findings).toEqual([
      expect.objectContaining({ ruleId: 'rule.boom', severity: 'info', message: 'kaput' }),
    ]);
  });
});

describe('ruleSkipReason', () => {
  it('matches categories, tags and component ids', () => {
    const c = reviewContext({ graph: GRAPH, registry });
    const base = registry.require('rule.spof', 'rule');
    const withA = (appliesTo: NonNullable<typeof base.appliesTo>) => ({ ...base, appliesTo });
    expect(ruleSkipReason(withA({ categories: ['database'] }), c)).toBeUndefined();
    expect(ruleSkipReason(withA({ tags: ['relational'] }), c)).toBeUndefined();
    expect(ruleSkipReason(withA({ defIds: ['compute.app-server'] }), c)).toBeUndefined();
    expect(ruleSkipReason(withA({ categories: ['storage'], tags: ['kafka'] }), c)).toBe(
      'no storage / kafka component on the board',
    );
    expect(ruleSkipReason(withA({ needs: ['scenario'] }), c)).toBe('needs a traffic scenario');
  });
});

describe('designFix', () => {
  it('returns the plan of a finding by key, re-checked on the current board', () => {
    const r = reviewDesign({ graph: GRAPH, scenario: SCENARIO, registry });
    const db = r.findings.find((f) => f.ruleId === 'rule.spof' && f.targetIds[0] === 'node_db')!;
    expect(designFix({ graph: GRAPH, scenario: SCENARIO, registry }, db.key)).toEqual({
      label: 'Turn on a standby for db',
      steps: [{ kind: 'setNodeConfig', nodeId: 'node_db', config: { highAvailability: true } }],
    });
    expect(designFix({ graph: GRAPH, registry }, 'rule.spof:node_x:nope')).toBeUndefined();
  });
});
