/** S17: the ten practice problems are complete, consistent registry data (F3 content checks). */
import { describe, expect, it } from 'vitest';
import { GraphSchema, ScenarioSchema } from '@/core';
import { registry } from '../index';
import { company, design, edgeId, nodeId, scenario, STACK } from './kit';

const problems = registry.list({ kind: 'problem' });

const EXPECTED = [
  'problem.rate-limiter',
  'problem.url-shortener',
  'problem.pastebin',
  'problem.notification-service',
  'problem.chat',
  'problem.news-feed',
  'problem.instagram',
  'problem.youtube',
  'problem.uber',
  'problem.payment-system',
  'problem.sample-ecommerce', // S22 sample reference board
  'problem.antipattern-patient-portal', // S23 anti-pattern sample board
];

describe('problem library content (S17)', () => {
  it('ships the ten problems from basic to expert, plus the S22/S23 sample boards', () => {
    expect(problems.map((p) => p.id).sort()).toEqual([...EXPECTED].sort());
    const levels = new Set(problems.map((p) => p.level));
    expect([...levels].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  describe.each(problems.map((p) => [p.id, p] as const))('%s', (_id, p) => {
    const ref = p.referenceSolutions[0]!;
    const nodes = new Set(ref.nodes.map((n) => n.id));

    it('has requirements, scale numbers, hints, a rubric and a summary', () => {
      expect(p.requirements.functional.length).toBeGreaterThanOrEqual(3);
      expect(p.requirements.nonFunctional.length).toBeGreaterThanOrEqual(3);
      expect(p.scale.dau).toBeGreaterThan(0);
      expect(p.scale.readWriteRatio).toBeGreaterThan(0);
      expect(p.scale.dataSizeBytes).toBeGreaterThan(0);
      expect(p.hints.length).toBeGreaterThanOrEqual(4);
      expect(p.rubric.some((r) => r.slo)).toBe(true);
      expect(p.docs.summary.length).toBeGreaterThan(20);
      // Anti-pattern samples carry no company style: a broken design must not be tied to a real company.
      if (!p.tags.includes('anti-pattern'))
        expect(p.tags.some((t) => t.startsWith('company:'))).toBe(true);
    });

    it('has a valid reference graph built from registry components', () => {
      expect(GraphSchema.safeParse(ref).success).toBe(true);
      for (const n of ref.nodes) {
        const def = registry.get(n.defId, 'component');
        expect(def, `${n.id} → ${n.defId}`).toBeDefined();
        expect(
          def!.instanceTypes.map((t) => t.id),
          `${n.id} instance type`,
        ).toContain(n.scaling.instanceType);
        // Config keys exist on the component and validate against its schema.
        const parsed = def!.configSchema.safeParse({ ...def!.defaults, ...n.config });
        expect(parsed.success, `${n.id} config: ${JSON.stringify(parsed.error?.issues)}`).toBe(
          true,
        );
        for (const k of Object.keys(n.config))
          expect(def!.defaults, `${n.id}.${k}`).toHaveProperty(k);
      }
      for (const e of ref.edges) {
        for (const proto of e.protocolStack) {
          expect(registry.get(proto, 'protocol'), `${e.id}: ${proto}`).toBeDefined();
        }
      }
      expect(ref.groups.filter((g) => g.kind === 'region').every((g) => g.regionId)).toBe(true);
    });

    it('debug variants (S18) are valid graphs that keep every node the flows visit', () => {
      for (const v of p.debugVariants) {
        expect(GraphSchema.safeParse(v.graph).success, v.id).toBe(true);
        const ids = new Set(v.graph.nodes.map((n) => n.id));
        for (const f of p.scenario.flows)
          for (const step of f.path)
            expect(ids.has(step.nodeId), `${v.id}: ${step.nodeId}`).toBe(true);
        for (const n of v.graph.nodes) {
          const def = registry.get(n.defId, 'component')!;
          expect(def.configSchema.safeParse({ ...def.defaults, ...n.config }).success).toBe(true);
        }
        for (const r of v.fixedWhenRulesPass ?? [])
          expect(registry.get(r, 'rule'), r).toBeDefined();
        expect(JSON.stringify(v.graph)).not.toEqual(JSON.stringify(ref));
      }
    });

    it('has a scenario preset whose flows walk the reference design', () => {
      expect(ScenarioSchema.safeParse(p.scenario).success).toBe(true);
      expect(p.scenario.flows.length).toBeGreaterThanOrEqual(2);
      const shares = p.scenario.flows.reduce((s, f) => s + f.share, 0);
      expect(shares).toBeCloseTo(1, 6);
      for (const f of p.scenario.flows) {
        expect(f.path.length).toBeGreaterThan(1);
        for (const step of f.path)
          expect(nodes.has(step.nodeId), `${f.id} → ${step.nodeId}`).toBe(true);
      }
      for (const u of Object.keys(p.scenario.usersByRegion)) {
        expect(registry.list({ kind: 'provider' }).length).toBeGreaterThan(0);
        expect(u).toMatch(/^[a-z-]+$/);
      }
    });

    it('rubric items point at real rules and flows', () => {
      const flows = new Set(p.scenario.flows.map((f) => f.id));
      for (const r of p.rubric) {
        if (r.ruleId) expect(registry.get(r.ruleId, 'rule'), r.ruleId).toBeDefined();
        if (r.slo?.flowId) expect(flows.has(r.slo.flowId), r.slo.flowId).toBe(true);
      }
    });
  });
});

describe('problem authoring kit', () => {
  it('builds prefixed ids, grid positions, groups and edges', () => {
    const g = design()
      .group('r', 'region', 'R', { regionId: 'us-east' })
      .group('s', 'subnet', 'S', { parent: 'r', zone: 'data' })
      .node('a', 'client.app', 'A', [0, 1], { type: 'browser' })
      .node('b', 'compute.app-server', 'B', [2, 0], { type: 'small', replicas: 3, group: 's' })
      .edge('a', 'b', STACK.https, { async: true, config: { timeoutMs: 5 } })
      .build();
    expect(g.groups).toEqual([
      { id: 'grp_r', kind: 'region', label: 'R', regionId: 'us-east' },
      {
        id: 'grp_s',
        kind: 'subnet',
        label: 'S',
        parentId: 'grp_r',
        security: { public: false, firewallRules: [], zone: 'data' },
      },
    ]);
    expect(g.nodes[0]).toMatchObject({ id: 'node_a', position: { x: 0, y: 140 } });
    expect(g.nodes[1]).toMatchObject({
      id: 'node_b',
      groupId: 'grp_s',
      position: { x: 480, y: 0 },
      scaling: { replicas: 3, instanceType: 'small' },
    });
    expect(g.edges[0]).toEqual({
      id: edgeId('a', 'b'),
      source: nodeId('a'),
      target: nodeId('b'),
      protocolStack: ['tcp', 'tls13', 'http2'],
      sync: false,
      config: { timeoutMs: 5 },
    });
    expect(GraphSchema.safeParse(g).success).toBe(true);
  });

  it('maps flow steps to node ids with per-step ops and defaults the rest', () => {
    const s = scenario({
      usersByRegion: { europe: 10 },
      flows: [
        {
          key: 'f',
          name: 'F',
          share: 1,
          rpsPerUser: 0.5,
          op: 'write',
          path: ['a', { key: 'b', op: 'read', cacheable: true }],
        },
      ],
    });
    expect(s.flows[0]).toEqual({
      id: 'flow_f',
      name: 'F',
      share: 1,
      rpsPerUser: 0.5,
      path: [
        { nodeId: 'node_a', op: 'write' },
        { nodeId: 'node_b', op: 'read', cacheable: true },
      ],
    });
    expect(s).toMatchObject({ peakMultiplier: 2, diurnal: false, events: [], seed: 1 });
    expect(company('meta')).toBe('company:meta');
  });
});
