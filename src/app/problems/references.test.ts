/**
 * S17 — F3 acceptance: "10 problems ship; each has requirements, scale numbers, hints and at least
 * one reference design that loads onto a board". Beyond loading, each reference is checked against
 * its own rubric: every edge is a legal connection, the SLO targets hold when the engine simulates
 * the preset scenario, no node is overloaded, and the rubric's review rules find nothing.
 */
import { describe, expect, it } from 'vitest';
import { BoardSchema, type SimResult, type SloTarget } from '@/core';
import { simulate } from '@/engine';
import { listProblems, startProblem } from '@/problems';
import { registry } from '@/registry';
import { reviewSecurity } from '@/security';
import { checkConnection, checkProtocolStack, createAppStores } from '@/store';

const problems = listProblems(registry);

function sloValue(r: SimResult, slo: SloTarget): number | undefined {
  if (slo.flowId) {
    const f = r.perFlow[slo.flowId];
    if (!f) return undefined;
    if (slo.metric === 'p50' || slo.metric === 'p95' || slo.metric === 'p99') return f[slo.metric];
    if (slo.metric === 'errorRate') return f.errorRate;
    if (slo.metric === 'rps') return f.rps;
    return undefined;
  }
  if (slo.metric === 'availability') return r.system.availability;
  if (slo.metric === 'costPerMonth') return r.system.costPerMonth;
  if (slo.metric === 'rps') return r.system.rps;
  return undefined;
}

const holds = (v: number, op: SloTarget['op'], t: number) =>
  op === 'lt' ? v < t : op === 'lte' ? v <= t : op === 'gt' ? v > t : v >= t;

describe('F3 — practice problems', () => {
  it('ships 10 problems', () => {
    expect(problems).toHaveLength(10);
  });

  describe.each(problems.map((p) => [p.title, p] as const))('%s', (_t, p) => {
    it('has requirements, scale numbers and hints', () => {
      expect(p.requirements.functional.length).toBeGreaterThan(0);
      expect(p.requirements.nonFunctional.length).toBeGreaterThan(0);
      expect(p.scale.dau * p.scale.readWriteRatio * p.scale.dataSizeBytes).toBeGreaterThan(0);
      expect(p.hints.length).toBeGreaterThan(0);
      expect(p.referenceSolutions.length).toBeGreaterThan(0);
    });

    it('loads its reference design onto a board that meets its rubric', () => {
      const { boardStore, workspaceStore } = createAppStores();
      const res = startProblem(workspaceStore, p, { mode: 'sandbox', start: 'reference' });
      expect(res.ok).toBe(true);
      const ws = workspaceStore.getState();
      const saved = ws.data.boards[ws.activeBoardId]!;
      expect(BoardSchema.safeParse(saved).success).toBe(true);
      expect(saved.problemId).toBe(p.id);

      const doc = boardStore.getState().doc;
      expect(doc.graph).toEqual(p.referenceSolutions[0]);

      // Every edge could have been drawn by hand: ports match and the stack is valid.
      for (const e of doc.graph.edges) {
        const others = { ...doc.graph, edges: doc.graph.edges.filter((x) => x.id !== e.id) };
        const c = checkConnection(registry, others, { source: e.source, target: e.target });
        expect(c.ok, `${e.id}: ${c.ok ? '' : c.reason}`).toBe(true);
        expect(checkProtocolStack(registry, doc.graph, e, e.protocolStack), e.id).toBeNull();
      }

      const result = simulate(
        { graph: doc.graph, scenario: doc.scenario, providerId: doc.providerId },
        registry,
      );
      for (const [id, n] of Object.entries(result.perNode)) {
        expect(n.utilization, `${id} utilisation`).toBeLessThan(0.85);
      }
      for (const [id, f] of Object.entries(result.perFlow)) {
        expect(f.errorRate, `${id} errors`).toBeLessThan(0.001);
        expect(f.rps, `${id} rps`).toBeGreaterThan(0);
      }
      for (const item of p.rubric) {
        if (!item.slo) continue;
        const v = sloValue(result, item.slo);
        expect(v, JSON.stringify(item.slo)).toBeDefined();
        expect(holds(v!, item.slo.op, item.slo.value), `${JSON.stringify(item.slo)} = ${v}`).toBe(
          true,
        );
      }

      const ruleIds = new Set(p.rubric.flatMap((r) => (r.ruleId ? [r.ruleId] : [])));
      const findings = reviewSecurity({
        graph: doc.graph,
        scenario: doc.scenario,
        registry,
      }).filter((f) => ruleIds.has(f.ruleId));
      expect(findings.map((f) => f.title)).toEqual([]);
    });
  });
});
